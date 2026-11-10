/* Navegación y encabezado visual compartidos por todos los módulos. */
(function () {
    const isArchived = window.location.pathname.includes('/_archivado/');
    const root = isArchived ? '../../' : (window.location.pathname.endsWith('/') || /\/[^/]+\.html$/.test(window.location.pathname) && !window.location.pathname.includes('/Dashboard/') && !window.location.pathname.includes('/SKU/') && !window.location.pathname.includes('/Recibos/') && !window.location.pathname.includes('/Manifiestos/') && !window.location.pathname.includes('/Adminroles/') ? './' : '../');
    const href = (path) => new URL(root + path, window.location.href).href;
    const links = [
        ['bi-house-fill', 'Inicio', 'index.html'],
        ['bi-grid-1x2-fill', 'Dashboard', 'Dashboard/index.html'],
        ['bi-file-earmark-medical-fill', 'Rechazos', '_archivado/Rechazos/reportes.html']
    ];

    function normalize() {
        const nav = document.querySelector('.offcanvas .nav, .offcanvas-body .nav');
        if (nav) {
            const current = window.location.pathname.toLowerCase();
            nav.innerHTML = `<div class="menu-brand-block"><div class="menu-brand-mark"><i class="bi bi-shop"></i></div><div><strong>Sistema Liverpool</strong><small>Centro de operaciones</small></div></div><div class="menu-section-label">Operación</div>` + links.map(([icon, label, path]) => {
                const target = href(path);
                const active = current.endsWith(path.toLowerCase().replace(/\\/g, '/')) || (label === 'Inicio' && (current.endsWith('/') || current.endsWith('/index.html')));
                return `<a class="nav-link${active ? ' active' : ''}" href="${target}"><i class="bi ${icon} me-2"></i>${label}</a>`;
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
                    <div class="card-content"><div class="card-icon"><i class="bi bi-file-earmark-medical-fill"></i></div><h3>Rechazos</h3><p>Gestiona y da seguimiento a los artículos rechazados.</p></div>
                    <div class="go-corner"><div class="go-arrow"></div></div>
                </a>`;
        }
        document.body.classList.add('ui-unificado');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize);
    else normalize();
})();
