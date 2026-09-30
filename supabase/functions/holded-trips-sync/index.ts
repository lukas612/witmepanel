// Syncs Holded's own "Proyectos" feature into witme_trips/witme_trip_expenses.
// Gisel already tags one Holded project per real trip/event, and assigns
// purchase-invoice lines to it -- so the trip list and its real costs
// already exist in Holded, they just weren't reaching the panel.
//
// This coexists with manual entry in viajes.html, not replaces it: manual
// trips/expenses (holded_project_id / holded_purchase_id null) are left
// alone. For Holded-sourced rows, identity/money fields (name, dates,
// amount, expense_date) are always refreshed from Holded -- the source of
// truth for those -- but user-editable fields the team fills in by hand
// after a row first appears (destination, responsable, notes, trip
// status, expense category/description/paid_by) are only set once, on
// first insert, and never overwritten by a later sync.
//
// Call with ?dry_run=true to compute without writing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOLDED_BASE = "https://api.holded.com/api/v2";
const PAGE_LIMIT = 200;
const MAX_ITERS = 300;

function parseHoldedNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return 0;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Holded gives project dates as "DD/MM/YYYY"; everywhere else in this app
// (and in Postgres `date` columns) it's "YYYY-MM-DD".
function parseHoldedSlashDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function fetchAllPages(docType: string, apiKey: string) {
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
    if (!data?.has_more || !data?.cursor) break;
    cursor = data.cursor;
  }
  return all;
}

function docYearMonth(doc: any): { year: number; month: number } | null {
  const raw = doc.date;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function getFxRate(admin: any, year: number, month: number, currency: string): Promise<number | null> {
  if (currency === "EUR") return 1;
  const { data } = await admin
    .from("witme_holded_fx_rates")
    .select("rate_eur")
    .eq("year", year).eq("month", month).eq("currency", currency)
    .maybeSingle();
  if (data) return Number(data.rate_eur);

  const mid = new Date(Date.UTC(year, month - 1, 15));
  const dateStr = mid.toISOString().slice(0, 10);
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateStr}/v1/currencies/${currency.toLowerCase()}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const rate = json?.[currency.toLowerCase()]?.eur;
  if (typeof rate !== "number") return null;
  await admin.from("witme_holded_fx_rates").insert({ year, month, currency, rate_eur: rate, source: "fawazahmed0 (auto, holded-trips-sync)" });
  return rate;
}

// Best-effort category guess from the vendor/description -- only used on
// first insert of a Holded-sourced expense; the team can recategorize
// freely afterwards in viajes.html and it will stick.
function guessCategory(contactName: string, description: string): string {
  const s = `${contactName} ${description}`.toLowerCase();
  if (/trip\.com|kiwi\.com|vuelo|flight|airlines|iberia|ryanair|vueling|air europa|easyjet|wizz ?air|lot sa|polskie linie lotnicze|edreams/.test(s)) return "vuelo";
  if (/hotel|apartment|hostal|booking\.com|bookings online|red universal de marketing|airbnb|meli[aá]|nh hoteles|catalonia/.test(s)) return "alojamiento";
  if (/taxi|uber|cabify|safedriver|renfe|parking|rentalcar|hertz|europcar|transporte|aena|pkp intercity|duty free/.test(s)) return "transporte";
  if (/restaurante|catering|dietas|comida|cafe |café|caf[eé] |bagatelle|caprabo|fogo de chao|portier eats|juan valdez|procafecol|takami|taqueria|delimex/.test(s)) return "dietas";
  if (/evento|stand|feria|conference|forum|congreso|summit|internetcorp/.test(s)) return "evento";
  if (/regalo|obsequio|merchandising|holeinone|hole in one/.test(s)) return "regalos";
  return "otros";
}

function deriveStatus(project: any, startDate: string | null): string {
  if (project.archived) return "cerrado";
  if (!startDate) return "planeado";
  const today = new Date().toISOString().slice(0, 10);
  return startDate <= today ? "en_curso" : "planeado";
}

type ExpenseRow = {
  holded_purchase_id: string; holded_line_id: string; holded_project_id: string;
  amount_eur: number; expense_date: string | null; contact_name: string; description: string;
};

// One purchase doc's subtotal attributed to project(s): if every tagged
// line points at the same project, treat the whole document as one
// expense (line_id "doc") so a document with several lines for the same
// trip doesn't fragment into noise; a document split across projects is
// prorated per line instead.
function docExpenseRows(doc: any, sign: 1 | -1): ExpenseRow[] {
  const lines = doc.lines || [];
  const projectIds = new Set(lines.map((l: any) => l.project_id).filter(Boolean));
  if (projectIds.size === 0) return [];
  const ym = docYearMonth(doc);
  const contactName = doc.contact_name || "";
  const description = doc.description || doc.document_number || "";

  if (projectIds.size === 1) {
    const projectId = [...projectIds][0] as string;
    return [{
      holded_purchase_id: doc.id, holded_line_id: "doc", holded_project_id: projectId,
      amount_eur: sign * parseHoldedNumber(doc.subtotal),
      expense_date: doc.date || null, contact_name: contactName, description,
    }];
  }
  const out: ExpenseRow[] = [];
  for (const l of lines) {
    if (!l.project_id) continue;
    const amount = parseHoldedNumber(l.price) * parseHoldedNumber(l.units) - parseHoldedNumber(l.discount);
    out.push({
      holded_purchase_id: doc.id, holded_line_id: l.line_id, holded_project_id: l.project_id,
      amount_eur: sign * amount, expense_date: doc.date || null, contact_name: contactName,
      description: l.description || l.name || description,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: apiKey, error: secretErr } = await admin.rpc("witme_get_secret", { secret_name: "holded_api_key" });
    if (secretErr || !apiKey) throw new Error(`Could not read holded_api_key from Vault: ${secretErr?.message}`);

    const [projects, purchases, refunds] = await Promise.all([
      fetchAllPages("projects", apiKey),
      fetchAllPages("purchases", apiKey),
      fetchAllPages("purchase-refunds", apiKey),
    ]);

    const rawRows: ExpenseRow[] = [
      ...purchases.flatMap((d: any) => docExpenseRows(d, 1)),
      ...refunds.flatMap((d: any) => docExpenseRows(d, -1)),
    ];

    // Resolve FX rates once per (year, month, currency) across the docs we'll touch.
    const currencyByDoc = new Map<string, string>();
    for (const d of [...purchases, ...refunds]) currencyByDoc.set(d.id, String(d.currency || "EUR").toUpperCase());
    const pairs = new Set<string>();
    for (const d of [...purchases, ...refunds]) {
      const ym = docYearMonth(d);
      if (!ym) continue;
      pairs.add(`${ym.year}-${ym.month}-${currencyByDoc.get(d.id)}`);
    }
    const rates = new Map<string, number | null>();
    for (const key of pairs) {
      const [y, m, currency] = key.split("-");
      rates.set(key, await getFxRate(admin, Number(y), Number(m), currency));
    }
    const docById = new Map([...purchases, ...refunds].map((d: any) => [d.id, d]));
    for (const row of rawRows) {
      const doc = docById.get(row.holded_purchase_id);
      const ym = docYearMonth(doc);
      const currency = currencyByDoc.get(row.holded_purchase_id) || "EUR";
      const rate = currency === "EUR" ? 1 : (ym ? rates.get(`${ym.year}-${ym.month}-${currency}`) : null);
      row.amount_eur = rate != null ? round2(row.amount_eur * rate) : NaN;
    }
    const validRows = rawRows.filter((r) => !isNaN(r.amount_eur));

    const summary: Record<string, unknown> = {
      dryRun,
      fetched: { projects: projects.length, purchases: purchases.length, refunds: refunds.length },
      expenseRows: validRows.length,
      skippedNoRate: rawRows.length - validRows.length,
    };

    if (dryRun) {
      summary.projects = projects.map((p: any) => ({ id: p.id, name: p.name, start_date: p.start_date, archived: p.archived }));
      summary.sampleExpenses = validRows.slice(0, 10);
      return new Response(JSON.stringify(summary, null, 2), { headers: { "content-type": "application/json" } });
    }

    // ---- Trips: one per Holded project ----
    const { data: existingTrips, error: tripsSelErr } = await admin
      .from("witme_trips")
      .select("id, holded_project_id, name, start_date, end_date")
      .not("holded_project_id", "is", null);
    if (tripsSelErr) throw tripsSelErr;
    const tripByProjectId = new Map((existingTrips || []).map((t: any) => [t.holded_project_id, t]));

    let tripsInserted = 0, tripsUpdated = 0;
    for (const p of projects) {
      const startDate = parseHoldedSlashDate(p.start_date);
      const endDate = parseHoldedSlashDate(p.due_date);
      const existing = tripByProjectId.get(p.id);
      if (!existing) {
        const users = Object.values(p.users || {}) as any[];
        const responsable = users[0]?.name || null;
        const { error } = await admin.from("witme_trips").insert({
          holded_project_id: p.id, name: p.name, start_date: startDate || new Date().toISOString().slice(0, 10),
          end_date: endDate, responsable, status: deriveStatus(p, startDate), notes: p.description || null,
          created_by: "holded-trips-sync",
        });
        if (error) throw error;
        tripsInserted++;
      } else if (existing.name !== p.name || existing.start_date !== startDate || existing.end_date !== endDate) {
        const { error } = await admin.from("witme_trips").update({
          name: p.name, start_date: startDate || existing.start_date, end_date: endDate,
        }).eq("id", existing.id);
        if (error) throw error;
        tripsUpdated++;
      }
    }

    // Re-select including any just-inserted trips, to map project_id -> trip UUID for expenses.
    const { data: allTrips, error: allTripsErr } = await admin
      .from("witme_trips").select("id, holded_project_id").not("holded_project_id", "is", null);
    if (allTripsErr) throw allTripsErr;
    const tripIdByProjectId = new Map((allTrips || []).map((t: any) => [t.holded_project_id, t.id]));

    // ---- Expenses ----
    const { data: existingExpenses, error: expSelErr } = await admin
      .from("witme_trip_expenses")
      .select("id, holded_purchase_id, holded_line_id, amount_eur, expense_date")
      .not("holded_purchase_id", "is", null);
    if (expSelErr) throw expSelErr;
    const expenseByKey = new Map((existingExpenses || []).map((e: any) => [`${e.holded_purchase_id}:${e.holded_line_id}`, e]));

    let expInserted = 0, expUpdated = 0, expSkippedNoTrip = 0;
    for (const row of validRows) {
      const tripId = tripIdByProjectId.get(row.holded_project_id);
      if (!tripId) { expSkippedNoTrip++; continue; }
      const key = `${row.holded_purchase_id}:${row.holded_line_id}`;
      const existing = expenseByKey.get(key);
      if (!existing) {
        const { error } = await admin.from("witme_trip_expenses").insert({
          trip_id: tripId, holded_purchase_id: row.holded_purchase_id, holded_line_id: row.holded_line_id,
          category: guessCategory(row.contact_name, row.description),
          description: row.contact_name || row.description || null,
          amount_eur: row.amount_eur, expense_date: row.expense_date, paid_by: "Holded",
          created_by: "holded-trips-sync",
        });
        if (error) throw error;
        expInserted++;
      } else if (Number(existing.amount_eur) !== row.amount_eur || existing.expense_date !== row.expense_date) {
        const { error } = await admin.from("witme_trip_expenses")
          .update({ amount_eur: row.amount_eur, expense_date: row.expense_date }).eq("id", existing.id);
        if (error) throw error;
        expUpdated++;
      }
    }

    summary.written = { tripsInserted, tripsUpdated, expInserted, expUpdated, expSkippedNoTrip };
    return new Response(JSON.stringify(summary, null, 2), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }, null, 2), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
