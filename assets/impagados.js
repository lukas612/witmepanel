import { supabase, initAuth } from "./auth.js";
import { fetchAllRows } from "./supabaseUtil.js";

const money = (n) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const holdedInvoiceUrl = (invoiceId) => `https://app.holded.com/sales/revenue#open:invoice-${invoiceId}`;
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

const state = { search: "", status: "all", sort: "overdue", view: "detail", minDaysOverdue: 0 };
let rows = null;
let today = null;

initAuth(renderAll);

document.getElementById("clientSearch").addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
  render();
});
document.getElementById("viewSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  document.querySelectorAll("#viewSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  render();
});
document.getElementById("statusSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;
  state.status = btn.dataset.status;
  document.querySelectorAll("#statusSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  render();
});
document.getElementById("sortSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sort]");
  if (!btn) return;
  state.sort = btn.dataset.sort;
  document.querySelectorAll("#sortSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  render();
});
document.getElementById("minDaysOverdue").addEventListener("input", (e) => {
  const v = parseInt(e.target.value, 10);
  state.minDaysOverdue = Number.isFinite(v) && v > 0 ? v : 0;
  render();
});

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function daysOverdue(r) {
  if (!r.due_date) return null;
  const due = new Date(r.due_date + "T00:00:00");
  return Math.round((today - due) / 86400000);
}

function statusLabel(r) {
  const d = daysOverdue(r);
  if (d == null) return { text: "Sin fecha de vencimiento", cls: "" };
  if (d > 0) return { text: `Vencida hace ${d} día${d === 1 ? "" : "s"}`, cls: "neg" };
  if (d === 0) return { text: "Vence hoy", cls: "" };
  return { text: `Vence en ${-d} día${-d === 1 ? "" : "s"}`, cls: "" };
}

function bucket(r) {
  const d = daysOverdue(r);
  return (d != null && d > 0) ? "overdue" : "upcoming";
}

function renderKpis(all) {
  const overdue = all.filter(r => bucket(r) === "overdue");
  const upcoming = all.filter(r => bucket(r) === "upcoming");
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">TOTAL PENDIENTE DE COBRO</div><div class="value">${money(all.reduce((s, r) => s + r.pending_eur, 0))}</div><div class="foot">${all.length} facturas</div></div>
    <div class="kpi"><div class="label">VENCIDO</div><div class="value neg">${money(overdue.reduce((s, r) => s + r.pending_eur, 0))}</div><div class="foot">${overdue.length} facturas vencidas</div></div>
    <div class="kpi"><div class="label">AÚN NO VENCE</div><div class="value">${money(upcoming.reduce((s, r) => s + r.pending_eur, 0))}</div><div class="foot">${upcoming.length} facturas dentro de plazo</div></div>
    <div class="kpi"><div class="label">MÁS ANTIGUA VENCIDA</div><div class="value" style="font-size:16px;">${overdue.length ? Math.max(...overdue.map(daysOverdue)) + " días" : "—"}</div><div class="foot">desde su vencimiento</div></div>
  `;
}

function filteredRows() {
  const search = state.search;
  return rows.filter(r => {
    if (search && !r.contact_name.toLowerCase().includes(search) && !r.document_number.toLowerCase().includes(search)) return false;
    if (state.status !== "all" && bucket(r) !== state.status) return false;
    if (state.minDaysOverdue > 0) {
      const d = daysOverdue(r);
      if (d == null || d <= state.minDaysOverdue) return false;
    }
    return true;
  });
}

function renderHead() {
  const head = document.getElementById("unpaidHead");
  if (state.view === "detail") {
    head.innerHTML = `
      <th style="text-align:left;">Cliente</th>
      <th style="text-align:left;">Factura</th>
      <th>Emitida</th>
      <th>Vence</th>
      <th style="text-align:left;">Estado</th>
      <th>Pendiente</th>`;
  } else if (state.view === "client") {
    head.innerHTML = `
      <th style="text-align:left;">Cliente</th>
      <th style="text-align:left;">País</th>
      <th>Facturas</th>
      <th>Vencidas</th>
      <th>Más antigua</th>
      <th>Pendiente</th>`;
  } else {
    head.innerHTML = `
      <th style="text-align:left;">País</th>
      <th>Clientes</th>
      <th>Facturas</th>
      <th>Vencidas</th>
      <th>Más antigua</th>
      <th>Pendiente</th>`;
  }
}

function renderDetailRows(list) {
  return list.map(r => {
    const st = statusLabel(r);
    const link = `<a href="${holdedInvoiceUrl(r.invoice_id)}" target="_blank" rel="noopener" class="invoice-link" title="Abrir factura en Holded">🧾</a>`;
    const statusExtra = r.status === "partial" ? " · pago parcial" : "";
    return `<tr>
      <td style="text-align:left;">${escapeHtml(r.contact_name)}</td>
      <td style="text-align:left;">${escapeHtml(r.document_number)} ${link}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${fmtDate(r.due_date)}</td>
      <td style="text-align:left;" class="${st.cls}">${st.text}${statusExtra}</td>
      <td>${money(r.pending_eur)}</td>
    </tr>`;
  }).join("");
}

function groupBy(list, keyFn) {
  const groups = new Map();
  for (const r of list) {
    const key = keyFn(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

function maxDaysOverdue(list) {
  const days = list.map(daysOverdue).filter(d => d != null && d > 0);
  return days.length ? Math.max(...days) : null;
}

function renderClientRows(list) {
  const groups = groupBy(list, r => r.contact_id);
  let entries = [...groups.entries()].map(([contactId, items]) => ({
    contactId,
    name: items[0].contact_name,
    country: items[0].contact_country || "—",
    count: items.length,
    overdueCount: items.filter(r => bucket(r) === "overdue").length,
    maxOverdue: maxDaysOverdue(items),
    total: items.reduce((s, r) => s + r.pending_eur, 0),
  }));
  entries = sortEntries(entries);
  return entries.map(e => `<tr>
    <td style="text-align:left;">${escapeHtml(e.name)}</td>
    <td style="text-align:left;">${escapeHtml(e.country)}</td>
    <td>${e.count}</td>
    <td class="${e.overdueCount ? "neg" : ""}">${e.overdueCount}</td>
    <td class="${e.maxOverdue ? "neg" : ""}">${e.maxOverdue ? e.maxOverdue + " días" : "—"}</td>
    <td>${money(e.total)}</td>
  </tr>`).join("");
}

function renderCountryRows(list) {
  const groups = groupBy(list, r => r.contact_country || "Sin país");
  let entries = [...groups.entries()].map(([country, items]) => ({
    country,
    clientCount: new Set(items.map(r => r.contact_id)).size,
    count: items.length,
    overdueCount: items.filter(r => bucket(r) === "overdue").length,
    maxOverdue: maxDaysOverdue(items),
    total: items.reduce((s, r) => s + r.pending_eur, 0),
  }));
  entries = sortEntries(entries);
  return entries.map(e => `<tr>
    <td style="text-align:left;">${escapeHtml(e.country)}</td>
    <td>${e.clientCount}</td>
    <td>${e.count}</td>
    <td class="${e.overdueCount ? "neg" : ""}">${e.overdueCount}</td>
    <td class="${e.maxOverdue ? "neg" : ""}">${e.maxOverdue ? e.maxOverdue + " días" : "—"}</td>
    <td>${money(e.total)}</td>
  </tr>`).join("");
}

function sortEntries(entries) {
  if (state.sort === "overdue") {
    return entries.sort((a, b) => (b.maxOverdue ?? -Infinity) - (a.maxOverdue ?? -Infinity));
  }
  return entries.sort((a, b) => b.total - a.total);
}

function render() {
  renderHead();
  let shown = filteredRows();

  const body = document.getElementById("unpaidBody");
  const empty = document.getElementById("unpaidEmpty");
  empty.style.display = shown.length ? "none" : "block";

  if (state.view === "detail") {
    if (state.sort === "overdue") {
      shown = [...shown].sort((a, b) => (daysOverdue(b) ?? -Infinity) - (daysOverdue(a) ?? -Infinity));
    } else {
      shown = [...shown].sort((a, b) => b.pending_eur - a.pending_eur);
    }
    body.innerHTML = renderDetailRows(shown);
  } else if (state.view === "client") {
    body.innerHTML = renderClientRows(shown);
  } else {
    body.innerHTML = renderCountryRows(shown);
  }
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    rows = await fetchAllRows(supabase, "witme_unpaid_invoices");
    today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!rows.length) {
      loadNote.textContent = "No hay facturas impagadas registradas.";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    renderKpis(rows);
    render();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
