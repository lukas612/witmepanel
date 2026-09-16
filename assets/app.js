import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const state = { year: 2026, region: "total" };
let chart = null;
const yearCache = {};

const eur = n => n==null ? "—" : n.toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const pct = n => n==null ? "—" : n.toLocaleString("es-ES",{maximumFractionDigits:1,minimumFractionDigits:1}) + "%";

// ---------------- Auth ----------------
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginMsg = document.getElementById("loginMsg");
const loginSubmit = document.getElementById("loginSubmit");
const logoutBtn = document.getElementById("logoutBtn");

function showLogin(){
  loginView.style.display = "flex";
  dashboardView.style.display = "none";
}
function showDashboard(){
  loginView.style.display = "none";
  dashboardView.style.display = "block";
  renderAll();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  loginSubmit.disabled = true;
  loginMsg.textContent = "Enviando enlace…";
  loginMsg.className = "login-msg";
  const redirectTo = window.location.href.split("#")[0].split("?")[0];
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo }
  });
  loginSubmit.disabled = false;
  if (error) {
    loginMsg.textContent = "No se pudo enviar el enlace. Comprueba el correo o contacta al administrador.";
    loginMsg.className = "login-msg error";
  } else {
    loginMsg.textContent = "Revisa tu correo y haz clic en el enlace de acceso.";
    loginMsg.className = "login-msg ok";
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) showDashboard(); else showLogin();
});

const { data: { session: initialSession } } = await supabase.auth.getSession();
if (initialSession) showDashboard(); else showLogin();

// ---------------- Data ----------------
async function fetchYear(year) {
  if (yearCache[year]) return yearCache[year];

  const [{ data: cfg, error: cfgErr }, { data: rows, error: rowsErr }] = await Promise.all([
    supabase.from("witme_year_config").select("*").eq("year", year).single(),
    supabase.from("witme_pnl_monthly").select("*").eq("year", year)
  ]);
  if (cfgErr) throw cfgErr;
  if (rowsErr) throw rowsErr;

  const yearData = { hasSplit: cfg.has_split, visibleMonths: cfg.visible_months };
  for (const region of ["total", "espana", "panama"]) {
    const regionRows = rows.filter(r => r.region === region);
    if (regionRows.length === 0) continue;
    const revenue = new Array(12).fill(null);
    const cost = new Array(12).fill(null);
    const real = new Array(12).fill(false);
    regionRows.forEach(r => {
      const i = r.month - 1;
      revenue[i] = r.revenue != null ? Number(r.revenue) : null;
      cost[i] = r.cost != null ? Number(r.cost) : null;
      real[i] = r.is_real;
    });
    yearData[region] = { revenue, cost, real };
  }

  yearCache[year] = yearData;
  return yearData;
}

function getSeries(yearData) {
  const n = yearData.visibleMonths || 12;
  const set = yearData[state.region] || yearData.total;
  const revenue = set.revenue ? set.revenue.slice(0, n) : null;
  const cost = set.cost.slice(0, n);
  const real = set.real.slice(0, n);
  const hasRevenue = !!revenue;
  const profit = hasRevenue ? revenue.map((r, i) => (r == null || cost[i] == null) ? null : r - cost[i]) : null;
  return { hasRevenue, revenue, cost, profit, real, n };
}

// ---------------- Render ----------------
function renderFilters(yearData) {
  document.querySelectorAll("#yearSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
  });
  document.querySelectorAll("#regionSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.region === state.region));
  });
  const split = yearData.hasSplit;
  document.querySelectorAll("#regionSeg button[data-region='espana'], #regionSeg button[data-region='panama']")
    .forEach(b => b.disabled = !split);
  document.getElementById("regionNote").classList.toggle("show", !split);
  if (!split && state.region !== "total") {
    state.region = "total";
  }
}

function renderKPIs(s) {
  const strip = document.getElementById("kpiStrip");
  const disabledNote = document.getElementById("regionDisabledNote");

  const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
  const sum = arr => arr == null ? null : realIdx.reduce((a, i) => a + (arr[i] || 0), 0);

  if (s.hasRevenue) {
    disabledNote.style.display = "none";
    strip.style.display = "grid";
    const rev = sum(s.revenue), cost = sum(s.cost), profit = sum(s.profit);
    const margin = rev ? (profit / rev * 100) : null;
    strip.innerHTML = `
      <div class="kpi"><div class="label">INGRESOS</div><div class="value">${eur(rev)}</div><div class="foot">${realIdx.length} meses con dato real</div></div>
      <div class="kpi"><div class="label">COSTES</div><div class="value">${eur(cost)}</div><div class="foot">España + Panamá</div></div>
      <div class="kpi"><div class="label">BENEFICIO</div><div class="value ${profit<0?'neg':'pos'}">${eur(profit)}</div><div class="foot">${state.year}</div></div>
      <div class="kpi"><div class="label">MARGEN</div><div class="value ${margin<0?'neg':'pos'}">${pct(margin)}</div><div class="foot">sobre ingresos reales</div></div>
    `;
  } else {
    strip.style.display = "none";
    disabledNote.style.display = "block";
    const cost = sum(s.cost);
    const label = state.region === "espana" ? "España" : "Panamá";
    disabledNote.innerHTML = `Ingresos no desglosados por país — solo coste disponible para <strong>${label}</strong>: <span style="font-family:'IBM Plex Mono',monospace">${eur(cost)}</span> (${realIdx.length} meses reales).`;
  }
}

function renderChart(s) {
  const box = document.getElementById("mainChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs y la tabla siguen funcionando con normalidad.</div>';
    return;
  }
  const ctx = document.getElementById("mainChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();

  const datasets = [];
  if (s.hasRevenue) {
    datasets.push({ label: "Ingresos", data: s.revenue, borderColor: "#3d7cbf", backgroundColor: "transparent", tension: .25, spanGaps: false });
    datasets.push({ label: "Costes", data: s.cost, borderColor: getComputedStyle(document.body).getPropertyValue("--neg").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false });
    datasets.push({ label: "Beneficio", data: s.profit, borderColor: getComputedStyle(document.body).getPropertyValue("--accent").trim(), backgroundColor: "transparent", tension: .25, spanGaps: false, borderWidth: 2.5 });
  } else {
    const label = state.region === "espana" ? "Costes España" : "Costes Panamá";
    datasets.push({ label, data: s.cost, borderColor: getComputedStyle(document.body).getPropertyValue("--warn").trim(), backgroundColor: "transparent", tension: .25 });
  }

  document.getElementById("chartTitle").textContent = `EVOLUCIÓN MENSUAL — ${state.year} · ${state.region === 'total' ? 'Total' : (state.region === 'espana' ? 'España' : 'Panamá')}`;

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: MONTHS.slice(0, s.n), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { color: inkSoft, boxWidth: 12, font: { family: "IBM Plex Mono", size: 11.5 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${eur(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => eur(v) } }
      }
    }
  });
}

function renderTable(s) {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");

  if (s.hasRevenue) {
    head.innerHTML = `<th>Mes</th><th>Ingresos</th><th>Costes</th><th>Beneficio</th><th>Margen</th><th>Estado</th>`;
    body.innerHTML = MONTHS.slice(0, s.n).map((m, i) => {
      const p = s.profit[i];
      const margin = (s.revenue[i] && p != null) ? (p / s.revenue[i] * 100) : null;
      return `<tr>
        <td>${m}</td>
        <td>${eur(s.revenue[i])}</td>
        <td>${eur(s.cost[i])}</td>
        <td class="${p<0?'neg':(p>0?'pos':'')}">${eur(p)}</td>
        <td class="${margin<0?'neg':''}">${pct(margin)}</td>
        <td><span class="status ${s.real[i]?'real':'est'}">${s.real[i]?'real':'estimado'}</span></td>
      </tr>`;
    }).join("");
    const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
    const sum = arr => realIdx.reduce((a, i) => a + (arr[i] || 0), 0);
    const trev = sum(s.revenue), tcost = sum(s.cost), tprofit = sum(s.profit);
    const tmargin = trev ? (tprofit / trev * 100) : null;
    foot.innerHTML = `<td>Total (meses reales)</td><td>${eur(trev)}</td><td>${eur(tcost)}</td><td class="${tprofit<0?'neg':'pos'}">${eur(tprofit)}</td><td>${pct(tmargin)}</td><td></td>`;
  } else {
    head.innerHTML = `<th>Mes</th><th>Costes</th><th>Estado</th>`;
    body.innerHTML = MONTHS.slice(0, s.n).map((m, i) => `<tr>
        <td>${m}</td>
        <td>${eur(s.cost[i])}</td>
        <td><span class="status ${s.real[i]?'real':'est'}">${s.real[i]?'real':'estimado'}</span></td>
      </tr>`).join("");
    const realIdx = s.real.map((r, i) => r ? i : -1).filter(i => i >= 0);
    const tcost = realIdx.reduce((a, i) => a + (s.cost[i] || 0), 0);
    foot.innerHTML = `<td>Total (meses reales)</td><td>${eur(tcost)}</td><td></td>`;
  }
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    const yearData = await fetchYear(state.year);
    renderFilters(yearData);
    const s = getSeries(yearData);
    renderKPIs(s);
    renderChart(s);
    renderTable(s);
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}

document.getElementById("yearSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.year = Number(b.dataset.year); renderAll();
});
document.getElementById("regionSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  state.region = b.dataset.region; renderAll();
});
