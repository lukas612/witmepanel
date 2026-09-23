const GROUPS = [
  {
    label: "Generado",
    pages: [
      { href: "index.html", label: "Generado (P&L)" },
      { href: "ejecutivo.html", label: "Resumen ejecutivo" },
    ],
  },
  {
    label: "Facturación",
    pages: [
      { href: "facturado.html", label: "Facturado (Holded)" },
      { href: "revision.html", label: "Revisión de clientes" },
      { href: "matriz.html", label: "Matriz de clientes" },
      { href: "impagados.html", label: "Impagados" },
    ],
  },
  {
    label: "Objetivos",
    pages: [
      { href: "objetivos.html", label: "Objetivos" },
      { href: "resultados.html", label: "Resultados" },
      { href: "comparativa.html", label: "Objetivo vs Real" },
    ],
  },
];

function currentPage() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf("/") + 1) || "index.html";
}

function initPageMenu() {
  const bar = document.getElementById("pageMenuBar");
  if (!bar) return;

  const here = currentPage();
  bar.innerHTML = GROUPS.map((g, i) => {
    const hasActive = g.pages.some(p => p.href === here);
    const links = g.pages.map(p =>
      `<a class="page-link${p.href === here ? " active" : ""}" href="${p.href}">${p.label}</a>`
    ).join("");
    return `
      <div class="page-menu-group">
        <button class="page-menu-btn${hasActive ? " current" : ""}" id="pageMenuBtn${i}" type="button" aria-haspopup="true" aria-expanded="false">${g.label} ▾</button>
        <nav class="page-menu-panel" id="pageMenuPanel${i}" hidden>${links}</nav>
      </div>`;
  }).join("");

  const entries = GROUPS.map((g, i) => ({
    btn: document.getElementById(`pageMenuBtn${i}`),
    panel: document.getElementById(`pageMenuPanel${i}`),
  }));

  const closeAll = (except) => {
    entries.forEach(({ btn, panel }) => {
      if (panel === except) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    });
  };

  entries.forEach(({ btn, panel }) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasHidden = panel.hidden;
      closeAll();
      if (wasHidden) {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
  document.addEventListener("click", (e) => {
    const insideAny = entries.some(({ btn, panel }) => panel.contains(e.target) || e.target === btn);
    if (!insideAny) closeAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPageMenu);
} else {
  initPageMenu();
}
