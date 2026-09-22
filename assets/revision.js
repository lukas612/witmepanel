import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MIN_PRIOR_ACTIVITY = 50;   // € — floor to count a client as "active" in the trailing months
const MIN_DEVIATION_BASE = 200;  // € — ignore deviations where both current and prior avg are tiny
const DEVIATION_THRESHOLD = 0.5; // ±50%

const state = { month: null };
let rows = null;       // witme_client_invoiced_monthly
let reviews = null;    // witme_client_alert_reviews
let currentUserEmail = null;

const money = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const monthKey = (y, m) => `${y}-${m}`;
const prevMonth = (y, m) => m === 1 ? [y - 1, 12] : [y, m - 1];

initAuth(renderAll);
document.getElementById("showReviewedMissing").addEventListener("change", () => indexCache && render());
document.getElementById("showReviewedDeviation").addEventListener("change", () => indexCache && render());

async function fetchAll() {
  if (rows && reviews) return;
  const [{ data: r, error: rErr }, { data: rv, error: rvErr }] = await Promise.all([
    supabase.from("witme_client_invoiced_monthly").select("*"),
    supabase.from("witme_client_alert_reviews").select("*")
  ]);
  if (rErr) throw rErr;
  if (rvErr) throw rvErr;
  rows = r;
  reviews = rv;
  const { data: { session } } = await supabase.auth.getSession();
  currentUserEmail = session?.user?.email || null;
}

function buildIndex() {
  // Map contact_id -> { name, byMonth: Map("y-m" -> eur) }
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
    c.byMonth.set(monthKey(r.year, r.month), Number(r.invoiced_eur));
  }
  return { byClient, months: [...monthsSet].sort() };
}

function computeReviewableMonths(months) {
  // A month is reviewable once its 3 preceding months are also present in the data.
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

function computeAlerts(byClient, year, month) {
  const cur = monthKey(year, month);
  const prior = [];
  let py = year, pm = month;
  for (let i = 0; i < 3; i++) {
    [py, pm] = prevMonth(py, pm);
    prior.push(monthKey(py, pm));
  }

  const missing = [];
  const deviations = [];

  for (const [contactId, c] of byClient) {
    const priorAmounts = prior.map(k => c.byMonth.get(k)).filter(v => v != null);
    const priorTotal = priorAmounts.reduce((a, b) => a + b, 0);
    const curAmount = c.byMonth.get(cur);

    if (priorTotal > MIN_PRIOR_ACTIVITY && !(curAmount > 0)) {
      missing.push({ contactId, name: c.name, priorTotal, curAmount: curAmount || 0 });
      continue;
    }

    if (curAmount != null && curAmount > 0 && priorAmounts.length >= 2) {
      const avg = priorTotal / priorAmounts.length;
      if (avg > 0) {
        const dev = (curAmount - avg) / avg;
        if (Math.abs(dev) >= DEVIATION_THRESHOLD && Math.max(avg, curAmount) >= MIN_DEVIATION_BASE) {
          deviations.push({ contactId, name: c.name, avg, curAmount, dev });
        }
      }
    }
  }

  missing.sort((a, b) => b.priorTotal - a.priorTotal);
  deviations.sort((a, b) => Math.abs(b.curAmount - b.avg) - Math.abs(a.curAmount - a.avg));
  return { missing, deviations };
}

async function toggleReview(alertType, year, month, contactId, isReviewed) {
  if (isReviewed) {
    await supabase.from("witme_client_alert_reviews").delete()
      .eq("year", year).eq("month", month).eq("contact_id", contactId).eq("alert_type", alertType);
    reviews = reviews.filter(r => !(r.year === year && r.month === month && r.contact_id === contactId && r.alert_type === alertType));
  } else {
    const row = { year, month, contact_id: contactId, alert_type: alertType, reviewed_by: currentUserEmail };
    const { data, error } = await supabase.from("witme_client_alert_reviews").upsert(row).select();
    if (!error && data && data[0]) reviews.push(data[0]);
  }
  render();
}

function reviewCell(alertType, year, month, contactId, reviewedRow) {
  const isReviewed = !!reviewedRow;
  const btn = document.createElement("button");
  btn.className = "review-btn" + (isReviewed ? " is-reviewed" : "");
  btn.textContent = isReviewed ? "✓ Revisado" : "Marcar revisado";
  btn.addEventListener("click", () => toggleReview(alertType, year, month, contactId, isReviewed));
  const wrap = document.createElement("div");
  wrap.appendChild(btn);
  if (isReviewed && reviewedRow.reviewed_by) {
    const meta = document.createElement("span");
    meta.className = "review-meta";
    const d = new Date(reviewedRow.reviewed_at);
    meta.textContent = `${reviewedRow.reviewed_by} · ${d.toLocaleDateString("es-ES")}`;
    wrap.appendChild(meta);
  }
  return wrap;
}

function renderMissing(year, month, missing, showReviewed) {
  const body = document.getElementById("missingBody");
  const empty = document.getElementById("missingEmpty");
  const reviewedMap = new Map(reviews.filter(r => r.alert_type === "missing").map(r => [`${r.year}-${r.month}-${r.contact_id}`, r]));
  body.innerHTML = "";
  let shown = 0;
  for (const item of missing) {
    const key = `${year}-${month}-${item.contactId}`;
    const reviewedRow = reviewedMap.get(key);
    if (reviewedRow && !showReviewed) continue;
    shown++;
    const tr = document.createElement("tr");
    if (reviewedRow) tr.className = "reviewed";
    tr.innerHTML = `<td style="text-align:left;">${escapeHtml(item.name)}</td><td>${money(item.priorTotal)}</td><td class="neg">${money(0)}</td>`;
    const td = document.createElement("td");
    td.className = "review-cell";
    td.appendChild(reviewCell("missing", year, month, item.contactId, reviewedRow));
    tr.appendChild(td);
    body.appendChild(tr);
  }
  empty.style.display = shown === 0 ? "block" : "none";
}

function renderDeviations(year, month, deviations, showReviewed) {
  const body = document.getElementById("deviationBody");
  const empty = document.getElementById("deviationEmpty");
  const reviewedMap = new Map(reviews.filter(r => r.alert_type === "deviation").map(r => [`${r.year}-${r.month}-${r.contact_id}`, r]));
  body.innerHTML = "";
  let shown = 0;
  for (const item of deviations) {
    const key = `${year}-${month}-${item.contactId}`;
    const reviewedRow = reviewedMap.get(key);
    if (reviewedRow && !showReviewed) continue;
    shown++;
    const tr = document.createElement("tr");
    if (reviewedRow) tr.className = "reviewed";
    const pct = (item.dev * 100).toFixed(0);
    const devClass = item.dev > 0 ? "dev-up" : "dev-down";
    const arrow = item.dev > 0 ? "▲" : "▼";
    tr.innerHTML = `<td style="text-align:left;">${escapeHtml(item.name)}</td><td>${money(item.avg)}</td><td>${money(item.curAmount)}</td><td class="${devClass}">${arrow} ${pct > 0 ? "+" : ""}${pct}%</td>`;
    const td = document.createElement("td");
    td.className = "review-cell";
    td.appendChild(reviewCell("deviation", year, month, item.contactId, reviewedRow));
    tr.appendChild(td);
    body.appendChild(tr);
  }
  empty.style.display = shown === 0 ? "block" : "none";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

let indexCache = null;
let reviewableMonths = null;

function render() {
  const [year, month] = state.month.split("-").map(Number);

  document.querySelectorAll("#monthSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.month === state.month));
  });

  const { missing, deviations } = computeAlerts(indexCache.byClient, year, month);
  const missingReviewed = reviews.filter(r => r.alert_type === "missing" && r.year === year && r.month === month).length;
  const deviationReviewed = reviews.filter(r => r.alert_type === "deviation" && r.year === year && r.month === month).length;

  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">CLIENTES QUE DEJARON DE FACTURAR</div><div class="value ${missing.length ? "neg" : ""}">${missing.length}</div><div class="foot">${missingReviewed} revisado${missingReviewed === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">FACTURACIÓN ATÍPICA</div><div class="value ${deviations.length ? "neg" : ""}">${deviations.length}</div><div class="foot">${deviationReviewed} revisado${deviationReviewed === 1 ? "" : "s"}</div></div>
    <div class="kpi"><div class="label">MES EN REVISIÓN</div><div class="value" style="font-size:16px;">${MONTHS[month - 1]} ${year}</div><div class="foot">vs. media de los 3 meses anteriores</div></div>
    <div class="kpi"><div class="label">CLIENTES ACTIVOS ESTE MES</div><div class="value">${[...indexCache.byClient.values()].filter(c => (c.byMonth.get(monthKey(year, month)) || 0) > 0).length}</div><div class="foot">con factura &gt;0€</div></div>
  `;

  renderMissing(year, month, missing, document.getElementById("showReviewedMissing").checked);
  renderDeviations(year, month, deviations, document.getElementById("showReviewedDeviation").checked);
}

function renderMonthFilter() {
  const seg = document.getElementById("monthSeg");
  seg.innerHTML = reviewableMonths.map(mk => {
    const [y, m] = mk.split("-").map(Number);
    return `<button data-month="${mk}" aria-pressed="${mk === state.month}">${MONTHS[m - 1]} ${y}</button>`;
  }).join("");
  seg.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => { state.month = b.dataset.month; render(); });
  });
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    await fetchAll();
    indexCache = buildIndex();
    reviewableMonths = computeReviewableMonths(indexCache.months);
    if (!reviewableMonths.length) {
      loadNote.textContent = "No hay suficientes meses de datos todavía (hacen falta al menos 4 meses seguidos) para calcular alertas.";
      loadNote.style.color = "var(--warn)";
      document.getElementById("kpiStrip").style.display = "none";
      return;
    }
    if (!state.month || !reviewableMonths.includes(state.month)) state.month = reviewableMonths[reviewableMonths.length - 1];
    renderMonthFilter();
    render();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
