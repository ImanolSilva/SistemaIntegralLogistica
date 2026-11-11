/* Navegación, encabezado de módulo y tema visual compartidos por todos los módulos. */

/* ── Reparación de textos con codificación dañada (mojibake) ──────────────────
   Algunos Excel llegan con acentos codificados dos veces: "AUDÍFONOS" se ve como
   "AUDÃƒÂFONOS" y "BÓXER" como "BÃƒâ€œXER". fixText() revierte esas capas
   (UTF-8 leído como Windows-1252/Latin-1), solo en tramos que al decodificarse
   forman UTF-8 válido, así que el texto correcto nunca se altera. */
(function () {
    if (window.fixText) return;
    const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
    const HI = '\\u0080-\\u00FF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122';
    const RUN = new RegExp('[' + HI + ']{2,}', 'g');
    const SUSPECT = /[ÂÃ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]|â€/;
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
    function decodeRun(run) {
        const bytes = [];
        for (const ch of run) {
            const c = ch.codePointAt(0);
            if (c < 256) bytes.push(c); else if (CP1252[c] != null) bytes.push(CP1252[c]); else return run;
        }
        try { return decoder.decode(new Uint8Array(bytes)); } catch (e) { return run; }
    }
    window.fixText = function (value) {
        if (typeof value !== 'string' || !decoder || !SUSPECT.test(value)) return value;
        let out = value;
        for (let i = 0; i < 4 && SUSPECT.test(out); i++) {
            const next = out.replace(RUN, decodeRun);
            if (next === out) break;
            out = next;
        }
        return out;
    };
    window.fixTextDeep = function (obj) {
        if (typeof obj === 'string') return window.fixText(obj);
        if (Array.isArray(obj)) return obj.map(window.fixTextDeep);
        if (obj && typeof obj === 'object' && Object.getPrototypeOf(obj) === Object.prototype) {
            const o = {};
            Object.keys(obj).forEach(k => { o[window.fixText(k)] = window.fixTextDeep(obj[k]); });
            return o;
        }
        return obj;
    };

    // Todo Excel que lean los módulos pasa por XLSX.utils.sheet_to_json: se repara ahí
    // para que filtros, cálculos, archivos que se vuelven a subir y exportaciones queden limpios.
    function patchXLSX() {
        const X = window.XLSX;
        if (!X || !X.utils || typeof X.utils.sheet_to_json !== 'function' || X.utils.sheet_to_json.__fixText) return;
        const original = X.utils.sheet_to_json;
        const patched = function () { return window.fixTextDeep(original.apply(this, arguments)); };
        patched.__fixText = true;
        X.utils.sheet_to_json = patched;
    }
    patchXLSX();
    document.addEventListener('DOMContentLoaded', patchXLSX);
    window.addEventListener('load', patchXLSX);

    // Red de seguridad para todos los módulos: corrige el texto visible en pantalla.
    function fixNode(node) {
        if (node.nodeType === 3) {
            const v = node.nodeValue, f = window.fixText(v);
            if (f !== v) node.nodeValue = f;
            return;
        }
        if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
        if (node.title) { const f = window.fixText(node.title); if (f !== node.title) node.title = f; }
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walker.nextNode())) {
            const v = t.nodeValue;
            if (SUSPECT.test(v)) t.nodeValue = window.fixText(v);
        }
    }
    function start() {
        fixNode(document.body);
        new MutationObserver(muts => muts.forEach(m => {
            if (m.type === 'characterData') fixNode(m.target);
            else m.addedNodes.forEach(fixNode);
        })).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

(function () {
    // La raíz del sistema es la carpeta donde vive este script.
    const scriptSrc = (document.currentScript && document.currentScript.src) || '';
    const rootUrl = scriptSrc ? scriptSrc.replace(/shared-ui\.js(\?.*)?$/, '') : new URL('./', window.location.href).href;
    const href = (path) => new URL(path, rootUrl).href;
    const current = decodeURIComponent(window.location.pathname).toLowerCase().replace(/\\/g, '/');

    const links = [
        ['bi-house-fill', 'Inicio', 'index.html'],
        ['bi-grid-1x2-fill', 'Dashboard', 'Dashboard/index.html'],
        ['bi-speedometer2', 'Dashboard PDIS', '_archivado/PDISDashboard/index.html'],
        ['bi-file-earmark-medical-fill', 'PDIS', '_archivado/Rechazos/reportes.html'],
        ['bi-person-fill-gear', 'Administrar roles', 'Adminroles/admin.html']
    ];

    // Encabezado (hero) de cada módulo. Los módulos con hero propio no aparecen aquí
    // (Dashboard, Dashboard PDIS, Inicio, Login, Pendientes).
    const MODULES = [
        { match: '/adminroles/admin.html', eyebrow: 'Administración', icon: 'bi-person-fill-gear', title: 'Usuarios y roles',
          desc: 'Asigna roles, jefaturas y datos operativos de los usuarios con acceso corporativo automatico.' },
        { match: '/sku/index.html', eyebrow: 'Consulta', icon: 'bi-upc-scan', title: 'Buscador de SKUs',
          desc: 'Localiza artículos por SKU o contenedor y consulta su sección, jefatura y datos de manifiesto.' },
        { match: '/recibos/index.html', eyebrow: 'Operación', icon: 'bi-box-arrow-in-down-right', title: 'Área de Recibos',
          desc: 'Registra cada entrega: escanea la bodega, agrega los contenedores y confirma la recepción.' },
        { match: '/manifiestos/manifiestos.html', eyebrow: 'Operación', icon: 'bi-file-earmark-text-fill', title: 'Manifestar mercancía',
          desc: 'Verifica al colaborador, escanea la mercancía contra el manifiesto y genera sus reportes de diferencias.' },
        { match: '/_archivado/rechazos/reportes.html', eyebrow: 'PDIS', icon: 'bi-file-earmark-medical-fill', title: 'Gestor de PDIS',
          desc: 'Carga reportes de artículos PDIS, da seguimiento a cada pieza y captura su estado.' },
        { match: '/_archivado/bodegas/index.html', eyebrow: 'Inventario', icon: 'bi-building', title: 'Bodegas',
          desc: 'Escanea SKUs por colección y ubícalos en el plano interactivo de la tienda.' },
        { match: '/_archivado/configuraciones/configuracion.html', eyebrow: 'Cuenta', icon: 'bi-gear-fill', title: 'Configuración',
          desc: 'Consulta los datos de tu perfil y la información general del sistema.' },
        { match: '/_archivado/inventarios/inventarios.html', eyebrow: 'Inventario', icon: 'bi-boxes', title: 'Control de inventario',
          desc: 'Asistente paso a paso para seleccionar el archivo de inventario y completar el conteo.' },
        { match: '/_archivado/kanban/index.html', eyebrow: 'Métricas', icon: 'bi-kanban-fill', title: 'Dashboard de métricas',
          desc: 'Indicadores de manifiesto, rechazos, procesos clave, auditoría, control de inventario y orden de bodega.' },
        { match: '/_archivado/reportes/resumensemanal.html', eyebrow: 'Reportes', icon: 'bi-graph-up-arrow', title: 'Resumen semanal',
          desc: 'Selecciona un rango de fechas para generar el resumen consolidado de la operación.' },
    ];

    function ensureTheme() {
        if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => /\/theme\.css(\?|$)/.test(l.href))) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href('theme.css');
        document.head.appendChild(link);
    }

    function injectHero() {
        const mod = MODULES.find(m => current.endsWith(m.match));
        if (!mod || document.querySelector('.ui-hero')) return;
        const main = document.querySelector('main') || document.querySelector('.main-container');
        if (!main) return;
        const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const hero = document.createElement('section');
        hero.className = 'ui-hero';
        hero.innerHTML = `
            <div>
                <div class="ui-hero-eyebrow"><i class="bi ${mod.icon}"></i> ${mod.eyebrow} · Sistema Liverpool</div>
                <h2 class="ui-hero-title">${mod.title}</h2>
                <p class="ui-hero-desc">${mod.desc}</p>
                <div class="ui-hero-chips">
                    <span class="ui-hero-chip"><i class="bi bi-calendar3"></i> ${today.charAt(0).toUpperCase() + today.slice(1)}</span>
                    <span class="ui-hero-chip"><i class="bi bi-shield-check"></i> Sesión segura</span>
                </div>
            </div>
            <div class="ui-hero-icon"><i class="bi ${mod.icon}"></i></div>`;
        main.parentNode.insertBefore(hero, main);
        document.body.classList.add('ui-has-hero');
    }

    function normalize() {
        ensureTheme();
        if (!document.querySelector('link[rel="icon"]')) {
            const favicon = document.createElement('link');
            favicon.rel = 'icon';
            favicon.type = 'image/svg+xml';
            favicon.href = href('assets/favicon.svg');
            document.head.appendChild(favicon);
        }
        const nav = document.querySelector('.offcanvas .nav, .offcanvas-body .nav');
        if (nav) {
            nav.innerHTML = `<div class="menu-brand-block"><div class="menu-brand-mark"><i class="bi bi-shop"></i></div><div><strong>Sistema Liverpool</strong><small>Centro de operaciones</small></div></div><div class="menu-section-label">Operación</div>` + links.map(([icon, label, path]) => {
                const p = path.toLowerCase();
                const active = current.endsWith('/' + p) || (label === 'Inicio' && rootUrl && window.location.href.toLowerCase().replace(/[?#].*$/, '').replace(/index\.html$/, '') === rootUrl.toLowerCase());
                return `<a class="nav-link${active ? ' active' : ''}" href="${href(path)}"><i class="bi ${icon} me-2"></i>${label}</a>`;
            }).join('') + `<div class="menu-status-card"><span class="menu-status-dot"></span><div><strong>Sistema activo</strong><small>Sesión operativa disponible</small></div></div><div class="menu-footer">Liverpool · Logística</div>`;
        }
        const quick = document.querySelector('.quick-access-grid');
        if (quick) {
            quick.innerHTML = `
                <a href="${href('Dashboard/index.html')}" class="action-card">
                    <div class="card-content"><div class="card-icon"><i class="bi bi-grid-1x2-fill"></i></div><h3>Dashboard</h3><p>Consulta indicadores y el estado general de la operación.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>
                <a href="${href('_archivado/PDISDashboard/index.html')}" class="action-card">
                    <div class="card-content"><div class="card-icon"><i class="bi bi-speedometer2"></i></div><h3>Dashboard PDIS</h3><p>Revisa avances, resultados y desempeño por jefatura.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>
                <a href="${href('_archivado/Rechazos/reportes.html')}" class="action-card">
                    <div class="card-content"><div class="card-icon"><i class="bi bi-file-earmark-medical-fill"></i></div><h3>Gestor de PDIS</h3><p>Gestiona y da seguimiento a los artículos PDIS.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>
                <a href="${href('SKU/index.html')}" class="action-card">
                    <div class="card-content"><div class="card-icon"><i class="bi bi-upc-scan"></i></div><h3>Buscador SKU</h3><p>Encuentra productos y consulta su informacion rapidamente.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>`;
        }
        injectHero();
        document.body.classList.add('ui-unificado');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize);
    else normalize();
})();
