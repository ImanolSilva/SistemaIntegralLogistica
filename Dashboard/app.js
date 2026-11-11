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

    // Caché offline: lecturas repetidas sirven desde disco local
    db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

    // ── CONSTANTES ───────────────────────────────────────────────────────────
    const COLLECTION   = "reportesDashboard";
    const DATOS_COLL   = "datosMaestros";
    const DATOS_DOC    = "secciones";
    const COMPLEMENTO_JEFATURA = "../Complementos/Jefatura.json";
    const STORAGE_PATH = "Dashboard/";

    const META = 95;          // meta de exactitud
    const WARN = 85;          // umbral de atención
    const NO_AREA = 'Sin área asignada';
    const PAGE_SIZE = 20;

    const RESULT_ALIASES = {
        contenedor:  ['contenedor','container','caja','folio'],
        piezas:      ['piezas','articulos','artículos','cantidad','unidades','manifestados','cantmanf','cant_manf'],
        faltantes:   ['faltantes','faltante','faltan','diferenciafaltante','faltanpiezas'],
        sobrante:    ['sobrante','sobrantes','exceso','mercanciademas','mercancia de mas','demas'],
        registradas: ['cant. registrada','cant registrada','cantidad registrada','registrada','recibidas','recibido'],
        diferencia:  ['diferencia','diferencias','diferencia piezas'],
        estado:      ['status','estado','estatus','resultado'],
        adicional:   ['adicional','adicionales','pieza adicional','piezas adicionales'],
        seccion:     ['seccion','sección','secciones','area','área'],
        jefatura:    ['jefatura','jefe','jefes','responsable','gerente'],
        manifiesto:  ['manifiesto','manifesto','folio manifiesto','reporte'],
        articulo:    ['articulo','artículo','sku','codigo','código','codigoarticulo'],
        descripcion: ['descripcion','descripción','descripcionarticulo','descarticulo','desc articulo'],
    };

    RESULT_ALIASES.piezas.push('Cant. Manf.', 'Cant Manf', 'Cantidad Manifestada');
    const C = { ok:'#0E9F6E', warn:'#D97706', bad:'#DC2626', rosa:'#E6007E', vino:'#8E1A5B', violeta:'#7C3AED', txt:'#2B2027', txt2:'#6D5B66', txt3:'#9B8994', grid:'rgba(91,35,69,0.07)' };
    const ESTADOS = {
        ok:    { label:'Sin diferencia', desc:'Llegó exactamente lo manifestado', color:C.ok,      icon:'bi-check-circle-fill' },
        falt:  { label:'Con faltantes',  desc:'Faltaron piezas, sin sobrantes',   color:C.bad,     icon:'bi-dash-circle-fill' },
        sobr:  { label:'Con sobrantes',  desc:'Sobraron piezas, sin faltantes',   color:C.warn,    icon:'bi-plus-circle-fill' },
        mixto: { label:'Mixto',          desc:'Tiene faltantes y sobrantes',      color:C.violeta, icon:'bi-shuffle' },
    };

    // ── ESTADO ───────────────────────────────────────────────────────────────
    const State = {
        currentUser: null,
        isAdmin: false,
        allReportes: [],
        allRows: [],
        filteredRows: [],
        masterMap: {},
        masterInfo: null,
        manifestInfo: {},
        parsedFile: null,
        parsedDatos: null,
        charts: {},
        cont: { search: '', status: '', sortKey: 'ft', sortDir: 'desc', page: 1 },
        sec:  { sortKey: 'ft', sortDir: 'desc' },
        uploadModal: null,
        datosModal: null,
    };

    // ── DOM ──────────────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const UI = {
        loading:          $('globalLoading'),
        authGuard:        $('auth-guard'),
        dashboardContent: $('dashboard-content'),
        adminPanel:       $('admin-panel'),
        datosStatus:      $('datos-status'),
        adminList:        $('manifests-admin-list'),
        filterManifiesto: $('filter-manifiesto'),
        filterJefatura:   $('filter-jefatura'),
        filterSeccion:    $('filter-seccion'),
        noDataState:      $('no-data-state'),
        dataContent:      $('data-content'),
        // upload
        dropZone:         $('drop-zone'),
        fileInput:        $('file-input'),
        filePreview:      $('filePreview'),
        btnConfirmUpload: $('btn-confirm-upload'),
        uploadError:      $('upload-error'),
        uploadErrorMsg:   $('upload-error-msg'),
        // datos maestros
        datosDropZone:    $('datos-drop-zone'),
        datosFileInput:   $('datos-file-input'),
        datosPreview:     $('datos-preview'),
        datosError:       $('datos-error'),
        datosErrorMsg:    $('datos-error-msg'),
        btnDatosConfirm:  $('btn-datos-confirm'),
    };

    if ($('uploadModal')) State.uploadModal = new bootstrap.Modal($('uploadModal'));
    if ($('datosModal'))  State.datosModal  = new bootstrap.Modal($('datosModal'));
    const jefeFilterLabel = document.querySelector('label[for="filter-jefatura"]');
    if (jefeFilterLabel) jefeFilterLabel.innerHTML = '<i class="bi bi-person-badge"></i> Jefatura';

    if (window.Chart) {
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.color = C.txt2;
    }

    // ── AUTH ─────────────────────────────────────────────────────────────────
    auth.onAuthStateChanged(async user => {
        if (!user) { hideLoading(); UI.authGuard.style.display = 'block'; return; }
        State.currentUser = user;
        State.isAdmin = await window.isSystemAdmin(user, db);
        UI.dashboardContent.style.display = 'block';
        if (State.isAdmin) UI.adminPanel.style.display = 'block';
        const adminTabNav = $('adminTab');
        if (adminTabNav && State.isAdmin) adminTabNav.style.display = 'flex';

        if ($('header-user')) $('header-user').style.display = 'flex';
        if ($('user-email-label')) $('user-email-label').textContent = user.email || '';
        if ($('user-avatar')) $('user-avatar').textContent = (user.email || 'U')[0].toUpperCase();

        const hour  = new Date().getHours();
        const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
        const name  = user.displayName || user.email?.split('@')[0] || 'usuario';
        $('welcome-greeting').textContent = `${greet}, ${name}`;

        await loadMasterData();
        await loadReportes();
    });

    $('logout-btn').addEventListener('click', () => {
        auth.signOut().then(() => { window.location.href = '../Login/login.html'; });
    });

    // ── PANEL ADMIN ──────────────────────────────────────────────────────────
    $('admin-panel-toggle').addEventListener('click', () => {
        const body = $('admin-panel-body');
        const open = body.style.display === 'none';
        body.style.display = open ? 'block' : 'none';
        $('admin-chevron').classList.toggle('open', open);
    });

    function updateAdminSummary() {
        const filas = State.allReportes.reduce((s, r) => s + (r.rows?.length || 0), 0);
        const secs  = Object.keys(State.masterMap).length;
        $('admin-summary').textContent = `${State.allReportes.length} reportes · ${fmt(filas)} filas · ${secs ? secs + ' secciones maestras' : 'Datos maestros sin cargar'}`;
        $('tab-count-avance').textContent = State.allReportes.length;
    }

    // ── DATOS MAESTROS ───────────────────────────────────────────────────────
    async function loadMasterData() {
        try {
            await loadJefaturaComplemento();
            const doc = await db.collection(DATOS_COLL).doc(DATOS_DOC).get();
            if (doc.exists && doc.data().sections) {
                State.masterMap = mergeMasterMaps(State.masterMap, fixDeep(doc.data().sections));
                const fecha = toDate(doc.data().uploadedAt);
                setDatosStatus(Object.keys(State.masterMap).length, fecha ? fmtDate(fecha) : '—');
            } else {
                UI.datosStatus.textContent = 'Sin cargar — las secciones no tendrán área asignada';
            }
        } catch (e) { console.error('Error cargando datos maestros:', e); }
    }

    async function loadJefaturaComplemento() {
        try {
            const response = await fetch(COMPLEMENTO_JEFATURA, { cache: 'no-store' });
            if (!response.ok) return;
            const source = fixDeep(await response.json());
            const sections = {};
            (source.jefes || []).forEach(jefe => (jefe.secciones || []).forEach(sec => {
                const key = String(sec.seccion ?? '').trim();
                if (key) sections[key] = { Descripcion: sec.departamento || '', Jefatura: jefe.jefe || 'Sin jefatura', Gerente: sec.gerencia || '', Asistente: sec.asistente || '', Bodega: '' };
            }));
            if (Object.keys(sections).length) State.masterMap = mergeMasterMaps(State.masterMap, sections);
        } catch (error) { console.warn('No se pudo cargar Complementos/Jefatura.json', error); }
    }

    function mergeMasterMaps(base, incoming) {
        const result = { ...(base || {}) };
        Object.entries(incoming || {}).forEach(([key, value]) => {
            const current = result[key] || {};
            const clean = Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== ''));
            result[key] = { ...current, ...clean };
        });
        return result;
    }

    function setDatosStatus(count, when) {
        UI.datosStatus.innerHTML = `<span style="color:${C.ok};font-weight:700">✓ ${count} secciones</span> · actualizado ${esc(when)}`;
    }

    function normKey(s) {
        return String(s).trim().replace(/^0+(?=\d)/, '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function buildNormMap() {
        const map = {};
        Object.keys(State.masterMap).forEach(k => { map[normKey(k)] = State.masterMap[k]; });
        return map;
    }

    function enrichWithMasterData(rows) {
        const normMap = buildNormMap();
        return rows.map(r => {
            const seccion = String(r.Seccion || '').trim();
            const master  = State.masterMap[seccion] || normMap[normKey(seccion)];
            const enriched = {
                ...r,
                Jefatura:       master?.Jefatura    || r.Jefatura       || '—',
                DescripcionSec: master?.Descripcion || r.DescripcionSec || '',
                Gerente:        master?.Gerente     || r.Gerente        || '',
                Asistente:      master?.Asistente   || r.Asistente      || '',
                Bodega:         master?.Bodega      || r.Bodega         || '',
            };
            enriched.Area = areaOf(enriched.Jefatura);
            return enriched;
        });
    }

    function areaOf(j) {
        const v = String(j || '').trim();
        if (!v || v === '—' || normKey(v) === 'sin jefatura') return NO_AREA;
        return v;
    }

    function pickColumn(row, aliases) {
        const clean = s => normKey(s).replace(/\s+/g, '');
        const keys = Object.keys(row);
        const key = keys.find(k => aliases.some(a => clean(k) === clean(a)));
        return key ? row[key] : '';
    }

    function normalizeResultRow(row) {
        const get = key => pickColumn(row, RESULT_ALIASES[key]);
        const piezas = toNum(get('piezas'));
        const registradas = toNum(get('registradas'));
        const rawDifference = get('diferencia');
        const diferencia = rawDifference === '' || rawDifference == null ? registradas - piezas : toNum(rawDifference);
        const rawEstado = String(get('estado') || '').trim().toLowerCase();
        const adicional = toNum(get('adicional')) || (rawEstado.includes('adicional') || (piezas === 0 && registradas > 0) ? Math.max(registradas, diferencia, 0) : 0);
        const concepto = rawEstado.includes('adicional') || adicional > 0 ? 'adicional' : rawEstado.includes('faltante') ? 'faltante' : rawEstado.includes('sobrante') ? 'sobrante' : rawEstado.includes('correcto') ? 'correcto' : diferencia < 0 ? 'faltante' : diferencia > 0 ? 'sobrante' : 'correcto';
        return {
            Contenedor:  String(get('contenedor') || 'General').trim(),
            Piezas:      piezas,
            Registradas: registradas,
            Diferencia:  diferencia,
            Faltantes:   toNum(get('faltantes')) || Math.max(-diferencia, 0),
            Sobrante:    toNum(get('sobrante')) || Math.max(diferencia, 0),
            Adicional:   adicional,
            Correcto:    concepto === 'correcto' ? piezas : 0,
            Concepto:    concepto,
            Seccion:     String(get('seccion') || 'Sin sección').trim(),
            Jefatura:    String(get('jefatura') || 'Sin jefatura').trim(),
            Manifiesto:  String(get('manifiesto') || 'GENERAL').trim(),
            Articulo:    String(get('articulo') || '').trim(),
            Descripcion: String(get('descripcion') || '').trim(),
        };
    }

    $('btn-datos-upload').addEventListener('click', () => { resetDatosModal(); State.datosModal.show(); });

    function resetDatosModal() {
        State.parsedDatos = null;
        UI.datosFileInput.value = '';
        UI.datosPreview.style.display = 'none';
        UI.datosError.style.display = 'none';
        UI.btnDatosConfirm.disabled = true;
        UI.datosDropZone.classList.remove('drag-over');
    }

    bindDropZone(UI.datosDropZone, UI.datosFileInput, handleDatosFile);

    function handleDatosFile(file) {
        UI.datosError.style.display = 'none';
        UI.btnDatosConfirm.disabled = true;
        UI.datosPreview.style.display = 'none';
        if (!/\.(xlsx|xls)$/i.test(file.name)) { showDatosError('El archivo debe ser .xlsx o .xls'); return; }

        readWorkbook(file, json => {
            if (json.length === 0) { showDatosError('El archivo está vacío.'); return; }
            const nk = k => k.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
            const normalized = json.map(row => { const o = {}; Object.keys(row).forEach(k => { o[nk(k)] = row[k]; }); return o; });
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
            $('datos-prev-count').textContent = Object.keys(sections).length + ' secciones';
            $('datos-prev-file').textContent  = file.name;
            UI.datosPreview.style.display = 'block';
            UI.btnDatosConfirm.disabled = false;
        }, () => showDatosError('No se pudo leer el archivo.'));
    }

    UI.btnDatosConfirm.addEventListener('click', async () => {
        if (!State.parsedDatos) return;
        const { sections } = State.parsedDatos;
        UI.btnDatosConfirm.disabled = true;
        UI.btnDatosConfirm.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';
        try {
            await db.collection(DATOS_COLL).doc(DATOS_DOC).set({ sections, uploadedAt: firebase.firestore.FieldValue.serverTimestamp(), uploadedBy: State.currentUser.uid });
            State.masterMap = sections;
            setDatosStatus(Object.keys(sections).length, 'ahora mismo');
            State.datosModal.hide();
            // Re-enriquecer lo ya cargado para reflejar las nuevas áreas
            State.allRows = enrichWithMasterData(State.allReportes.flatMap(r => r.rows || []));
            updateAdminSummary();
            applyFilters();
            Swal.fire({ icon: 'success', title: '¡Listo!', text: `${Object.keys(sections).length} secciones cargadas.`, timer: 2300, showConfirmButton: false });
        } catch (err) { console.error(err); showDatosError('Error al guardar.'); }
        finally { UI.btnDatosConfirm.disabled = false; UI.btnDatosConfirm.innerHTML = '<i class="bi bi-database-fill-up"></i> Guardar'; }
    });

    function showDatosError(msg) {
        UI.datosErrorMsg.textContent = msg;
        UI.datosError.style.display = 'block';
    }

    // ── CARGA DE REPORTES ────────────────────────────────────────────────────
    async function loadReportes() {
        showLoading();
        try {
            // Sin orderBy: los registros sin uploadedAt también deben aparecer.
            const snap = await db.collection(COLLECTION).get();
            State.allReportes = snap.docs.map(d => { const data = d.data(); return { id: d.id, ...data, rows: fixDeep(data.rows || []) }; });
            State.allReportes.sort((a, b) => (toDate(b.uploadedAt)?.getTime() || 0) - (toDate(a.uploadedAt)?.getTime() || 0));

            State.manifestInfo = {};
            State.allReportes.forEach(r => {
                const d = toDate(r.uploadedAt);
                (r.rows || []).forEach(row => {
                    const m = String(row.Manifiesto || r.manifestoId || '');
                    const prev = State.manifestInfo[m];
                    if (!prev || (d && (!prev.date || d > prev.date))) State.manifestInfo[m] = { date: d, by: r.uploadedByEmail || '', file: r.fileName || '' };
                });
            });

            State.allRows = enrichWithMasterData(State.allReportes.flatMap(r => r.rows || []));
            renderAdminList();
            updateAdminSummary();
            applyFilters();
        } catch (e) {
            console.error(e);
            UI.noDataState.style.display = 'block';
            UI.dataContent.style.display = 'none';
            UI.noDataState.querySelector('p').innerHTML = `No se pudieron leer los resultados.<br><small>${esc(e.code || e.message || 'Revisa Firebase y vuelve a intentar.')}</small>`;
            Swal.fire({ icon: 'error', title: 'No se pudieron cargar los resultados', text: e.code || e.message || 'Revisa Firebase y vuelve a intentar.' });
        } finally { hideLoading(); }
    }

    // ── FILTROS ──────────────────────────────────────────────────────────────
    function fillSelect(el, items, placeholder) {
        const current = el.value;
        el.innerHTML = `<option value="">${placeholder}</option>` +
            items.map(it => `<option value="${esc(it.value)}">${esc(it.label)}</option>`).join('');
        el.value = items.some(it => it.value === current) ? current : '';
        el.classList.toggle('is-set', !!el.value);
    }

    function refreshFilterOptions() {
        const manifs = uniq(State.allRows.map(r => r.Manifiesto)).sort((a, b) => manifDate(b) - manifDate(a) || a.localeCompare(b));
        fillSelect(UI.filterManifiesto, manifs.map(m => ({ value: m, label: manifLabel(m) })), 'Todos los reportes');

        const fM = UI.filterManifiesto.value;
        const rowsM = State.allRows.filter(r => !fM || r.Manifiesto === fM);
        const areas = uniq(rowsM.map(r => r.Area)).sort(areaSort);
        fillSelect(UI.filterJefatura, areas.map(a => ({ value: a, label: a })), 'Todas las áreas');

        const fJ = UI.filterJefatura.value;
        const rowsMJ = rowsM.filter(r => !fJ || r.Area === fJ);
        const secMap = {};
        rowsMJ.forEach(r => { if (!secMap[r.Seccion]) secMap[r.Seccion] = r.DescripcionSec; });
        const secs = Object.keys(secMap).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
        fillSelect(UI.filterSeccion, secs.map(s => ({ value: s, label: secMap[s] && secMap[s] !== s ? `${s} · ${secMap[s]}` : s })), 'Todas las secciones');
    }

    function applyFilters() {
        refreshFilterOptions();
        const fM = UI.filterManifiesto.value, fJ = UI.filterJefatura.value, fS = UI.filterSeccion.value;
        State.filteredRows = State.allRows.filter(r =>
            (!fM || r.Manifiesto === fM) && (!fJ || r.Area === fJ) && (!fS || r.Seccion === fS));
        State.cont.page = 1;
        renderActiveFilters();

        if (State.allRows.length === 0) {
            UI.noDataState.style.display = 'block';
            UI.dataContent.style.display = 'none';
            renderHero();
            return;
        }
        UI.noDataState.style.display = 'none';
        UI.dataContent.style.display = 'block';
        renderAll();
    }

    [UI.filterManifiesto, UI.filterJefatura, UI.filterSeccion].forEach(el => el.addEventListener('change', applyFilters));
    $('btn-reset-filters').addEventListener('click', () => {
        UI.filterManifiesto.value = ''; UI.filterJefatura.value = ''; UI.filterSeccion.value = '';
        applyFilters();
    });

    function setFilter(el, value) {
        el.value = el.value === value ? '' : value;
        applyFilters();
    }

    function renderActiveFilters() {
        const box = $('filter-active');
        const pills = [
            [UI.filterManifiesto, 'Reporte'],
            [UI.filterJefatura, 'Área'],
            [UI.filterSeccion, 'Sección'],
        ].filter(([el]) => el.value).map(([el, lbl], i) =>
            `<span class="db-filter-pill">${lbl}: ${esc(el.options[el.selectedIndex]?.text || el.value)} <button type="button" data-clear="${i}" aria-label="Quitar filtro">✕</button></span>`);
        box.innerHTML = pills.length ? `<span>Filtros activos:</span>${pills.join('')}` : '';
        box.classList.toggle('show', pills.length > 0);
        box.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
            [UI.filterManifiesto, UI.filterJefatura, UI.filterSeccion][+b.dataset.clear].value = '';
            applyFilters();
        }));
    }

    // ── RENDER GENERAL ───────────────────────────────────────────────────────
    function renderAll() {
        const rows = State.filteredRows;
        const tot  = agg(rows);
        const conts = buildContenedores(rows);
        renderHero(tot, conts);
        renderKPIs(tot, conts);
        renderInsights(rows, tot, conts);
        renderSemaforo(tot);
        renderChartJefatura(rows);
        renderChartEstado(conts);
        renderChartDiferencias(rows);
        renderChartSecciones(rows, tot);
        renderChartTendencia(rows);
        renderAreaCards();
        renderTablaSecciones(rows, tot);
        renderTablaContenedores(conts);
        renderArticulos(rows);
    }

    // ── HERO ─────────────────────────────────────────────────────────────────
    function renderHero(tot, conts) {
        const rows = State.filteredRows;
        tot = tot || agg(rows);
        const manifs = uniq(rows.map(r => r.Manifiesto));
        animateNumber($('wb-manifiestos'), manifs.length);
        animateNumber($('wb-jefaturas'), uniq(rows.map(r => r.Area).filter(a => a !== NO_AREA)).length);
        animateNumber($('wb-secciones'), uniq(rows.map(r => r.Seccion)).length);
        animateNumber($('wb-contenedores'), conts ? conts.length : 0);

        const parts = [];
        if (UI.filterManifiesto.value) parts.push(`reporte <strong>${esc(manifLabel(UI.filterManifiesto.value))}</strong>`);
        if (UI.filterJefatura.value)   parts.push(`área <strong>${esc(UI.filterJefatura.value)}</strong>`);
        if (UI.filterSeccion.value)    parts.push(`sección <strong>${esc(UI.filterSeccion.value)}</strong>`);
        const scope = parts.length ? `Viendo ${parts.join(' · ')}.` : 'Viendo <strong>todos los reportes</strong> cargados.';
        $('hero-scope').innerHTML = rows.length
            ? `${scope} Se manifestaron <strong>${fmt(tot.pz)}</strong> piezas: faltan <strong>${fmt(tot.ft)}</strong> y sobran <strong>${fmt(tot.sb)}</strong>.`
            : 'Todavía no hay resultados para mostrar.';

        const last = State.allReportes.find(r => toDate(r.uploadedAt));
        $('wb-fecha').textContent = last
            ? `Última carga: ${fmtDateTime(toDate(last.uploadedAt))}${last.uploadedByEmail ? ' · por ' + last.uploadedByEmail : ''}`
            : (State.allReportes.length ? 'Fecha de carga no disponible' : 'Sin cargas registradas');

        const pct = tot.pct ?? 0;
        const tone = toneOf(tot.pct);
        const circ = 2 * Math.PI * 50;
        const fill = $('gauge-fill');
        fill.style.strokeDashoffset = circ * (1 - Math.min(pct, 100) / 100);
        fill.style.stroke = tone === 'good' ? '#6EE7B7' : tone === 'warn' ? '#FCD34D' : tone === 'bad' ? '#FCA5A5' : '#fff';
        $('gauge-meta').setAttribute('transform', `rotate(${META * 3.6} 60 60)`);
        animatePct($('gauge-value'), pct);
        const st = $('gauge-status');
        st.dataset.tone = tone;
        st.innerHTML = tot.pct == null ? 'Sin datos'
            : tone === 'good' ? '<i class="bi bi-check-circle-fill"></i> En meta'
            : tone === 'warn' ? '<i class="bi bi-exclamation-circle-fill"></i> Requiere atención'
            : '<i class="bi bi-x-octagon-fill"></i> Crítico';
        $('gauge-gap').textContent = tot.pct == null ? '—'
            : tot.pct >= META ? `+${(tot.pct - META).toFixed(1)} pts sobre la meta`
            : `${(META - tot.pct).toFixed(1)} pts por debajo`;
    }

    // ── KPIs ─────────────────────────────────────────────────────────────────
    function renderKPIs(tot, conts) {
        const recibidas = Math.max(tot.pz - tot.ft, 0);
        const faltPct = tot.pz > 0 ? tot.ft / tot.pz * 100 : 0;
        const sobrPct = tot.pz > 0 ? tot.sb / tot.pz * 100 : 0;
        const byEst = countBy(conts, c => c.estado);
        const contFalt = (byEst.falt || 0) + (byEst.mixto || 0);
        const contSobr = (byEst.sobr || 0) + (byEst.mixto || 0);
        const ok = byEst.ok || 0;

        animateNumber($('kpi-piezas'), tot.pz, true);
        $('kpi-piezas-sub').innerHTML = `${fmt(conts.length)} contenedores · ${fmt(tot.lines)} líneas`;

        animateNumber($('kpi-recibidas'), recibidas, true);
        $('kpi-recibidas-sub').innerHTML = `<b>${pctTxt(tot.pct ?? 0)}</b> de lo manifestado`;

        animateNumber($('kpi-faltantes'), tot.ft, true);
        $('kpi-faltantes-sub').innerHTML = `<b>${faltPct.toFixed(2)}%</b> del total · ${fmt(contFalt)} contenedores`;

        animateNumber($('kpi-sobrantes'), tot.sb, true);
        $('kpi-sobrantes-sub').innerHTML = `<b>${sobrPct.toFixed(2)}%</b> del total · ${fmt(contSobr)} contenedores`;

        animatePct($('kpi-cumplimiento'), tot.pct ?? 0);
        const bar = $('kpi-progress-bar');
        const tone = toneOf(tot.pct);
        bar.style.background = tone === 'good' ? C.ok : tone === 'warn' ? C.warn : C.bad;
        requestAnimationFrame(() => { bar.style.width = Math.min(tot.pct ?? 0, 100) + '%'; });
        $('kpi-cumplimiento-sub').innerHTML = tot.pct == null ? 'Sin piezas manifestadas'
            : tot.pct >= META ? `Cumple la meta de ${META}% <b>(+${(tot.pct - META).toFixed(1)} pts)</b>`
            : `A <b>${(META - tot.pct).toFixed(1)} pts</b> de la meta de ${META}%`;

        $('kpi-cont-ok').textContent = `${fmt(ok)} / ${fmt(conts.length)}`;
        $('kpi-cont-ok-sub').innerHTML = `<b>${pctTxt(conts.length ? ok / conts.length * 100 : 0)}</b> llegaron sin diferencias`;
        if ($('kpi-faltantes-vcm')) $('kpi-faltantes-vcm').textContent = fmt(tot.ft);
        if ($('kpi-sobrantes-vcm')) $('kpi-sobrantes-vcm').textContent = fmt(tot.sb);
        if ($('kpi-adicional')) $('kpi-adicional').textContent = fmt(tot.ad);
        if ($('kpi-correcto')) $('kpi-correcto').textContent = fmt(tot.correcto);
    }

    // ── HALLAZGOS ────────────────────────────────────────────────────────────
    function renderInsights(rows, tot, conts) {
        const items = [];
        const areas = groupAgg(rows, r => r.Area).filter(a => a.key !== NO_AREA && a.pz > 0);
        const secs  = groupAgg(rows, r => r.Seccion);

        if (tot.ft === 0 && tot.sb === 0) {
            items.push({ tone: 'good', icon: 'bi-stars', title: 'Recepción perfecta', text: `Las <strong>${fmt(tot.pz)}</strong> piezas manifestadas llegaron completas y sin sobrantes.` });
        } else {
            const tone = toneOf(tot.pct);
            items.push({ tone, icon: 'bi-bullseye', title: 'Exactitud global',
                text: `La exactitud es de <strong>${pctTxt(tot.pct ?? 0)}</strong>; ${tot.pct >= META ? 'cumple' : '<strong>no cumple</strong>'} la meta de ${META}%. Faltan <strong>${fmt(tot.ft)}</strong> piezas de ${fmt(tot.pz)}.` });
        }

        if (tot.ft > 0 && areas.length) {
            const worstFt = [...areas].sort((a, b) => b.ft - a.ft)[0];
            if (worstFt.ft > 0) items.push({ tone: 'bad', icon: 'bi-person-exclamation', title: 'Área con más faltantes',
                text: `<strong>${esc(worstFt.key)}</strong> acumula <strong>${fmt(worstFt.ft)}</strong> piezas faltantes, el <strong>${pctTxt(worstFt.ft / tot.ft * 100)}</strong> del total.` });
        }

        if (areas.length > 1) {
            const sorted = [...areas].sort((a, b) => b.pct - a.pct);
            const best = sorted[0], worst = sorted[sorted.length - 1];
            if (best.pct !== worst.pct) {
                items.push({ tone: 'good', icon: 'bi-trophy-fill', title: 'Mejor desempeño',
                    text: `<strong>${esc(best.key)}</strong> lidera con <strong>${pctTxt(best.pct)}</strong> de exactitud.` });
                items.push({ tone: toneOf(worst.pct), icon: 'bi-graph-down-arrow', title: 'Menor exactitud',
                    text: `<strong>${esc(worst.key)}</strong> tiene <strong>${pctTxt(worst.pct)}</strong>, ${(best.pct - worst.pct).toFixed(1)} pts debajo del líder.` });
            }
        }

        if (tot.ft > 0) {
            const secFt = secs.filter(s => s.ft > 0).sort((a, b) => b.ft - a.ft);
            const top = secFt[0];
            const desc = descSeccion(top.key);
            items.push({ tone: 'warn', icon: 'bi-grid-3x3-gap-fill', title: 'Sección más afectada',
                text: `Sección <strong>${esc(top.key)}${desc ? ' · ' + esc(desc) : ''}</strong> con <strong>${fmt(top.ft)}</strong> faltantes (${pctTxt(top.ft / tot.ft * 100)} del total).` });
            // Concentración (Pareto 80%)
            let acc = 0, n = 0;
            for (const s of secFt) { acc += s.ft; n++; if (acc >= tot.ft * 0.8) break; }
            if (secFt.length > 2) items.push({ tone: 'info', icon: 'bi-funnel-fill', title: 'Concentración',
                text: `El <strong>80%</strong> de los faltantes se concentra en <strong>${n}</strong> de ${secFt.length} secciones con faltantes.` });
        }

        const conDif = conts.filter(c => c.estado !== 'ok').length;
        if (conts.length) items.push({ tone: conDif ? 'warn' : 'good', icon: 'bi-boxes', title: 'Contenedores',
            text: conDif
                ? `<strong>${fmt(conDif)}</strong> de ${fmt(conts.length)} contenedores (${pctTxt(conDif / conts.length * 100)}) presentan alguna diferencia.`
                : `Los <strong>${fmt(conts.length)}</strong> contenedores llegaron sin diferencias.` });

        if (tot.sb > 0 && areas.length) {
            const topSb = [...areas].sort((a, b) => b.sb - a.sb)[0];
            if (topSb.sb > 0) items.push({ tone: 'warn', icon: 'bi-plus-square-fill', title: 'Sobrantes',
                text: `<strong>${esc(topSb.key)}</strong> concentra <strong>${fmt(topSb.sb)}</strong> de las ${fmt(tot.sb)} piezas sobrantes.` });
        }

        const sinArea = rows.filter(r => r.Area === NO_AREA);
        if (sinArea.length) {
            const nSec = uniq(sinArea.map(r => r.Seccion)).length;
            items.push({ tone: 'info', icon: 'bi-database-exclamation', title: 'Datos incompletos',
                text: `<strong>${fmt(agg(sinArea).pz)}</strong> piezas en <strong>${nSec}</strong> secciones no tienen área asignada. Actualiza Datos Maestros.` });
        }

        $('insights-list').innerHTML = items.slice(0, 8).map(it => `
            <li class="db-insight" data-tone="${it.tone}">
                <span class="db-insight-icon"><i class="bi ${it.icon}"></i></span>
                <div><div class="db-insight-title">${it.title}</div><div class="db-insight-text">${it.text}</div></div>
            </li>`).join('');
    }

    // ── SEMÁFORO ─────────────────────────────────────────────────────────────
    function renderSemaforo(tot) {
        const areas = groupAgg(State.filteredRows, r => r.Area).filter(a => a.key !== NO_AREA && a.pct != null);
        const c = countBy(areas, a => toneOf(a.pct));
        $('sem-good').textContent = c.good || 0;
        $('sem-warn').textContent = c.warn || 0;
        $('sem-bad').textContent  = c.bad  || 0;

        const recibidas = Math.max(tot.pz - tot.ft, 0);
        const base = recibidas + tot.ft + tot.sb || 1;
        const segs = [
            ['Recibidas', recibidas, C.ok],
            ['Faltantes', tot.ft, C.bad],
            ['Sobrantes', tot.sb, C.warn],
        ];
        $('split-bar').innerHTML = segs.map(([l, v, col]) => `<span style="width:${v / base * 100}%;background:${col}" title="${l}: ${fmt(v)}"></span>`).join('');
        $('split-legend').innerHTML = '<strong style="width:100%;font-size:.7rem;color:var(--txt)">Composición de piezas</strong>' +
            segs.map(([l, v, col]) => `<span><i style="background:${col}"></i>${l} <b>${fmt(v)}</b> (${pctTxt(v / base * 100)})</span>`).join('');
    }

    // ── GRÁFICAS ─────────────────────────────────────────────────────────────
    const tooltipStyle = {
        backgroundColor: '#2B2027', titleColor: '#fff', bodyColor: 'rgba(255,255,255,.85)',
        padding: 10, cornerRadius: 10, titleFont: { weight: '800' }, boxPadding: 4,
    };

    const metaLinePlugin = {
        id: 'metaLine',
        afterDatasetsDraw(chart, _args, opts) {
            if (opts?.value == null) return;
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const xp = x.getPixelForValue(opts.value);
            ctx.save();
            ctx.strokeStyle = C.txt; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = C.txt; ctx.font = "700 10px Inter, sans-serif"; ctx.textAlign = 'center';
            ctx.fillText(`Meta ${opts.value}%`, xp, top - 4);
            ctx.restore();
        }
    };

    const valueLabelPlugin = {
        id: 'valueLabels',
        afterDatasetsDraw(chart, _args, opts) {
            if (!opts?.format) return;
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.font = "800 11px Inter, sans-serif"; ctx.textBaseline = 'middle';
            chart.data.datasets.forEach((ds, di) => {
                if (opts.datasets && !opts.datasets.includes(di)) return;
                const meta = chart.getDatasetMeta(di);
                if (meta.hidden) return;
                meta.data.forEach((el, i) => {
                    const v = ds.data[i];
                    if (v == null || (opts.skipZero && !v)) return;
                    const txt = opts.format(v, i);
                    const w = ctx.measureText(txt).width;
                    let x = el.x + 6, color = C.txt;
                    if (x + w > chartArea.right) { x = el.x - w - 6; color = '#fff'; }
                    ctx.fillStyle = color; ctx.textAlign = 'left';
                    ctx.fillText(txt, x, el.y);
                });
            });
            ctx.restore();
        }
    };

    function chartReset(name) { if (State.charts[name]) { State.charts[name].destroy(); State.charts[name] = null; } }

    function chartEmpty(canvas, msg) {
        const wrap = canvas.parentElement;
        let el = wrap.querySelector('.db-chart-empty');
        if (msg) {
            canvas.style.display = 'none';
            if (!el) { el = document.createElement('div'); el.className = 'db-chart-empty'; wrap.appendChild(el); }
            el.textContent = msg;
            return true;
        }
        canvas.style.display = '';
        if (el) el.remove();
        return false;
    }

    function renderChartJefatura(rows) {
        const canvas = $('chart-jefatura');
        chartReset('jefatura');
        const areas = groupAgg(rows, r => r.Area).filter(a => a.pct != null).sort((a, b) => b.pct - a.pct);
        if (chartEmpty(canvas, areas.length ? '' : 'Sin datos por área')) return;
        $('wrap-jefatura').style.height = Math.max(240, areas.length * 38 + 50) + 'px';
        const colors = areas.map(a => toneColor(a.pct));

        State.charts.jefatura = new Chart(canvas, {
            type: 'bar',
            plugins: [metaLinePlugin, valueLabelPlugin],
            data: { labels: areas.map(a => a.key), datasets: [{ data: areas.map(a => +a.pct.toFixed(2)), backgroundColor: colors.map(c => c + 'CC'), hoverBackgroundColor: colors, borderRadius: 6, borderSkipped: false, barPercentage: .72 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 14, right: 8 } },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterJefatura, areas[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { display: false },
                    metaLine: { value: META },
                    valueLabels: { format: v => v.toFixed(1) + '%' },
                    tooltip: { ...tooltipStyle, callbacks: {
                        label: ctx => ` Exactitud: ${pctTxt(ctx.parsed.x)}`,
                        afterLabel: ctx => { const a = areas[ctx.dataIndex]; return [` Piezas: ${fmt(a.pz)}`, ` Faltantes: ${fmt(a.ft)}`, ` Sobrantes: ${fmt(a.sb)}`]; }
                    } }
                },
                scales: {
                    x: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: C.grid } },
                    y: { ticks: { font: { size: 11, weight: '700' }, color: C.txt }, grid: { display: false } }
                }
            }
        });
    }

    function renderChartEstado(conts) {
        const canvas = $('chart-estado');
        chartReset('estado');
        const keys = Object.keys(ESTADOS);
        const counts = countBy(conts, c => c.estado);
        const data = keys.map(k => counts[k] || 0);
        const total = conts.length;
        $('donut-total').textContent = fmt(total);

        State.charts.estado = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: keys.map(k => ESTADOS[k].label), datasets: [{ data, backgroundColor: keys.map(k => ESTADOS[k].color), borderColor: '#fff', borderWidth: 3, hoverOffset: 8 }] },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '72%',
                plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${fmt(ctx.parsed)} contenedores (${pctTxt(total ? ctx.parsed / total * 100 : 0)})` } } }
            }
        });

        $('estado-legend').innerHTML = keys.map((k, i) => `
            <li data-status="${k}" title="Ver estos contenedores en la tabla">
                <span class="dot" style="background:${ESTADOS[k].color}"></span>
                <span class="lbl">${ESTADOS[k].label}<small>${ESTADOS[k].desc}</small></span>
                <span class="val">${fmt(data[i])}<small>${pctTxt(total ? data[i] / total * 100 : 0)}</small></span>
            </li>`).join('');
        $('estado-legend').querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
            setContStatus(li.dataset.status);
            $('table-contenedores').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    }

    function renderChartDiferencias(rows) {
        const canvas = $('chart-diferencias');
        chartReset('diferencias');
        const areas = groupAgg(rows, r => r.Area).filter(a => a.ft + a.sb > 0).sort((a, b) => (b.ft + b.sb) - (a.ft + a.sb)).slice(0, 12);
        if (chartEmpty(canvas, areas.length ? '' : 'Sin faltantes ni sobrantes 🎉')) return;
        $('wrap-diferencias').style.height = Math.max(240, areas.length * 38 + 50) + 'px';

        State.charts.diferencias = new Chart(canvas, {
            type: 'bar',
            data: { labels: areas.map(a => a.key), datasets: [
                { label: 'Faltantes', data: areas.map(a => a.ft), backgroundColor: C.bad + 'D0', borderRadius: 5, borderSkipped: false },
                { label: 'Sobrantes', data: areas.map(a => a.sb), backgroundColor: C.warn + 'C0', borderRadius: 5, borderSkipped: false },
            ] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterJefatura, areas[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 11, weight: '700' } } },
                    tooltip: { ...tooltipStyle, mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.x)} pzas` } }
                },
                scales: {
                    x: { stacked: true, beginAtZero: true, ticks: { callback: v => fmt(v), font: { size: 10 } }, grid: { color: C.grid } },
                    y: { stacked: true, ticks: { font: { size: 11, weight: '700' }, color: C.txt }, grid: { display: false } }
                }
            }
        });
    }

    function renderChartSecciones(rows, tot) {
        const canvas = $('chart-secciones');
        chartReset('secciones');
        const secs = groupAgg(rows, r => r.Seccion).filter(s => s.ft > 0).sort((a, b) => b.ft - a.ft).slice(0, 10);
        if (chartEmpty(canvas, secs.length ? '' : 'No hay secciones con faltantes 🎉')) return;
        $('wrap-secciones').style.height = Math.max(240, secs.length * 34 + 40) + 'px';
        const labels = secs.map(s => { const d = descSeccion(s.key); return d ? `${s.key} · ${truncate(d, 22)}` : s.key; });

        State.charts.secciones = new Chart(canvas, {
            type: 'bar',
            plugins: [valueLabelPlugin],
            data: { labels, datasets: [{ data: secs.map(s => s.ft), backgroundColor: secs.map((_, i) => i < 3 ? C.bad : C.bad + '80'), borderRadius: 5, borderSkipped: false, barPercentage: .7 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                layout: { padding: { right: 50 } },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterSeccion, secs[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { display: false },
                    valueLabels: { format: (v) => `${fmt(v)} · ${pctTxt(tot.ft ? v / tot.ft * 100 : 0)}` },
                    tooltip: { ...tooltipStyle, callbacks: {
                        title: items => { const s = secs[items[0].dataIndex]; const d = descSeccion(s.key); return `Sección ${s.key}${d ? ' · ' + d : ''}`; },
                        label: ctx => { const s = secs[ctx.dataIndex]; return [` Faltantes: ${fmt(s.ft)} (${pctTxt(tot.ft ? s.ft / tot.ft * 100 : 0)} del total)`, ` Exactitud: ${pctTxt(s.pct ?? 0)}`, ` Área: ${areaOfSeccion(s.key)}`]; }
                    } }
                },
                scales: {
                    x: { beginAtZero: true, ticks: { callback: v => fmt(v), font: { size: 10 } }, grid: { color: C.grid } },
                    y: { ticks: { font: { size: 10.5, weight: '700' }, color: C.txt }, grid: { display: false } }
                }
            }
        });
    }

    function renderChartTendencia(rows) {
        const canvas = $('chart-tendencia');
        chartReset('tendencia');
        const manifs = groupAgg(rows, r => r.Manifiesto).sort((a, b) => manifDate(a.key) - manifDate(b.key) || a.key.localeCompare(b.key));
        if (chartEmpty(canvas, manifs.length ? '' : 'Sin reportes')) return;
        const labels = manifs.map(m => { const d = State.manifestInfo[m.key]?.date; return d ? [manifLabel(m.key), fmtDate(d)] : manifLabel(m.key); });

        State.charts.tendencia = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [
                { type: 'line', label: 'Exactitud %', data: manifs.map(m => m.pct == null ? null : +m.pct.toFixed(2)), yAxisID: 'y1', borderColor: C.vino, backgroundColor: C.vino, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderWidth: 2, tension: .35, order: 0 },
                { type: 'bar', label: 'Piezas manifestadas', data: manifs.map(m => m.pz), backgroundColor: 'rgba(230,0,126,.22)', hoverBackgroundColor: 'rgba(230,0,126,.4)', borderRadius: 6, yAxisID: 'y', order: 2, maxBarThickness: 46 },
                { type: 'bar', label: 'Faltantes', data: manifs.map(m => m.ft), backgroundColor: C.bad + 'CC', borderRadius: 6, yAxisID: 'y', order: 1, maxBarThickness: 46 },
                { type: 'bar', label: 'Sobrantes', data: manifs.map(m => m.sb), backgroundColor: C.warn + 'BB', borderRadius: 6, yAxisID: 'y', order: 1, maxBarThickness: 46 },
            ] },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterManifiesto, manifs[els[0].index].key); },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 11, weight: '700' } } },
                    tooltip: { ...tooltipStyle, callbacks: {
                        title: items => { const m = manifs[items[0].dataIndex]; const info = State.manifestInfo[m.key]; return `Reporte ${manifLabel(m.key)}${info?.date ? ' · ' + fmtDateTime(info.date) : ''}`; },
                        label: ctx => ctx.dataset.yAxisID === 'y1' ? ` Exactitud: ${pctTxt(ctx.parsed.y ?? 0)}` : ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
                    } }
                },
                scales: {
                    x: { ticks: { font: { size: 10, weight: '600' }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Piezas', font: { size: 10, weight: '700' } }, ticks: { callback: v => fmt(v), font: { size: 10 } }, grid: { color: C.grid } },
                    y1: { min: 0, max: 100, position: 'right', title: { display: true, text: 'Exactitud', font: { size: 10, weight: '700' } }, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { display: false } }
                }
            }
        });
    }

    // ── TARJETAS DE ÁREA ─────────────────────────────────────────────────────
    function renderAreaCards() {
        // Ignoran el filtro de área para que se puedan comparar y alternar
        const fM = UI.filterManifiesto.value, fS = UI.filterSeccion.value;
        const rows = State.allRows.filter(r => (!fM || r.Manifiesto === fM) && (!fS || r.Seccion === fS));
        const areas = groupAgg(rows, r => r.Area).sort((a, b) =>
            (a.key === NO_AREA) - (b.key === NO_AREA) || (b.pct ?? -1) - (a.pct ?? -1) || b.pz - a.pz);
        const active = UI.filterJefatura.value;
        const box = $('ranking-jefatura');

        if (!areas.length) { box.innerHTML = '<div class="db-empty" style="grid-column:1/-1">Sin datos por área</div>'; return; }

        box.innerHTML = areas.map((a, i) => {
            const aRows = rows.filter(r => r.Area === a.key);
            const secs = groupAgg(aRows, r => r.Seccion);
            const worst = secs.filter(s => s.ft > 0).sort((x, y) => y.ft - x.ft)[0];
            const conts = uniq(aRows.map(r => r.Manifiesto + '|' + r.Contenedor)).length;
            const gerentes = uniq(aRows.map(r => r.Gerente).filter(Boolean));
            const tone = a.key === NO_AREA ? 'none' : toneOf(a.pct);
            const status = tone === 'good' ? 'En meta' : tone === 'warn' ? 'Atención' : tone === 'bad' ? 'Crítico' : 'Sin asignar';
            const foot = worst
                ? `<i class="bi bi-exclamation-triangle-fill"></i> Más afectada: <strong>${esc(worst.key)}${descSeccion(worst.key) ? ' · ' + esc(truncate(descSeccion(worst.key), 20)) : ''}</strong> (${fmt(worst.ft)} falt.)`
                : a.sb > 0 ? `<i class="bi bi-info-circle-fill"></i> Sin faltantes; ${fmt(a.sb)} piezas sobrantes`
                : `<i class="bi bi-check-circle-fill"></i> Sin diferencias en ${secs.length} secciones`;
            return `<button type="button" class="db-area${active === a.key ? ' is-active' : ''}" data-tone="${tone}" data-area="${esc(a.key)}">
                <div class="db-area-head">
                    <span class="db-area-rank">${a.key === NO_AREA ? '?' : i + 1}</span>
                    <div>
                        <div class="db-area-name">${esc(a.key)}</div>
                        <div class="db-area-meta">${secs.length} secciones${gerentes.length ? ' · ' + esc(truncate(gerentes.join(', '), 30)) : ''}</div>
                    </div>
                    <div class="db-area-pct"><strong>${a.pct == null ? '—' : pctTxt(a.pct)}</strong><small>${status}</small></div>
                </div>
                <div class="db-area-bar"><span style="width:${Math.min(a.pct ?? 0, 100)}%"></span><i></i></div>
                <div class="db-area-stats">
                    <div class="db-area-stat"><b>${fmtShort(a.pz)}</b><small>Piezas</small></div>
                    <div class="db-area-stat falt"><b>${fmt(a.ft)}</b><small>Faltan</small></div>
                    <div class="db-area-stat sobr"><b>${fmt(a.sb)}</b><small>Sobran</small></div>
                    <div class="db-area-stat"><b>${fmt(conts)}</b><small>Cont.</small></div>
                </div>
                <div class="db-area-foot">${foot}</div>
            </button>`;
        }).join('');
        box.querySelectorAll('.db-area').forEach(el => el.addEventListener('click', () => setFilter(UI.filterJefatura, el.dataset.area)));
    }

    // ── TABLA SECCIONES ──────────────────────────────────────────────────────
    function renderTablaSecciones(rows, tot) {
        const secs = groupAgg(rows, r => r.Seccion).map(s => {
            const sRows = rows.filter(r => r.Seccion === s.key);
            return { ...s, seccion: s.key, jefatura: sRows[0]?.Area || NO_AREA, desc: sRows[0]?.DescripcionSec || '',
                contenedores: uniq(sRows.map(r => r.Manifiesto + '|' + r.Contenedor)).length,
                share: tot.ft ? s.ft / tot.ft * 100 : 0, pctSort: s.pct ?? -1 };
        });
        sortBy(secs, State.sec.sortKey === 'pct' ? 'pctSort' : State.sec.sortKey, State.sec.sortDir);
        $('sec-count').textContent = `${fmt(secs.length)} secciones`;
        $('tbody-secciones').innerHTML = secs.map(s => `<tr>
                <td><strong>${esc(s.seccion)}</strong>${s.desc && s.desc !== s.seccion ? `<span class="sub">${esc(s.desc)}</span>` : ''}</td>
                <td>${areaCell(s.jefatura)}</td>
                <td class="num">${fmt(s.contenedores)}</td>
                <td class="num">${fmt(s.pz)}</td>
                <td class="num ${s.ft ? 'falt' : 'zero'}">${fmt(s.ft)}</td>
                <td class="num ${s.sb ? 'sobr' : 'zero'}">${fmt(s.sb)}</td>
                <td class="num">${pctBadge(s.pct)}</td>
                <td><div class="db-share"><div class="db-share-bar"><span style="width:${s.share}%"></span></div><small>${s.ft ? pctTxt(s.share) : '—'}</small></div></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">Sin datos</td></tr>';
        markSort('table-secciones', State.sec);
    }

    // ── TABLA CONTENEDORES ───────────────────────────────────────────────────
    function buildContenedores(rows) {
        const map = {};
        rows.forEach(r => {
            const k = r.Manifiesto + '|' + r.Contenedor;
            const c = map[k] || (map[k] = { contenedor: r.Contenedor, manifiesto: r.Manifiesto, secciones: new Set(), areas: new Set(), articulos: new Set(), lineas: 0, pz: 0, ft: 0, sb: 0 });
            c.secciones.add(r.Seccion); c.areas.add(r.Area);
            if (r.Articulo) c.articulos.add(r.Articulo + ' ' + (r.Descripcion || ''));
            c.lineas++; c.pz += toNum(r.Piezas); c.ft += toNum(r.Faltantes); c.sb += toNum(r.Sobrante);
        });
        return Object.values(map).map(c => {
            const pct = pctOf(c.pz, c.ft);
            const secs = [...c.secciones], areas = [...c.areas];
            return { ...c, pct, pctSort: pct ?? -1, estado: estadoOf(c.ft, c.sb),
                seccion: secs[0] + (secs.length > 1 ? ` +${secs.length - 1}` : ''),
                jefatura: areas[0] + (areas.length > 1 ? ` +${areas.length - 1}` : ''),
                search: [c.contenedor, c.manifiesto, ...secs, ...areas, ...c.articulos].join(' ').toLowerCase() };
        });
    }

    function renderTablaContenedores(conts) {
        conts = conts || buildContenedores(State.filteredRows);
        State._conts = conts;
        const counts = countBy(conts, c => c.estado);
        document.querySelectorAll('#cont-status-chips [data-count]').forEach(el => {
            el.textContent = fmt(el.dataset.count === 'all' ? conts.length : (counts[el.dataset.count] || 0));
        });
        document.querySelectorAll('#cont-status-chips .db-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.status === State.cont.status));

        const q = State.cont.search.trim().toLowerCase();
        const list = conts.filter(c => (!State.cont.status || c.estado === State.cont.status) && (!q || c.search.includes(q)));
        sortBy(list, State.cont.sortKey === 'pct' ? 'pctSort' : State.cont.sortKey, State.cont.sortDir);

        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        State.cont.page = Math.min(State.cont.page, pages);
        const start = (State.cont.page - 1) * PAGE_SIZE;
        const pageRows = list.slice(start, start + PAGE_SIZE);

        $('cont-count').textContent = `${fmt(list.length)} de ${fmt(conts.length)} contenedores`;
        $('tbody-contenedor').innerHTML = pageRows.map(c => `<tr>
                <td><span class="db-mono">${esc(c.contenedor)}</span></td>
                <td>${esc(manifLabel(c.manifiesto))}</td>
                <td>${esc(c.seccion)}</td>
                <td>${areaCell(c.jefatura)}</td>
                <td class="num">${fmt(c.lineas)}</td>
                <td class="num">${fmt(c.pz)}</td>
                <td class="num ${c.ft ? 'falt' : 'zero'}">${fmt(c.ft)}</td>
                <td class="num ${c.sb ? 'sobr' : 'zero'}">${fmt(c.sb)}</td>
                <td class="num">${pctBadge(c.pct)}</td>
                <td><span class="db-status ${c.estado}"><i class="bi ${ESTADOS[c.estado].icon}"></i>${ESTADOS[c.estado].label}</span></td>
            </tr>`).join('') || '<tr><td colspan="10" class="empty">Ningún contenedor coincide con la búsqueda</td></tr>';
        markSort('table-contenedores', State.cont);
        renderPager(list.length, pages);
    }

    function renderPager(total, pages) {
        const p = State.cont.page;
        const pager = $('cont-pager');
        if (total <= PAGE_SIZE) { pager.innerHTML = `<span>Mostrando ${fmt(total)} contenedores</span>`; return; }
        const nums = [];
        for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
        pager.innerHTML = `<span>Mostrando ${fmt((p - 1) * PAGE_SIZE + 1)}–${fmt(Math.min(p * PAGE_SIZE, total))} de ${fmt(total)}</span>
            <div class="db-pager-btns">
                <button data-page="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                ${nums.map(n => n === '…' ? '<button disabled>…</button>' : `<button data-page="${n}" class="${n === p ? 'active' : ''}">${n}</button>`).join('')}
                <button data-page="${p + 1}" ${p === pages ? 'disabled' : ''} aria-label="Siguiente"><i class="bi bi-chevron-right"></i></button>
            </div>`;
        pager.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
            State.cont.page = +b.dataset.page; renderTablaContenedores(State._conts);
        }));
    }

    function setContStatus(status) {
        State.cont.status = status; State.cont.page = 1;
        renderTablaContenedores(State._conts);
    }

    document.querySelectorAll('#cont-status-chips .db-chip').forEach(ch => ch.addEventListener('click', () => setContStatus(ch.dataset.status)));
    let searchTimer;
    $('cont-search').addEventListener('input', e => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { State.cont.search = e.target.value; State.cont.page = 1; renderTablaContenedores(State._conts); }, 180);
    });

    bindSort('table-secciones', State.sec, () => renderTablaSecciones(State.filteredRows, agg(State.filteredRows)));
    bindSort('table-contenedores', State.cont, () => renderTablaContenedores(State._conts));

    // ── ARTÍCULOS ────────────────────────────────────────────────────────────
    function renderArticulos(rows) {
        const withArt = rows.filter(r => r.Articulo);
        $('articulos-block').style.display = withArt.length ? 'block' : 'none';
        if (!withArt.length) return;
        const arts = groupAgg(withArt, r => r.Articulo).map(a => {
            const aRows = withArt.filter(r => r.Articulo === a.key);
            return { ...a, desc: aRows.find(r => r.Descripcion)?.Descripcion || '', area: aRows[0].Area,
                conts: uniq(aRows.map(r => r.Manifiesto + '|' + r.Contenedor)).length };
        }).filter(a => a.ft + a.sb > 0).sort((a, b) => (b.ft + b.sb) - (a.ft + a.sb)).slice(0, 15);

        $('tbody-articulos').innerHTML = arts.map(a => `<tr>
                <td><span class="db-mono">${esc(a.key)}</span></td>
                <td>${esc(truncate(a.desc || '—', 48))}</td>
                <td>${areaCell(a.area)}</td>
                <td class="num">${fmt(a.conts)}</td>
                <td class="num">${fmt(a.pz)}</td>
                <td class="num ${a.ft ? 'falt' : 'zero'}">${fmt(a.ft)}</td>
                <td class="num ${a.sb ? 'sobr' : 'zero'}">${fmt(a.sb)}</td>
                <td class="num">${pctBadge(a.pct)}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">Ningún artículo tiene diferencias 🎉</td></tr>';
    }

    // ── EXPORTAR ─────────────────────────────────────────────────────────────
    $('btn-export').addEventListener('click', () => {
        const rows = State.filteredRows;
        if (!rows.length) { Swal.fire({ icon: 'info', title: 'Nada que exportar', text: 'No hay resultados con los filtros actuales.' }); return; }
        const tot = agg(rows);
        const conts = buildContenedores(rows);
        const wb = XLSX.utils.book_new();

        const resumen = [
            ['Dashboard de Resultados — Sistema Liverpool'],
            ['Generado', fmtDateTime(new Date())],
            ['Reporte', UI.filterManifiesto.value ? manifLabel(UI.filterManifiesto.value) : 'Todos'],
            ['Área', UI.filterJefatura.value || 'Todas'],
            ['Sección', UI.filterSeccion.value || 'Todas'],
            [],
            ['Indicador', 'Valor'],
            ['Piezas manifestadas', tot.pz],
            ['Piezas recibidas', Math.max(tot.pz - tot.ft, 0)],
            ['Faltantes', tot.ft],
            ['Sobrantes', tot.sb],
            ['Exactitud %', round2(tot.pct ?? 0)],
            ['Meta %', META],
            ['Contenedores', conts.length],
            ...Object.keys(ESTADOS).map(k => [`Contenedores · ${ESTADOS[k].label}`, conts.filter(c => c.estado === k).length]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');

        const areas = groupAgg(rows, r => r.Area).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(areas.map(a => ({
            'Área': a.key, 'Piezas': a.pz, 'Faltantes': a.ft, 'Sobrantes': a.sb, 'Exactitud %': round2(a.pct ?? 0),
            'Estado': a.key === NO_AREA ? 'Sin asignar' : ({ good: 'En meta', warn: 'Atención', bad: 'Crítico' })[toneOf(a.pct)] || '—'
        }))), 'Áreas');

        const secs = groupAgg(rows, r => r.Seccion).sort((a, b) => b.ft - a.ft);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(secs.map(s => ({
            'Sección': s.key, 'Descripción': descSeccion(s.key), 'Área': areaOfSeccion(s.key),
            'Piezas': s.pz, 'Faltantes': s.ft, 'Sobrantes': s.sb, 'Exactitud %': round2(s.pct ?? 0),
            '% de faltantes': round2(tot.ft ? s.ft / tot.ft * 100 : 0)
        }))), 'Secciones');

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conts.sort((a, b) => b.ft - a.ft).map(c => ({
            'Contenedor': c.contenedor, 'Reporte': manifLabel(c.manifiesto), 'Secciones': [...c.secciones].join(', '),
            'Áreas': [...c.areas].join(', '), 'Líneas': c.lineas, 'Piezas': c.pz, 'Faltantes': c.ft, 'Sobrantes': c.sb,
            'Exactitud %': round2(c.pct ?? 0), 'Estado': ESTADOS[c.estado].label
        }))), 'Contenedores');

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
            'Manifiesto': r.Manifiesto, 'Contenedor': r.Contenedor, 'Sección': r.Seccion, 'Descripción sección': r.DescripcionSec,
            'Área': r.Area, 'Artículo': r.Articulo || '', 'Descripción': r.Descripcion || '',
            'Piezas': toNum(r.Piezas), 'Faltantes': toNum(r.Faltantes), 'Sobrantes': toNum(r.Sobrante)
        }))), 'Detalle');

        XLSX.writeFile(wb, `resultados_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });

    // ── LISTA ADMIN ──────────────────────────────────────────────────────────
    function renderAdminList() {
        if (!State.isAdmin) return;
        if (!State.allReportes.length) { UI.adminList.innerHTML = '<div class="db-file-empty">No hay reportes cargados aún.</div>'; return; }
        UI.adminList.innerHTML = State.allReportes.map(rep => {
            const d = toDate(rep.uploadedAt);
            const label = rep.manifestoId?.startsWith('varios') ? 'Varios manifiestos' : (rep.manifestoId || '—');
            const t = agg(rep.rows || []);
            return `<div class="db-file">
                <span class="db-file-icon"><i class="bi bi-file-earmark-spreadsheet-fill"></i></span>
                <div style="min-width:0">
                    <div class="db-file-name">${esc(manifLabel(label))}</div>
                    <div class="db-file-meta">${esc(rep.fileName || '—')} · ${d ? fmtDateTime(d) : 'sin fecha'}${rep.uploadedByEmail ? ' · ' + esc(rep.uploadedByEmail) : ''}</div>
                </div>
                <div class="db-file-stats">${fmt(rep.rows?.length || 0)} filas<br>${pctTxt(t.pct ?? 0)} exactitud</div>
                <button class="db-file-del" data-id="${esc(rep.id)}" data-name="${esc(label)}" title="Eliminar"><i class="bi bi-trash3-fill"></i></button>
            </div>`;
        }).join('');
        UI.adminList.querySelectorAll('.db-file-del').forEach(btn => btn.addEventListener('click', () => deleteReporte(btn.dataset.id, btn.dataset.name)));
    }

    async function deleteReporte(docId, name) {
        const confirmed = await Swal.fire({
            title: '¿Eliminar reporte?', html: `Se eliminará <strong>${esc(name)}</strong> del dashboard. Esta acción no se puede deshacer.`,
            icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: C.bad
        });
        if (!confirmed.isConfirmed) return;
        showLoading();
        try {
            await db.collection(COLLECTION).doc(docId).delete();
            Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1700, showConfirmButton: false });
            await loadReportes();
        } catch (e) {
            hideLoading();
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar.' });
        }
    }

    // ── SUBIR RESULTADOS ─────────────────────────────────────────────────────
    $('btn-upload-open').addEventListener('click', () => { resetUploadModal(); State.uploadModal.show(); });

    function resetUploadModal() {
        State.parsedFile = null;
        UI.fileInput.value = '';
        UI.filePreview.style.display = 'none';
        UI.uploadError.style.display = 'none';
        UI.btnConfirmUpload.disabled = true;
        UI.dropZone.classList.remove('drag-over');
    }

    bindDropZone(UI.dropZone, UI.fileInput, handleFile);

    function handleFile(file) {
        showUploadError('');
        UI.btnConfirmUpload.disabled = true;
        UI.filePreview.style.display = 'none';
        if (!/\.(xlsx|xls)$/i.test(file.name)) { showUploadError('El archivo debe ser .xlsx o .xls'); return; }

        readWorkbook(file, json => {
            if (json.length === 0) { showUploadError('El archivo está vacío.'); return; }
            const rows = enrichWithMasterData(json.map(normalizeResultRow)).map(({ Area, ...r }) => r);

            const manifiestos = uniq(rows.map(r => r.Manifiesto));
            const isMultiple  = manifiestos.length > 1;
            const invalidM    = manifiestos.find(m => m !== 'GENERAL' && !/^\d{10}$/.test(m));
            if (invalidM) { showUploadError(`"Manifiesto" debe tener 10 dígitos. Se encontró: "${invalidM}"`); return; }

            const today     = new Date().toISOString().split('T')[0];
            const savedName = isMultiple ? `resultados_${today}.xlsx` : `${manifiestos[0]}_${today}.xlsx`;
            const jefaturas = uniq(rows.map(r => r.Jefatura).filter(j => areaOf(j) !== NO_AREA));
            const secciones = uniq(rows.map(r => r.Seccion));
            const t = agg(rows);

            State.parsedFile = { file, rows, manifiestos, isMultiple, savedName };
            $('prev-manifest-id').textContent = isMultiple ? `${manifiestos.length} manifiestos` : manifiestos[0];
            $('prev-multi-tag').style.display = isMultiple ? 'inline-flex' : 'none';
            $('prev-manifests-row').style.display = isMultiple ? 'flex' : 'none';
            $('prev-manifests-list').textContent = manifiestos.join(', ');
            $('prev-filename').textContent  = file.name;
            $('prev-rows').textContent      = fmt(rows.length);
            $('prev-totales').textContent   = `${fmt(t.pz)} / ${fmt(t.ft)} / ${fmt(t.sb)} · ${pctTxt(t.pct ?? 0)}`;
            $('prev-jefaturas').textContent = jefaturas.length ? jefaturas.join(', ') : '(se asignarán desde Datos Maestros)';
            $('prev-secciones').textContent = `${secciones.length}: ${truncate(secciones.join(', '), 120)}`;
            UI.filePreview.style.display = 'block';
            UI.btnConfirmUpload.disabled = false;
        }, () => showUploadError('No se pudo leer el archivo.'));
    }

    UI.btnConfirmUpload.addEventListener('click', async () => {
        if (!State.parsedFile) return;
        const { file, rows, manifiestos, isMultiple, savedName } = State.parsedFile;
        UI.btnConfirmUpload.disabled = true;
        UI.btnConfirmUpload.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Subiendo...';
        try {
            await storage.ref(`${STORAGE_PATH}${savedName}`).put(file);
            for (const manifestoId of manifiestos) {
                const manifestRows = isMultiple ? rows.filter(r => r.Manifiesto === manifestoId) : rows;
                const localExisting = State.allReportes.filter(r => r.manifestoId === manifestoId);
                if (localExisting.length > 0) {
                    const batch = db.batch();
                    localExisting.forEach(r => batch.delete(db.collection(COLLECTION).doc(r.id)));
                    await batch.commit();
                } else {
                    const existing = await db.collection(COLLECTION).where('manifestoId', '==', manifestoId).get();
                    if (existing.docs.length > 0) {
                        const batch = db.batch();
                        existing.docs.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                    }
                }
                await db.collection(COLLECTION).add({ manifestoId, fileName: savedName, uploadedBy: State.currentUser.uid, uploadedByEmail: State.currentUser.email, uploadedAt: firebase.firestore.FieldValue.serverTimestamp(), rows: manifestRows });
            }
            State.uploadModal.hide();
            Swal.fire({ icon: 'success', title: '¡Listo!', text: isMultiple ? `${manifiestos.length} manifiestos cargados.` : `Manifiesto ${manifiestos[0]} cargado.`, timer: 2300, showConfirmButton: false });
            await loadReportes();
        } catch (err) {
            console.error(err); showUploadError('Error al subir. Intenta de nuevo.');
        } finally {
            UI.btnConfirmUpload.disabled = false;
            UI.btnConfirmUpload.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Subir';
        }
    });

    function showUploadError(msg) {
        if (!msg) { UI.uploadError.style.display = 'none'; return; }
        UI.uploadErrorMsg.textContent = msg;
        UI.uploadError.style.display = 'block';
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────
    function showLoading() { UI.loading.style.display = 'flex'; }
    function hideLoading() { UI.loading.style.display = 'none'; }

    function bindDropZone(zone, input, handler) {
        input.addEventListener('change', e => { if (e.target.files[0]) handler(e.target.files[0]); });
        zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
        });
    }

    function readWorkbook(file, onJson, onError) {
        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb = XLSX.read(evt.target.result, { type: 'array' });
                onJson(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
            } catch (err) { console.error(err); onError(); }
        };
        reader.readAsArrayBuffer(file);
    }

    function bindSort(tableId, st, rerender) {
        document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
            else { st.sortKey = key; st.sortDir = th.classList.contains('num') || key === 'share' ? 'desc' : 'asc'; }
            if ('page' in st) st.page = 1;
            rerender();
        }));
    }

    function markSort(tableId, st) {
        document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
            th.classList.toggle('sort-asc',  th.dataset.sort === st.sortKey && st.sortDir === 'asc');
            th.classList.toggle('sort-desc', th.dataset.sort === st.sortKey && st.sortDir === 'desc');
        });
    }

    function sortBy(arr, key, dir) {
        const m = dir === 'asc' ? 1 : -1;
        arr.sort((a, b) => {
            const x = a[key], y = b[key];
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
            return String(x ?? '').localeCompare(String(y ?? ''), 'es', { numeric: true }) * m;
        });
        return arr;
    }

    function agg(rows) {
        let pz = 0, ft = 0, sb = 0, ad = 0, correcto = 0;
        rows.forEach(r => { pz += toNum(r.Piezas); ft += toNum(r.Faltantes); sb += toNum(r.Sobrante); ad += toNum(r.Adicional); correcto += toNum(r.Correcto); });
        return { pz, ft, sb, ad, correcto, lines: rows.length, pct: pctOf(pz, ft) };
    }

    function groupAgg(rows, keyFn) {
        const g = {};
        rows.forEach(r => { const k = keyFn(r) || '—'; (g[k] || (g[k] = [])).push(r); });
        return Object.keys(g).map(k => ({ key: k, ...agg(g[k]) }));
    }

    function pctOf(pz, ft) { return pz > 0 ? Math.max(0, (pz - ft) / pz * 100) : null; }
    function estadoOf(ft, sb) { return ft > 0 && sb > 0 ? 'mixto' : ft > 0 ? 'falt' : sb > 0 ? 'sobr' : 'ok'; }
    function toneOf(p) { return p == null ? 'none' : p >= META ? 'good' : p >= WARN ? 'warn' : 'bad'; }
    function toneColor(p) { const t = toneOf(p); return t === 'good' ? C.ok : t === 'warn' ? C.warn : t === 'bad' ? C.bad : C.txt3; }

    function descSeccion(sec) {
        const r = State.allRows.find(x => x.Seccion === sec && x.DescripcionSec && x.DescripcionSec !== sec);
        return r ? r.DescripcionSec : '';
    }
    function areaOfSeccion(sec) { return State.allRows.find(x => x.Seccion === sec)?.Area || NO_AREA; }
    function areaCell(a) { return String(a).startsWith(NO_AREA) ? `<span class="db-noarea"><i class="bi bi-exclamation-triangle-fill"></i>${esc(a)}</span>` : esc(a); }
    function areaSort(a, b) { return (a === NO_AREA) - (b === NO_AREA) || a.localeCompare(b, 'es'); }

    function manifLabel(m) { return m === 'GENERAL' ? 'General (sin manifiesto)' : m; }
    function manifDate(m) { return State.manifestInfo[m]?.date?.getTime() || 0; }

    function toDate(ts) {
        if (!ts) return null;
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts.seconds != null) return new Date(ts.seconds * 1000);
        const d = new Date(ts);
        return isNaN(d) ? null : d;
    }
    function fmtDate(d) { return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
    function fmtDateTime(d) { return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

    function uniq(a) { return [...new Set(a)]; }
    function countBy(a, fn) { return a.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {}); }
    // Repara acentos dañados en datos ya guardados (ver fixText en shared-ui.js)
    function fixDeep(v) { return window.fixTextDeep ? window.fixTextDeep(v) : v; }
    function toNum(v) { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
    function fmt(n) { return Number(n).toLocaleString('es-MX'); }
    function fmtShort(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n); }
    function pctTxt(p) { return (p ?? 0).toFixed(1) + '%'; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function esc(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function pctBadge(pct) {
        if (pct == null) return '<span class="badge-pct">—</span>';
        return `<span class="badge-pct ${toneOf(pct)}">${pctTxt(pct)}</span>`;
    }

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function animateNumber(el, target, isFmt) {
        if (!el) return;
        const duration = 700, start = performance.now();
        const step = now => {
            const p = Math.min((now - start) / duration, 1);
            const v = Math.round(target * easeOut(p));
            el.textContent = isFmt ? fmt(v) : v;
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
    function animatePct(el, target) {
        if (!el) return;
        const duration = 800, start = performance.now();
        const step = now => {
            const p = Math.min((now - start) / duration, 1);
            el.textContent = (target * easeOut(p)).toFixed(1) + '%';
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
});
