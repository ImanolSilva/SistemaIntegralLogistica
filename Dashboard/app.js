"use strict";

document.addEventListener('DOMContentLoaded', () => {

    // ── FIREBASE ─────────────────────────────────────────────────────────────
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

    // ── CONSTANTS ─────────────────────────────────────────────────────────────
    const ADMIN_UIDS        = ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"];
    const COLLECTION        = "reportesDashboard";
    const CERRADO_COLL      = "manifiestosCerrados";
    const DATOS_COLL        = "datosMaestros";
    const DATOS_DOC         = "secciones";
    const STORAGE_PATH      = "Dashboard/";
    const STORAGE_CERRADO   = "ManifiestosCerrados/";

    // Columnas requeridas avance
    const REQUIRED_AVANCE   = ["contenedor","piezas","faltantes","sobrante","seccion","manifiesto"];
    // Columnas requeridas cerrado (normalizadas sin espacios/acentos)
    const REQUIRED_CERRADO  = ["manifiesto","seccion","articulo","codigoupc","descripcionarticulo","contenedor","cantmanf","cantregistr","diferencia","status"];

    // ── STATE ─────────────────────────────────────────────────────────────────
    const State = {
        currentUser: null,
        isAdmin: false,
        allReportes: [],
        allRows: [],
        filteredRows: [],
        allCerrados: [],
        allCerradoRows: [],
        masterMap: {},
        parsedFile: null,
        parsedDatos: null,
        parsedCerrado: null,
        chartJefatura: null,
        chartSeccion: null,
        chartTendencia: null,
        uploadModal: null,
        datosModal: null,
        cerradoModal: null,
    };

    // ── DOM ───────────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const UI = {
        welcomeGreeting:    $('welcome-greeting'),
        wbManifiestos:      $('wb-manifiestos'),
        wbJefaturas:        $('wb-jefaturas'),
        wbCerrados:         $('wb-cerrados'),
        wbFecha:            $('wb-fecha'),
        headerUser:         $('header-user'),
        userAvatar:         $('user-avatar'),
        userEmailLabel:     $('user-email-label'),
        sectionDate:        $('section-date'),
        loading:            $('globalLoading'),
        authGuard:          $('auth-guard'),
        dashboardContent:   $('dashboard-content'),
        adminPanel:         $('admin-panel'),
        datosStatus:        $('datos-status'),
        manifestsAdminList: $('manifests-admin-list'),
        cerradosAdminList:  $('cerrados-admin-list'),
        filterManifiesto:   $('filter-manifiesto'),
        filterJefatura:     $('filter-jefatura'),
        filterSeccion:      $('filter-seccion'),
        btnResetFilters:    $('btn-reset-filters'),
        noDataState:        $('no-data-state'),
        dataContent:        $('data-content'),
        kpiPiezas:          $('kpi-piezas'),
        kpiFaltantes:       $('kpi-faltantes'),
        kpiSobrantes:       $('kpi-sobrantes'),
        kpiCumplimiento:    $('kpi-cumplimiento'),
        kpiFaltantesSub:    $('kpi-faltantes-sub'),
        kpiSobrantesSub:    $('kpi-sobrantes-sub'),
        kpiCumplimientoSub: $('kpi-cumplimiento-sub'),
        kpiTrendPiezas:     $('kpi-trend-piezas'),
        kpiTrendFaltantes:  $('kpi-trend-faltantes'),
        kpiTrendSobrantes:  $('kpi-trend-sobrantes'),
        kpiProgressBar:     $('kpi-progress-bar'),
        rankingJefatura:    $('ranking-jefatura'),
        tbodyJefatura:      $('tbody-jefatura'),
        tbodyContenedor:    $('tbody-contenedor'),
        tbodyCerrado:       $('tbody-cerrado'),
        toggleContenedor:   $('toggle-contenedor'),
        panelContenedor:    $('panel-contenedor'),
        iconContenedor:     $('icon-contenedor'),
        toggleCerrado:      $('toggle-cerrado'),
        panelCerrado:       $('panel-cerrado'),
        iconCerrado:        $('icon-cerrado'),
        noCerradoState:     $('no-cerrado-state'),
        cerradoContent:     $('cerrado-content'),
        logoutBtn:          $('logout-btn'),
        // Avance upload
        btnUploadOpen:      $('btn-upload-open'),
        dropZone:           $('drop-zone'),
        fileInput:          $('file-input'),
        filePreview:        $('filePreview'),
        btnConfirmUpload:   $('btn-confirm-upload'),
        uploadError:        $('upload-error'),
        uploadErrorMsg:     $('upload-error-msg'),
        // Datos maestros
        btnDatosUpload:     $('btn-datos-upload'),
        datosDropZone:      $('datos-drop-zone'),
        datosFileInput:     $('datos-file-input'),
        datosPreview:       $('datos-preview'),
        datosPrevCount:     $('datos-prev-count'),
        datosPrevFile:      $('datos-prev-file'),
        datosError:         $('datos-error'),
        datosErrorMsg:      $('datos-error-msg'),
        btnDatosConfirm:    $('btn-datos-confirm'),
        // Cerrado upload
        btnCerradoOpen:     $('btn-cerrado-open'),
        cerradoDropZone:    $('cerrado-drop-zone'),
        cerradoFileInput:   $('cerrado-file-input'),
        cerradoPreview:     $('cerradoPreview'),
        cerradoPrevManif:   $('cerrado-prev-manifest'),
        cerradoPrevFile:    $('cerrado-prev-filename'),
        cerradoPrevRows:    $('cerrado-prev-rows'),
        cerradoPrevCont:    $('cerrado-prev-contenedores'),
        cerradoPrevEst:     $('cerrado-prev-estatus'),
        cerradoError:       $('cerrado-error'),
        cerradoErrorMsg:    $('cerrado-error-msg'),
        btnConfirmCerrado:  $('btn-confirm-cerrado'),
    };

    // ── MODALS ────────────────────────────────────────────────────────────────
    const uploadModalEl  = document.getElementById('uploadModal');
    if (uploadModalEl)  State.uploadModal  = new bootstrap.Modal(uploadModalEl);
    const datosModalEl   = document.getElementById('datosModal');
    if (datosModalEl)   State.datosModal   = new bootstrap.Modal(datosModalEl);
    const cerradoModalEl = document.getElementById('cerradoModal');
    if (cerradoModalEl) State.cerradoModal = new bootstrap.Modal(cerradoModalEl);

    // ── AUTH ──────────────────────────────────────────────────────────────────
    auth.onAuthStateChanged(async user => {
        if (!user) { hideLoading(); UI.authGuard.style.display = 'block'; return; }
        State.currentUser = user;
        State.isAdmin = ADMIN_UIDS.includes(user.uid);
        UI.dashboardContent.style.display = 'block';
        if (State.isAdmin) UI.adminPanel.style.display = 'block';
        const adminTabNav = document.getElementById('adminTab');
        if (adminTabNav && State.isAdmin) adminTabNav.style.display = 'flex';

        if (UI.headerUser) UI.headerUser.style.display = 'flex';
        if (UI.userEmailLabel) UI.userEmailLabel.textContent = user.email || '';
        if (UI.userAvatar) UI.userAvatar.textContent = (user.email || 'U')[0].toUpperCase();

        const hour  = new Date().getHours();
        const greet = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
        const name  = user.displayName || user.email?.split('@')[0] || 'usuario';
        if (UI.welcomeGreeting) UI.welcomeGreeting.textContent = `${greet}, ${name}`;

        await loadMasterData();
        // Load avance first so allRows is ready for cerrado cross-reference
        await loadReportes();
        await loadCerrados();
    });

    UI.logoutBtn.addEventListener('click', () => {
        auth.signOut().then(() => { window.location.href = '../Login/login.html'; });
    });

    // ── ADMIN PANEL: colapso + tabs ───────────────────────────────────────────
    const adminToggle  = $('admin-panel-toggle');
    const adminBody    = $('admin-panel-body');
    const adminChevron = $('admin-chevron');
    if (adminToggle && adminBody) {
        adminToggle.addEventListener('click', () => {
            const collapsed = adminBody.style.display === 'none';
            adminBody.style.display = collapsed ? 'block' : 'none';
            if (adminChevron) adminChevron.classList.toggle('collapsed', !collapsed);
        });
    }

    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.querySelectorAll('.admin-tab-panel').forEach(p => {
                p.style.display = p.id === `tab-panel-${target}` ? 'block' : 'none';
            });
        });
    });

    function updateTabCounts() {
        const cAvance  = $('tab-count-avance');
        const cCerrado = $('tab-count-cerrado');
        if (cAvance)  cAvance.textContent  = State.allReportes.length;
        if (cCerrado) cCerrado.textContent = State.allCerrados.length;
    }

    // ── DATOS MAESTROS ────────────────────────────────────────────────────────
    async function loadMasterData() {
        try {
            const doc = await db.collection(DATOS_COLL).doc(DATOS_DOC).get();
            if (doc.exists && doc.data().sections) {
                State.masterMap = doc.data().sections;
                const count = Object.keys(State.masterMap).length;
                const fecha = doc.data().uploadedAt
                    ? new Date(doc.data().uploadedAt.toDate()).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
                    : '—';
                if (UI.datosStatus) { UI.datosStatus.textContent = `✓ ${count} secciones · ${fecha}`; UI.datosStatus.style.color = '#10B981'; }
            } else {
                if (UI.datosStatus) UI.datosStatus.textContent = 'Sin cargar — Jefatura no se auto-rellenará';
            }
        } catch (e) { console.error('Error cargando datos maestros:', e); }
    }

    // Normalize a section key: trim, remove leading zeros, lowercase
    // "045" → "45", " 45 " → "45", "Electrónica" → "electronica"
    function normSeccion(s) {
        return String(s).trim().replace(/^0+(?=\d)/, '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // Build a normalized lookup: normKey → master entry
    function buildNormMap() {
        const map = {};
        Object.keys(State.masterMap).forEach(k => {
            map[normSeccion(k)] = State.masterMap[k];
        });
        return map;
    }

    function enrichWithMasterData(rows) {
        const normMap = buildNormMap();
        return rows.map(r => {
            const seccion = String(r.Seccion || '').trim();
            // Try exact match first, then normalized match
            const master  = State.masterMap[seccion] || normMap[normSeccion(seccion)];
            return {
                ...r,
                Jefatura:       master?.Jefatura    || r.Jefatura       || '—',
                DescripcionSec: master?.Descripcion || r.DescripcionSec || seccion,
                Gerente:        master?.Gerente      || '—',
                Bodega:         master?.Bodega       || '—',
            };
        });
    }

    // Datos upload
    if (UI.btnDatosUpload) UI.btnDatosUpload.addEventListener('click', () => { resetDatosModal(); State.datosModal.show(); });

    function resetDatosModal() {
        State.parsedDatos = null;
        if (UI.datosFileInput) UI.datosFileInput.value = '';
        if (UI.datosPreview) UI.datosPreview.style.display = 'none';
        if (UI.datosError)   UI.datosError.style.display = 'none';
        if (UI.btnDatosConfirm) UI.btnDatosConfirm.disabled = true;
        if (UI.datosDropZone) { UI.datosDropZone.style.display = 'flex'; UI.datosDropZone.classList.remove('drag-over'); }
    }

    if (UI.datosFileInput) UI.datosFileInput.addEventListener('change', e => { if (e.target.files[0]) handleDatosFile(e.target.files[0]); });
    if (UI.datosDropZone) {
        UI.datosDropZone.addEventListener('dragover',  e => { e.preventDefault(); UI.datosDropZone.classList.add('drag-over'); });
        UI.datosDropZone.addEventListener('dragleave', () => UI.datosDropZone.classList.remove('drag-over'));
        UI.datosDropZone.addEventListener('drop', e => {
            e.preventDefault(); UI.datosDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleDatosFile(e.dataTransfer.files[0]);
        });
    }

    function handleDatosFile(file) {
        if (UI.datosError) UI.datosError.style.display = 'none';
        if (UI.btnDatosConfirm) UI.btnDatosConfirm.disabled = true;
        if (UI.datosPreview) UI.datosPreview.style.display = 'none';
        if (!file.name.match(/\.(xlsx|xls)$/i)) { showDatosError('El archivo debe ser .xlsx o .xls'); return; }

        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb   = XLSX.read(evt.target.result, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                if (json.length === 0) { showDatosError('El archivo está vacío.'); return; }

                const nk = k => k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');
                const normalized = json.map(row => { const o={}; Object.keys(row).forEach(k=>{o[nk(k)]=row[k];}); return o; });

                if (!('seccion' in normalized[0])) { showDatosError('No se encontró la columna "Sección".'); return; }

                const sections = {};
                normalized.forEach(r => {
                    const sec = String(r.seccion || '').trim();
                    if (sec) sections[sec] = {
                        Descripcion: String(r.descripcion || '').trim(),
                        Jefatura:    String(r.jefatura    || '').trim(),
                        Gerente:     String(r.gerente     || '').trim(),
                        Bodega:      String(r.bodega      || '').trim(),
                    };
                });

                State.parsedDatos = { file, sections };
                if (UI.datosPrevCount) UI.datosPrevCount.textContent = Object.keys(sections).length + ' secciones';
                if (UI.datosPrevFile)  UI.datosPrevFile.textContent  = file.name;
                if (UI.datosPreview)   UI.datosPreview.style.display = 'block';
                if (UI.btnDatosConfirm) UI.btnDatosConfirm.disabled = false;
            } catch (err) { console.error(err); showDatosError('No se pudo leer el archivo.'); }
        };
        reader.readAsArrayBuffer(file);
    }

    if (UI.btnDatosConfirm) UI.btnDatosConfirm.addEventListener('click', async () => {
        if (!State.parsedDatos) return;
        const { sections } = State.parsedDatos;
        UI.btnDatosConfirm.disabled = true;
        UI.btnDatosConfirm.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';
        try {
            await db.collection(DATOS_COLL).doc(DATOS_DOC).set({ sections, uploadedAt: firebase.firestore.FieldValue.serverTimestamp(), uploadedBy: State.currentUser.uid });
            State.masterMap = sections;
            if (UI.datosStatus) { UI.datosStatus.textContent = `✓ ${Object.keys(sections).length} secciones · ahora mismo`; UI.datosStatus.style.color = '#10B981'; }
            State.datosModal.hide();
            Swal.fire({ icon: 'success', title: '¡Listo!', text: `${Object.keys(sections).length} secciones cargadas.`, background: '#0e0e1a', color: '#fff', timer: 2500, showConfirmButton: false });
        } catch (err) { console.error(err); showDatosError('Error al guardar.'); }
        finally { UI.btnDatosConfirm.disabled = false; UI.btnDatosConfirm.innerHTML = '<i class="bi bi-database-fill-up"></i> Guardar'; }
    });

    function showDatosError(msg) {
        if (!UI.datosError) return;
        if (UI.datosErrorMsg) UI.datosErrorMsg.textContent = msg;
        UI.datosError.style.display = 'block';
    }

    // ── LOAD REPORTES (AVANCE) ────────────────────────────────────────────────
    async function loadReportes() {
        showLoading();
        try {
            const snap = await db.collection(COLLECTION).orderBy('uploadedAt', 'desc').get();
            State.allReportes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            State.allRows = enrichWithMasterData(State.allReportes.flatMap(r => r.rows || []));
            populateFilterOptions();
            renderAdminList();
            updateTabCounts();
            renderTopJefatura();
            updateWelcomeBanner();
            applyFilters();
        } catch (e) {
            console.error(e);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los reportes.', background: '#0e0e1a', color: '#fff' });
        } finally { hideLoading(); }
    }

    // ── LOAD MANIFIESTOS CERRADOS ─────────────────────────────────────────────
    async function loadCerrados() {
        try {
            const snap = await db.collection(CERRADO_COLL).orderBy('uploadedAt', 'desc').get();
            State.allCerrados    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            State.allCerradoRows = enrichWithMasterData(State.allCerrados.flatMap(d => d.rows || []));
            renderCerradosAdminList();
            updateTabCounts();
            renderTablaCerrado();
            updateWelcomeBanner();
        } catch (e) { console.error('Error cargando cerrados:', e); }
    }

    // ── WELCOME BANNER ────────────────────────────────────────────────────────
    function updateWelcomeBanner() {
        const manifiestos = [...new Set(State.allRows.map(r => r.Manifiesto))];
        const jefaturas   = [...new Set(State.allRows.map(r => r.Jefatura).filter(j => j && j !== '—'))];
        if (UI.wbManifiestos) animateCount(UI.wbManifiestos, manifiestos.length);
        if (UI.wbJefaturas)   animateCount(UI.wbJefaturas,   jefaturas.length);
        if (UI.wbCerrados)    animateCount(UI.wbCerrados,    State.allCerrados.length);

        const lastRep = State.allReportes[0];
        if (UI.wbFecha && lastRep?.uploadedAt) {
            UI.wbFecha.textContent = new Date(lastRep.uploadedAt.toDate()).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
        }
        if (UI.sectionDate) {
            UI.sectionDate.textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
        }
    }

    function animateCount(el, target) {
        const duration = 800, start = performance.now();
        const step = now => {
            const pct = Math.min((now - start) / duration, 1);
            el.textContent = Math.round(target * easeOut(pct));
            if (pct < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    // ── FILTERS ───────────────────────────────────────────────────────────────
    function populateFilterOptions() {
        const manifiestos = [...new Set(State.allRows.map(r => r.Manifiesto))].sort();
        const jefaturas   = [...new Set(State.allRows.map(r => r.Jefatura).filter(j => j && j !== '—'))].sort();
        const secciones   = [...new Set(State.allRows.map(r => r.Seccion))].sort();
        fillSelect(UI.filterManifiesto, manifiestos, 'Todos los reportes');
        fillSelect(UI.filterJefatura,   jefaturas,   'Todas las áreas');
        fillSelect(UI.filterSeccion,    secciones,   'Todas las secciones');
    }

    function fillSelect(el, values, placeholder) {
        el.innerHTML = `<option value="">${placeholder}</option>`;
        values.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); });
    }

    function applyFilters() {
        const fM = UI.filterManifiesto.value;
        const fJ = UI.filterJefatura.value;
        const fS = UI.filterSeccion.value;
        State.filteredRows = State.allRows.filter(r =>
            (!fM || r.Manifiesto === fM) && (!fJ || r.Jefatura === fJ) && (!fS || r.Seccion === fS)
        );
        if (State.allRows.length === 0) {
            UI.noDataState.style.display = 'block';
            UI.dataContent.style.display = 'none';
        } else {
            UI.noDataState.style.display = 'none';
            UI.dataContent.style.display = 'block';
            renderKPIs();
            renderCharts();
            renderTablaJefatura();
            renderTablaContenedor();
        }
    }

    UI.filterManifiesto.addEventListener('change', applyFilters);
    UI.filterJefatura.addEventListener('change',   applyFilters);
    UI.filterSeccion.addEventListener('change',    applyFilters);
    UI.btnResetFilters.addEventListener('click', () => {
        UI.filterManifiesto.value = ''; UI.filterJefatura.value = ''; UI.filterSeccion.value = '';
        applyFilters();
    });

    // ── KPIs ──────────────────────────────────────────────────────────────────
    function renderKPIs() {
        const rows = State.filteredRows;
        const piezas    = rows.reduce((s, r) => s + toNum(r.Piezas),    0);
        const faltantes = rows.reduce((s, r) => s + toNum(r.Faltantes), 0);
        const sobrantes = rows.reduce((s, r) => s + toNum(r.Sobrante),  0);
        const cumplPct  = piezas > 0 ? ((piezas - faltantes) / piezas * 100) : 0;

        animateKpiNumber(UI.kpiPiezas,    piezas,    true);
        animateKpiNumber(UI.kpiFaltantes, faltantes, true);
        animateKpiNumber(UI.kpiSobrantes, sobrantes, true);
        animatePct(UI.kpiCumplimiento, cumplPct);

        const faltPct = piezas > 0 ? (faltantes / piezas * 100).toFixed(1) : 0;
        const sobrPct = piezas > 0 ? (sobrantes / piezas * 100).toFixed(1) : 0;

        if (UI.kpiProgressBar) setTimeout(() => { UI.kpiProgressBar.style.width = Math.min(cumplPct, 100).toFixed(1) + '%'; }, 100);

        const contenedores = rows.length;
        if (UI.kpiTrendPiezas) { UI.kpiTrendPiezas.innerHTML = `<i class="bi bi-boxes"></i> ${contenedores} contenedores`; UI.kpiTrendPiezas.className = 'kpi-trend neutral'; }
        if (UI.kpiTrendFaltantes) {
            const isBad = faltPct > 5;
            UI.kpiTrendFaltantes.innerHTML = `<i class="bi bi-arrow-${isBad?'up':'down'}-short"></i> ${faltPct}% del total`;
            UI.kpiTrendFaltantes.className = `kpi-trend ${isBad ? 'down' : 'up'}`;
        }
        if (UI.kpiTrendSobrantes) { UI.kpiTrendSobrantes.innerHTML = `<i class="bi bi-percent"></i> ${sobrPct}% del total`; UI.kpiTrendSobrantes.className = 'kpi-trend neutral'; }

        // Donut center label
        const donutPct = $('donut-pct');
        if (donutPct) donutPct.textContent = cumplPct.toFixed(1) + '%';

        // Stat totals (header del área chart)
        const statPiezas = $('stat-piezas-total');
        const statFalt   = $('stat-faltantes-total');
        if (statPiezas) statPiezas.textContent = fmt(piezas);
        if (statFalt)   statFalt.textContent   = fmt(faltantes);

        // Progress bars de contenedores
        const total    = rows.length;
        const contOk   = rows.filter(r => toNum(r.Faltantes) === 0 && toNum(r.Sobrante) === 0).length;
        const contFalt = rows.filter(r => toNum(r.Faltantes) > 0).length;
        const contSobr = rows.filter(r => toNum(r.Sobrante) > 0 && toNum(r.Faltantes) === 0).length;

        const setProg = (barId, valId, countId, count, label) => {
            const pct = total > 0 ? (count / total * 100) : 0;
            const bar = $(barId), val = $(valId), cnt = $(countId);
            if (bar) setTimeout(() => { bar.style.width = pct.toFixed(1) + '%'; }, 120);
            if (val) val.textContent = pct.toFixed(1) + '%';
            if (cnt) cnt.textContent = `${count} ${label}`;
        };
        setProg('prog-ok',   'prog-val-ok',   'prog-count-ok',   contOk,   'correctos');
        setProg('prog-falt', 'prog-val-falt', 'prog-count-falt', contFalt, 'faltantes');
        setProg('prog-sobr', 'prog-val-sobr', 'prog-count-sobr', contSobr, 'sobrantes');
    }

    function animateKpiNumber(el, target, isFmt) {
        if (!el) return;
        const duration = 750, start = performance.now();
        const step = now => {
            const pct = Math.min((now - start) / duration, 1);
            el.textContent = isFmt ? fmt(Math.round(target * easeOut(pct))) : Math.round(target * easeOut(pct));
            if (pct < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
    function animatePct(el, target) {
        if (!el) return;
        const duration = 850, start = performance.now();
        const step = now => {
            const pct = Math.min((now - start) / duration, 1);
            el.textContent = (target * easeOut(pct)).toFixed(1) + '%';
            if (pct < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // ── RANKING ───────────────────────────────────────────────────────────────
    function renderTopJefatura() {
        if (!UI.rankingJefatura) return;
        const grouped = groupBy(State.allRows, 'Jefatura');
        const jefaturas = Object.keys(grouped).filter(j => j && j !== '—');
        if (jefaturas.length === 0) { UI.rankingJefatura.innerHTML = ''; return; }

        const ranked = jefaturas.map(j => {
            const rows = grouped[j];
            const pz = rows.reduce((s,r) => s + toNum(r.Piezas),0);
            const ft = rows.reduce((s,r) => s + toNum(r.Faltantes),0);
            const sb = rows.reduce((s,r) => s + toNum(r.Sobrante),0);
            return { nombre: j, pz, ft, sb, pct: pz > 0 ? ((pz-ft)/pz*100) : 0 };
        }).sort((a, b) => b.pct - a.pct);

        const medals = ['🥇','🥈','🥉'];
        UI.rankingJefatura.innerHTML = ranked.map((item, i) => {
            const medal    = i < 3 ? medals[i] : String(i+1);
            const rankCls  = i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-other';
            const barColor = item.pct >= 95 ? '#10B981' : item.pct >= 85 ? '#F59E0B' : '#EF4444';
            const pctCls   = item.pct >= 95 ? 'good' : item.pct >= 85 ? 'warn' : 'bad';
            return `<div class="ranking-item">
                <div class="rank-badge ${rankCls}">${medal}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${item.nombre}</div>
                    <div class="ranking-stats">${fmt(item.pz)} pzas · <span style="color:#F87171">${fmt(item.ft)} falt.</span> · <span style="color:#FCD34D">${fmt(item.sb)} sobr.</span></div>
                </div>
                <div class="ranking-bar-wrap">
                    <div class="ranking-bar-bg">
                        <div class="ranking-bar-fill" style="width:${Math.min(item.pct,100).toFixed(1)}%;background:${barColor}"></div>
                    </div>
                </div>
                <div class="ranking-pct"><span class="badge-pct ${pctCls}">${item.pct.toFixed(1)}%</span></div>
            </div>`;
        }).join('');
    }

    // ── CHARTS ────────────────────────────────────────────────────────────────
    function renderCharts() { renderChartJefatura(); renderChartSeccion(); renderChartTendencia(); }

    function renderChartJefatura() {
        const canvas = document.getElementById('chart-jefatura');
        if (!canvas) return;
        const grouped = groupBy(State.filteredRows.filter(r => r.Jefatura && r.Jefatura !== '—'), 'Jefatura');
        const labels  = Object.keys(grouped).sort((a, b) => {
            const pct = j => { const rw=grouped[j]; const pz=rw.reduce((s,r)=>s+toNum(r.Piezas),0); const ft=rw.reduce((s,r)=>s+toNum(r.Faltantes),0); return pz>0?(pz-ft)/pz*100:0; };
            return pct(b) - pct(a);
        });

        if (State.chartJefatura) State.chartJefatura.destroy();

        if (labels.length === 0) {
            canvas.parentElement.innerHTML = '<div style="text-align:center;color:rgba(241,241,245,0.3);padding:2rem;font-size:0.82rem;">Sin datos de Jefatura</div>';
            return;
        }

        const pctData  = labels.map(j => { const rw=grouped[j]; const pz=rw.reduce((s,r)=>s+toNum(r.Piezas),0); const ft=rw.reduce((s,r)=>s+toNum(r.Faltantes),0); return pz>0?((pz-ft)/pz*100):0; });
        const piezasData = labels.map(j => grouped[j].reduce((s,r)=>s+toNum(r.Piezas),0));
        const bgColors = pctData.map(p => p>=95?'rgba(16,185,129,0.55)':p>=85?'rgba(245,158,11,0.55)':'rgba(239,68,68,0.55)');
        const bdColors = pctData.map(p => p>=95?'rgba(16,185,129,0.9)':p>=85?'rgba(245,158,11,0.9)':'rgba(239,68,68,0.9)');

        // Adjust chart height dynamically based on number of labels
        const wrapEl = canvas.closest('.chart-wrapper');
        if (wrapEl) wrapEl.style.height = Math.max(200, labels.length * 38) + 'px';

        State.chartJefatura = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ label: '% Exactitud', data: pctData, backgroundColor: bgColors, borderColor: bdColors, borderWidth: 1.5, borderRadius: 5, borderSkipped: false }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10,10,15,0.95)',
                        titleColor: 'rgba(241,241,245,0.9)',
                        bodyColor: 'rgba(241,241,245,0.75)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: ctx => ` Exactitud: ${ctx.parsed.x.toFixed(1)}%`,
                            afterLabel: ctx => ` Piezas: ${fmt(piezasData[ctx.dataIndex])}`
                        }
                    }
                },
                scales: {
                    x: {
                        min: 0, max: 100,
                        ticks: { color:'rgba(241,241,245,0.35)', font:{ size:10 }, callback: v => v+'%' },
                        grid:  { color:'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        ticks: { color:'rgba(241,241,245,0.65)', font:{ size:11 } },
                        grid:  { display: false }
                    }
                }
            }
        });
    }

    function renderChartTendencia() {
        const grouped = groupBy(State.filteredRows, 'Manifiesto');
        const labels  = Object.keys(grouped).sort();
        const dataPz  = labels.map(m => grouped[m].reduce((s,r)=>s+toNum(r.Piezas),0));
        const dataFt  = labels.map(m => grouped[m].reduce((s,r)=>s+toNum(r.Faltantes),0));
        const canvas  = document.getElementById('chart-tendencia');
        if (!canvas) return;
        if (State.chartTendencia) State.chartTendencia.destroy();

        // Gradient plugin: creates gradients after chart area is known
        const gradientPlugin = {
            id: 'tendenciaGradient',
            beforeDraw(chart) {
                const { ctx: c, chartArea } = chart;
                if (!chartArea) return;
                const y0 = chartArea.top, y1 = chartArea.bottom;

                const gAzul = c.createLinearGradient(0, y0, 0, y1);
                gAzul.addColorStop(0, 'rgba(37,99,235,0.32)');
                gAzul.addColorStop(1, 'rgba(37,99,235,0.02)');

                const gRosa = c.createLinearGradient(0, y0, 0, y1);
                gRosa.addColorStop(0, 'rgba(230,0,126,0.26)');
                gRosa.addColorStop(1, 'rgba(230,0,126,0.01)');

                chart.data.datasets[0].backgroundColor = gAzul;
                chart.data.datasets[1].backgroundColor = gRosa;
            }
        };

        State.chartTendencia = new Chart(canvas, {
            type: 'line',
            plugins: [gradientPlugin],
            data: {
                labels,
                datasets: [
                    {
                        label: 'Piezas recibidas',
                        data: dataPz,
                        borderColor: '#2563EB',
                        borderWidth: 2.5,
                        pointBackgroundColor: '#2563EB',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: labels.length <= 12 ? 4 : 2,
                        pointHoverRadius: 6,
                        fill: true,
                        backgroundColor: 'rgba(37,99,235,0.18)',
                        tension: 0.42,
                    },
                    {
                        label: 'Faltantes',
                        data: dataFt,
                        borderColor: '#E6007E',
                        borderWidth: 2.5,
                        pointBackgroundColor: '#E6007E',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: labels.length <= 12 ? 4 : 2,
                        pointHoverRadius: 6,
                        fill: true,
                        backgroundColor: 'rgba(230,0,126,0.14)',
                        tension: 0.42,
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true, position: 'top', align: 'end',
                        labels: { color: 'rgba(241,241,245,0.60)', font: { size: 11 }, boxWidth: 10, padding: 14 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10,10,15,0.95)',
                        titleColor: 'rgba(241,241,245,0.9)',
                        bodyColor:  'rgba(241,241,245,0.75)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    x: {
                        ticks: { color:'rgba(241,241,245,0.35)', font:{ size:9 }, maxRotation:30, autoSkip:true, maxTicksLimit:10 },
                        grid:  { color:'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        min: 0,
                        ticks: { color:'rgba(241,241,245,0.35)', font:{ size:9 }, callback: v => fmt(v) },
                        grid:  { color:'rgba(255,255,255,0.04)' }
                    }
                }
            }
        });
    }

    function renderChartSeccion() {
        const canvas = document.getElementById('chart-seccion');
        if (!canvas) return;
        const grouped = groupBy(State.filteredRows, 'Seccion');
        const labels  = Object.keys(grouped).filter(s => s && s !== 'Sin Seccion').sort();
        const piezas  = labels.map(s => grouped[s].reduce((sum,r)=>sum+toNum(r.Piezas),0));
        const total   = piezas.reduce((a,b)=>a+b,0);
        const displayLabels = labels.map(s => {
            const m = State.masterMap[s] || null;
            return m?.Descripcion ? `${s} · ${m.Descripcion}` : s;
        });
        if (State.chartSeccion) State.chartSeccion.destroy();
        State.chartSeccion = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: displayLabels, datasets: [{ data: piezas, backgroundColor: generateColors(labels.length), borderColor: 'rgba(10,10,15,0.55)', borderWidth: 2.5, hoverOffset: 12 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10,10,15,0.95)',
                        titleColor: 'rgba(241,241,245,0.9)',
                        bodyColor:  'rgba(241,241,245,0.75)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: { label: ctx => { const pct=total>0?(ctx.parsed/total*100).toFixed(1):0; return ` ${fmt(ctx.parsed)} pzas — ${pct}%`; } }
                    }
                }
            }
        });
    }

    // ── TABLA JEFATURA ────────────────────────────────────────────────────────
    function renderTablaJefatura() {
        const grouped   = groupBy(State.filteredRows.filter(r=>r.Jefatura&&r.Jefatura!=='—'), 'Jefatura');
        const jefaturas = Object.keys(grouped).sort((a,b)=>{
            const pct=j=>{const rw=grouped[j];const pz=rw.reduce((s,r)=>s+toNum(r.Piezas),0);const ft=rw.reduce((s,r)=>s+toNum(r.Faltantes),0);return pz>0?(pz-ft)/pz*100:0;};
            return pct(b)-pct(a);
        });
        UI.tbodyJefatura.innerHTML = jefaturas.map(j => {
            const rows=grouped[j];
            const pz=rows.reduce((s,r)=>s+toNum(r.Piezas),0);
            const ft=rows.reduce((s,r)=>s+toNum(r.Faltantes),0);
            const sb=rows.reduce((s,r)=>s+toNum(r.Sobrante),0);
            const pct=pz>0?((pz-ft)/pz*100):0;
            return `<tr>
                <td><strong>${j}</strong></td>
                <td style="text-align:right">${fmt(pz)}</td>
                <td style="text-align:right;color:#F87171">${fmt(ft)}</td>
                <td style="text-align:right;color:#FCD34D">${fmt(sb)}</td>
                <td style="text-align:right">${pctBadge(pct)}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--txt3);padding:1.5rem">Sin datos</td></tr>`;
    }

    // ── TABLA CONTENEDOR ──────────────────────────────────────────────────────
    function renderTablaContenedor() {
        UI.tbodyContenedor.innerHTML = State.filteredRows.map(r => {
            const pz=toNum(r.Piezas), ft=toNum(r.Faltantes), sb=toNum(r.Sobrante);
            const pct=pz>0?((pz-ft)/pz*100):0;
            const descSec=r.DescripcionSec&&r.DescripcionSec!==r.Seccion?`<br><span style="font-size:0.71rem;color:var(--txt3)">${r.DescripcionSec}</span>`:'';
            return `<tr>
                <td><strong>${r.Contenedor||'—'}</strong></td>
                <td style="color:var(--rosa);font-size:0.78rem">${r.Manifiesto||'—'}</td>
                <td>${r.Seccion||'—'}${descSec}</td>
                <td>${r.Jefatura||'—'}</td>
                <td style="text-align:right">${fmt(pz)}</td>
                <td style="text-align:right;color:#F87171">${fmt(ft)}</td>
                <td style="text-align:right;color:#FCD34D">${fmt(sb)}</td>
                <td style="text-align:right">${pctBadge(pct)}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--txt3);padding:1.5rem">Sin datos</td></tr>`;
    }

    UI.toggleContenedor.addEventListener('click', () => {
        const isHidden = UI.panelContenedor.style.display === 'none';
        UI.panelContenedor.style.display = isHidden ? 'block' : 'none';
        UI.toggleContenedor.classList.toggle('collapsed', !isHidden);
    });

    // ── TABLA CERRADO (colapsable) ────────────────────────────────────────────
    UI.toggleCerrado.addEventListener('click', () => {
        const isHidden = UI.panelCerrado.style.display === 'none';
        UI.panelCerrado.style.display = isHidden ? 'block' : 'none';
        UI.toggleCerrado.classList.toggle('collapsed', !isHidden);
    });

    // ── CERRADO EXPLAIN TOGGLE ────────────────────────────────────────────────
    document.addEventListener('click', e => {
        const btn = e.target.closest('#cerrado-explain-toggle');
        if (!btn) return;
        const body = document.getElementById('cerrado-explain-body');
        if (!body) return;
        const open = body.classList.toggle('open');
        btn.classList.toggle('open', open);
    });

    function renderTablaCerrado() {
        if (State.allCerradoRows.length === 0) {
            if (UI.noCerradoState) UI.noCerradoState.style.display = 'block';
            if (UI.cerradoContent) UI.cerradoContent.style.display = 'none';
            return;
        }
        if (UI.noCerradoState) UI.noCerradoState.style.display = 'none';
        if (UI.cerradoContent) UI.cerradoContent.style.display = 'block';

        // Build avance lookup by contenedor (from State.allRows = enriched avance rows)
        const avanceByContenedor = {};
        State.allRows.forEach(r => {
            const k = String(r.Contenedor || '').trim().toUpperCase();
            if (k) avanceByContenedor[k] = r;
        });

        // Group cerrado rows by manifiesto to render summary headers
        const byManifiesto = {};
        State.allCerradoRows.forEach(r => {
            const m = r.Manifiesto || '—';
            if (!byManifiesto[m]) byManifiesto[m] = [];
            byManifiesto[m].push(r);
        });

        let tbody = '';
        Object.keys(byManifiesto).sort().forEach(manif => {
            const rows = byManifiesto[manif];
            const contenedoresUnicos = [...new Set(rows.map(r => String(r.Contenedor||'').trim().toUpperCase()).filter(Boolean))];
            const conMatchAvance     = contenedoresUnicos.filter(c => avanceByContenedor[c]).length;
            const jefaturasCubiertas = rows.filter(r => r.Jefatura && r.Jefatura !== '—').length;
            const jefPct             = rows.length > 0 ? Math.round(jefaturasCubiertas / rows.length * 100) : 0;
            const completos  = rows.filter(r => r.Estatus === 'Completo').length;
            const faltantes  = rows.filter(r => r.Estatus === 'Faltante').length;
            const sobrantes  = rows.filter(r => r.Estatus === 'Sobrante').length;
            const avancePct  = contenedoresUnicos.length > 0 ? Math.round(conMatchAvance / contenedoresUnicos.length * 100) : 0;

            // Summary header row spanning all columns
            tbody += `<tr class="cerrado-group-header">
                <td colspan="11">
                    <div class="cerrado-group-summary">
                        <div class="cgs-left">
                            <span class="cgs-manif"><i class="bi bi-file-earmark-check-fill" style="color:var(--verde)"></i>${manif}</span>
                            <span class="cgs-pill">${rows.length} artículos</span>
                            <span class="cgs-pill">${contenedoresUnicos.length} contenedores</span>
                        </div>
                        <div class="cgs-right">
                            <span class="cgs-match ${conMatchAvance === contenedoresUnicos.length ? 'match-full' : conMatchAvance > 0 ? 'match-partial' : 'match-none'}" title="Contenedores con registro en Reporte de Avance">
                                <i class="bi bi-bar-chart-fill"></i> Avance: ${conMatchAvance}/${contenedoresUnicos.length} (${avancePct}%)
                            </span>
                            <span class="cgs-match ${jefPct === 100 ? 'match-full' : jefPct > 0 ? 'match-partial' : 'match-none'}" title="Artículos con Jefatura resuelta desde Datos Maestros">
                                <i class="bi bi-person-badge-fill"></i> Jefatura: ${jefPct}%
                            </span>
                            <span class="cgs-est" style="color:#34D399"><i class="bi bi-check-circle-fill"></i>${completos}</span>
                            <span class="cgs-est" style="color:#F87171"><i class="bi bi-x-circle-fill"></i>${faltantes}</span>
                            ${sobrantes > 0 ? `<span class="cgs-est" style="color:#A78BFA"><i class="bi bi-plus-circle-fill"></i>${sobrantes}</span>` : ''}
                        </div>
                    </div>
                </td>
            </tr>`;

            rows.forEach(r => {
                const cantManf  = toNum(r.CantManf);
                const cantReg   = toNum(r.CantRegistr);
                const diff      = toNum(r.Diferencia);
                const contKey   = String(r.Contenedor || '').trim().toUpperCase();
                const avance    = avanceByContenedor[contKey];

                // Cross-ref cell: show avance piezas/faltantes if available
                let avanceCel;
                if (avance) {
                    const pz = toNum(avance.Piezas), ft = toNum(avance.Faltantes);
                    const pct = pz > 0 ? ((pz - ft) / pz * 100) : 0;
                    avanceCel = `<span class="cerr-avance-match" title="Avance: ${fmt(pz)} pzas · ${fmt(ft)} falt.">
                        <i class="bi bi-check2-circle" style="color:var(--verde)"></i>
                        ${fmt(pz)} · ${fmt(ft)} falt. · ${pctBadge(pct)}
                    </span>`;
                } else {
                    avanceCel = `<span class="cerr-avance-none" title="Sin registro en Reporte de Avance"><i class="bi bi-dash-circle"></i>Sin avance</span>`;
                }

                tbody += `<tr>
                    <td><strong>${esc(r.Contenedor||'—')}</strong></td>
                    <td style="color:var(--rosa);font-size:0.78rem">${esc(r.Manifiesto||'—')}</td>
                    <td>${esc(r.Seccion||'—')}</td>
                    <td>${r.Jefatura && r.Jefatura !== '—' ? esc(r.Jefatura) : `<span style="color:var(--rojo);font-size:0.72rem"><i class="bi bi-exclamation-triangle-fill"></i>${esc(r.Jefatura||'—')}</span>`}</td>
                    <td style="font-size:0.78rem">${esc(r.Articulo||'—')}</td>
                    <td style="font-family:monospace;font-size:0.78rem">${esc(r.CodigoUPC||'—')}</td>
                    <td style="text-align:right">${fmt(cantManf)}</td>
                    <td style="text-align:right">${fmt(cantReg)}</td>
                    <td style="text-align:right;color:${diff<0?'#F87171':diff>0?'#FCD34D':'var(--txt2)'}">${diff>=0?'+':''}${fmt(diff)}</td>
                    <td>${estatusCerradoBadge(r.Estatus)}</td>
                    <td>${avanceCel}</td>
                </tr>`;
            });
        });

        UI.tbodyCerrado.innerHTML = tbody || `<tr><td colspan="11" style="text-align:center;color:var(--txt3);padding:1.5rem">Sin datos</td></tr>`;
    }

    function estatusCerradoBadge(est) {
        if (!est || est === '—') return `<span class="est-badge est-pendiente"><i class="bi bi-clock"></i>Pendiente</span>`;
        const e = String(est).toLowerCase();
        if (e.includes('complet') || e === 'ok' || e === 'si' || e === 'sí')
            return `<span class="est-badge est-completo"><i class="bi bi-check-circle-fill"></i>Completo</span>`;
        if (e.includes('falt') || e.includes('missing'))
            return `<span class="est-badge est-faltante"><i class="bi bi-x-circle-fill"></i>Faltante</span>`;
        if (e.includes('sobrant') || e.includes('adicional'))
            return `<span class="est-badge est-sobrante"><i class="bi bi-plus-circle-fill"></i>Sobrante</span>`;
        return `<span class="est-badge est-pendiente">${esc(est)}</span>`;
    }

    // ── ADMIN LISTS ───────────────────────────────────────────────────────────
    function renderAdminList() {
        if (!State.isAdmin) return;
        if (State.allReportes.length === 0) { UI.manifestsAdminList.innerHTML = '<div class="no-manifests">No hay reportes cargados aún.</div>'; return; }
        UI.manifestsAdminList.innerHTML = State.allReportes.map(rep => {
            const fecha = rep.uploadedAt ? new Date(rep.uploadedAt.toDate()).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—';
            const label = rep.manifestoId?.startsWith('varios') ? 'Varios manifiestos' : rep.manifestoId;
            return `<div class="manifest-item">
                <div><div class="manifest-id">${label}</div><div class="manifest-meta">${rep.fileName}</div></div>
                <div class="manifest-rows">${fmt(rep.rows?.length||0)} filas · ${fecha}</div>
                <button class="btn-delete-manifest" data-id="${rep.id}" data-name="${label}" title="Eliminar"><i class="bi bi-trash3-fill"></i></button>
            </div>`;
        }).join('');
        UI.manifestsAdminList.querySelectorAll('.btn-delete-manifest').forEach(btn => {
            btn.addEventListener('click', () => deleteReporte(btn.dataset.id, btn.dataset.name));
        });
    }

    function renderCerradosAdminList() {
        if (!State.isAdmin) return;
        if (State.allCerrados.length === 0) { UI.cerradosAdminList.innerHTML = '<div class="no-manifests">No hay manifiestos cerrados cargados aún.</div>'; return; }
        UI.cerradosAdminList.innerHTML = State.allCerrados.map(doc => {
            const fecha = doc.uploadedAt ? new Date(doc.uploadedAt.toDate()).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—';
            const label = doc.manifestoId?.startsWith('varios') ? 'Varios manifiestos' : (doc.manifestoId || '—');
            return `<div class="manifest-item">
                <div><div class="manifest-id">${label}</div><div class="manifest-meta">${doc.fileName||'—'}</div></div>
                <div class="manifest-rows">${fmt(doc.rows?.length||0)} filas · ${fecha}</div>
                <button class="btn-delete-manifest" data-id="${doc.id}" data-name="${label}" data-type="cerrado" title="Eliminar"><i class="bi bi-trash3-fill"></i></button>
            </div>`;
        }).join('');
        UI.cerradosAdminList.querySelectorAll('.btn-delete-manifest').forEach(btn => {
            btn.addEventListener('click', () => deleteReporte(btn.dataset.id, btn.dataset.name, btn.dataset.type === 'cerrado'));
        });
    }

    async function deleteReporte(docId, name, isCerrado = false) {
        const confirmed = await Swal.fire({
            title: '¿Eliminar?', html: `Se eliminará <strong>${name}</strong>.`,
            icon: 'warning', showCancelButton: true,
            confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
            confirmButtonColor: '#EF4444', background: '#0e0e1a', color: '#fff'
        });
        if (!confirmed.isConfirmed) return;
        showLoading();
        try {
            const coll = isCerrado ? CERRADO_COLL : COLLECTION;
            await db.collection(coll).doc(docId).delete();
            Swal.fire({ icon:'success', title:'Eliminado', background:'#0e0e1a', color:'#fff', timer:1800, showConfirmButton:false });
            if (isCerrado) await loadCerrados();
            else await loadReportes();
        } catch (e) {
            hideLoading();
            Swal.fire({ icon:'error', title:'Error', text:'No se pudo eliminar.', background:'#0e0e1a', color:'#fff' });
        }
    }

    // ── UPLOAD AVANCE ─────────────────────────────────────────────────────────
    if (UI.btnUploadOpen) UI.btnUploadOpen.addEventListener('click', () => { resetUploadModal(); State.uploadModal.show(); });

    function resetUploadModal() {
        State.parsedFile = null;
        UI.fileInput.value = '';
        UI.filePreview.style.display = 'none';
        UI.uploadError.style.display = 'none';
        UI.btnConfirmUpload.disabled = true;
        UI.dropZone.style.display = 'flex';
        UI.dropZone.classList.remove('drag-over');
    }

    UI.fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    UI.dropZone.addEventListener('dragover',  e => { e.preventDefault(); UI.dropZone.classList.add('drag-over'); });
    UI.dropZone.addEventListener('dragleave', () => UI.dropZone.classList.remove('drag-over'));
    UI.dropZone.addEventListener('drop', e => {
        e.preventDefault(); UI.dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    function handleFile(file) {
        showUploadError('');
        UI.btnConfirmUpload.disabled = true;
        UI.filePreview.style.display = 'none';
        if (!file.name.match(/\.(xlsx|xls)$/i)) { showUploadError('El archivo debe ser .xlsx o .xls'); return; }

        const reader = new FileReader();
        reader.onload = e => {
            try {
                const wb   = XLSX.read(e.target.result, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                if (json.length === 0) { showUploadError('El archivo está vacío.'); return; }

                const normalized = json.map(row => { const o={}; Object.keys(row).forEach(k=>{o[k.trim().toLowerCase()]=row[k];}); return o; });
                const missing = REQUIRED_AVANCE.filter(c => !(c in normalized[0]));
                if (missing.length > 0) { showUploadError(`Columnas faltantes: ${missing.join(', ')}`); return; }

                let rows = normalized.map(r => ({
                    Contenedor: String(r.contenedor||'').trim(),
                    Piezas:     toNum(r.piezas),
                    Faltantes:  toNum(r.faltantes),
                    Sobrante:   toNum(r.sobrante),
                    Seccion:    String(r.seccion||'').trim(),
                    Jefatura:   String(r.jefatura||'').trim(),
                    Manifiesto: String(r.manifiesto||'').trim(),
                }));
                rows = enrichWithMasterData(rows);

                const manifiestos = [...new Set(rows.map(r => r.Manifiesto))];
                const isMultiple  = manifiestos.length > 1;
                const invalidM    = manifiestos.find(m => !/^\d{10}$/.test(m));
                if (invalidM) { showUploadError(`"Manifiesto" debe tener 10 dígitos. Se encontró: "${invalidM}"`); return; }

                const today    = new Date().toISOString().split('T')[0];
                const savedName = isMultiple ? `varios_${today}.xlsx` : `${manifiestos[0]}_${today}.xlsx`;
                const jefaturas = [...new Set(rows.map(r=>r.Jefatura).filter(j=>j&&j!=='—'))];
                const secciones = [...new Set(rows.map(r=>r.Seccion))];

                State.parsedFile = { file, rows, manifiestos, isMultiple, savedName };

                $('prev-manifest-id').textContent = isMultiple ? `${manifiestos.length} manifiestos` : manifiestos[0];
                $('prev-multi-tag').style.display = isMultiple ? 'inline-flex' : 'none';
                const multiRow = $('prev-manifests-row');
                if (multiRow) { multiRow.style.display = isMultiple?'flex':'none'; $('prev-manifests-list').textContent = manifiestos.join(', '); }
                $('prev-filename').textContent  = file.name;
                $('prev-rows').textContent      = fmt(rows.length);
                $('prev-jefaturas').textContent = jefaturas.length > 0 ? jefaturas.join(', ') : '(desde Datos Maestros)';
                $('prev-secciones').textContent = secciones.join(', ');
                UI.filePreview.style.display = 'block';
                UI.btnConfirmUpload.disabled = false;
            } catch (err) { console.error(err); showUploadError('No se pudo leer el archivo.'); }
        };
        reader.readAsArrayBuffer(file);
    }

    UI.btnConfirmUpload.addEventListener('click', uploadReporte);

    async function uploadReporte() {
        if (!State.parsedFile) return;
        const { file, rows, manifiestos, isMultiple, savedName } = State.parsedFile;
        UI.btnConfirmUpload.disabled = true;
        UI.btnConfirmUpload.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Subiendo...';
        try {
            await storage.ref(`${STORAGE_PATH}${savedName}`).put(file);
            for (const manifestoId of (isMultiple ? manifiestos : [manifiestos[0]])) {
                const manifestRows = isMultiple ? rows.filter(r=>r.Manifiesto===manifestoId) : rows;
                // Usar estado local para saber si ya existe (evita query)
                const localExisting = State.allReportes.filter(r => r.manifestoId === manifestoId);
                if (localExisting.length > 0) {
                    const batch = db.batch();
                    localExisting.forEach(r => batch.delete(db.collection(COLLECTION).doc(r.id)));
                    await batch.commit();
                } else {
                    // Fallback: verificar en Firestore solo si no está en estado local
                    const existing = await db.collection(COLLECTION).where('manifestoId','==',manifestoId).get();
                    if (existing.docs.length > 0) {
                        const batch = db.batch();
                        existing.docs.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                    }
                }
                await db.collection(COLLECTION).add({ manifestoId, fileName: savedName, uploadedBy: State.currentUser.uid, uploadedByEmail: State.currentUser.email, uploadedAt: firebase.firestore.FieldValue.serverTimestamp(), rows: manifestRows });
            }
            State.uploadModal.hide();
            Swal.fire({ icon:'success', title:'¡Listo!', text: isMultiple ? `${manifiestos.length} manifiestos cargados.` : `Manifiesto ${manifiestos[0]} cargado.`, background:'#0e0e1a', color:'#fff', timer:2300, showConfirmButton:false });
            await loadReportes();
        } catch (err) {
            console.error(err); showUploadError('Error al subir. Intenta de nuevo.');
        } finally {
            UI.btnConfirmUpload.disabled = false;
            UI.btnConfirmUpload.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Subir';
        }
    }

    // ── UPLOAD MANIFIESTO CERRADO ─────────────────────────────────────────────
    if (UI.btnCerradoOpen) UI.btnCerradoOpen.addEventListener('click', () => { resetCerradoModal(); State.cerradoModal.show(); });

    function resetCerradoModal() {
        State.parsedCerrado = null;
        if (UI.cerradoFileInput) UI.cerradoFileInput.value = '';
        if (UI.cerradoPreview) UI.cerradoPreview.style.display = 'none';
        if (UI.cerradoError)   UI.cerradoError.style.display = 'none';
        if (UI.btnConfirmCerrado) UI.btnConfirmCerrado.disabled = true;
        if (UI.cerradoDropZone) { UI.cerradoDropZone.style.display = 'flex'; UI.cerradoDropZone.classList.remove('drag-over'); }
    }

    if (UI.cerradoFileInput) UI.cerradoFileInput.addEventListener('change', e => { if (e.target.files[0]) handleCerradoFile(e.target.files[0]); });
    if (UI.cerradoDropZone) {
        UI.cerradoDropZone.addEventListener('dragover',  e => { e.preventDefault(); UI.cerradoDropZone.classList.add('drag-over'); });
        UI.cerradoDropZone.addEventListener('dragleave', () => UI.cerradoDropZone.classList.remove('drag-over'));
        UI.cerradoDropZone.addEventListener('drop', e => {
            e.preventDefault(); UI.cerradoDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleCerradoFile(e.dataTransfer.files[0]);
        });
    }

    function handleCerradoFile(file) {
        if (UI.cerradoError) UI.cerradoError.style.display = 'none';
        if (UI.btnConfirmCerrado) UI.btnConfirmCerrado.disabled = true;
        if (UI.cerradoPreview) UI.cerradoPreview.style.display = 'none';
        if (!file.name.match(/\.(xlsx|xls)$/i)) { showCerradoError('El archivo debe ser .xlsx o .xls'); return; }

        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb   = XLSX.read(evt.target.result, { type: 'array' });
                const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
                if (json.length === 0) { showCerradoError('El archivo está vacío.'); return; }

                // Normalize: lowercase, remove spaces, remove accents
                const nk = k => k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s.]/g,'');
                const normalized = json.map(row => { const o={}; Object.keys(row).forEach(k=>{o[nk(k)]=row[k];}); return o; });

                const missing = REQUIRED_CERRADO.filter(c => !(c in normalized[0]));
                if (missing.length > 0) { showCerradoError(`Columnas faltantes: ${missing.join(', ')}`); return; }

                // Map to standard shape — calcular estatus desde diferencia
                let rows = normalized.map(r => {
                    const cantManf = toNum(r.cantmanf);
                    const cantReg  = toNum(r.cantregistr);
                    const diff     = toNum(r.diferencia || (cantReg - cantManf));
                    // Estatus calculado
                    let estatus;
                    const rawEst = String(r.status || r.estatus || '').trim();
                    if (rawEst) {
                        estatus = rawEst;
                    } else {
                        if (cantReg === 0 && cantManf > 0) estatus = 'Faltante';
                        else if (cantReg === cantManf)      estatus = 'Completo';
                        else if (cantReg < cantManf)        estatus = 'Faltante';
                        else                                estatus = 'Sobrante';
                    }
                    return {
                        NoTienda:        String(r.notienda   || '').trim(),
                        Manifiesto:      String(r.manifiesto || '').trim(),
                        Seccion:         String(r.seccion    || '').trim(),
                        Articulo:        String(r.articulo   || '').trim(),
                        CodigoUPC:       String(r.codigoupc  || '').trim(),
                        DescArticulo:    String(r.descripcionarticulo || r.descarticulo || '').trim(),
                        Contenedor:      String(r.contenedor || '').trim(),
                        CantManf:        cantManf,
                        CantRegistr:     cantReg,
                        Diferencia:      diff,
                        Estatus:         estatus,
                        FechaMan:        String(r.fechaman   || r.fechamanifiesto || '').trim(),
                        NoOrigen:        String(r.noorigen   || '').trim(),
                        Jefatura:        String(r.jefatura   || '').trim(),
                    };
                });

                // Enrich from master data
                rows = enrichWithMasterData(rows);

                const manifiestos  = [...new Set(rows.map(r=>r.Manifiesto).filter(Boolean))];
                const isMultiple   = manifiestos.length > 1;
                const contenedores = [...new Set(rows.map(r=>r.Contenedor))];
                const completos    = rows.filter(r=>r.Estatus==='Completo').length;
                const faltantes    = rows.filter(r=>r.Estatus==='Faltante').length;
                const sobrantes    = rows.filter(r=>r.Estatus==='Sobrante').length;

                const today     = new Date().toISOString().split('T')[0];
                const savedName = isMultiple ? `cerrado_varios_${today}.xlsx` : `cerrado_${manifiestos[0]}_${today}.xlsx`;

                State.parsedCerrado = { file, rows, manifiestos, isMultiple, savedName };

                if (UI.cerradoPrevManif) UI.cerradoPrevManif.textContent = isMultiple ? `${manifiestos.length} manifiestos` : manifiestos[0];
                if (UI.cerradoPrevFile)  UI.cerradoPrevFile.textContent  = file.name;
                if (UI.cerradoPrevRows)  UI.cerradoPrevRows.textContent  = fmt(rows.length) + ' filas';
                if (UI.cerradoPrevCont)  UI.cerradoPrevCont.textContent  = contenedores.length + ' contenedores';
                if (UI.cerradoPrevEst)   UI.cerradoPrevEst.textContent   = `${completos} completos · ${faltantes} faltantes · ${sobrantes} sobrantes`;
                if (UI.cerradoPreview)   UI.cerradoPreview.style.display  = 'block';
                if (UI.btnConfirmCerrado) UI.btnConfirmCerrado.disabled   = false;
            } catch (err) { console.error(err); showCerradoError('No se pudo leer el archivo.'); }
        };
        reader.readAsArrayBuffer(file);
    }

    if (UI.btnConfirmCerrado) UI.btnConfirmCerrado.addEventListener('click', uploadCerrado);

    async function uploadCerrado() {
        if (!State.parsedCerrado) return;
        const { file, rows, manifiestos, isMultiple, savedName } = State.parsedCerrado;
        UI.btnConfirmCerrado.disabled = true;
        UI.btnConfirmCerrado.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Subiendo...';
        try {
            await storage.ref(`${STORAGE_CERRADO}${savedName}`).put(file);
            for (const manifestoId of (isMultiple ? manifiestos : [manifiestos[0]])) {
                const manifestRows = isMultiple ? rows.filter(r=>r.Manifiesto===manifestoId) : rows;
                // Usar estado local para saber si ya existe (evita query)
                const localExisting = State.allCerrados.filter(r => r.manifestoId === manifestoId);
                if (localExisting.length > 0) {
                    const batch = db.batch();
                    localExisting.forEach(r => batch.delete(db.collection(CERRADO_COLL).doc(r.id)));
                    await batch.commit();
                } else {
                    const existing = await db.collection(CERRADO_COLL).where('manifestoId','==',manifestoId).get();
                    if (existing.docs.length > 0) {
                        const batch = db.batch();
                        existing.docs.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                    }
                }
                await db.collection(CERRADO_COLL).add({ manifestoId, fileName: savedName, uploadedBy: State.currentUser.uid, uploadedByEmail: State.currentUser.email, uploadedAt: firebase.firestore.FieldValue.serverTimestamp(), rows: manifestRows });
            }
            State.cerradoModal.hide();
            Swal.fire({ icon:'success', title:'¡Listo!', text: isMultiple ? `${manifiestos.length} manifiestos cerrados cargados.` : `Manifiesto cerrado ${manifiestos[0]} cargado.`, background:'#0e0e1a', color:'#fff', timer:2300, showConfirmButton:false });
            await loadCerrados();
        } catch (err) {
            console.error(err); showCerradoError('Error al subir. Intenta de nuevo.');
        } finally {
            UI.btnConfirmCerrado.disabled = false;
            UI.btnConfirmCerrado.innerHTML = '<i class="bi bi-archive-fill"></i> Subir Cerrado';
        }
    }

    function showCerradoError(msg) {
        if (!UI.cerradoError) return;
        if (UI.cerradoErrorMsg) UI.cerradoErrorMsg.textContent = msg;
        UI.cerradoError.style.display = 'block';
    }

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function showLoading()  { UI.loading.style.display = 'flex'; }
    function hideLoading()  { UI.loading.style.display = 'none'; }

    function showUploadError(msg) {
        if (!msg) { UI.uploadError.style.display = 'none'; return; }
        UI.uploadErrorMsg.textContent = msg;
        UI.uploadError.style.display = 'block';
    }

    function toNum(v) { const n = parseFloat(String(v).replace(/,/g,'')); return isNaN(n) ? 0 : n; }
    function fmt(n)   { return Number(n).toLocaleString('es-MX'); }
    function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function pctBadge(pct) {
        const cls = pct >= 95 ? 'good' : pct >= 85 ? 'warn' : 'bad';
        return `<span class="badge-pct ${cls}">${pct.toFixed(1)}%</span>`;
    }

    function groupBy(arr, key) {
        return arr.reduce((acc, item) => {
            const k = item[key] || 'Sin ' + key;
            if (!acc[k]) acc[k] = [];
            acc[k].push(item);
            return acc;
        }, {});
    }

    function generateColors(n) {
        const palette = ['rgba(230,0,126,0.75)','rgba(37,99,235,0.75)','rgba(16,185,129,0.75)','rgba(245,158,11,0.75)','rgba(124,58,237,0.75)','rgba(6,182,212,0.75)','rgba(239,68,68,0.75)','rgba(0,150,136,0.75)','rgba(249,115,22,0.75)','rgba(99,102,241,0.75)'];
        return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
    }

});
