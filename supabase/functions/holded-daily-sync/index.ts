// Daily refresh of witme_invoiced_monthly ("Facturado") and
// witme_purchased_monthly ("Comprado") from the Holded API, following the
// same logic documented in README.md ("Facturado (Holded) vs generado" /
// "Comprado y resultado (Holded)"):
//   invoiced  = sum(subtotal of /api/v2/invoices)  - sum(subtotal of /api/v2/credit-notes)
//   purchased = sum(subtotal of /api/v2/purchases) - sum(subtotal of /api/v2/purchase-refunds)
// grouped by (year, month, currency) of the document's `date`, then
// converted to EUR via witme_holded_fx_rates (missing rates are fetched
// from the fawazahmed0 currency-api and cached).
//
// Only a rolling window (current month + REFRESH_MONTHS_BACK previous
// months) is recomputed and overwritten each run, to catch late invoices
// and credit notes without touching untouched historical months.
//
// Call with ?dry_run=true to compute and return the aggregates without
// writing anything (used to validate the logic before enabling the cron).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOLDED_BASE = "https://api.holded.com/api/v2";
const PAGE_LIMIT = 200;
const MAX_ITERS = 300; // safety cap per document type (~60,000 docs) if the early-exit below never triggers
const REFRESH_MONTHS_BACK = 2; // + current month = 3-month rolling window

function monthKeyNum(year: number, month: number) {
  return year * 100 + month;
}

function currentWindow() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  let py = y, pm = m - REFRESH_MONTHS_BACK;
  while (pm < 1) { pm += 12; py -= 1; }
  return { min: monthKeyNum(py, pm), max: monthKeyNum(y, m), maxYear: y, maxMonth: m };
}

function monthsInWindow(min: number, max: number) {
  const out: { year: number; month: number }[] = [];
  let mk = min;
  while (mk <= max) {
    const year = Math.floor(mk / 100), month = mk % 100;
    out.push({ year, month });
    mk = month === 12 ? (year + 1) * 100 + 1 : year * 100 + (month + 1);
  }
  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Holded returns amounts as Spanish-formatted strings, e.g. "3.780,00" or
// "16070,22" (comma decimal separator, optional dot thousands separator).
function parseHoldedNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return 0;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Holded's list endpoints use cursor-based pagination: the response carries
// {items, cursor, has_more}, and the next request must pass that exact
// cursor value back as ?cursor=... (a "page" query param is silently
// ignored -- confirmed by live testing, not from the docs). Documents come
// back newest-first, so once a full page is entirely older than the
// refresh window we can stop early instead of paging through all history.
async function fetchDocs(docType: string, apiKey: string, win: { min: number; max: number }) {
  const all: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_ITERS; i++) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`${HOLDED_BASE}/${docType}?${qs.toString()}`, {
      headers: { "Authorization": `Bearer ${apiKey}`, "accept": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Holded ${docType} iter ${i}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) break;
    all.push(...items);

    const allBelowWindow = items.every((doc) => {
      const ym = docYearMonth(doc);
      return ym != null && monthKeyNum(ym.year, ym.month) < win.min;
    });
    if (allBelowWindow) break;

    if (!data?.has_more || !data?.cursor) break;
    cursor = data.cursor;
  }
  return all;
}

function docYearMonth(doc: any): { year: number; month: number } | null {
  const raw = doc.date;
  let d: Date;
  if (typeof raw === "number") {
    d = new Date(raw < 2e10 ? raw * 1000 : raw); // seconds vs milliseconds guard
  } else if (typeof raw === "string") {
    d = new Date(raw);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

type AggRow = { year: number; month: number; currency: string; total: number; count: number };

function accumulate(agg: Map<string, AggRow>, docs: any[], sign: 1 | -1, isPrimary: boolean, win: { min: number; max: number }) {
  for (const doc of docs) {
    const ym = docYearMonth(doc);
    if (!ym) continue;
    const mk = monthKeyNum(ym.year, ym.month);
    if (mk < win.min || mk > win.max) continue;
    const currency = String(doc.currency || "EUR").toUpperCase();
    const subtotal = parseHoldedNumber(doc.subtotal);
    const key = `${ym.year}-${ym.month}-${currency}`;
    const cur = agg.get(key) || { year: ym.year, month: ym.month, currency, total: 0, count: 0 };
    cur.total += sign * subtotal;
    if (isPrimary) cur.count += 1;
    agg.set(key, cur);
  }
}

async function getFxRate(admin: any, year: number, month: number, currency: string): Promise<{ rate: number | null; fetchedNew: boolean }> {
  if (currency === "EUR") return { rate: 1, fetchedNew: false };
  const { data } = await admin
    .from("witme_holded_fx_rates")
    .select("rate_eur")
    .eq("year", year).eq("month", month).eq("currency", currency)
    .maybeSingle();
  if (data) return { rate: Number(data.rate_eur), fetchedNew: false };

  const mid = new Date(Date.UTC(year, month - 1, 15));
  const dateStr = mid.toISOString().slice(0, 10);
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateStr}/v1/currencies/${currency.toLowerCase()}.json`;
  const res = await fetch(url);
  if (!res.ok) return { rate: null, fetchedNew: false };
  const json = await res.json();
  const rate = json?.[currency.toLowerCase()]?.eur;
  if (typeof rate !== "number") return { rate: null, fetchedNew: false };
  await admin.from("witme_holded_fx_rates").insert({ year, month, currency, rate_eur: rate, source: "fawazahmed0 (auto, holded-daily-sync)" });
  return { rate, fetchedNew: true };
}

async function upsertMonthly(admin: any, table: string, agg: Map<string, AggRow>, win: { min: number; max: number }, totalField: string, eurField: string, countField: string) {
  for (const { year, month } of monthsInWindow(win.min, win.max)) {
    const { error } = await admin.from(table).delete().eq("year", year).eq("month", month);
    if (error) throw error;
  }
  const rowsOut = [];
  let fxFetched = 0;
  for (const v of agg.values()) {
    const { rate, fetchedNew } = await getFxRate(admin, v.year, v.month, v.currency);
    if (fetchedNew) fxFetched++;
    const row: Record<string, unknown> = {
      year: v.year, month: v.month, currency: v.currency,
      [totalField]: round2(v.total),
      [countField]: v.count,
    };
    row[eurField] = rate != null ? round2(v.total * rate) : null;
    rowsOut.push(row);
  }
  if (rowsOut.length) {
    const { error } = await admin.from(table).insert(rowsOut);
    if (error) throw error;
  }
  return { rows: rowsOut, fxFetched };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";
    const win = currentWindow();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: apiKey, error: secretErr } = await admin.rpc("witme_get_secret", { secret_name: "holded_api_key" });
    if (secretErr || !apiKey) {
      throw new Error(`Could not read holded_api_key from Vault: ${secretErr?.message}`);
    }

    const [invoices, creditNotes, purchases, purchaseRefunds] = await Promise.all([
      fetchDocs("invoices", apiKey, win),
      fetchDocs("credit-notes", apiKey, win),
      fetchDocs("purchases", apiKey, win),
      fetchDocs("purchase-refunds", apiKey, win),
    ]);

    const invoicedAgg = new Map<string, AggRow>();
    accumulate(invoicedAgg, invoices, 1, true, win);
    accumulate(invoicedAgg, creditNotes, -1, false, win);

    const purchasedAgg = new Map<string, AggRow>();
    accumulate(purchasedAgg, purchases, 1, true, win);
    accumulate(purchasedAgg, purchaseRefunds, -1, false, win);

    const summary: Record<string, unknown> = {
      window: win,
      fetched: { invoices: invoices.length, creditNotes: creditNotes.length, purchases: purchases.length, purchaseRefunds: purchaseRefunds.length },
      invoiced: [...invoicedAgg.values()],
      purchased: [...purchasedAgg.values()],
      dryRun,
    };

    if (!dryRun) {
      const invoicedResult = await upsertMonthly(admin, "witme_invoiced_monthly", invoicedAgg, win, "invoiced_total", "invoiced_eur", "invoice_count");
      const purchasedResult = await upsertMonthly(admin, "witme_purchased_monthly", purchasedAgg, win, "purchased_total", "purchased_eur", "purchase_count");
      summary.written = { invoiced: invoicedResult.rows.length, purchased: purchasedResult.rows.length, fxRatesFetched: invoicedResult.fxFetched + purchasedResult.fxFetched };

      const nowIso = new Date().toISOString();
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, covers_until_year: win.maxYear, covers_until_month: win.maxMonth, updated_by: "holded-daily-sync",
      }).eq("key", "facturado");
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, covers_until_year: win.maxYear, covers_until_month: win.maxMonth, updated_by: "holded-daily-sync",
      }).eq("key", "comprado");
    }

    return new Response(JSON.stringify(summary, null, 2), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }, null, 2), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
