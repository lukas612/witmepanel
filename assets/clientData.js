// Shared data/alert logic for the per-client Holded views (revision.js list view,
// matriz.js grid view). Both read witme_client_invoiced_monthly /
// witme_client_alert_reviews and apply the same "missing" / "deviation" rules.

import { fetchAllRows } from "./supabaseUtil.js";

export const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
export const MIN_PRIOR_ACTIVITY = 50;   // € — floor to count a client as "active" in the trailing months
export const MIN_DEVIATION_BASE = 200;  // € — ignore deviations where both current and prior avg are tiny
export const DEVIATION_THRESHOLD = 0.5; // ±50%

export const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const monthKey = (y, m) => `${y}-${m}`;
export const prevMonth = (y, m) => m === 1 ? [y - 1, 12] : [y, m - 1];
export const holdedInvoiceUrl = (invoiceId) => `https://app.holded.com/sales/revenue#open:invoice-${invoiceId}`;

export async function fetchClientData(supabase) {
  const [rows, reviews] = await Promise.all([
    fetchAllRows(supabase, "witme_client_invoiced_monthly"),
    fetchAllRows(supabase, "witme_client_alert_reviews")
  ]);
  const { data: { session } } = await supabase.auth.getSession();
  return { rows, reviews, currentUserEmail: session?.user?.email || null };
}

// Map contact_id -> { name, byMonth: Map("y-m" -> { eur, invoiceIds }) }, plus
// the sorted list of month keys present anywhere in the data.
export function buildIndex(rows) {
  const byClient = new Map();
  const monthsSet = new Set();
  for (const r of rows) {
    monthsSet.add(monthKey(r.year, r.month));
    let c = byClient.get(r.contact_id);
    if (!c) {
      c = { name: r.contact_name, byMonth: new Map() };
      byClient.set(r.contact_id, c);
    }
    c.name = r.contact_name;
    c.byMonth.set(monthKey(r.year, r.month), { eur: Number(r.invoiced_eur), invoiceIds: r.invoice_ids || [] });
  }
  return { byClient, months: [...monthsSet].sort() };
}

// A month is reviewable once its 3 preceding calendar months are also present.
export function computeReviewableMonths(months) {
  const set = new Set(months);
  return months.filter(mk => {
    const [y, m] = mk.split("-").map(Number);
    let yy = y, mm = m, ok = true;
    for (let i = 0; i < 3; i++) {
      [yy, mm] = prevMonth(yy, mm);
      if (!set.has(monthKey(yy, mm))) ok = false;
    }
    return ok;
  });
}

// Evaluates one client's single (year, month) cell against its 3 preceding
// calendar months. Returns { type: "missing" | "deviation" | null, ... }.
export function evalClientMonth(c, year, month) {
  const cur = monthKey(year, month);
  const prior = [];
  let py = year, pm = month;
  for (let i = 0; i < 3; i++) {
    [py, pm] = prevMonth(py, pm);
    prior.push(monthKey(py, pm));
  }
  const priorEntries = prior.map(k => c.byMonth.get(k)).filter(v => v != null);
  const priorAmounts = priorEntries.map(e => e.eur);
  const priorTotal = priorAmounts.reduce((a, b) => a + b, 0);
  const curEntry = c.byMonth.get(cur);
  const curAmount = curEntry?.eur;
  const curInvoiceIds = curEntry?.invoiceIds || [];

  if (priorTotal > MIN_PRIOR_ACTIVITY && !(curAmount > 0)) {
    return { type: "missing", priorTotal, priorAvg: priorTotal / priorAmounts.length, curAmount: curAmount || 0, curInvoiceIds };
  }
  if (curAmount != null && curAmount > 0 && priorAmounts.length >= 2) {
    const avg = priorTotal / priorAmounts.length;
    if (avg > 0) {
      const dev = (curAmount - avg) / avg;
      if (Math.abs(dev) >= DEVIATION_THRESHOLD && Math.max(avg, curAmount) >= MIN_DEVIATION_BASE) {
        return { type: "deviation", avg, curAmount, dev, curInvoiceIds };
      }
    }
  }
  return { type: null, curAmount, curInvoiceIds };
}

export function computeAlerts(byClient, year, month) {
  const missing = [];
  const deviations = [];
  for (const [contactId, c] of byClient) {
    const res = evalClientMonth(c, year, month);
    if (res.type === "missing") missing.push({ contactId, name: c.name, ...res });
    else if (res.type === "deviation") deviations.push({ contactId, name: c.name, ...res });
  }
  missing.sort((a, b) => b.priorTotal - a.priorTotal);
  deviations.sort((a, b) => Math.abs(b.curAmount - b.avg) - Math.abs(a.curAmount - a.avg));
  return { missing, deviations };
}

// Toggles a review row in Supabase; returns the new row (for insert) or null (for delete)
// — caller updates its own local `reviews` array.
export async function toggleReview(supabase, alertType, year, month, contactId, isReviewed, currentUserEmail) {
  if (isReviewed) {
    await supabase.from("witme_client_alert_reviews").delete()
      .eq("year", year).eq("month", month).eq("contact_id", contactId).eq("alert_type", alertType);
    return null;
  }
  const row = { year, month, contact_id: contactId, alert_type: alertType, reviewed_by: currentUserEmail };
  const { data, error } = await supabase.from("witme_client_alert_reviews").upsert(row).select();
  if (error || !data) return undefined;
  return data[0];
}
