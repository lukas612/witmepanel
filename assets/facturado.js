import { supabase, initAuth } from "./auth.js";

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const state = { year: null };
let chart = null;
let invoicedRows = null;
let purchasedRows = null;

const money = (n, currency) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency, maximumFractionDigits: 0 });

initAuth(renderAll);

async function fetchAll() {
  if (invoicedRows && purchasedRows) return;
  const [{ data: inv, error: invErr }, { data: pur, error: purErr }] = await Promise.all([
    supabase.from("witme_invoiced_monthly").select("*"),
    supabase.from("witme_purchased_monthly").select("*")
  ]);
  if (invErr) throw invErr;
  if (purErr) throw purErr;
  invoicedRows = inv;
  purchasedRows = pur;
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
  const invRows = invoicedRows.filter(r => r.year === state.year);
  const purRows = purchasedRows.filter(r => r.year === state.year);

  const facturadoByMonth = new Array(12).fill(0);
  const compradoByMonth = new Array(12).fill(0);
  const invoicesByMonth = new Array(12).fill(0);
  const purchasesByMonth = new Array(12).fill(0);
  const currenciesUsed = new Set();

  invRows.forEach(r => {
    const i = r.month - 1;
    facturadoByMonth[i] += Number(r.invoiced_eur);
    invoicesByMonth[i] += r.invoice_count;
    currenciesUsed.add(r.currency);
  });
  purRows.forEach(r => {
    const i = r.month - 1;
    compradoByMonth[i] += Number(r.purchased_eur);
    purchasesByMonth[i] += r.purchase_count;
    currenciesUsed.add(r.currency);
  });

  const resultadoByMonth = facturadoByMonth.map((v, i) => v - compradoByMonth[i]);

  const hasData = i => facturadoByMonth[i] !== 0 || compradoByMonth[i] !== 0 || invoicesByMonth[i] > 0 || purchasesByMonth[i] > 0;
  const monthsWithData = facturadoByMonth.map((_, i) => hasData(i)).lastIndexOf(true) + 1 || 12;

  document.querySelectorAll("#yearSeg button").forEach(b => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
  });

  const totalFacturado = facturadoByMonth.slice(0, monthsWithData).reduce((a, b) => a + b, 0);
  const totalComprado = compradoByMonth.slice(0, monthsWithData).reduce((a, b) => a + b, 0);
  const totalResultado = totalFacturado - totalComprado;
  const totalInvoices = invoicesByMonth.slice(0, monthsWithData).reduce((a, b) => a + b, 0);
  const totalPurchases = purchasesByMonth.slice(0, monthsWithData).reduce((a, b) => a + b, 0);
  const margin = totalFacturado ? (totalResultado / totalFacturado * 100) : null;

  const strip = document.getElementById("kpiStrip");
  strip.style.display = "grid";
  strip.innerHTML = `
    <div class="kpi"><div class="label">FACTURADO (sin IVA, todo en €)</div><div class="value">${money(totalFacturado, "EUR")}</div><div class="foot">${totalInvoices} facturas</div></div>
    <div class="kpi"><div class="label">COMPRADO (solo proveedores, sin IVA)</div><div class="value">${money(totalComprado, "EUR")}</div><div class="foot">${totalPurchases} compras — no incluye nómina</div></div>
    <div class="kpi"><div class="label">RESULTADO (parcial, sin nómina)</div><div class="value ${totalResultado<0?'neg':'pos'}">${money(totalResultado, "EUR")}</div><div class="foot">margen ${margin!=null?margin.toFixed(1)+'%':'—'}</div></div>
    <div class="kpi"><div class="label">DIVISAS INCLUIDAS</div><div class="value" style="font-size:16px;">${[...currenciesUsed].sort().join(" · ")}</div><div class="foot">convertidas a EUR</div></div>
  `;

  document.getElementById("chartTitle").textContent = `FACTURADO, COMPRADO Y RESULTADO (€) — ${state.year}`;
  drawChart(MONTHS.slice(0, monthsWithData), facturadoByMonth.slice(0, monthsWithData), compradoByMonth.slice(0, monthsWithData), resultadoByMonth.slice(0, monthsWithData));

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  const foot = document.getElementById("tableFoot");
  head.innerHTML = `<th>Mes</th><th>Facturado (€)</th><th>Comprado (€)</th><th>Resultado (€)</th>`;
  body.innerHTML = MONTHS.slice(0, monthsWithData).map((m, i) => {
    const r = resultadoByMonth[i];
    return `<tr>
      <td>${m}</td>
      <td>${money(facturadoByMonth[i], "EUR")}</td>
      <td>${money(compradoByMonth[i], "EUR")}</td>
      <td class="${r<0?'neg':(r>0?'pos':'')}">${money(r, "EUR")}</td>
    </tr>`;
  }).join("");
  foot.innerHTML = `<td>Total ${state.year}</td><td>${money(totalFacturado, "EUR")}</td><td>${money(totalComprado, "EUR")}</td><td class="${totalResultado<0?'neg':'pos'}">${money(totalResultado, "EUR")}</td>`;
}

function drawChart(labels, facturado, comprado, resultado) {
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
  const neg = getComputedStyle(document.body).getPropertyValue("--neg").trim();

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Facturado", data: facturado, backgroundColor: accentSoft, borderColor: accent, borderWidth: 1.5 },
        { type: "bar", label: "Comprado", data: comprado, backgroundColor: "transparent", borderColor: neg, borderWidth: 1.5 },
        { type: "line", label: "Resultado", data: resultado, borderColor: "#3d7cbf", backgroundColor: "transparent", tension: .25, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "end", labels: { color: inkSoft, boxWidth: 12, font: { family: "IBM Plex Mono", size: 11.5 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y, "EUR")}` } }
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
    await fetchAll();
    const years = [...new Set([...invoicedRows, ...purchasedRows].map(r => r.year))].sort();
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
