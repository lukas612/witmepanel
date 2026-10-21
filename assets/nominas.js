import { supabase, initAuth } from "./auth.js";
import { fetchAllRows } from "./supabaseUtil.js";

const MONTH_NAMES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const RUN_TYPE_LABELS = { nomina: "Nómina", bonus: "Bonus" };

const money = (n) => n == null ? "—" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

let runs = [], lines = [];
let trendChart = null;

initAuth(renderAll);

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : s;
  return div.innerHTML;
}

// ---------------- Excel parsing ----------------

// The "Detalle" sheet's description column uses abbreviations the source
// system truncates differently per concept (e.g. "Sueldo bas" for "Sueldo
// base"), so labels are matched by a normalized (letters-only) key instead
// of an exact string -- startsWith/includes on that key survives truncation.
function normKey(s) {
  return (s == null ? "" : String(s)).toLowerCase().replace(/[^a-záéíóúñ]/g, "");
}

const CONCEPT_MATCHERS = [
  { test: k => k.startsWith("sueldobas"), field: "sueldo_base" },
  { test: k => k.startsWith("incentivo"), field: "incentivos" },
  { test: k => k.startsWith("acuenta"), field: "a_cuenta_convenio" },
  { test: k => k.startsWith("mejoravol"), field: "mejora_voluntaria" },
  { test: k => k.startsWith("ticket"), field: "ticket_restaurante" },
  { test: k => k.startsWith("transflex") || k.startsWith("trasnsporteflex"), field: "transporte_flexible" },
  { test: k => k.startsWith("accajuste"), field: "acc_ajuste" },
  { test: k => k === "ppe", field: "ppe" },
  { test: k => k === "totaldevengos", field: "total_devengos", marksEndOfDevengos: true },
  { test: k => k.startsWith("dtoccom"), field: "dto_comunes" },
  { test: k => k.startsWith("dtoacc"), field: "dto_accidente" },
  { test: k => k.startsWith("retenirpf"), field: "retencion_irpf" },
  { test: k => k === "totalretencion", field: "total_retencion" },
  { test: k => k === "totalliquido", field: "total_liquido" },
  { test: k => k.includes("costess") && k.includes("empr"), field: "coste_ss_empresa" },
  { test: k => k.includes("costehe") && k.includes("empr"), field: "coste_he_empresa" },
  { test: k => k.includes("costeacc") && k.includes("empr"), field: "coste_acc_empresa" },
  { test: k => k === "total", field: "total_coste" },
  { test: k => k === "baseunica", field: "base_unica" },
  { test: k => k === "baseaccidentes", field: "base_accidentes" },
  { test: k => k === "segurosocialtotal", field: "seguro_social_total" },
];

const EMPTY_FIELDS = {
  sueldo_base: null, incentivos: null, a_cuenta_convenio: null, mejora_voluntaria: null,
  ticket_restaurante: null, transporte_flexible: null, acc_ajuste: null, ppe: null,
  total_devengos: null, dto_comunes: null, dto_accidente: null, retencion_irpf: null,
  total_retencion: null, total_liquido: null, coste_ss_empresa: null, coste_he_empresa: null,
  coste_acc_empresa: null, total_coste: null, base_unica: null, base_accidentes: null,
  seguro_social_total: null,
};

function cellNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function cellText(v) {
  return (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
}

// Parses the "Detalle" sheet (array-of-arrays, header:1) into one row per
// employee. The sheet's layout (codes row -> 3 name-part rows -> fecha_alta
// row -> concept rows) is located by content, not by a fixed row number, so
// it keeps working if a future month adds/removes a concept row.
function parseDetalle(aoa) {
  let periodLabel = null;
  for (const row of aoa) {
    if (row && cellText(row[0]) === "Proceso") { periodLabel = cellText(row[1]); break; }
  }

  let codesRowIdx = -1;
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (cellText(row[0]) !== "" || cellText(row[1]) !== "") continue;
    let codeCount = 0;
    for (let c = 2; c < row.length; c++) {
      if (/^\d+$/.test(cellText(row[c]))) codeCount++;
    }
    if (codeCount >= 3) { codesRowIdx = i; break; }
  }
  if (codesRowIdx === -1) throw new Error('No se encontró la fila de códigos de empleado en la hoja "Detalle". ¿Es el archivo correcto?');

  const codesRow = aoa[codesRowIdx];
  const codeCols = [];
  for (let c = 2; c < codesRow.length; c++) {
    if (cellText(codesRow[c]) !== "") codeCols.push(c);
  }

  const identityRows = [];
  let r = codesRowIdx + 1;
  while (r < aoa.length && identityRows.length <= 6) {
    const row = aoa[r] || [];
    if (cellText(row[0]) !== "") break;
    identityRows.push(row);
    r++;
  }
  let fechaRowIdx = -1;
  for (let i = identityRows.length - 1; i >= 0; i--) {
    const row = identityRows[i];
    if (codeCols.some(c => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cellText(row[c])))) { fechaRowIdx = i; break; }
  }
  const nameRows = fechaRowIdx >= 0 ? identityRows.slice(0, fechaRowIdx) : identityRows;
  const fechaRow = fechaRowIdx >= 0 ? identityRows[fechaRowIdx] : null;
  const conceptStartIdx = r;

  function buildName(col) {
    const parts = nameRows.map(row => cellText(row[col])).filter(Boolean);
    if (parts.length >= 3) return `${parts[1]} ${parts[2]}, ${parts[0]}`;
    if (parts.length === 2) return `${parts[1]}, ${parts[0]}`;
    return parts[0] || "(sin nombre)";
  }
  function buildFecha(col) {
    if (!fechaRow) return null;
    const m = cellText(fechaRow[col]).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  }

  const employees = codeCols.map(c => ({
    employee_code: cellText(codesRow[c]),
    employee_name: buildName(c),
    fecha_alta: buildFecha(c),
    ...EMPTY_FIELDS,
    raw_concepts: {},
  }));
  const empByCol = new Map(codeCols.map((c, idx) => [c, employees[idx]]));

  let inDevengos = true;
  for (let i = conceptStartIdx; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const label = cellText(row[0]).replace(/^\(\d+\)\s*\d+\s*/, "").trim();
    if (!label) continue;
    const key = normKey(label);
    const matcher = CONCEPT_MATCHERS.find(m => m.test(key));
    if (matcher && matcher.marksEndOfDevengos) inDevengos = false;

    for (const c of codeCols) {
      const emp = empByCol.get(c);
      const num = cellNumber(row[c]);
      if (num == null) continue;
      if (matcher) {
        // "Ticket restaurante"/"Transporte flexible" each appear twice: once
        // as a devengo, once as an equal-amount deduction further down (a
        // wash) -- only the first (devengo) occurrence fills the named
        // column; the deduction-side repeat is kept under raw_concepts.
        if ((matcher.field === "ticket_restaurante" || matcher.field === "transporte_flexible") && !inDevengos) {
          emp.raw_concepts[`dto_${matcher.field}`] = num;
        } else {
          emp[matcher.field] = num;
        }
      } else {
        emp.raw_concepts[label] = num;
      }
    }
  }

  return { periodLabel, employees };
}

// ---------------- Upload ----------------

async function handleUpload() {
  const msg = document.getElementById("uploadMsg");
  const btn = document.getElementById("uploadBtn");
  const year = parseInt(document.getElementById("upYear").value, 10);
  const month = parseInt(document.getElementById("upMonth").value, 10);
  const runType = document.getElementById("upType").value;
  const xlsxFile = document.getElementById("upXlsx").files[0];
  const pdfFile = document.getElementById("upPdf").files[0];
  const notes = document.getElementById("upNotes").value.trim();

  if (!year || !month || !xlsxFile) {
    msg.textContent = "Año, mes y el archivo Excel son obligatorios.";
    msg.className = "form-msg error";
    return;
  }

  btn.disabled = true;
  msg.className = "form-msg";
  msg.textContent = "Leyendo el Excel…";

  try {
    const buf = await xlsxFile.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames.find(n => n.toLowerCase() === "detalle") || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    const { periodLabel, employees } = parseDetalle(aoa);
    if (!employees.length) throw new Error("No se encontró ningún empleado en el Excel.");

    msg.textContent = "Subiendo archivos…";
    const base = `${year}/${String(month).padStart(2, "0")}_${runType}`;
    const { error: xlsxErr } = await supabase.storage.from("nominas").upload(`${base}.xlsx`, xlsxFile, { upsert: true, contentType: xlsxFile.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (xlsxErr) throw xlsxErr;
    let pdfPath = null;
    if (pdfFile) {
      const { error: pdfErr } = await supabase.storage.from("nominas").upload(`${base}.pdf`, pdfFile, { upsert: true, contentType: pdfFile.type || "application/pdf" });
      if (pdfErr) throw pdfErr;
      pdfPath = `${base}.pdf`;
    }

    msg.textContent = "Guardando datos…";
    const { data: { user } } = await supabase.auth.getUser();
    const { data: run, error: runErr } = await supabase.from("witme_payroll_runs")
      .upsert({
        year, month, run_type: runType, period_label: periodLabel,
        xlsx_path: `${base}.xlsx`, pdf_path: pdfPath, notes: notes || null,
        uploaded_by: user?.email || null, uploaded_at: new Date().toISOString(),
      }, { onConflict: "year,month,run_type" })
      .select().single();
    if (runErr) throw runErr;

    // Re-uploading a period replaces its lines entirely rather than merging.
    const { error: delErr } = await supabase.from("witme_payroll_lines").delete().eq("run_id", run.id);
    if (delErr) throw delErr;
    const { data: newLines, error: linesErr } = await supabase.from("witme_payroll_lines")
      .insert(employees.map(e => ({ run_id: run.id, ...e })))
      .select();
    if (linesErr) throw linesErr;

    runs = runs.filter(r => r.id !== run.id);
    runs.push(run);
    lines = lines.filter(l => l.run_id !== run.id).concat(newLines);

    msg.textContent = `Listo: ${employees.length} empleado(s) procesado(s).`;
    msg.className = "form-msg ok";
    ["upXlsx", "upPdf", "upNotes"].forEach(id => { document.getElementById(id).value = ""; });
    renderAllViews();
  } catch (err) {
    console.error(err);
    msg.textContent = `No se pudo procesar: ${err.message || err}`;
    msg.className = "form-msg error";
  } finally {
    btn.disabled = false;
  }
}

async function deleteRun(runId) {
  if (!confirm("¿Eliminar esta subida y todas sus líneas? Esta acción no se puede deshacer.")) return;
  const run = runs.find(r => r.id === runId);
  const paths = [run?.xlsx_path, run?.pdf_path].filter(Boolean);
  if (paths.length) await supabase.storage.from("nominas").remove(paths);
  const { error } = await supabase.from("witme_payroll_runs").delete().eq("id", runId);
  if (error) { alert("No se pudo eliminar."); console.error(error); return; }
  runs = runs.filter(r => r.id !== runId);
  lines = lines.filter(l => l.run_id !== runId);
  goToList();
}

async function downloadFile(path, btn) {
  if (!path) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  const { data, error } = await supabase.storage.from("nominas").createSignedUrl(path, 60);
  btn.disabled = false; btn.textContent = original;
  if (error) { alert("No se pudo generar el enlace de descarga."); console.error(error); return; }
  window.open(data.signedUrl, "_blank");
}

async function updateLineName(lineId, name) {
  const { error } = await supabase.from("witme_payroll_lines").update({ employee_name: name }).eq("id", lineId);
  if (error) { alert("No se pudo guardar el nombre."); console.error(error); return; }
  const l = lines.find(l => l.id === lineId);
  if (l) l.employee_name = name;
}

// ---------------- Rendering ----------------

const state = { view: "list", selectedRunId: null };

function runsSorted() {
  return [...runs].sort((a, b) => (b.year - a.year) || (b.month - a.month) || a.run_type.localeCompare(b.run_type));
}
function linesFor(runId) { return lines.filter(l => l.run_id === runId); }

function renderKpis() {
  const nominaRuns = runs.filter(r => r.run_type === "nomina").sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const latest = nominaRuns[0];
  const latestLines = latest ? linesFor(latest.id) : [];
  const coste = latestLines.reduce((s, l) => s + Number(l.total_coste || 0), 0);
  const liquido = latestLines.reduce((s, l) => s + Number(l.total_liquido || 0), 0);
  const yearToDate = latest ? runs.filter(r => r.run_type === "nomina" && r.year === latest.year).flatMap(r => linesFor(r.id)).reduce((s, l) => s + Number(l.total_coste || 0), 0) : 0;

  document.getElementById("kpiStrip").innerHTML = `
    <div class="kpi"><div class="label">COSTE EMPRESA</div><div class="value">${money(coste)}</div><div class="foot">${latest ? `${MONTH_NAMES[latest.month]} ${latest.year}` : "sin datos"}</div></div>
    <div class="kpi"><div class="label">LÍQUIDO A PERCIBIR</div><div class="value">${money(liquido)}</div><div class="foot">${latest ? `${MONTH_NAMES[latest.month]} ${latest.year}` : "sin datos"}</div></div>
    <div class="kpi"><div class="label">EMPLEADOS</div><div class="value">${latestLines.length || "—"}</div><div class="foot">en la última nómina</div></div>
    <div class="kpi"><div class="label">MASA SALARIAL ${latest ? latest.year : ""}</div><div class="value">${money(yearToDate)}</div><div class="foot">coste acumulado en el año</div></div>
  `;
}

function renderRunsTable() {
  const body = document.getElementById("runsBody");
  const sorted = runsSorted();
  document.getElementById("runsEmpty").style.display = sorted.length ? "none" : "block";
  body.innerHTML = sorted.map(r => {
    const ls = linesFor(r.id);
    const liquido = ls.reduce((s, l) => s + Number(l.total_liquido || 0), 0);
    const coste = ls.reduce((s, l) => s + Number(l.total_coste || 0), 0);
    return `<tr>
      <td style="text-align:left;">${escapeHtml(r.period_label || `${MONTH_NAMES[r.month]} ${r.year}`)}</td>
      <td style="text-align:left;"><span class="status ${r.run_type}">${RUN_TYPE_LABELS[r.run_type]}</span></td>
      <td>${ls.length}</td>
      <td>${money(liquido)}</td>
      <td>${money(coste)}</td>
      <td style="text-align:left;">${r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString("es-ES") : "—"}</td>
      <td>
        <button class="btn-secondary" data-action="view" data-run-id="${r.id}">Ver</button>
        ${r.xlsx_path ? `<button class="btn-secondary" data-action="xlsx" data-run-id="${r.id}">Excel</button>` : ""}
        ${r.pdf_path ? `<button class="btn-secondary" data-action="pdf" data-run-id="${r.id}">PDF</button>` : ""}
        <button class="btn-icon-delete" data-action="delete" data-run-id="${r.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`;
  }).join("");
}

function renderTrendChart() {
  const box = document.getElementById("trendChart").parentElement;
  if (typeof Chart === "undefined") {
    box.innerHTML = '<div style="color:var(--ink-soft); font-size:13px; padding:20px;">No se ha podido cargar la librería de gráficos (Chart.js).</div>';
    return;
  }
  const nominaRuns = runs.filter(r => r.run_type === "nomina").sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const labels = nominaRuns.map(r => `${MONTH_NAMES[r.month].slice(0, 3)} ${String(r.year).slice(2)}`);
  const data = nominaRuns.map(r => linesFor(r.id).reduce((s, l) => s + Number(l.total_coste || 0), 0));

  const ctx = document.getElementById("trendChart").getContext("2d");
  const gridColor = getComputedStyle(document.body).getPropertyValue("--line").trim();
  const inkSoft = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  const accentSoft = getComputedStyle(document.body).getPropertyValue("--accent-soft").trim();

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Coste empresa", data, backgroundColor: accentSoft, borderColor: accent, borderWidth: 1.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.y) } } },
      scales: {
        y: { grid: { color: gridColor }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 }, callback: v => money(v) } },
        x: { grid: { display: false }, ticks: { color: inkSoft, font: { family: "IBM Plex Mono", size: 11 } } },
      },
    },
  });
}

function populateYearSelect() {
  const sel = document.getElementById("annualYear");
  const years = [...new Set(runs.map(r => r.year))].sort((a, b) => b - a);
  const prev = sel.value;
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  if (years.length) sel.value = years.includes(Number(prev)) ? prev : years[0];
}

function renderAnnualTable() {
  const sel = document.getElementById("annualYear");
  const year = Number(sel.value);
  const byCode = new Map();
  for (const r of runs) {
    if (r.year !== year) continue;
    for (const l of linesFor(r.id)) {
      if (!byCode.has(l.employee_code)) byCode.set(l.employee_code, {
        code: l.employee_code, name: l.employee_name,
        nominaCount: 0, nominaLiquido: 0, nominaCoste: 0, bonusLiquido: 0, bonusCoste: 0,
        lastMonth: 0,
      });
      const e = byCode.get(l.employee_code);
      if (r.run_type === "nomina") {
        e.nominaCount++;
        e.nominaLiquido += Number(l.total_liquido || 0);
        e.nominaCoste += Number(l.total_coste || 0);
      } else {
        e.bonusLiquido += Number(l.total_liquido || 0);
        e.bonusCoste += Number(l.total_coste || 0);
      }
      // Use the name from the most recent month seen, so a later manual
      // correction (or a less-truncated source row) wins the display label.
      if (r.month >= e.lastMonth) { e.lastMonth = r.month; e.name = l.employee_name; }
    }
  }
  const rows = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById("annualEmpty").style.display = rows.length ? "none" : "block";
  document.getElementById("annualBody").innerHTML = rows.map(e => `<tr>
    <td style="text-align:left;">${escapeHtml(e.name)} <span style="color:var(--ink-soft); font-size:11px;">(${escapeHtml(e.code)})</span></td>
    <td>${e.nominaCount}</td>
    <td>${money(e.nominaLiquido)}</td>
    <td>${money(e.nominaCoste)}</td>
    <td>${money(e.bonusLiquido)}</td>
    <td>${money(e.bonusCoste)}</td>
    <td>${money(e.nominaLiquido + e.bonusLiquido)}</td>
    <td>${money(e.nominaCoste + e.bonusCoste)}</td>
  </tr>`).join("");
  const tot = rows.reduce((acc, e) => ({
    nominaLiquido: acc.nominaLiquido + e.nominaLiquido, nominaCoste: acc.nominaCoste + e.nominaCoste,
    bonusLiquido: acc.bonusLiquido + e.bonusLiquido, bonusCoste: acc.bonusCoste + e.bonusCoste,
  }), { nominaLiquido: 0, nominaCoste: 0, bonusLiquido: 0, bonusCoste: 0 });
  document.getElementById("annualFoot").innerHTML = `<td style="text-align:left;">Total (${rows.length})</td><td></td>
    <td>${money(tot.nominaLiquido)}</td><td>${money(tot.nominaCoste)}</td>
    <td>${money(tot.bonusLiquido)}</td><td>${money(tot.bonusCoste)}</td>
    <td>${money(tot.nominaLiquido + tot.bonusLiquido)}</td><td>${money(tot.nominaCoste + tot.bonusCoste)}</td>`;
}

function renderList() {
  renderKpis();
  renderRunsTable();
  renderTrendChart();
  populateYearSelect();
  renderAnnualTable();
}

function goToList() {
  state.view = "list"; state.selectedRunId = null;
  document.getElementById("listView").style.display = "block";
  document.getElementById("detailView").style.display = "none";
  renderList();
}

function goToDetail(runId) {
  state.view = "detail"; state.selectedRunId = runId;
  document.getElementById("listView").style.display = "none";
  document.getElementById("detailView").style.display = "block";
  renderDetail(runId);
}

function renderDetail(runId) {
  const run = runs.find(r => r.id === runId);
  if (!run) { goToList(); return; }
  const ls = [...linesFor(runId)].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  const liquido = ls.reduce((s, l) => s + Number(l.total_liquido || 0), 0);
  const coste = ls.reduce((s, l) => s + Number(l.total_coste || 0), 0);

  document.getElementById("runHeader").innerHTML = `
    <div>
      <h2>${escapeHtml(run.period_label || `${MONTH_NAMES[run.month]} ${run.year}`)}</h2>
      <div class="trip-meta"><span class="status ${run.run_type}">${RUN_TYPE_LABELS[run.run_type]}</span> · ${ls.length} empleado(s)${run.notes ? ` · ${escapeHtml(run.notes)}` : ""}</div>
    </div>
  `;
  document.getElementById("runKpiStrip").innerHTML = `
    <div class="kpi"><div class="label">TOTAL LÍQUIDO</div><div class="value">${money(liquido)}</div><div class="foot"></div></div>
    <div class="kpi"><div class="label">TOTAL COSTE EMPRESA</div><div class="value">${money(coste)}</div><div class="foot"></div></div>
  `;

  document.getElementById("linesBody").innerHTML = ls.map(l => `<tr>
    <td style="text-align:left;">${escapeHtml(l.employee_code)}</td>
    <td style="text-align:left;"><span class="editable-name" data-line-id="${l.id}" title="Clic para corregir el nombre">${escapeHtml(l.employee_name)}</span></td>
    <td>${money(l.sueldo_base)}</td>
    <td>${money(l.total_devengos)}</td>
    <td>${money(l.total_retencion)}</td>
    <td>${money(l.total_liquido)}</td>
    <td>${money(l.coste_ss_empresa)}</td>
    <td>${money(l.total_coste)}</td>
  </tr>`).join("");
  document.getElementById("linesFoot").innerHTML = `<td colspan="5" style="text-align:left;">Total</td>
    <td>${money(liquido)}</td><td></td><td>${money(coste)}</td>`;
}

function startNameEdit(span) {
  const lineId = span.dataset.lineId;
  const input = document.createElement("input");
  input.type = "text";
  input.value = span.textContent;
  input.className = "name-edit-input";
  span.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const value = input.value.trim();
    const newSpan = document.createElement("span");
    newSpan.className = "editable-name";
    newSpan.dataset.lineId = lineId;
    newSpan.title = "Clic para corregir el nombre";
    newSpan.textContent = value;
    input.replaceWith(newSpan);
    if (value && value !== span.textContent) await updateLineName(lineId, value);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
}

function renderAllViews() {
  if (state.view === "detail") renderDetail(state.selectedRunId); else renderList();
}

// ---------------- Event wiring ----------------

document.getElementById("uploadBtn").addEventListener("click", handleUpload);
document.getElementById("backToListBtn").addEventListener("click", goToList);
document.getElementById("annualYear").addEventListener("change", renderAnnualTable);

document.getElementById("runsBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-run-id]");
  if (!btn) return;
  const runId = btn.dataset.runId;
  const run = runs.find(r => r.id === runId);
  if (btn.dataset.action === "view") goToDetail(runId);
  else if (btn.dataset.action === "xlsx") downloadFile(run?.xlsx_path, btn);
  else if (btn.dataset.action === "pdf") downloadFile(run?.pdf_path, btn);
  else if (btn.dataset.action === "delete") deleteRun(runId);
});

document.getElementById("linesBody").addEventListener("click", (e) => {
  const span = e.target.closest(".editable-name");
  if (span) startNameEdit(span);
});

// ---------------- Boot ----------------

async function fetchAll() {
  const [r, l] = await Promise.all([
    fetchAllRows(supabase, "witme_payroll_runs"),
    fetchAllRows(supabase, "witme_payroll_lines"),
  ]);
  runs = r; lines = l;
}

async function renderAll() {
  const today = new Date();
  document.getElementById("upYear").value = today.getFullYear();
  document.getElementById("upMonth").value = today.getMonth() + 1;

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
    loadNote.textContent = "No se pudieron cargar los datos. Puede que tu cuenta no tenga acceso a esta sección — contacta al administrador.";
    loadNote.style.color = "var(--neg)";
  }
}
