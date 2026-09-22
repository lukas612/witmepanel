import { supabase, initAuth } from "./auth.js";
import { fetchAllRows } from "./supabaseUtil.js";

const money = (n) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const holdedInvoiceUrl = (invoiceId) => `https://app.holded.com/sales/revenue#open:invoice-${invoiceId}`;
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

const state = { search: "", status: "all", sort: "overdue" };
let rows = null;
let today = null;

initAuth(renderAll);

document.getElementById("clientSearch").addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
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

function render() {
  const search = state.search;
  let shown = rows.filter(r => {
    if (search && !r.contact_name.toLowerCase().includes(search) && !r.document_number.toLowerCase().includes(search)) return false;
    if (state.status !== "all" && bucket(r) !== state.status) return false;
    return true;
  });

  if (state.sort === "overdue") {
    shown = [...shown].sort((a, b) => (daysOverdue(b) ?? -Infinity) - (daysOverdue(a) ?? -Infinity));
  } else {
    shown = [...shown].sort((a, b) => b.pending_eur - a.pending_eur);
  }

  const body = document.getElementById("unpaidBody");
  const empty = document.getElementById("unpaidEmpty");
  empty.style.display = shown.length ? "none" : "block";

  body.innerHTML = shown.map(r => {
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
