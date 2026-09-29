// Daily refresh of witme_invoiced_monthly ("Facturado"), witme_purchased_monthly
// ("Comprado"), witme_client_invoiced_monthly ("Revisión de clientes" / Matriz)
// and witme_unpaid_invoices ("Impagados") from the Holded API, following the
// same logic documented in README.md:
//   invoiced  = sum(subtotal of /api/v2/invoices)  - sum(subtotal of /api/v2/credit-notes)
//   purchased = sum(subtotal of /api/v2/purchases) - sum(subtotal of /api/v2/purchase-refunds)
// grouped by (year, month, currency) of the document's `date`, then
// converted to EUR via witme_holded_fx_rates (missing rates are fetched
// from the fawazahmed0 currency-api and cached).
//
// witme_invoiced_monthly / witme_purchased_monthly only recompute a rolling
// window (current month + REFRESH_MONTHS_BACK previous months), to catch
// late invoices/credit notes without touching untouched historical months.
//
// witme_client_invoiced_monthly needs a wider rolling window
// (CLIENT_MONTHS_BACK previous months + current) so every month of the
// current year keeps its 3 prior months for comparison -- it's not full
// history, just enough for the "Revisión de clientes" alerts.
//
// witme_unpaid_invoices is a snapshot, not a monthly series: it's rebuilt
// from ALL still-open (pending/partial) invoices regardless of age, and
// rows for invoices that got paid/cancelled/no longer pending are deleted
// so the table always reflects the current state exactly.
//
// Call with ?dry_run=true to compute and return the aggregates without
// writing anything (used to validate the logic before enabling the cron).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOLDED_BASE = "https://api.holded.com/api/v2";
const PAGE_LIMIT = 200;
const MAX_ITERS = 300; // safety cap per document type (~60,000 docs) if the early-exit below never triggers
const REFRESH_MONTHS_BACK = 2; // + current month = 3-month rolling window (invoiced/purchased monthly totals)
const CLIENT_MONTHS_BACK = 11; // + current month = 12-month rolling window (per-client invoicing)
const FULL_HISTORY_MIN = 200001; // year 2000, month 1 -- effectively "no early exit" for invoices/credit-notes

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

function windowBack(monthsBack: number, maxYear: number, maxMonth: number) {
  let py = maxYear, pm = maxMonth - monthsBack;
  while (pm < 1) { pm += 12; py -= 1; }
  return { min: monthKeyNum(py, pm), max: monthKeyNum(maxYear, maxMonth) };
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
// back newest-first, so once a full page is entirely older than `win.min`
// we can stop early instead of paging through all history -- pass
// FULL_HISTORY_MIN as win.min to disable that early exit and fetch
// everything (used for invoices/credit-notes, needed by impagados).
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

async function fetchContacts(apiKey: string) {
  const map = new Map<string, { country: string | null; country_code: string | null }>();
  let cursor: string | null = null;
  for (let i = 0; i < MAX_ITERS; i++) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`${HOLDED_BASE}/contacts?${qs.toString()}`, {
      headers: { "Authorization": `Bearer ${apiKey}`, "accept": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Holded contacts iter ${i}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) break;
    for (const c of items) {
      map.set(c.id, {
        country: c.bill_address?.country ?? null,
        country_code: c.bill_address?.country_code ?? null,
      });
    }
    if (!data?.has_more || !data?.cursor) break;
    cursor = data.cursor;
  }
  return map;
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
  await admin.from("witme_holded_fx_rates").insert({ year, month, currency, rate_eur: rate, source: "fawazahmed0 (auto, holded-daily-sync)" });
  return rate;
}

// Resolves and caches every (year, month, currency) rate a batch of
// documents needs in one pass, so the per-document accumulation below can
// stay synchronous instead of awaiting a rate lookup per document.
async function resolveRates(admin: any, docs: any[]): Promise<Map<string, number | null>> {
  const pairs = new Set<string>();
  for (const doc of docs) {
    const ym = docYearMonth(doc);
    if (!ym) continue;
    const currency = String(doc.currency || "EUR").toUpperCase();
    pairs.add(`${ym.year}-${ym.month}-${currency}`);
  }
  const rates = new Map<string, number | null>();
  for (const key of pairs) {
    const [y, m, currency] = key.split("-");
    rates.set(key, await getFxRate(admin, Number(y), Number(m), currency));
  }
  return rates;
}

function rateKey(year: number, month: number, currency: string) {
  return `${year}-${month}-${currency.toUpperCase()}`;
}

async function upsertMonthly(admin: any, table: string, agg: Map<string, AggRow>, win: { min: number; max: number }, totalField: string, eurField: string, countField: string) {
  for (const { year, month } of monthsInWindow(win.min, win.max)) {
    const { error } = await admin.from(table).delete().eq("year", year).eq("month", month);
    if (error) throw error;
  }
  const rowsOut = [];
  for (const v of agg.values()) {
    const rate = await getFxRate(admin, v.year, v.month, v.currency);
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
  return { rows: rowsOut };
}

// ---------------- Part 4: per-client monthly invoicing ----------------

type ClientRow = { year: number; month: number; contact_id: string; invoiced_eur: number; invoice_count: number; invoice_ids: string[] };

function accumulateClient(
  agg: Map<string, ClientRow>,
  docs: any[],
  sign: 1 | -1,
  isInvoice: boolean,
  win: { min: number; max: number },
  rates: Map<string, number | null>,
  contactNames: Map<string, string>,
) {
  for (const doc of docs) {
    const ym = docYearMonth(doc);
    if (!ym) continue;
    const mk = monthKeyNum(ym.year, ym.month);
    if (mk < win.min || mk > win.max) continue;
    const contactId = doc.contact_id;
    if (!contactId) continue;
    if (doc.contact_name && !contactNames.has(contactId)) contactNames.set(contactId, doc.contact_name);

    const currency = String(doc.currency || "EUR").toUpperCase();
    const rate = currency === "EUR" ? 1 : rates.get(rateKey(ym.year, ym.month, currency));
    if (rate == null) continue; // no fx rate resolvable -- skip rather than guess
    const eur = parseHoldedNumber(doc.subtotal) * rate;

    const key = `${ym.year}-${ym.month}-${contactId}`;
    const cur = agg.get(key) || { year: ym.year, month: ym.month, contact_id: contactId, invoiced_eur: 0, invoice_count: 0, invoice_ids: [] as string[] };
    cur.invoiced_eur += sign * eur;
    if (isInvoice) {
      cur.invoice_count += 1;
      cur.invoice_ids.push(doc.id); // docs iterate newest-first, so this stays newest-first per key
    }
    agg.set(key, cur);
  }
}

async function upsertClientInvoiced(admin: any, agg: Map<string, ClientRow>, contactNames: Map<string, string>, win: { min: number; max: number }) {
  // select existing rows in-window first, so we only write ones that changed
  const months = monthsInWindow(win.min, win.max);
  const { data: existingRows, error: selErr } = await admin
    .from("witme_client_invoiced_monthly")
    .select("year, month, contact_id, contact_name, invoiced_eur, invoice_count, invoice_ids")
    .gte("year", months[0].year)
    .lte("year", months[months.length - 1].year);
  if (selErr) throw selErr;

  const existing = new Map<string, any>();
  for (const r of existingRows || []) {
    const mk = monthKeyNum(r.year, r.month);
    if (mk < win.min || mk > win.max) continue;
    existing.set(`${r.year}-${r.month}-${r.contact_id}`, r);
  }

  const rowsOut = [];
  for (const [key, v] of agg.entries()) {
    const contact_name = contactNames.get(v.contact_id) || existing.get(key)?.contact_name || v.contact_id;
    const invoiced_eur = round2(v.invoiced_eur);
    const prev = existing.get(key);
    const changed = !prev
      || Number(prev.invoiced_eur) !== invoiced_eur
      || Number(prev.invoice_count) !== v.invoice_count
      || JSON.stringify(prev.invoice_ids || []) !== JSON.stringify(v.invoice_ids);
    if (!changed) continue;
    rowsOut.push({
      year: v.year, month: v.month, contact_id: v.contact_id, contact_name,
      invoiced_eur, invoice_count: v.invoice_count, invoice_ids: v.invoice_ids,
    });
  }
  if (rowsOut.length) {
    const { error } = await admin.from("witme_client_invoiced_monthly").upsert(rowsOut, { onConflict: "year,month,contact_id" });
    if (error) throw error;
  }
  return { changed: rowsOut.length };
}

// ---------------- Part 5: impagados snapshot ----------------

async function upsertUnpaidInvoices(admin: any, invoices: any[], rates: Map<string, number | null>, contacts: Map<string, { country: string | null; country_code: string | null }>) {
  const pending = invoices.filter((doc) => doc.status === "pending" || doc.status === "partial");

  const rowsOut = pending.map((doc) => {
    const ym = docYearMonth(doc);
    const currency = String(doc.currency || "EUR").toUpperCase();
    const rate = currency === "EUR" ? 1 : (ym ? rates.get(rateKey(ym.year, ym.month, currency)) : null);
    const paymentsPending = parseHoldedNumber(doc.payments_pending);
    const contact = contacts.get(doc.contact_id) || { country: null, country_code: null };
    return {
      invoice_id: doc.id,
      document_number: doc.document_number ?? null,
      contact_id: doc.contact_id ?? null,
      contact_name: doc.contact_name ?? null,
      date: doc.date,
      due_date: doc.due_date ?? null,
      currency,
      total: parseHoldedNumber(doc.total),
      payments_pending: paymentsPending,
      pending_eur: rate != null ? round2(paymentsPending * rate) : null,
      status: doc.status,
      contact_country: contact.country,
      contact_country_code: contact.country_code,
    };
  });

  const currentIds = new Set(rowsOut.map((r) => r.invoice_id));
  const { data: existingIdRows, error: selErr } = await admin.from("witme_unpaid_invoices").select("invoice_id");
  if (selErr) throw selErr;
  const toDelete = (existingIdRows || []).map((r: any) => r.invoice_id).filter((id: string) => !currentIds.has(id));

  if (rowsOut.length) {
    const { error } = await admin.from("witme_unpaid_invoices").upsert(rowsOut, { onConflict: "invoice_id" });
    if (error) throw error;
  }
  if (toDelete.length) {
    const { error } = await admin.from("witme_unpaid_invoices").delete().in("invoice_id", toDelete);
    if (error) throw error;
  }
  return { current: rowsOut.length, deleted: toDelete.length };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";
    const win = currentWindow();
    const clientWin = windowBack(CLIENT_MONTHS_BACK, win.maxYear, win.maxMonth);
    const fullWin = { min: FULL_HISTORY_MIN, max: win.max };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: apiKey, error: secretErr } = await admin.rpc("witme_get_secret", { secret_name: "holded_api_key" });
    if (secretErr || !apiKey) {
      throw new Error(`Could not read holded_api_key from Vault: ${secretErr?.message}`);
    }

    // Invoices/credit-notes are fetched in full (fullWin has no effective
    // early exit) since impagados needs the entire history; purchases only
    // ever need the narrow rolling window.
    const [invoices, creditNotes, purchases, purchaseRefunds, contacts] = await Promise.all([
      fetchDocs("invoices", apiKey, fullWin),
      fetchDocs("credit-notes", apiKey, fullWin),
      fetchDocs("purchases", apiKey, win),
      fetchDocs("purchase-refunds", apiKey, win),
      fetchContacts(apiKey),
    ]);

    const invoicedAgg = new Map<string, AggRow>();
    accumulate(invoicedAgg, invoices, 1, true, win);
    accumulate(invoicedAgg, creditNotes, -1, false, win);

    const purchasedAgg = new Map<string, AggRow>();
    accumulate(purchasedAgg, purchases, 1, true, win);
    accumulate(purchasedAgg, purchaseRefunds, -1, false, win);

    const rates = await resolveRates(admin, [...invoices, ...creditNotes]);

    const clientAgg = new Map<string, ClientRow>();
    const contactNames = new Map<string, string>();
    accumulateClient(clientAgg, invoices, 1, true, clientWin, rates, contactNames);
    accumulateClient(clientAgg, creditNotes, -1, false, clientWin, rates, contactNames);

    const summary: Record<string, unknown> = {
      window: win,
      clientWindow: clientWin,
      fetched: { invoices: invoices.length, creditNotes: creditNotes.length, purchases: purchases.length, purchaseRefunds: purchaseRefunds.length, contacts: contacts.size },
      invoiced: [...invoicedAgg.values()],
      purchased: [...purchasedAgg.values()],
      dryRun,
    };

    if (!dryRun) {
      const invoicedResult = await upsertMonthly(admin, "witme_invoiced_monthly", invoicedAgg, win, "invoiced_total", "invoiced_eur", "invoice_count");
      const purchasedResult = await upsertMonthly(admin, "witme_purchased_monthly", purchasedAgg, win, "purchased_total", "purchased_eur", "purchase_count");
      const clientResult = await upsertClientInvoiced(admin, clientAgg, contactNames, clientWin);
      const unpaidResult = await upsertUnpaidInvoices(admin, invoices, rates, contacts);

      summary.written = {
        invoiced: invoicedResult.rows.length,
        purchased: purchasedResult.rows.length,
        clientRowsChanged: clientResult.changed,
        unpaidCurrent: unpaidResult.current,
        unpaidDeleted: unpaidResult.deleted,
      };

      const nowIso = new Date().toISOString();
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, covers_until_year: win.maxYear, covers_until_month: win.maxMonth, updated_by: "holded-daily-sync",
      }).eq("key", "facturado");
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, covers_until_year: win.maxYear, covers_until_month: win.maxMonth, updated_by: "holded-daily-sync",
      }).eq("key", "comprado");
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, covers_until_year: clientWin.max ? Math.floor(clientWin.max / 100) : win.maxYear, covers_until_month: clientWin.max ? clientWin.max % 100 : win.maxMonth, updated_by: "holded-daily-sync",
      }).eq("key", "revision_clientes");
      await admin.from("witme_data_sources").update({
        last_updated_at: nowIso, updated_by: "holded-daily-sync",
      }).eq("key", "impagados");
    } else {
      summary.client = [...clientAgg.values()].slice(0, 20);
      summary.unpaidCount = invoices.filter((d) => d.status === "pending" || d.status === "partial").length;
    }

    return new Response(JSON.stringify(summary, null, 2), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }, null, 2), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
