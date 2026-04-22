"use strict";

document.addEventListener('DOMContentLoaded', () => {

    // ── FIREBASE CONFIG ──────────────────────────────────────────────────────
    const firebaseConfig = {
        apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
        authDomain: "sistemaintegrall.firebaseapp.com",
        projectId: "sistemaintegrall",
        storageBucket: "sistemaintegrall.firebasestorage.app",
        messagingSenderId: "302291844621",
        appId: "1:302291844621:web:6ebf1845790bdeabfc1f44"
    };
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth    = firebase.auth();
    const db      = firebase.firestore();
    const storage = firebase.storage();

    // Caché offline: lecturas repetidas sirven desde disco local (gratis)
    db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

    // ── CONSTANTS ────────────────────────────────────────────────────────────
    const ADMIN_UIDS      = ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"];
    const SKU_COLLECTION  = "skuManifiestos";
    const DASH_COLLECTION = "reportesDashboard";
    const CERRADO_COLL    = "manifiestosCerrados";
    const DATOS_COLL      = "datosMaestros";
    const DATOS_DOC       = "secciones";
    const STORAGE_PATH    = "SKUs/";
    const REQUIRED_COLS   = ["fechademanifiesto","numeromanifiesto","seccion","sku","numerodecontenedor","cant","estatus"];

    // ── STATE ────────────────────────────────────────────────────────────────
    const State = {
        currentUser: null,
        isAdmin: false,
        skuReportes: [],
        skuRows: [],
        dashRows: [],
        cerradoRows: [],    // manifiestosCerrados rows for cross-reference
        masterMap: {},
        parsedFile: null,
        searchType: 'contenedor',
        searchTimeout: null,
        uploadModal: null,
    };

    // ── DOM REFS ─────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const UI = {
        loading:           $('globalLoading'),
        authGuard:         $('auth-guard'),
        pageContent:       $('page-content'),
        adminPlaceholder:  $('admin-panel-placeholder'),
        get adminPanel()   { return $('admin-panel'); },
        get datosStatus()  { return $('datos-status'); },
        get skuAdminList() { return $('sku-admin-list'); },
        searchInput:       $('search-input'),
        btnSearch:         $('btn-search'),
        emptySearch:       $('empty-search'),
        resultsContent:    $('results-content'),
        logoutBtn:         $('logout-btn'),
        get btnUploadOpen()    { return $('btn-upload-open'); },
        get dropZone()         { return $('drop-zone'); },
        get fileInput()        { return $('file-input'); },
        get filePreview()      { return $('filePreview'); },
        get btnConfirmUpload() { return $('btn-confirm-upload'); },
        get uploadError()      { return $('upload-error'); },
        get uploadErrorMsg()   { return $('upload-error-msg'); },
    };

    const uploadModalEl = document.getElementById('uploadModal');
    if (uploadModalEl) State.uploadModal = new bootstrap.Modal(uploadModalEl);

    // ── ADMIN PANEL (solo admins) ─────────────────────────────────────────────
    function buildAdminPanel() {
        if (!UI.adminPlaceholder) return;
        UI.adminPlaceholder.innerHTML = `
        <div id="admin-panel" class="admin-panel" style="display:block">
            <div class="admin-panel-header" id="sku-admin-toggle">
                <div class="admin-panel-title">
                    <i class="bi bi-shield-lock-fill" style="color:var(--rosa)"></i>
                    <span>Panel de Administración</span>
                    <span class="admin-badge">Admin</span>
                </div>
                <i class="bi bi-chevron-up admin-chevron" id="sku-admin-chevron"></i>
            </div>
            <div id="sku-admin-body">
                <div class="datos-maestros-row" style="margin-top:0.85rem">
                    <div class="datos-info">
                        <i class="bi bi-database-fill-gear" style="color:var(--rosa);font-size:1rem"></i>
                        <div>
                            <div class="datos-title">Datos Maestros (Secciones)</div>
                            <div class="datos-status" id="datos-status">Sin cargar — Jefatura y Gerencia no se auto-rellenarán</div>
                        </div>
                    </div>
                </div>
                <div class="admin-divider"></div>
                <div class="panel-header">
                    <h2 style="color:var(--txt2);font-size:0.8rem"><i class="bi bi-cloud-upload-fill" style="color:var(--rosa)"></i> Archivos SKU por Manifiesto</h2>
                    <button class="btn-primary-rosa" id="btn-upload-open">
                        <i class="bi bi-plus-circle-fill"></i> Subir Archivo SKU
                    </button>
                </div>
                <div id="sku-admin-list" class="manifests-list mt-2">
                    <div class="no-manifests"><i class="bi bi-inbox" style="font-size:1.5rem;display:block;margin-bottom:0.5rem"></i>No hay archivos SKU cargados aún.</div>
                </div>
            </div>
        </div>`;

        // Colapso
        const toggle   = $('sku-admin-toggle');
        const body     = $('sku-admin-body');
        const chevron  = $('sku-admin-chevron');
        if (toggle && body) {
            toggle.addEventListener('click', () => {
                const collapsed = body.style.display === 'none';
                body.style.display = collapsed ? 'block' : 'none';
                if (chevron) chevron.classList.toggle('collapsed', !collapsed);
            });
        }

        // Wire upload button
        const btn = $('btn-upload-open');
        if (btn) btn.addEventListener('click', () => { resetUploadModal(); State.uploadModal.show(); });

        // Wire drop zone
        wireDropZone();
    }

    // ── AUTH ─────────────────────────────────────────────────────────────────
    auth.onAuthStateChanged(user => {
        if (!user) {
            hideLoading();
            UI.authGuard.style.display = 'block';
            return;
        }
        State.currentUser = user;
        State.isAdmin = ADMIN_UIDS.includes(user.uid);
        UI.pageContent.style.display = 'block';
        if (State.isAdmin) buildAdminPanel();
        const adminTabNav = document.getElementById('adminTab');
        if (adminTabNav && State.isAdmin) adminTabNav.style.display = 'flex';
        loadData();
    });

    UI.logoutBtn.addEventListener('click', () => {
        auth.signOut().then(() => { window.location.href = '../Login/login.html'; });
    });

    // ── LOAD DATA ────────────────────────────────────────────────────────────
    async function loadData() {
        showLoading();
        try {
            const [skuSnap, dashSnap, cerradoSnap] = await Promise.all([
                db.collection(SKU_COLLECTION).orderBy('uploadedAt', 'desc').get(),
                db.collection(DASH_COLLECTION).get(),
                db.collection(CERRADO_COLL).get(),
            ]);
            State.skuReportes  = skuSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            State.dashRows     = dashSnap.docs.flatMap(d => d.data().rows || []);
            State.cerradoRows  = cerradoSnap.docs.flatMap(d => d.data().rows || []);
            await loadMasterData();
            const rawRows = State.skuReportes.flatMap(r => r.rows || []);
            State.skuRows = enrichWithCerradoStatus(enrichWithDashStatus(enrichWithMasterData(rawRows)));
            renderAdminList();
        } catch (e) {
            console.error(e);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los datos.', background: '#0e0e1a', color: '#fff' });
        } finally {
            hideLoading();
        }
    }

    // ── DATOS MAESTROS ───────────────────────────────────────────────────────
    async function loadMasterData() {
        try {
            const doc = await db.collection(DATOS_COLL).doc(DATOS_DOC).get();
            if (doc.exists && doc.data().sections) {
                State.masterMap = doc.data().sections;
                const count = Object.keys(State.masterMap).length;
                const fecha = doc.data().uploadedAt
                    ? new Date(doc.data().uploadedAt.toDate()).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                if (UI.datosStatus) { UI.datosStatus.textContent = `✓ ${count} secciones cargadas · actualizado ${fecha}`; UI.datosStatus.style.color = '#198754'; }
            } else {
                if (UI.datosStatus) { UI.datosStatus.textContent = 'Sin cargar — Jefatura y Gerencia no se auto-rellenarán'; UI.datosStatus.style.color = ''; }
            }
        } catch (e) {
            console.error('Error cargando datos maestros:', e);
        }
    }

    function normSeccion(s) {
        return String(s).trim().replace(/^0+(?=\d)/, '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function buildNormMap() {
        const map = {};
        Object.keys(State.masterMap).forEach(k => { map[normSeccion(k)] = State.masterMap[k]; });
        return map;
    }

    function enrichWithMasterData(rows) {
        const normMap = buildNormMap();
        return rows.map(r => {
            const seccion = String(r.Seccion || '').trim();
            const master  = State.masterMap[seccion] || normMap[normSeccion(seccion)];
            return {
                ...r,
                Jefatura: (master?.Jefatura) || r.Jefatura || '—',
                Gerencia: (master?.Gerente)  || r.Gerencia || '—',
            };
        });
    }

    function enrichWithDashStatus(skuRows) {
        const dashByKey = {};
        State.dashRows.forEach(d => {
            const k = (d.Contenedor || '').trim().toUpperCase();
            if (k) dashByKey[k] = d;
        });
        return skuRows.map(r => {
            if (r.Estatus && r.Estatus !== '—') return r;
            const k = (r.NumeroContenedor || '').trim().toUpperCase();
            const d = dashByKey[k];
            if (!d) return r;
            const ft = toNum(d.Faltantes), sb = toNum(d.Sobrante), pz = toNum(d.Piezas);
            const est = ft > 0 ? 'Faltante' : sb > 0 ? 'Sobrante' : pz > 0 ? 'Escaneado' : null;
            return est ? { ...r, Estatus: est } : r;
        });
    }

    // Enrich with real status from manifiesto cerrado (overrides dash status)
    function enrichWithCerradoStatus(skuRows) {
        // Index ALL cerrado rows per contenedor (aggregated totals for correct status)
        // and exact SKU+contenedor for the detail row attachment
        const cerradoBySkuCont = {};   // exact match: "SKU::CONT" → row
        const cerradoTotalByCont = {}; // "CONT" → { totalManf, totalReg, firstRow }
        State.cerradoRows.forEach(c => {
            const cont = (c.Contenedor || '').trim().toUpperCase();
            const sku  = (c.CodigoUPC  || c.SKU || '').trim().toUpperCase();
            if (!cont) return;
            // exact SKU+cont match (for the detail sub-row)
            if (sku) cerradoBySkuCont[`${sku}::${cont}`] = c;
            // aggregate totals per contenedor
            if (!cerradoTotalByCont[cont]) {
                cerradoTotalByCont[cont] = { totalManf: 0, totalReg: 0, firstRow: c };
            }
            cerradoTotalByCont[cont].totalManf += toNum(c.CantManf);
            cerradoTotalByCont[cont].totalReg  += toNum(c.CantRegistr);
        });

        return skuRows.map(r => {
            const cont = (r.NumeroContenedor || '').trim().toUpperCase();
            const sku  = (r.SKU || '').trim().toUpperCase();

            // For the detail sub-row: prefer exact SKU+cont match
            const cerrDetail = cerradoBySkuCont[`${sku}::${cont}`] || cerradoTotalByCont[cont]?.firstRow || null;
            // For the status badge: use aggregated totals of the whole contenedor
            const totals = cerradoTotalByCont[cont];
            if (!totals) return r;

            const { totalManf, totalReg } = totals;
            let estatus;
            if      (totalReg === 0 && totalManf > 0) estatus = 'Faltante';
            else if (totalReg === totalManf)           estatus = 'Completo';
            else if (totalReg < totalManf)             estatus = 'Faltante';
            else                                       estatus = 'Sobrante';

            return { ...r, Estatus: estatus, _cerrado: cerrDetail };
        });
    }

    // ── SEARCH TYPE PILLS ────────────────────────────────────────────────────
    const placeholders = {
        contenedor: 'Escribe el número de contenedor...',
        sku:        'Escribe un SKU (código de producto)...',
        manifiesto: 'Escribe el número de manifiesto (10 dígitos)...',
    };

    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.searchType = btn.dataset.type;
            UI.searchInput.placeholder = placeholders[State.searchType] || 'Buscar...';
            clearResults();
            UI.searchInput.value = '';
            UI.searchInput.focus();
        });
    });

    // ── SEARCH TRIGGERS ──────────────────────────────────────────────────────
    UI.btnSearch.addEventListener('click', doSearch);
    UI.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    UI.searchInput.addEventListener('input', () => {
        clearTimeout(State.searchTimeout);
        State.searchTimeout = setTimeout(doSearch, 320);
    });

    function doSearch() {
        const raw = UI.searchInput.value.trim();
        if (!raw) { clearResults(); return; }
        const term = raw.toUpperCase();

        if (State.searchType === 'contenedor') {
            const rows = State.skuRows.filter(r => r.NumeroContenedor && r.NumeroContenedor.toUpperCase().includes(term));
            renderContenedorResults(rows, raw); // async, no await needed
        } else if (State.searchType === 'sku') {
            const rows = State.skuRows.filter(r => r.SKU && r.SKU.toUpperCase().includes(term));
            renderSKUResults(rows, raw);
        } else {
            const rows = State.skuRows.filter(r => r.NumeroManifiesto && r.NumeroManifiesto.includes(raw));
            renderManifiestoResults(rows, raw);
        }
    }

    function clearResults() {
        UI.emptySearch.style.display = 'block';
        UI.resultsContent.style.display = 'none';
        UI.resultsContent.innerHTML = '';
    }

    function showResults(html) {
        UI.emptySearch.style.display = 'none';
        UI.resultsContent.style.display = 'block';
        UI.resultsContent.innerHTML = html;
    }

    // ── DELIVERY TIMELINE BUILDER ────────────────────────────────────────────
    function buildTimeline(first, dash, entrega, escaneados, totalRows) {
        // Determine each step state
        const tieneManifiesto = !!(first.NumeroManifiesto && first.NumeroManifiesto !== '—');
        const tieneEscaneo    = escaneados > 0 || !!(dash && toNum(dash.Piezas) > 0);
        const tieneEntrega    = !!entrega;

        const steps = [
            {
                key: 'manifesto',
                icon: 'bi bi-file-earmark-text-fill',
                label: 'Manifestado',
                sub:  tieneManifiesto ? (fmtFecha(first.FechaManifiesto) || 'En sistema') : 'Sin manifiesto',
                done: tieneManifiesto,
            },
            {
                key: 'escaneo',
                icon: 'bi bi-upc-scan',
                label: 'Escaneado',
                sub: tieneEscaneo
                    ? (dash ? `${fmt(toNum(dash.Piezas))} pzas` : `${escaneados} SKUs`)
                    : 'Pendiente',
                done: tieneEscaneo,
            },
            {
                key: 'entrega',
                icon: 'bi bi-box-arrow-in-down-right',
                label: 'Entregado',
                sub: tieneEntrega
                    ? (entrega.fecha ? `${entrega.fecha} · ${entrega.hora || ''}` : 'Registrado')
                    : 'Sin entrega',
                done: tieneEntrega,
            },
        ];

        // Step state: done → previous done; current → first not-done; pending → rest
        let currentSet = false;
        const stateOf = s => {
            if (s.done) return 'done';
            if (!currentSet) { currentSet = true; return 'current'; }
            return 'pending';
        };

        const stepsHtml = steps.map(s => {
            const st = stateOf(s);
            return `<div class="tl-step ${st}">
                <div class="tl-icon-wrap"><i class="${esc(s.icon)}"></i></div>
                <div class="tl-label">${esc(s.label)}</div>
                <div class="tl-sub">${esc(s.sub)}</div>
            </div>`;
        }).join('');

        let detailHtml = '';
        if (tieneEntrega) {
            detailHtml = `<div class="tl-entregado-detail">
                <div class="tl-ed-item"><i class="bi bi-box-fill"></i><strong>${esc(entrega.nombreBodega || entrega.codigoBodega || '—')}</strong></div>
                <div class="tl-ed-item"><i class="bi bi-person-badge-fill"></i>${esc(entrega.empleadoNombre || entrega.empleadoNumero || '—')}</div>
                <div class="tl-ed-item"><i class="bi bi-person-fill-gear"></i>${esc(entrega.jefeBodega || '—')}</div>
                <div class="tl-ed-item"><i class="bi bi-clock-fill"></i>${esc(entrega.fecha || '')} ${esc(entrega.hora || '')}</div>
                ${entrega.fotoUrl ? `<img src="${esc(entrega.fotoUrl)}" class="tl-ed-foto" alt="Evidencia" onclick="window.open('${esc(entrega.fotoUrl)}','_blank')" title="Ver foto evidencia">` : ''}
            </div>`;
        }

        return `<div class="delivery-timeline">
            <div class="timeline-title"><i class="bi bi-signpost-2-fill"></i> Seguimiento de Contenedor</div>
            <div class="timeline-steps">${stepsHtml}</div>
            ${detailHtml}
        </div>`;
    }

    // ── RENDER: BY CONTAINER ─────────────────────────────────────────────────
    async function renderContenedorResults(skuRows, term) {
        if (skuRows.length === 0) {
            showResults(`<div class="empty-state"><i class="bi bi-box-seam"></i><p>No se encontró ningún contenedor con "<strong>${esc(term)}</strong>".</p></div>`);
            return;
        }

        const byContenedor = groupBy(skuRows, 'NumeroContenedor');
        const contenedores = Object.keys(byContenedor).sort();

        // Fetch entrega records — supports new 'contenedores' array field and legacy 'contenedor' string
        const entregasMap = {};
        try {
            const contUpperList = contenedores.map(c => c.toUpperCase());
            const chunks = [];
            for (let i = 0; i < contUpperList.length; i += 30) chunks.push(contUpperList.slice(i, i + 30));
            for (const chunk of chunks) {
                const [snapArr, snapStr] = await Promise.all([
                    db.collection('entregas').where('contenedores', 'array-contains-any', chunk).get(),
                    db.collection('entregas').where('contenedor', 'in', chunk).get(),
                ]);
                snapArr.forEach(doc => {
                    const data = doc.data();
                    (Array.isArray(data.contenedores) ? data.contenedores : []).forEach(c => {
                        const k = c.toUpperCase();
                        if (!entregasMap[k]) entregasMap[k] = data;
                    });
                });
                snapStr.forEach(doc => {
                    const data = doc.data();
                    const key  = (data.contenedor || '').toUpperCase();
                    if (key && !entregasMap[key]) entregasMap[key] = data;
                });
            }
        } catch(_) { /* continúa sin datos de entrega */ }

        let html = `<div class="result-count-bar">
            <i class="bi bi-box-seam"></i>
            <span>${contenedores.length} contenedor(es) · <strong>${fmt(skuRows.length)}</strong> SKUs totales</span>
        </div>`;

        contenedores.forEach(cont => {
            const rows      = byContenedor[cont];
            const first     = rows[0];
            const totalUnid = rows.reduce((s, r) => s + toNum(r.Cantidad), 0);
            const skusU     = [...new Set(rows.map(r => r.SKU))].length;
            const dash      = State.dashRows.find(d => d.Contenedor && d.Contenedor.trim().toUpperCase() === cont.toUpperCase());
            const entrega   = entregasMap[cont.toUpperCase()] || null;

            const completos  = rows.filter(r => isEstatus(r.Estatus, 'complet')).length;
            const escaneados = rows.filter(r => isEstatus(r.Estatus, 'escaneado') || isEstatus(r.Estatus, 'recib')).length;
            const faltantes  = rows.filter(r => isEstatus(r.Estatus, 'falt') || isEstatus(r.Estatus, 'no recib')).length;
            const sobrantes  = rows.filter(r => isEstatus(r.Estatus, 'sobrant')).length;
            const hasCerrado = rows.some(r => r._cerrado);

            // Banner: prefer cerrado (authoritative) over avance report
            let bannerBadge;
            if (hasCerrado) {
                if (faltantes > 0)
                    bannerBadge = `<span class="banner-badge bb-red"><i class="bi bi-x-circle-fill"></i>Faltante <span style="font-size:0.7rem;opacity:0.8">(cerrado)</span></span>`;
                else if (sobrantes > 0)
                    bannerBadge = `<span class="banner-badge bb-purple"><i class="bi bi-plus-circle-fill"></i>Sobrante <span style="font-size:0.7rem;opacity:0.8">(cerrado)</span></span>`;
                else
                    bannerBadge = `<span class="banner-badge bb-green"><i class="bi bi-check-circle-fill"></i>Completo <span style="font-size:0.7rem;opacity:0.8">(cerrado)</span></span>`;
            } else if (dash) {
                const ft = toNum(dash.Faltantes), sb = toNum(dash.Sobrante), pz = toNum(dash.Piezas);
                if (ft > 0)       bannerBadge = `<span class="banner-badge bb-red"><i class="bi bi-x-circle-fill"></i>Faltante</span>`;
                else if (sb > 0)  bannerBadge = `<span class="banner-badge bb-purple"><i class="bi bi-plus-circle-fill"></i>Sobrante</span>`;
                else if (pz > 0)  bannerBadge = `<span class="banner-badge bb-green"><i class="bi bi-check-circle-fill"></i>Escaneado</span>`;
                else              bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-dash-circle"></i>Sin datos</span>`;
            } else {
                bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-question-circle"></i>Sin dashboard</span>`;
            }

            // Cross-ref strip
            let crossref;
            if (dash) {
                const pz = toNum(dash.Piezas), ft = toNum(dash.Faltantes), sb = toNum(dash.Sobrante);
                const pct = pz > 0 ? ((pz - ft) / pz * 100) : 0;
                const pctCls = pct >= 95 ? 'good' : pct >= 85 ? 'warn' : 'bad';
                crossref = `<div class="dash-crossref dcr-match">
                    <i class="bi bi-bar-chart-fill dcr-icon"></i>
                    <span class="dcr-text">
                        <strong>Dashboard:</strong> ${fmt(pz)} piezas &nbsp;·&nbsp;
                        <span class="dcr-falt">${fmt(ft)} faltantes</span> &nbsp;·&nbsp;
                        <span class="dcr-sob">${fmt(sb)} sobrantes</span> &nbsp;·&nbsp;
                        <span class="badge-pct ${pctCls}">${pct.toFixed(1)}%</span>
                    </span>
                </div>`;
            } else {
                crossref = `<div class="dash-crossref dcr-nomatch">
                    <i class="bi bi-bar-chart dcr-icon"></i>
                    <span class="dcr-nomatch-text">Sin registro en el Dashboard de Reportes.</span>
                </div>`;
            }

            html += `
            <div class="sku-result-card">
                <div class="card-banner">
                    <div class="banner-left">
                        <div class="banner-cont">${highlight(cont, term)}</div>
                        <div class="banner-mani"><i class="bi bi-file-earmark-text me-1"></i>${first.NumeroManifiesto || '—'}</div>
                    </div>
                    ${bannerBadge}
                </div>
                <div class="card-meta">
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-person-badge-fill"></i>Jefatura</div>
                        <div class="mc-value ${!first.Jefatura || first.Jefatura === '—' ? 'mc-empty' : ''}">${first.Jefatura && first.Jefatura !== '—' ? first.Jefatura : 'Sin datos'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-building"></i>Gerencia</div>
                        <div class="mc-value ${!first.Gerencia || first.Gerencia === '—' ? 'mc-empty' : ''}">${first.Gerencia && first.Gerencia !== '—' ? first.Gerencia : 'Sin datos'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-grid-3x3-gap-fill"></i>Sección</div>
                        <div class="mc-value">${first.Seccion || '—'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-calendar3"></i>Fecha Manif.</div>
                        <div class="mc-value">${fmtFecha(first.FechaManifiesto)}</div>
                    </div>
                </div>
                <div class="card-stats">
                    <div class="kpi-chip kc-sku"><span class="kpi-chip-num">${skusU}</span><span class="kpi-chip-lbl">SKUs</span></div>
                    <div class="kpi-chip kc-uds"><span class="kpi-chip-num">${fmt(totalUnid)}</span><span class="kpi-chip-lbl">Unidades</span></div>
                    ${escaneados > 0 ? `<div class="kpi-chip kc-ok"><span class="kpi-chip-num">${escaneados}</span><span class="kpi-chip-lbl">Escaneado</span></div>` : ''}
                    ${faltantes  > 0 ? `<div class="kpi-chip kc-falt"><span class="kpi-chip-num">${faltantes}</span><span class="kpi-chip-lbl">Faltante</span></div>` : ''}
                    ${sobrantes  > 0 ? `<div class="kpi-chip kc-sob"><span class="kpi-chip-num">${sobrantes}</span><span class="kpi-chip-lbl">Sobrante</span></div>` : ''}
                </div>
                ${crossref}
                ${buildTimeline(first, dash, entrega, escaneados, rows.length)}
                <div class="table-responsive">
                    <table class="sku-table">
                        <thead><tr><th>SKU</th><th style="text-align:right">Cantidad</th><th>Estatus</th></tr></thead>
                        <tbody>
                            ${rows.map(r => {
                                const isBad = r.Estatus === 'Faltante' || r.Estatus === 'Sobrante';
                                const cerr  = r._cerrado;
                                const descArticulo = cerr?.DescArticulo || cerr?.Articulo || '';
                                const cantManf  = cerr ? fmt(toNum(cerr.CantManf))  : null;
                                const cantReg   = cerr ? fmt(toNum(cerr.CantRegistr)) : null;
                                const extraRow = (isBad && cerr)
                                    ? `<tr class="sku-cerrado-detail-row">
                                        <td colspan="3">
                                            <div class="sku-cerr-info">
                                                ${descArticulo ? `<span class="sku-cerr-desc"><i class="bi bi-tag-fill"></i>${esc(descArticulo)}</span>` : ''}
                                                <span class="sku-cerr-counts">
                                                    <span style="color:var(--txt2)">Manifiestado: <strong>${cantManf}</strong></span>
                                                    <span style="color:${r.Estatus==='Faltante'?'#F87171':'#FCD34D'}">Registrado: <strong>${cantReg}</strong></span>
                                                </span>
                                            </div>
                                        </td>
                                      </tr>`
                                    : '';
                                return `<tr>
                                    <td><span class="sku-code">${r.SKU || '—'}</span></td>
                                    <td style="text-align:right;font-weight:700">${fmt(toNum(r.Cantidad))}</td>
                                    <td>${estatusBadge(r.Estatus)}</td>
                                </tr>${extraRow}`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        });

        showResults(html);
    }

    // ── RENDER: BY SKU ───────────────────────────────────────────────────────
    function renderSKUResults(rows, term) {
        if (rows.length === 0) {
            showResults(`<div class="empty-state"><i class="bi bi-upc"></i><p>No se encontró el SKU "<strong>${esc(term)}</strong>".</p></div>`);
            return;
        }

        const byContenedor  = groupBy(rows, 'NumeroContenedor');
        const contenedores  = Object.keys(byContenedor).sort();
        const totalUnidades = rows.reduce((s, r) => s + toNum(r.Cantidad), 0);
        const skusUnicos    = [...new Set(rows.map(r => r.SKU))];

        let html = `<div class="result-count-bar">
            <i class="bi bi-upc"></i>
            <span>${skusUnicos.length > 1 ? skusUnicos.length + ' SKUs coincidentes' : 'SKU encontrado'} en ${contenedores.length} contenedor(es) · <strong>${fmt(totalUnidades)}</strong> uds</span>
        </div>`;

        contenedores.forEach(cont => {
            const contRows = byContenedor[cont];
            const first    = contRows[0];
            const dash     = State.dashRows.find(d => d.Contenedor && d.Contenedor.trim().toUpperCase() === cont.toUpperCase());

            let bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-question-circle"></i>Sin dashboard</span>`;
            if (dash) {
                const ft = toNum(dash.Faltantes), sb = toNum(dash.Sobrante), pz = toNum(dash.Piezas);
                if (ft > 0)      bannerBadge = `<span class="banner-badge bb-red"><i class="bi bi-x-circle-fill"></i>Faltante</span>`;
                else if (sb > 0) bannerBadge = `<span class="banner-badge bb-purple"><i class="bi bi-plus-circle-fill"></i>Sobrante</span>`;
                else if (pz > 0) bannerBadge = `<span class="banner-badge bb-green"><i class="bi bi-check-circle-fill"></i>Escaneado</span>`;
                else             bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-dash-circle"></i>Sin datos</span>`;
            }

            html += `
            <div class="sku-result-card">
                <div class="card-banner">
                    <div class="banner-left">
                        <div class="banner-cont">${esc(cont)}</div>
                        <div class="banner-mani"><i class="bi bi-file-earmark-text me-1"></i>${first.NumeroManifiesto || '—'}</div>
                    </div>
                    ${bannerBadge}
                </div>
                <div class="card-meta">
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-person-badge-fill"></i>Jefatura</div>
                        <div class="mc-value ${!first.Jefatura || first.Jefatura === '—' ? 'mc-empty' : ''}">${first.Jefatura && first.Jefatura !== '—' ? first.Jefatura : 'Sin datos'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-building"></i>Gerencia</div>
                        <div class="mc-value ${!first.Gerencia || first.Gerencia === '—' ? 'mc-empty' : ''}">${first.Gerencia && first.Gerencia !== '—' ? first.Gerencia : 'Sin datos'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-grid-3x3-gap-fill"></i>Sección</div>
                        <div class="mc-value">${first.Seccion || '—'}</div>
                    </div>
                    <div class="meta-cell">
                        <div class="mc-label"><i class="bi bi-calendar3"></i>Fecha</div>
                        <div class="mc-value">${fmtFecha(first.FechaManifiesto)}</div>
                    </div>
                </div>
                <div class="table-responsive">
                    <table class="sku-table">
                        <thead><tr><th>SKU</th><th style="text-align:right">Cantidad</th><th>Estatus</th></tr></thead>
                        <tbody>
                            ${contRows.map(r => {
                                const isBad = r.Estatus === 'Faltante' || r.Estatus === 'Sobrante';
                                const cerr  = r._cerrado;
                                const descArticulo = cerr?.DescArticulo || cerr?.Articulo || '';
                                const extraRow = (isBad && cerr)
                                    ? `<tr class="sku-cerrado-detail-row">
                                        <td colspan="3">
                                            <div class="sku-cerr-info">
                                                ${descArticulo ? `<span class="sku-cerr-desc"><i class="bi bi-tag-fill"></i>${esc(descArticulo)}</span>` : ''}
                                                <span class="sku-cerr-counts">
                                                    <span style="color:var(--txt2)">Manif.: <strong>${fmt(toNum(cerr.CantManf))}</strong></span>
                                                    <span style="color:${r.Estatus==='Faltante'?'#F87171':'#FCD34D'}">Registr.: <strong>${fmt(toNum(cerr.CantRegistr))}</strong></span>
                                                </span>
                                            </div>
                                        </td>
                                      </tr>`
                                    : '';
                                return `<tr>
                                    <td><span class="sku-code">${highlight(r.SKU || '—', term)}</span></td>
                                    <td style="text-align:right;font-weight:700">${fmt(toNum(r.Cantidad))}</td>
                                    <td>${estatusBadge(r.Estatus)}</td>
                                </tr>${extraRow}`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        });

        showResults(html);
    }

    // ── RENDER: BY MANIFEST ──────────────────────────────────────────────────
    function renderManifiestoResults(rows, term) {
        if (rows.length === 0) {
            showResults(`<div class="empty-state"><i class="bi bi-file-earmark-text"></i><p>No se encontró el manifiesto "<strong>${esc(term)}</strong>".</p></div>`);
            return;
        }

        const byContenedor  = groupBy(rows, 'NumeroContenedor');
        const contenedores  = Object.keys(byContenedor).sort();
        const totalSkus     = [...new Set(rows.map(r => r.SKU))].length;
        const totalUnidades = rows.reduce((s, r) => s + toNum(r.Cantidad), 0);

        let html = `<div class="result-count-bar">
            <i class="bi bi-file-earmark-text"></i>
            <span>Manifiesto <strong>${esc(term)}</strong> · ${contenedores.length} contenedores · ${totalSkus} SKUs · <strong>${fmt(totalUnidades)}</strong> uds</span>
        </div>`;

        contenedores.forEach(cont => {
            const contRows  = byContenedor[cont];
            const totalCont = contRows.reduce((s, r) => s + toNum(r.Cantidad), 0);
            const skusCont  = [...new Set(contRows.map(r => r.SKU))].length;
            const first     = contRows[0];
            const dash      = State.dashRows.find(d => d.Contenedor && d.Contenedor.trim().toUpperCase() === cont.toUpperCase());

            const escaneados = contRows.filter(r => isEstatus(r.Estatus, 'escaneado') || isEstatus(r.Estatus, 'recib')).length;
            const faltantes  = contRows.filter(r => isEstatus(r.Estatus, 'falt') || isEstatus(r.Estatus, 'no recib')).length;
            const sobrantes  = contRows.filter(r => isEstatus(r.Estatus, 'sobrant')).length;

            let bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-question-circle"></i>Sin dashboard</span>`;
            if (dash) {
                const ft = toNum(dash.Faltantes), sb = toNum(dash.Sobrante), pz = toNum(dash.Piezas);
                if (ft > 0)      bannerBadge = `<span class="banner-badge bb-red"><i class="bi bi-x-circle-fill"></i>Faltante</span>`;
                else if (sb > 0) bannerBadge = `<span class="banner-badge bb-purple"><i class="bi bi-plus-circle-fill"></i>Sobrante</span>`;
                else if (pz > 0) bannerBadge = `<span class="banner-badge bb-green"><i class="bi bi-check-circle-fill"></i>Escaneado</span>`;
                else             bannerBadge = `<span class="banner-badge bb-gray"><i class="bi bi-dash-circle"></i>Sin datos</span>`;
            }

            html += `
            <div class="sku-result-card">
                <div class="card-banner">
                    <div class="banner-left">
                        <div class="banner-cont">${esc(cont)}</div>
                        <div class="banner-mani">
                            <i class="bi bi-person-badge-fill me-1"></i>${first.Jefatura && first.Jefatura !== '—' ? first.Jefatura : 'Sin jefatura'} &nbsp;·&nbsp;
                            ${skusCont} SKUs &nbsp;·&nbsp; ${fmt(totalCont)} uds
                            ${escaneados > 0 ? `&nbsp;·&nbsp;<span style="color:#40e0a0">${escaneados} ✓</span>` : ''}
                            ${faltantes  > 0 ? `&nbsp;·&nbsp;<span style="color:#ff8a9a">${faltantes} ✗</span>` : ''}
                            ${sobrantes  > 0 ? `&nbsp;·&nbsp;<span style="color:#c8a0e0">${sobrantes} +</span>` : ''}
                        </div>
                    </div>
                    ${bannerBadge}
                </div>
                <div class="table-responsive">
                    <table class="sku-table">
                        <thead><tr><th>SKU</th><th>Sección</th><th style="text-align:right">Cantidad</th><th>Estatus</th></tr></thead>
                        <tbody>
                            ${contRows.map(r => {
                                const isBad = r.Estatus === 'Faltante' || r.Estatus === 'Sobrante';
                                const cerr  = r._cerrado;
                                const descArticulo = cerr?.DescArticulo || cerr?.Articulo || '';
                                const extraRow = (isBad && cerr)
                                    ? `<tr class="sku-cerrado-detail-row">
                                        <td colspan="4">
                                            <div class="sku-cerr-info">
                                                ${descArticulo ? `<span class="sku-cerr-desc"><i class="bi bi-tag-fill"></i>${esc(descArticulo)}</span>` : ''}
                                                <span class="sku-cerr-counts">
                                                    <span style="color:var(--txt2)">Manif.: <strong>${fmt(toNum(cerr.CantManf))}</strong></span>
                                                    <span style="color:${r.Estatus==='Faltante'?'#F87171':'#FCD34D'}">Registr.: <strong>${fmt(toNum(cerr.CantRegistr))}</strong></span>
                                                </span>
                                            </div>
                                        </td>
                                      </tr>`
                                    : '';
                                return `<tr>
                                    <td><span class="sku-code">${r.SKU || '—'}</span></td>
                                    <td>${r.Seccion || '—'}</td>
                                    <td style="text-align:right;font-weight:700">${fmt(toNum(r.Cantidad))}</td>
                                    <td>${estatusBadge(r.Estatus)}</td>
                                </tr>${extraRow}`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        });

        showResults(html);
    }

    // ── ADMIN LIST ───────────────────────────────────────────────────────────
    function renderAdminList() {
        if (!State.isAdmin) return;
        if (State.skuReportes.length === 0) {
            UI.skuAdminList.innerHTML = '<div class="no-manifests"><i class="bi bi-inbox" style="font-size:1.5rem;display:block;margin-bottom:0.5rem"></i>No hay archivos SKU cargados aún.</div>';
            return;
        }
        UI.skuAdminList.innerHTML = State.skuReportes.map(rep => {
            const fecha = rep.uploadedAt
                ? new Date(rep.uploadedAt.toDate()).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';
            const label = rep.manifestoId && rep.manifestoId.startsWith('varios') ? 'Varios manifiestos' : (rep.manifestoId || '—');
            return `<div class="manifest-item">
                <div>
                    <div class="manifest-id">${label}</div>
                    <div class="manifest-meta">${rep.fileName || '—'}</div>
                </div>
                <div class="manifest-rows">${fmt(rep.rows?.length || 0)} SKUs · ${fecha}</div>
                <button class="btn-delete-manifest" data-id="${rep.id}" data-name="${label}" data-file="${rep.fileName || ''}" title="Eliminar">
                    <i class="bi bi-trash3-fill"></i>
                </button>
            </div>`;
        }).join('');

        UI.skuAdminList.querySelectorAll('.btn-delete-manifest').forEach(btn => {
            btn.addEventListener('click', () => deleteReporte(btn.dataset.id, btn.dataset.name, btn.dataset.file));
        });
    }

    async function deleteReporte(docId, name, fileName) {
        const confirmed = await Swal.fire({
            title: '¿Eliminar archivo?',
            html: `Se eliminarán todos los SKUs de <strong>${name}</strong>.`,
            icon: 'warning', showCancelButton: true,
            confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e53935', background: '#0e0e1a', color: '#fff'
        });
        if (!confirmed.isConfirmed) return;
        showLoading();
        try {
            await db.collection(SKU_COLLECTION).doc(docId).delete();
            if (fileName) {
                try { await storage.ref(`${STORAGE_PATH}${fileName}`).delete(); } catch (_) {}
            }
            // Actualizar estado local sin re-descargar Firestore
            State.skuReportes = State.skuReportes.filter(r => r.id !== docId);
            const rawRows = State.skuReportes.flatMap(r => r.rows || []);
            State.skuRows = enrichWithCerradoStatus(enrichWithDashStatus(enrichWithMasterData(rawRows)));
            renderAdminList();
            Swal.fire({ icon: 'success', title: 'Eliminado', text: 'Archivo eliminado.', background: '#0e0e1a', color: '#fff', timer: 2000, showConfirmButton: false });
            clearResults();
        } catch (e) {
            hideLoading();
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar.', background: '#0e0e1a', color: '#fff' });
        }
    }

    // ── UPLOAD ───────────────────────────────────────────────────────────────
    function resetUploadModal() {
        State.parsedFile = null;
        if (UI.fileInput) UI.fileInput.value = '';
        if (UI.filePreview) UI.filePreview.style.display = 'none';
        if (UI.uploadError) UI.uploadError.style.display = 'none';
        if (UI.btnConfirmUpload) UI.btnConfirmUpload.disabled = true;
        if (UI.dropZone) { UI.dropZone.style.display = 'flex'; UI.dropZone.classList.remove('drag-over'); }
    }

    function wireDropZone() {
        const dz = $('drop-zone');
        const fi = $('file-input');
        if (fi) fi.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
        if (dz) {
            dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
        }
    }

    function handleFile(file) {
        showUploadError('');
        if (UI.btnConfirmUpload) UI.btnConfirmUpload.disabled = true;
        if (UI.filePreview) UI.filePreview.style.display = 'none';

        if (!file.name.match(/\.(xlsx|xls)$/i)) { showUploadError('El archivo debe ser .xlsx o .xls'); return; }

        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb   = XLSX.read(evt.target.result, { type: 'array' });
                const ws   = wb.Sheets[wb.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
                if (json.length === 0) { showUploadError('El archivo está vacío.'); return; }

                // Normalize: lowercase + remove spaces
                const normalized = json.map(row => {
                    const out = {};
                    Object.keys(row).forEach(k => { out[k.trim().toLowerCase().replace(/\s+/g, '')] = row[k]; });
                    return out;
                });

                // Validate columns
                const missing = REQUIRED_COLS.filter(c => !(c in normalized[0]));
                if (missing.length > 0) {
                    showUploadError(`Columnas faltantes: ${missing.join(', ')}`);
                    return;
                }

                // Map to standard shape
                let rows = normalized.map(r => ({
                    FechaManifiesto:  String(r.fechademanifiesto  || '').trim(),
                    NumeroManifiesto: String(r.numeromanifiesto   || '').trim(),
                    Seccion:          String(r.seccion            || '').trim(),
                    SKU:              String(r.sku                || '').trim().toUpperCase(),
                    NumeroContenedor: String(r.numerodecontenedor || '').trim(),
                    Cantidad:         toNum(r.cant),
                    Jefatura:         String(r.jefatura           || '').trim(),
                    Gerencia:         String(r.gerencia           || '').trim(),
                    Estatus:          String(r.estatus            || '').trim(),
                }));

                // Auto-enrich Jefatura y Gerencia desde Datos Maestros
                rows = enrichWithMasterData(rows);

                // Detect unique manifests
                const manifiestos = [...new Set(rows.map(r => r.NumeroManifiesto).filter(Boolean))];
                const isMultiple  = manifiestos.length > 1;

                // Validate 10-digit manifests
                const invalidM = manifiestos.find(m => !/^\d{10}$/.test(m));
                if (invalidM) {
                    showUploadError(`"Numero Manifiesto" debe tener 10 dígitos. Se encontró: "${invalidM}"`);
                    return;
                }

                const today      = new Date().toISOString().split('T')[0];
                const savedName  = isMultiple ? `SKU_varios_${today}.xlsx` : `SKU_${manifiestos[0]}_${today}.xlsx`;
                const contenedores = [...new Set(rows.map(r => r.NumeroContenedor))];
                const skusUnicos   = [...new Set(rows.map(r => r.SKU))];

                State.parsedFile = { file, rows, manifiestos, isMultiple, savedName };

                // Preview
                $('prev-manifest-id').textContent  = isMultiple ? `${manifiestos.length} manifiestos detectados` : manifiestos[0];
                $('prev-multi-tag').style.display   = isMultiple ? 'inline-flex' : 'none';
                const multiRow = $('prev-manifests-row');
                if (multiRow) {
                    multiRow.style.display = isMultiple ? 'flex' : 'none';
                    $('prev-manifests-list').textContent = manifiestos.join(', ');
                }
                const jefaturas = [...new Set(rows.map(r => r.Jefatura).filter(j => j && j !== '—'))];

                $('prev-filename').textContent    = file.name;
                $('prev-rows').textContent        = fmt(rows.length) + ' filas';
                $('prev-skus').textContent        = skusUnicos.length + ' SKUs distintos';
                $('prev-contenedores').textContent = contenedores.length + ' contenedores';
                $('prev-jefaturas').textContent   = jefaturas.length > 0 ? jefaturas.join(', ') : '(no encontradas en Datos Maestros)';
                $('prev-savedname').textContent   = savedName;
                UI.filePreview.style.display = 'block';
                UI.btnConfirmUpload.disabled = false;

            } catch (err) {
                console.error(err);
                showUploadError('No se pudo leer el archivo. Verifica que sea un Excel válido.');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    if (UI.btnConfirmUpload) UI.btnConfirmUpload.addEventListener('click', uploadFile);

    async function uploadFile() {
        if (!State.parsedFile) return;
        const { file, rows, manifiestos, isMultiple, savedName } = State.parsedFile;

        UI.btnConfirmUpload.disabled = true;
        UI.btnConfirmUpload.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Subiendo...';

        try {
            await storage.ref(`${STORAGE_PATH}${savedName}`).put(file);

            const manifiestosList = isMultiple ? manifiestos : [manifiestos[0]];
            for (const manifestoId of manifiestosList) {
                const manifestRows = isMultiple ? rows.filter(r => r.NumeroManifiesto === manifestoId) : rows;
                const existingSnap = await db.collection(SKU_COLLECTION).where('manifestoId', '==', manifestoId).get();
                const batch = db.batch();
                existingSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                await db.collection(SKU_COLLECTION).add({
                    manifestoId,
                    fileName: savedName,
                    uploadedBy: State.currentUser.uid,
                    uploadedByEmail: State.currentUser.email,
                    uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    rows: manifestRows
                });
            }

            State.uploadModal.hide();
            const msg = isMultiple ? `${manifiestos.length} manifiestos SKU cargados.` : `SKUs del manifiesto ${manifiestos[0]} cargados.`;
            Swal.fire({ icon: 'success', title: '¡Listo!', text: msg, background: '#0e0e1a', color: '#fff', timer: 2500, showConfirmButton: false });
            await loadData();

        } catch (err) {
            console.error(err);
            showUploadError('Error al subir el archivo. Intenta de nuevo.');
        } finally {
            UI.btnConfirmUpload.disabled = false;
            UI.btnConfirmUpload.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Subir Archivo';
        }
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────
    function showLoading()  { UI.loading.style.display = 'flex'; }
    function hideLoading()  { UI.loading.style.display = 'none'; }

    function showUploadError(msg) {
        if (!UI.uploadError) return;
        if (!msg) { UI.uploadError.style.display = 'none'; return; }
        if (UI.uploadErrorMsg) UI.uploadErrorMsg.textContent = msg;
        UI.uploadError.style.display = 'block';
    }

    function toNum(v) {
        const n = parseFloat(String(v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function fmt(n) { return Number(n).toLocaleString('es-MX'); }

    // Convierte fecha de Excel: puede llegar como serial numérico (45123), string "DD/MM/YYYY", o ISO
    function fmtFecha(raw) {
        if (!raw || raw === '—') return '—';
        const s = String(raw).trim();
        // Si es número serial de Excel
        const num = parseFloat(s);
        if (!isNaN(num) && num > 1000 && !/[\/\-]/.test(s)) {
            // Excel epoch: 1 = 1 enero 1900, con bug de 1900 como bisiesto
            const date = new Date((num - 25569) * 86400 * 1000);
            if (!isNaN(date.getTime()))
                return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
        // Si ya es texto con fecha reconocible
        const d = new Date(s);
        if (!isNaN(d.getTime()) && d.getFullYear() > 2000)
            return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return s; // devolver tal cual si no se puede parsear
    }

    function esc(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function highlight(text, term) {
        if (!term) return esc(text);
        const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return esc(text).replace(re, '<mark>$1</mark>');
    }

    function isEstatus(estatus, keyword) {
        return estatus && estatus.toLowerCase().includes(keyword.toLowerCase());
    }

    function estatusBadge(estatus) {
        if (!estatus || estatus === '—')
            return `<span class="estatus-badge est-gray"><i class="bi bi-dash-circle"></i>Sin info</span>`;
        const e = estatus.toLowerCase();
        if (e === 'completo' || e.includes('comple') || e === 'ok' || e === 'si' || e === 'sí' || e === 'yes')
            return `<span class="estatus-badge est-green"><i class="bi bi-check-circle-fill"></i>Completo</span>`;
        if (e.includes('escaneado') || e.includes('recib'))
            return `<span class="estatus-badge est-green"><i class="bi bi-check-circle-fill"></i>Escaneado</span>`;
        if (e.includes('sobrant') || e.includes('adicional'))
            return `<span class="estatus-badge est-purple"><i class="bi bi-plus-circle-fill"></i>Sobrante</span>`;
        if (e.includes('falt') || e.includes('missing') || e === 'no' || e.includes('no recib'))
            return `<span class="estatus-badge est-red"><i class="bi bi-x-circle-fill"></i>Faltante</span>`;
        if (e.includes('pendi') || e.includes('proceso') || e.includes('transit'))
            return `<span class="estatus-badge est-yellow"><i class="bi bi-clock-fill"></i>Pendiente</span>`;
        if (e.includes('parcial') || e.includes('incomplet'))
            return `<span class="estatus-badge est-orange"><i class="bi bi-exclamation-circle-fill"></i>Parcial</span>`;
        return `<span class="estatus-badge est-gray"><i class="bi bi-info-circle-fill"></i>${esc(estatus)}</span>`;
    }

    function groupBy(arr, key) {
        return arr.reduce((acc, item) => {
            const k = item[key] || 'Sin ' + key;
            if (!acc[k]) acc[k] = [];
            acc[k].push(item);
            return acc;
        }, {});
    }

});
