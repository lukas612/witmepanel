import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const state = { year: null };
let chart = null;
let allRows = null; // full witme_invoiced_monthly cache, fetched once

const money = (n, currency) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency, maximumFractionDigits: 0 });

initAuth(renderAll);

async function fetchAll() {
  if (allRows) return allRows;
  const { data, error } = await supabase.from("witme_invoiced_monthly").select("*");
  if (error) throw error;
  allRows = data;
  return allRows;
}

function renderYearFilter(years) {
  const seg = document.getElementById("yearSeg");
  seg.innerHTML = years.map(y =>
    `<button data-year="${y}" aria-pressed="${y === state.year}">${y}</button>`
  ).join("");
  seg.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => { state.year = Number(b.dataset.year); render(); });
  });
}

function render() {
  const rows = allRows.filter(r => r.year === state.year);
  const eurByMonth = new Array(12).fill(0);
  const eurInvoicesByMonth = new Array(12).fill(0);
  const otherCurrencies = {}; // currency -> total (whole year)
  let totalEur = 0, totalEurInvoices = 0, otherInvoiceCount = 0;

  rows.forEach(r => {
    const i = r.month - 1;
    if (r.currency === "EUR") {
      eurByMonth[i] += Number(r.invoiced_total);
      totalEur += Number(r.invoiced_total);
      eurInvoicesByMonth[i] += r.invoice_count;
      totalEurInvoices += r.invoice_count;
    } else {
      otherCurrencies[r.currency] = (otherCurrencies[r.currency] || 0) + Number(r.invoiced_total);
      otherInvoiceCount += r.invoice_count;
    }
  });

  const monthsWithData = eurByMonth.map((v, i) => v > 0 || eurInvoicesByMonth[i] > 0).lastIndexOf(true) + 1 || 12;

  document.querySelectorAll("#yearSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
  });

  const avgMonthly = totalEur / (eurByMonth.slice(0, monthsWithData).filter(v => v > 0).length || 1);
  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  const otherSummary = Object.entries(otherCurrencies)
    .map(([cur, total]) => money(total, cur)).join(" · ") || "—";
  strip.innerHTML = `
    <div class="kpi"><div class="label">FACTURADO EUR (sin IVA)</div><div class="value">${money(totalEur, "EUR")}</div><div class="foot">${state.year}</div></div>
    <div class="kpi"><div class="label">FACTURAS EMITIDAS (EUR)</div><div class="value">${totalEurInvoices}</div><div class="foot">${state.year}</div></div>
    <div class="kpi"><div class="label">MEDIA MENSUAL (EUR)</div><div class="value">${money(avgMonthly, "EUR")}</div><div class="foot">meses con facturación</div></div>
    <div class="kpi"><div class="label">OTRAS DIVISAS (sin convertir)</div><div class="value" style="font-size:14px;">${otherSummary}</div><div class="foot">${otherInvoiceCount} facturas</div></div>
  `;

  document.getElementById("chartTitle").textContent = `FACTURADO MENSUAL (EUR) — ${state.year}`;
  drawChart(MONTHS.slice(0, monthsWithData), eurByMonth.slice(0, monthsWithData));

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");
  head.innerHTML = `<th>Mes</th><th>Facturado EUR</th><th>Facturas EUR</th><th>Otras divisas</th>`;
  body.innerHTML = MONTHS.slice(0, monthsWithData).map((m, i) => {
    const others = rows.filter(r => r.month === i + 1 && r.currency !== "EUR")
      .map(r => money(Number(r.invoiced_total), r.currency)).join(", ") || "—";
    return `<tr>
      <td>${m}</td>
      <td>${money(eurByMonth[i], "EUR")}</td>
      <td>${eurInvoicesByMonth[i] || "—"}</td>
      <td style="text-align:left; font-size:12px;">${others}</td>
    </tr>`;
  }).join("");
  foot.innerHTML = `<td>Total ${state.year}</td><td>${money(totalEur, "EUR")}</td><td>${totalEurInvoices}</td><td></td>`;
}

function drawChart(labels, data) {
  const box = document.getElementById("mainChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js). Los KPIs y la tabla siguen funcionando con normalidad.</div>';
    return;
  }
  const ctx = document.getElementById("mainChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const accentSoft = getComputedStyle(document.body).getPropertyValue("--accent-soft").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Facturado EUR", data, backgroundColor: accentSoft, borderColor: accent, borderWidth: 1.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => money(c.parsed.y, "EUR") } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => money(v, "EUR") } }
      }
    }
  });
}

async function renderAll() {
  const loadNote = document.getElementById("loadNote");
  loadNote.style.display = "block";
  loadNote.textContent = "Cargando datos…";
  loadNote.style.color = "";
  try {
    const rows = await fetchAll();
    const years = [...new Set(rows.map(r => r.year))].sort();
    if (state.year == null) state.year = years[years.length - 1];
    renderYearFilter(years);
    render();
    loadNote.style.display = "none";
  } catch (err) {
    console.error(err);
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a este panel — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
