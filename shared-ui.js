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
            nav.innerHTML = links.map(([icon, label, path]) => {
                const target = href(path);
                const active = current.endsWith(path.toLowerCase().replace(/\\/g, '/')) || (label === 'Inicio' && (current.endsWith('/') || current.endsWith('/index.html')));
                return `<a class="nav-link${active ? ' active' : ''}" href="${target}"><i class="bi ${icon} me-2"></i>${label}</a>`;
            }).join('');
        }
        document.body.classList.add('ui-unificado');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize);
    else normalize();
})();
