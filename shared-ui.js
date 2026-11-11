/* Navegación, encabezado de módulo y tema visual compartidos por todos los módulos. */
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
        ['bi-file-earmark-medical-fill', 'PDIS', '_archivado/Rechazos/reportes.html']
    ];

    // Encabezado (hero) de cada módulo. Los módulos con hero propio no aparecen aquí
    // (Dashboard, Dashboard PDIS, Inicio, Login, Pendientes).
    const MODULES = [
        { match: '/adminroles/admin.html', eyebrow: 'Administración', icon: 'bi-person-fill-gear', title: 'Usuarios y roles',
          desc: 'Aprueba solicitudes de acceso, asigna roles y mantiene actualizados los datos de cada usuario del sistema.' },
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
                <a href="${href('_archivado/Rechazos/reportes.html')}" class="action-card">
                    <div class="card-content"><div class="card-icon"><i class="bi bi-file-earmark-medical-fill"></i></div><h3>Gestor de PDIS</h3><p>Gestiona y da seguimiento a los artículos PDIS.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>`;
        }
        injectHero();
        document.body.classList.add('ui-unificado');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize);
    else normalize();
})();
