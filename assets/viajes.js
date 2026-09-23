import { supabase, initAuth } from "./auth.js";
import { fetchAllRows } from "./supabaseUtil.js";
import { MIN_PRIOR_ACTIVITY } from "./clientData.js";

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CLIENT_TYPES = [
  { value: "nuevo", label: "Cliente nuevo" },
  { value: "antiguo", label: "Visita cliente antiguo" },
];
const CLIENT_TYPE_LABELS = Object.fromEntries(CLIENT_TYPES.map(t => [t.value, t.label]));
const CATEGORIES = [
  { value: "vuelo", label: "Vuelo" },
  { value: "alojamiento", label: "Alojamiento" },
  { value: "dietas", label: "Dietas" },
  { value: "transporte", label: "Transporte" },
  { value: "evento", label: "Evento / stand" },
  { value: "regalos", label: "Regalos / atenciones" },
  { value: "otros", label: "Otros" },
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));
const STATUSES = [
  { value: "planeado", label: "Planeado" },
  { value: "en_curso", label: "En curso" },
  { value: "cerrado", label: "Cerrado" },
];
const STATUS_LABELS = Object.fromEntries(STATUSES.map(s => [s.value, s.label]));

const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (n) => n == null ? "—" : `${n.toFixed(0)}%`;

const state = { view: "list", selectedTripId: null, selectedContact: null, selectedClientType: "nuevo" };
let trips = [], expenses = [], tripClients = [], invoicedRows = [];
let contactsList = [];
let categoryChart = null;

initAuth(renderAll);

function monthKey(y, m) { return `${y}-${String(m).padStart(2, "0")}`; }

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : s;
  return div.innerHTML;
}

function fmtDate(d) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
function fmtDateRange(start, end) {
  return end ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start);
}
function monthRangeLabel(c) {
  const a = `${MONTHS_SHORT[c.attribution_start_month - 1]} ${c.attribution_start_year}`;
  const b = `${MONTHS_SHORT[c.attribution_end_month - 1]} ${c.attribution_end_year}`;
  return a === b ? a : `${a} – ${b}`;
}

async function fetchAll() {
  const [t, e, c, inv] = await Promise.all([
    fetchAllRows(supabase, "witme_trips"),
    fetchAllRows(supabase, "witme_trip_expenses"),
    fetchAllRows(supabase, "witme_trip_clients"),
    fetchAllRows(supabase, "witme_client_invoiced_monthly"),
  ]);
  trips = t; expenses = e; tripClients = c; invoicedRows = inv;
  buildContactsIndex();
}

function buildContactsIndex() {
  const map = new Map();
  for (const r of invoicedRows) {
    if (!map.has(r.contact_id)) map.set(r.contact_id, { contactId: r.contact_id, contactName: r.contact_name, months: new Map() });
    const entry = map.get(r.contact_id);
    entry.contactName = r.contact_name;
    entry.months.set(monthKey(r.year, r.month), Number(r.invoiced_eur));
  }
  contactsList = [...map.values()].sort((a, b) => a.contactName.localeCompare(b.contactName));
}

// Revenue is never stored -- always summed live from witme_client_invoiced_monthly
// (the same source Revisión/Matriz use) over the link's (year, month) range.
function computeClientRevenue(link) {
  const contact = contactsList.find(c => c.contactId === link.contact_id);
  if (!contact) return 0;
  let sum = 0;
  for (let y = link.attribution_start_year; y <= link.attribution_end_year; y++) {
    const mStart = y === link.attribution_start_year ? link.attribution_start_month : 1;
    const mEnd = y === link.attribution_end_year ? link.attribution_end_month : 12;
    for (let m = mStart; m <= mEnd; m++) sum += contact.months.get(monthKey(y, m)) || 0;
  }
  return sum;
}

function tripExpensesFor(tripId) { return expenses.filter(e => e.trip_id === tripId); }
function tripClientsFor(tripId) { return tripClients.filter(c => c.trip_id === tripId); }
function tripCost(tripId) { return tripExpensesFor(tripId).reduce((s, e) => s + Number(e.amount_eur), 0); }
function tripRevenue(tripId) { return tripClientsFor(tripId).reduce((s, c) => s + computeClientRevenue(c), 0); }

function prevMonth(y, m) { return m === 1 ? [y - 1, 12] : [y, m - 1]; }
function monthsInRange(link) {
  return (link.attribution_end_year - link.attribution_start_year) * 12 + (link.attribution_end_month - link.attribution_start_month) + 1;
}

// For a "visita cliente antiguo" link: compares the attributed period's
// monthly average against the average of the 3 calendar months right
// before it -- same formula (and same MIN_PRIOR_ACTIVITY floor) as the
// "facturación atípica" alert in Revisión de clientes / Matriz.
function computeAntiguoValoracion(link) {
  const contact = contactsList.find(c => c.contactId === link.contact_id);
  if (!contact) return null;
  let py = link.attribution_start_year, pm = link.attribution_start_month;
  const priorAmounts = [];
  for (let i = 0; i < 3; i++) {
    [py, pm] = prevMonth(py, pm);
    const v = contact.months.get(monthKey(py, pm));
    if (v != null) priorAmounts.push(v);
  }
  const priorTotal = priorAmounts.reduce((a, b) => a + b, 0);
  if (priorTotal < MIN_PRIOR_ACTIVITY) return { insufficientData: true };
  const priorAvg = priorTotal / priorAmounts.length;
  const windowAvg = computeClientRevenue(link) / monthsInRange(link);
  return { insufficientData: false, priorAvg, windowAvg, delta: priorAvg ? (windowAvg - priorAvg) / priorAvg : null };
}

// ---------------- List view ----------------

function renderList() {
  const totalCost = trips.reduce((s, t) => s + tripCost(t.id), 0);
  const totalRevenue = trips.reduce((s, t) => s + tripRevenue(t.id), 0);
  const totalProfit = totalRevenue - totalCost;
  const roi = totalCost ? (totalRevenue / totalCost * 100) : null;

  document.getElementById("kpiStrip").innerHTML = `
    <div class="kpi"><div class="label">VIAJES</div><div class="value">${trips.length}</div><div class="foot">registrados</div></div>
    <div class="kpi"><div class="label">COSTE TOTAL</div><div class="value">${money(totalCost)}</div><div class="foot">todos los viajes</div></div>
    <div class="kpi"><div class="label">INGRESO ATRIBUIDO</div><div class="value">${money(totalRevenue)}</div><div class="foot">clientes vinculados</div></div>
    <div class="kpi"><div class="label">ROI GLOBAL</div><div class="value ${roi != null && roi < 100 ? "neg" : "pos"}">${pct(roi)}</div><div class="foot">${money(totalProfit)} beneficio</div></div>
  `;

  const body = document.getElementById("tripsBody");
  const empty = document.getElementById("tripsEmpty");
  const sorted = [...trips].sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  empty.style.display = sorted.length ? "none" : "block";
  body.innerHTML = sorted.map(t => {
    const cost = tripCost(t.id), revenue = tripRevenue(t.id), profit = revenue - cost;
    const roi2 = cost ? (revenue / cost * 100) : null;
    return `<tr>
      <td style="text-align:left;">${escapeHtml(t.name)}</td>
      <td style="text-align:left;">${fmtDateRange(t.start_date, t.end_date)}</td>
      <td style="text-align:left;">${escapeHtml(t.responsable || "—")}</td>
      <td style="text-align:left;"><span class="status ${t.status}">${STATUS_LABELS[t.status] || t.status}</span></td>
      <td>${money(cost)}</td>
      <td>${money(revenue)}</td>
      <td class="${profit < 0 ? "neg" : (profit > 0 ? "pos" : "")}">${money(profit)}</td>
      <td class="${roi2 != null && roi2 < 100 ? "neg" : (roi2 != null ? "pos" : "")}">${pct(roi2)}</td>
      <td><button class="btn-secondary" data-trip-id="${t.id}" data-action="view">Ver</button></td>
    </tr>`;
  }).join("");
}

function goToList() {
  state.view = "list"; state.selectedTripId = null;
  document.getElementById("listView").style.display = "block";
  document.getElementById("detailView").style.display = "none";
  renderList();
}

function goToDetail(tripId) {
  state.view = "detail"; state.selectedTripId = tripId;
  document.getElementById("listView").style.display = "none";
  document.getElementById("detailView").style.display = "block";
  renderDetail(tripId);

  const trip = trips.find(t => t.id === tripId);
  document.getElementById("attrStart").value = trip?.start_date ? trip.start_date.slice(0, 7) : "";
  document.getElementById("attrEnd").value = trip?.start_date ? trip.start_date.slice(0, 7) : "";
  document.getElementById("clientSearch").value = "";
  document.getElementById("clientSuggestions").hidden = true;
  document.getElementById("clientPreview").innerHTML = "";
  document.getElementById("expenseFormMsg").textContent = "";
  document.getElementById("clientFormMsg").textContent = "";
  state.selectedContact = null;
  document.getElementById("addClientBtn").disabled = true;
  state.selectedClientType = "nuevo";
  document.querySelectorAll("#clientTypeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === "nuevo")));
}

// ---------------- Detail view ----------------

function renderDetail(tripId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) { goToList(); return; }

  const cost = tripCost(tripId), revenue = tripRevenue(tripId), profit = revenue - cost;
  const roi = cost ? (revenue / cost * 100) : null;

  document.getElementById("tripHeader").innerHTML = `
    <div>
      <h2>${escapeHtml(trip.name)}</h2>
      <div class="trip-meta">${trip.destination ? escapeHtml(trip.destination) + " · " : ""}${fmtDateRange(trip.start_date, trip.end_date)} · ${escapeHtml(trip.responsable || "sin responsable")}</div>
      ${trip.notes ? `<div class="trip-notes">${escapeHtml(trip.notes)}</div>` : ""}
    </div>
    <div style="display:flex; align-items:center; gap:10px;">
      <select class="status-select" id="statusSelect">
        ${STATUSES.map(s => `<option value="${s.value}" ${s.value === trip.status ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
      <button class="btn-icon-delete" id="deleteTripBtn" title="Eliminar viaje">🗑 Eliminar viaje</button>
    </div>
  `;
  document.getElementById("statusSelect").addEventListener("change", (e) => updateTripStatus(tripId, e.target.value));
  document.getElementById("deleteTripBtn").addEventListener("click", () => deleteTrip(tripId));

  document.getElementById("tripKpiStrip").innerHTML = `
    <div class="kpi"><div class="label">COSTE</div><div class="value">${money(cost)}</div><div class="foot">${tripExpensesFor(tripId).length} gasto${tripExpensesFor(tripId).length === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">INGRESO ATRIBUIDO</div><div class="value">${money(revenue)}</div><div class="foot">${tripClientsFor(tripId).length} cliente${tripClientsFor(tripId).length === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">BENEFICIO</div><div class="value ${profit < 0 ? "neg" : (profit > 0 ? "pos" : "")}">${money(profit)}</div><div class="foot"></div></div>
    <div class="kpi"><div class="label">ROI</div><div class="value ${roi != null && roi < 100 ? "neg" : (roi != null ? "pos" : "")}">${pct(roi)}</div><div class="foot">ingreso / coste</div></div>
  `;

  renderExpensesTable(tripId);
  renderCategoryChart(tripId);
  renderClientsTable(tripId);
}

function renderExpensesTable(tripId) {
  const rows = [...tripExpensesFor(tripId)].sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""));
  const body = document.getElementById("expensesBody");
  document.getElementById("expensesEmpty").style.display = rows.length ? "none" : "block";
  body.innerHTML = rows.map(e => `<tr>
    <td style="text-align:left;">${CATEGORY_LABELS[e.category] || e.category}</td>
    <td style="text-align:left;">${escapeHtml(e.description || "—")}</td>
    <td style="text-align:left;">${fmtDate(e.expense_date)}</td>
    <td style="text-align:left;">${escapeHtml(e.paid_by || "—")}</td>
    <td>${money(Number(e.amount_eur))}</td>
    <td><button class="btn-icon-delete" data-expense-id="${e.id}" title="Eliminar">🗑</button></td>
  </tr>`).join("");
  const total = rows.reduce((s, e) => s + Number(e.amount_eur), 0);
  document.getElementById("expensesFoot").innerHTML = `<td colspan="4" style="text-align:left;">Total</td><td>${money(total)}</td><td></td>`;
}

function renderCategoryChart(tripId) {
  const box = document.getElementById("categoryChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). El resto de la página sigue funcionando con normalidad.</div>';
    return;
  }
  const rows = tripExpensesFor(tripId);
  const sums = new Map();
  for (const r of rows) sums.set(r.category, (sums.get(r.category) || 0) + Number(r.amount_eur));
  const cats = CATEGORIES.filter(c => sums.has(c.value)).sort((a, b) => sums.get(b.value) - sums.get(a.value));

  const ctx = document.getElementById("categoryChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const accentSoft = getComputedStyle(document.body).getPropertyValue("--accent-soft").trim();

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: cats.map(c => c.label),
      datasets: [{ label: "Gasto", data: cats.map(c => sums.get(c.value)), backgroundColor: accentSoft, borderColor: accent, borderWidth: 1.5 }]
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.x) } } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => money(v) } },
        y: { grid: { display: false }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11.5 } } }
      }
    }
  });
}

function valoracionCell(c) {
  if (c.client_type !== "antiguo") return `<span style="color:var(--ink-soft);">—</span>`;
  const v = computeAntiguoValoracion(c);
  if (!v || v.insufficientData) return `<span style="color:var(--ink-soft); font-size:12px;">sin histórico previo</span>`;
  if (v.delta == null) return `<span style="color:var(--ink-soft); font-size:12px;">—</span>`;
  const arrow = v.delta >= 0 ? "▲" : "▼";
  const cls = v.delta >= 0 ? "pos" : "neg";
  const deltaPct = (v.delta * 100);
  return `<span class="${cls}">${arrow} ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%</span> <span style="color:var(--ink-soft); font-size:11.5px;">(antes ${money(v.priorAvg)}/mes)</span>`;
}

function renderClientsTable(tripId) {
  const rows = tripClientsFor(tripId);
  const body = document.getElementById("clientsBody");
  document.getElementById("clientsEmpty").style.display = rows.length ? "none" : "block";
  body.innerHTML = rows.map(c => `<tr>
    <td style="text-align:left;">${escapeHtml(c.contact_name)}</td>
    <td style="text-align:left;"><span class="status ${c.client_type}">${CLIENT_TYPE_LABELS[c.client_type] || c.client_type}</span></td>
    <td style="text-align:left;">${monthRangeLabel(c)}</td>
    <td>${money(computeClientRevenue(c))}</td>
    <td style="text-align:left;">${valoracionCell(c)}</td>
    <td><button class="btn-icon-delete" data-link-id="${c.id}" title="Quitar">🗑</button></td>
  </tr>`).join("");
  const total = rows.reduce((s, c) => s + computeClientRevenue(c), 0);
  const nuevoCount = rows.filter(c => c.client_type === "nuevo").length;
  const antiguoCount = rows.filter(c => c.client_type === "antiguo").length;
  document.getElementById("clientsFoot").innerHTML = `<td colspan="3" style="text-align:left;">Total (${nuevoCount} nuevo${nuevoCount === 1 ? "" : "s"}, ${antiguoCount} antiguo${antiguoCount === 1 ? "" : "s"})</td><td>${money(total)}</td><td></td><td></td>`;
}

// ---------------- Mutations ----------------

async function updateTripStatus(tripId, newStatus) {
  const { error } = await supabase.from("witme_trips").update({ status: newStatus }).eq("id", tripId);
  if (error) { alert("No se pudo actualizar el estado."); console.error(error); return; }
  const t = trips.find(t => t.id === tripId);
  if (t) t.status = newStatus;
}

async function deleteTrip(tripId) {
  if (!confirm("¿Eliminar este viaje y todos sus gastos/clientes vinculados? Esta acción no se puede deshacer.")) return;
  const { error } = await supabase.from("witme_trips").delete().eq("id", tripId);
  if (error) { alert("No se pudo eliminar el viaje."); console.error(error); return; }
  trips = trips.filter(t => t.id !== tripId);
  expenses = expenses.filter(e => e.trip_id !== tripId);
  tripClients = tripClients.filter(c => c.trip_id !== tripId);
  goToList();
}

async function deleteExpense(id) {
  if (!confirm("¿Eliminar este gasto?")) return;
  const { error } = await supabase.from("witme_trip_expenses").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar."); console.error(error); return; }
  expenses = expenses.filter(e => e.id !== id);
  renderDetail(state.selectedTripId);
}

async function deleteClientLink(id) {
  if (!confirm("¿Quitar este cliente del viaje?")) return;
  const { error } = await supabase.from("witme_trip_clients").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar."); console.error(error); return; }
  tripClients = tripClients.filter(c => c.id !== id);
  renderDetail(state.selectedTripId);
}

function updateClientPreview() {
  const el = document.getElementById("clientPreview");
  if (!state.selectedContact) { el.innerHTML = ""; return; }
  const startVal = document.getElementById("attrStart").value;
  const endVal = document.getElementById("attrEnd").value;
  if (!startVal || !endVal) {
    el.innerHTML = `Cliente: <strong>${escapeHtml(state.selectedContact.contactName)}</strong> — elige el rango de meses.`;
    return;
  }
  const [sy, sm] = startVal.split("-").map(Number);
  const [ey, em] = endVal.split("-").map(Number);
  const revenue = computeClientRevenue({ contact_id: state.selectedContact.contactId, attribution_start_year: sy, attribution_start_month: sm, attribution_end_year: ey, attribution_end_month: em });
  el.innerHTML = `Ingreso estimado para <strong>${escapeHtml(state.selectedContact.contactName)}</strong> en ese rango: <strong>${money(revenue)}</strong>`;
}

// ---------------- Static event wiring ----------------

document.getElementById("newTripToggle").addEventListener("click", () => {
  const form = document.getElementById("newTripForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
});
document.getElementById("cancelTripBtn").addEventListener("click", () => {
  document.getElementById("newTripForm").style.display = "none";
});
document.getElementById("createTripBtn").addEventListener("click", async () => {
  const msg = document.getElementById("tripFormMsg");
  const name = document.getElementById("tripName").value.trim();
  const destination = document.getElementById("tripDestination").value.trim();
  const start = document.getElementById("tripStart").value;
  const end = document.getElementById("tripEnd").value || null;
  const responsable = document.getElementById("tripResponsable").value.trim();
  const status = document.getElementById("tripStatus").value;
  const notes = document.getElementById("tripNotes").value.trim();
  if (!name || !start) {
    msg.textContent = "Nombre y fecha de inicio son obligatorios.";
    msg.className = "form-msg error";
    return;
  }
  const btn = document.getElementById("createTripBtn");
  btn.disabled = true;
  const { data, error } = await supabase.from("witme_trips").insert({
    name, destination: destination || null, start_date: start, end_date: end,
    responsable: responsable || null, status, notes: notes || null,
  }).select().single();
  btn.disabled = false;
  if (error) {
    msg.textContent = "No se pudo crear el viaje.";
    msg.className = "form-msg error";
    console.error(error);
    return;
  }
  trips.push(data);
  ["tripName", "tripDestination", "tripStart", "tripEnd", "tripResponsable", "tripNotes"].forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("tripStatus").value = "planeado";
  document.getElementById("newTripForm").style.display = "none";
  msg.textContent = "";
  renderList();
});

document.getElementById("tripsBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='view']");
  if (btn) goToDetail(btn.dataset.tripId);
});
document.getElementById("backToListBtn").addEventListener("click", goToList);

document.getElementById("expensesBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-expense-id]");
  if (btn) deleteExpense(btn.dataset.expenseId);
});
document.getElementById("addExpenseBtn").addEventListener("click", async () => {
  const msg = document.getElementById("expenseFormMsg");
  const category = document.getElementById("expCategory").value;
  const description = document.getElementById("expDescription").value.trim();
  const date = document.getElementById("expDate").value || null;
  const paidBy = document.getElementById("expPaidBy").value.trim();
  const amount = parseFloat(document.getElementById("expAmount").value);
  if (!amount || amount <= 0) {
    msg.textContent = "Introduce un importe válido.";
    msg.className = "form-msg error";
    return;
  }
  const btn = document.getElementById("addExpenseBtn");
  btn.disabled = true;
  const { data, error } = await supabase.from("witme_trip_expenses").insert({
    trip_id: state.selectedTripId, category, description: description || null,
    expense_date: date, paid_by: paidBy || null, amount_eur: amount,
  }).select().single();
  btn.disabled = false;
  if (error) {
    msg.textContent = "No se pudo guardar el gasto.";
    msg.className = "form-msg error";
    console.error(error);
    return;
  }
  expenses.push(data);
  document.getElementById("expDescription").value = "";
  document.getElementById("expDate").value = "";
  document.getElementById("expPaidBy").value = "";
  document.getElementById("expAmount").value = "";
  msg.textContent = "";
  renderDetail(state.selectedTripId);
});

document.getElementById("clientsBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-link-id]");
  if (btn) deleteClientLink(btn.dataset.linkId);
});

document.getElementById("clientSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  state.selectedContact = null;
  document.getElementById("addClientBtn").disabled = true;
  updateClientPreview();
  const box = document.getElementById("clientSuggestions");
  if (!q) { box.hidden = true; box.innerHTML = ""; return; }
  const alreadyLinked = new Set(tripClientsFor(state.selectedTripId).map(c => c.contact_id));
  const matches = contactsList.filter(c => !alreadyLinked.has(c.contactId) && c.contactName.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = matches.map(c => `<div class="client-suggestion" data-contact-id="${escapeHtml(c.contactId)}">
    <span>${escapeHtml(c.contactName)}</span><span class="cs-months">${c.months.size} meses con datos</span>
  </div>`).join("");
  box.querySelectorAll(".client-suggestion").forEach(el => {
    el.addEventListener("click", () => {
      const contact = contactsList.find(c => c.contactId === el.dataset.contactId);
      state.selectedContact = contact;
      document.getElementById("clientSearch").value = contact.contactName;
      box.hidden = true;
      document.getElementById("addClientBtn").disabled = false;
      updateClientPreview();
    });
  });
});
document.addEventListener("click", (e) => {
  const box = document.getElementById("clientSuggestions");
  const input = document.getElementById("clientSearch");
  if (!box.hidden && e.target !== input && !box.contains(e.target)) box.hidden = true;
});
document.getElementById("attrStart").addEventListener("change", updateClientPreview);
document.getElementById("attrEnd").addEventListener("change", updateClientPreview);

document.getElementById("clientTypeSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-type]");
  if (!btn) return;
  state.selectedClientType = btn.dataset.type;
  document.querySelectorAll("#clientTypeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
});

document.getElementById("addClientBtn").addEventListener("click", async () => {
  const msg = document.getElementById("clientFormMsg");
  if (!state.selectedContact) return;
  const startVal = document.getElementById("attrStart").value;
  const endVal = document.getElementById("attrEnd").value;
  if (!startVal || !endVal) {
    msg.textContent = "Elige el rango de meses.";
    msg.className = "form-msg error";
    return;
  }
  const [sy, sm] = startVal.split("-").map(Number);
  const [ey, em] = endVal.split("-").map(Number);
  if (ey < sy || (ey === sy && em < sm)) {
    msg.textContent = "El mes final no puede ser anterior al inicial.";
    msg.className = "form-msg error";
    return;
  }
  const btn = document.getElementById("addClientBtn");
  btn.disabled = true;
  const { data, error } = await supabase.from("witme_trip_clients").insert({
    trip_id: state.selectedTripId,
    contact_id: state.selectedContact.contactId,
    contact_name: state.selectedContact.contactName,
    attribution_start_year: sy, attribution_start_month: sm,
    attribution_end_year: ey, attribution_end_month: em,
    client_type: state.selectedClientType,
  }).select().single();
  if (error) {
    msg.textContent = error.code === "23505" ? "Ese cliente ya está vinculado a este viaje." : "No se pudo guardar.";
    msg.className = "form-msg error";
    console.error(error);
    btn.disabled = false;
    return;
  }
  tripClients.push(data);
  msg.textContent = "";
  document.getElementById("clientSearch").value = "";
  state.selectedContact = null;
  state.selectedClientType = "nuevo";
  document.querySelectorAll("#clientTypeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === "nuevo")));
  renderDetail(state.selectedTripId);
});

// ---------------- Boot ----------------

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    await fetchAll();
    renderList();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
