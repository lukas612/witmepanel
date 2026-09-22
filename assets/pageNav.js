const PAGES = [
  { href: "index.html", label: "Generado (P&L)" },
  { href: "ejecutivo.html", label: "Resumen ejecutivo" },
  { href: "facturado.html", label: "Facturado (Holded)" },
  { href: "revision.html", label: "Revisión de clientes" },
  { href: "matriz.html", label: "Matriz de clientes" },
  { href: "impagados.html", label: "Impagados" },
  { href: "objetivos.html", label: "Objetivos" },
  { href: "resultados.html", label: "Resultados" },
];

function currentPage() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf("/") + 1) || "index.html";
}

function initPageMenu() {
  const btn = document.getElementById("pageMenuBtn");
  const panel = document.getElementById("pageMenuPanel");
  if (!btn || !panel) return;

  const here = currentPage();
  panel.innerHTML = PAGES.map(p =>
    `<a class="page-link${p.href === here ? " active" : ""}" href="${p.href}">${p.label}</a>`
  ).join("");

  const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => { panel.hidden = false; btn.setAttribute("aria-expanded", "true"); };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) open(); else close();
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPageMenu);
} else {
  initPageMenu();
}
