// Manually-triggered sync for Panama invoicing (EBI-PAC). Unlike
// holded-daily-sync, this is never scheduled by pg_cron: EBI-PAC's Web
// Service has no list/query-by-date method, only single-document ops
// (Enviar, EstadoDocumento, DescargaXML/PDF...). The only place that lists
// invoices is the CAPTCHA-gated human web portal
// (factura.ebi-pac.com/invoices), authenticated by a plain Laravel session
// cookie with no durable token. So a human logs into that portal, copies
// the session cookie from DevTools, and pastes it into panama.html's
// "Actualizar" button, which POSTs it here. This function does the actual
// pagination/aggregation/write server-to-server (browsers can't send an
// arbitrary Cookie header themselves -- it's a forbidden header name in
// fetch()), then discards the cookie -- it's never stored.
//
// POST body: { cookie: string }
// Caller must be one of the witme team emails (checked from their own
// Supabase session JWT, not the service role -- this endpoint is reachable
// from a public page, so it enforces the same allowlist RLS would).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_EMAILS = ["lukas@witme.es", "lukas@lukasochoa.com", "gferreyra@witme.es", "freddy@witme.es"];

// This function is called directly from the browser (panama.html), so it
// needs CORS: the preflight OPTIONS request and every real response must
// carry these headers, or fetch() fails with an opaque "Failed to fetch"
// before the request ever reaches this code.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const EBIPAC_BASE = "https://factura.ebi-pac.com";
const PAGE_SIZE = 200;
const MAX_ITERS = 50;

const COLUMNS = ["issue_date", "issue_datetime", "description", "code_cat_document_type", "document_id",
  "identification_number_receptor", "business_name", "total_amount", "name", "subsidiary", "subsidiary_point", "actions"];
const ORDERABLE = new Set(["issue_date", "issue_datetime", "code_cat_document_type", "document_id", "business_name", "name"]);

// The portal's date-range picker feeds a per-column search value on
// issue_datetime (column 1), formatted "YYYY-MM-DD HH:MM:SS - YYYY-MM-DD
// HH:MM:SS" -- without it, the table defaults to a narrow recent window
// (confirmed live: it silently hid ~230 older documents). A generous fixed
// range covers all real history without needing maintenance.
const DATE_RANGE = "2015-01-01 00:00:00 - 2035-12-31 23:59:00";

function buildUrl(start: number, length: number) {
  const params = new URLSearchParams();
  params.set("draw", "1");
  COLUMNS.forEach((c, i) => {
    params.set(`columns[${i}][data]`, c);
    params.set(`columns[${i}][name]`, "");
    params.set(`columns[${i}][searchable]`, "true");
    params.set(`columns[${i}][orderable]`, String(ORDERABLE.has(c)));
    params.set(`columns[${i}][search][value]`, c === "issue_datetime" ? DATE_RANGE : "");
    params.set(`columns[${i}][search][regex]`, "false");
  });
  params.set("order[0][column]", "0");
  params.set("order[0][dir]", "desc");
  params.set("start", String(start));
  params.set("length", String(length));
  params.set("search[value]", "");
  params.set("search[regex]", "false");
  params.set("_", String(Date.now()));
  return `${EBIPAC_BASE}/invoices/list?${params.toString()}`;
}

async function fetchAll(cookie: string) {
  const all: any[] = [];
  let start = 0;
  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetch(buildUrl(start, PAGE_SIZE), {
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        "referer": `${EBIPAC_BASE}/invoices`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "cookie": cookie,
      },
    });
    if (res.status === 401) throw new Error("EBI-PAC rechazó la cookie (401) -- vuelve a iniciar sesión en el portal y copia una cookie nueva.");
    if (!res.ok) throw new Error(`EBI-PAC HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return all;
}

type Agg = { year: number; month: number; total: number; invoiceCount: number; creditCount: number };

// The `name` field carries the DGI status as HTML (e.g. a green "Aceptado"
// badge). Annulled/rejected/pending documents stay in the list (there's an
// "Anular este documento" action, so annulment is a real state here) but
// must not be counted -- only documents DGI actually accepted are real.
function documentStatus(row: any): string {
  return String(row.name || "").replace(/<[^>]*>/g, "").trim();
}

function aggregate(rows: any[]): { monthly: Agg[]; excluded: Record<string, number> } {
  const agg = new Map<string, Agg>();
  const excluded: Record<string, number> = {};
  for (const r of rows) {
    const status = documentStatus(r);
    if (!/aceptado/i.test(status)) {
      excluded[status || "(sin estado)"] = (excluded[status || "(sin estado)"] || 0) + 1;
      continue;
    }
    const isCredit = /cr[eé]dito/i.test(r.code_cat_document_type || "");
    const [, mm, yyyy] = String(r.issue_date).split("-").map(Number);
    const key = `${yyyy}-${mm}`;
    const cur = agg.get(key) || { year: yyyy, month: mm, total: 0, invoiceCount: 0, creditCount: 0 };
    const amount = Number(r.total_amount);
    cur.total += isCredit ? -amount : amount;
    if (isCredit) cur.creditCount++; else cur.invoiceCount++;
    agg.set(key, cur);
  }
  const monthly = [...agg.values()].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
  return { monthly, excluded };
}

function callerEmail(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.email ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const email = callerEmail(req);
    if (!email || !ALLOWED_EMAILS.includes(email)) {
      return new Response(JSON.stringify({ error: "No autorizado." }), { status: 403, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    const body = await req.json().catch(() => ({}));
    const cookie = body?.cookie;
    if (!cookie || typeof cookie !== "string") {
      return new Response(JSON.stringify({ error: "Falta la cookie de sesión del portal." }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
    }

    const rows = await fetchAll(cookie);
    const { monthly, excluded } = aggregate(rows);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    for (const m of monthly) {
      const { error } = await admin.from("witme_panama_invoiced_monthly").upsert({
        year: m.year, month: m.month, currency: "USD",
        invoiced_total: Math.round(m.total * 100) / 100,
        invoice_count: m.invoiceCount, credit_count: m.creditCount,
        last_pulled_at: new Date().toISOString(),
      }, { onConflict: "year,month,currency" });
      if (error) throw error;
    }

    const last = monthly[monthly.length - 1];
    if (last) {
      await admin.from("witme_data_sources").update({
        last_updated_at: new Date().toISOString(),
        covers_until_year: last.year, covers_until_month: last.month,
        updated_by: email,
      }).eq("key", "facturado_panama");
    }

    return new Response(JSON.stringify({
      documentsFetched: rows.length,
      monthsUpdated: monthly.map((m) => ({ year: m.year, month: m.month, total: m.total, invoiceCount: m.invoiceCount, creditCount: m.creditCount })),
      excludedByStatus: excluded,
      excludedCount: Object.values(excluded).reduce((a, b) => a + b, 0),
    }, null, 2), { headers: { "content-type": "application/json", ...CORS_HEADERS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500, headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }
});
