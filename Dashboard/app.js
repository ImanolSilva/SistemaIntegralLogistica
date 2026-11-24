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
    const META_ID      = "_meta";      // documento de control de versión (no es un reporte)
    const DATOS_COLL   = "datosMaestros";
    const DATOS_DOC    = "secciones";
    const COMPLEMENTO_JEFATURA = "../Complementos/Jefatura.json";
    const STORAGE_PATH = "Dashboard/";

    const META = 95;          // meta de exactitud
    const WARN = 85;          // umbral de atención
    const NO_AREA = 'Sin área asignada';
    const PAGE_SIZE = 20;
    const SEARCH_DELAY = 200; // espera de los buscadores (ms)
    const SUGGEST_MAX = 50;   // sugerencias visibles del filtro Contenedor
    const EXPORT_DETAIL_MAX = 50000; // más líneas: se pregunta antes de incluir la hoja Detalle
    const NUM_FMT = new Intl.NumberFormat('es-MX');
    // Un solo comparador: localeCompare con opciones crea uno nuevo en cada llamada y es muy lento.
    const COLL = new Intl.Collator('es', { numeric: true });

    // Encabezados aceptados. Se comparan sin acentos, espacios ni signos
    // ("Desc. Artículo" = "descarticulo"). El orden de cada lista es su prioridad.
    const RESULT_ALIASES = {
        contenedor:  ['contenedor','container','caja','folio'],
        piezas:      ['cant. manf.','cant manf','cantidad manifestada','piezas','articulos','artículos','cantidad','unidades','manifestados','cantmanf','cant_manf'],
        faltantes:   ['faltantes','faltante','faltan','diferenciafaltante','faltanpiezas'],
        sobrante:    ['sobrante','sobrantes','exceso','mercanciademas','mercancia de mas','demas'],
        registradas: ['cant. registrada','cant registrada','cantidad registrada','registrada','registradas','cant. registr.','cant. reg.','cant reg','recibidas','recibido','cant. recibida','cantidad recibida'],
        diferencia:  ['diferencia','diferencias','diferencia piezas'],
        estado:      ['status','estado','estatus','resultado','concepto'],
        adicional:   ['adicional','adicionales','pieza adicional','piezas adicionales'],
        seccion:     ['seccion','sección','secciones','area','área'],
        jefatura:    ['jefatura','jefe','jefes','responsable','gerente'],
        manifiesto:  ['manifiesto','manifesto','folio manifiesto','reporte'],
        articulo:    ['articulo','artículo','sku','codigo','código','codigoarticulo'],
        descripcion: ['descripcion','descripción','descripcionarticulo','descarticulo','desc articulo','desc. artículo'],
    };
    // Nombres legibles para los avisos de carga
    const FIELD_LABELS = {
        contenedor: 'Contenedor', piezas: 'Cant. Manf. (piezas)', faltantes: 'Faltantes', sobrante: 'Sobrantes',
        registradas: 'Cant. Registrada', diferencia: 'Diferencia', estado: 'Status', adicional: 'Adicional',
        seccion: 'Sección', jefatura: 'Jefatura', manifiesto: 'Manifiesto', articulo: 'Artículo', descripcion: 'Desc. Artículo',
    };

    const C = { ok:'#0E9F6E', warn:'#D97706', bad:'#DC2626', rosa:'#E6007E', vino:'#8E1A5B', violeta:'#7C3AED', txt:'#2B2027', txt2:'#6D5B66', txt3:'#9B8994', grid:'rgba(91,35,69,0.07)' };
    const ESTADOS = {
        ok:    { label:'Sin diferencia', desc:'Llegó exactamente lo manifestado', color:C.ok,      icon:'bi-check-circle-fill' },
        falt:  { label:'Con faltantes',  desc:'Faltaron piezas, sin sobrantes',   color:C.bad,     icon:'bi-dash-circle-fill' },
        sobr:  { label:'Con sobrantes',  desc:'Sobrantes o adicionales, sin faltantes', color:C.warn, icon:'bi-plus-circle-fill' },
        mixto: { label:'Mixto',          desc:'Tiene faltantes y sobrantes',      color:C.violeta, icon:'bi-shuffle' },
    };
    // Los cuatro conceptos que trae el archivo VCM (columna Status)
    const CONCEPTOS = {
        correcto:  { label:'Correcto',  icon:'bi-check-circle-fill' },
        faltante:  { label:'Faltante',  icon:'bi-dash-circle-fill' },
        sobrante:  { label:'Sobrante',  icon:'bi-plus-circle-fill' },
        adicional: { label:'Adicional', icon:'bi-box-seam-fill' },
    };
    const CONCEPTO_ORDEN = { faltante: 0, sobrante: 1, adicional: 2, correcto: 3 };
    const CONCEPTO_KEYS  = ['faltante', 'sobrante', 'adicional', 'correcto'];
    const CONCEPTO_BIT   = { faltante: 1, sobrante: 2, adicional: 4, correcto: 8 };

    // ── ESTADO ───────────────────────────────────────────────────────────────
    const State = {
        currentUser: null,
        isAdmin: false,
        allReportes: [],
        allRows: [],
        filteredRows: [],
        idx: null,            // índices calculados una vez al cargar
        sum: null,            // resumen de lo filtrado (una sola pasada)
        filterCont: '',       // contenedor elegido en el filtro principal
        masterMap: {},
        manifestInfo: {},
        parsedFile: null,
        parsedDatos: null,
        charts: {},
        cont: { search: '', status: '', sortKey: 'ft', sortDir: 'desc', page: 1 },
        sec:  { sortKey: 'ft', sortDir: 'desc', search: '' },
        art:  { search: '', status: 'dif', sortKey: 'dif', sortDir: 'desc', page: 1, cache: null },
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
        filterCont:       $('filter-contenedor'),
        filterContList:   $('filter-contenedor-list'),
        noDataState:      $('no-data-state'),
        dataContent:      $('data-content'),
        // upload
        dropZone:         $('drop-zone'),
        fileInput:        $('file-input'),
        filePreview:      $('filePreview'),
        btnConfirmUpload: $('btn-confirm-upload'),
        uploadError:      $('upload-error'),
        uploadErrorMsg:   $('upload-error-msg'),
        uploadWarn:       $('upload-warn'),
        uploadWarnMsg:    $('upload-warn-msg'),
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
        // Sin animaciones: con miles de datos cada cuadro animado vuelve a dibujar todas las gráficas.
        Chart.defaults.animation = false;
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
        const secs  = Object.keys(State.masterMap).length;
        $('admin-summary').textContent = `${State.allReportes.length} reportes · ${fmt(State.allRows.length)} filas · ${secs ? secs + ' secciones maestras' : 'Datos maestros sin cargar'}`;
        $('tab-count-avance').textContent = State.allReportes.length;
    }

    // ── DATOS MAESTROS ───────────────────────────────────────────────────────
    async function loadMasterData() {
        try {
            const doc = await db.collection(DATOS_COLL).doc(DATOS_DOC).get();
            if (doc.exists && doc.data().sections) {
                // Firebase funciona como respaldo; Jefatura.json tiene prioridad para no confundir departamento con jefe.
                State.masterMap = fixDeep(doc.data().sections);
                const fecha = toDate(doc.data().uploadedAt);
                setDatosStatus(Object.keys(State.masterMap).length, fecha ? fmtDate(fecha) : '—');
            } else {
                UI.datosStatus.textContent = 'Sin cargar — las secciones no tendrán área asignada';
            }
            await loadJefaturaComplemento();
            if (Object.keys(State.masterMap).length) setDatosStatus(Object.keys(State.masterMap).length, 'catálogo VCM');
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

    // Asigna Jefatura, Descripción y Área a cada fila. Modifica las filas en su lugar
    // (sin copiarlas) y busca cada sección una sola vez.
    function enrichRows(rows) {
        const normMap = {};
        Object.keys(State.masterMap).forEach(k => { normMap[normKey(k)] = State.masterMap[k]; });
        const cache = new Map(), areaCache = new Map();
        for (const r of rows) {
            const seccion = String(r.Seccion ?? '').trim();
            let master = cache.get(seccion);
            if (master === undefined) { master = State.masterMap[seccion] || normMap[normKey(seccion)] || null; cache.set(seccion, master); }
            r.Jefatura       = master?.Jefatura    || r.Jefatura       || '—';
            r.DescripcionSec = master?.Descripcion || r.DescripcionSec || '';
            r.Gerente        = master?.Gerente     || r.Gerente        || '';
            r.Asistente      = master?.Asistente   || r.Asistente      || '';
            r.Bodega         = master?.Bodega      || r.Bodega         || '';
            let area = areaCache.get(r.Jefatura);
            if (area === undefined) { area = areaOf(r.Jefatura); areaCache.set(r.Jefatura, area); }
            r.Area = area;
        }
        return rows;
    }

    function areaOf(j) {
        const v = String(j || '').trim();
        const k = normKey(v);
        if (!v || v === '—' || k === 'sin jefatura' || k === 'sin asignar' || k === 'sin area asignada') return NO_AREA;
        return v;
    }

    // ── LECTURA DEL ARCHIVO VCM ──────────────────────────────────────────────
    function cleanHeader(s) { return normKey(s).replace(/[^a-z0-9]/g, ''); }

    // Relaciona cada dato con su encabezado una sola vez por archivo.
    function resolveHeaders(keys) {
        const cleaned = keys.map(k => [k, cleanHeader(k)]);
        const used = new Set(), map = {};
        Object.keys(RESULT_ALIASES).forEach(field => {
            for (const alias of RESULT_ALIASES[field]) {
                const ca = cleanHeader(alias);
                const hit = cleaned.find(([k, c]) => c === ca && !used.has(k));
                if (hit) { map[field] = hit[0]; used.add(hit[0]); break; }
            }
        });
        return map;
    }

    function conceptoFromStatus(raw) {
        const s = normKey(raw || '');
        if (!s) return '';
        if (s.includes('adicional')) return 'adicional';
        if (s.includes('faltante')) return 'faltante';
        if (s.includes('sobrante')) return 'sobrante';
        if (s.includes('correcto')) return 'correcto';
        return '';
    }

    function normalizeResultRow(row, map) {
        const get = key => map[key] ? row[map[key]] : '';
        const has = key => !!map[key] && row[map[key]] !== '' && row[map[key]] != null;
        const piezas = toNum(get('piezas'));
        const rawStatus = conceptoFromStatus(get('estado'));
        const rawDifference = get('diferencia');
        let registradas;
        if (has('registradas')) registradas = toNum(get('registradas'));
        else if (has('diferencia')) registradas = Math.max(piezas + toNum(rawDifference), 0);
        else registradas = Math.max(piezas - Math.abs(toNum(get('faltantes'))) + Math.abs(toNum(get('sobrante'))) + Math.abs(toNum(get('adicional'))), 0);
        const diferencia = has('diferencia') ? toNum(rawDifference) : registradas - piezas;

        const concepto = rawStatus
            || (toNum(get('adicional')) > 0 || (piezas === 0 && registradas > 0) ? 'adicional'
            : diferencia < 0 ? 'faltante' : diferencia > 0 ? 'sobrante' : 'correcto');
        // Cada pieza se cuenta en un solo concepto: un Adicional no suma también como Sobrante.
        // Si un Adicional sí traía piezas manifestadas, lo que no llegó de ellas sigue siendo faltante.
        const esAdic = concepto === 'adicional';
        const adicional = esAdic ? (Math.abs(toNum(get('adicional'))) || (piezas > 0 ? Math.max(diferencia, 0) : Math.max(registradas, diferencia, 0))) : 0;
        const faltantes = esAdic && piezas === 0 ? 0 : (Math.abs(toNum(get('faltantes'))) || Math.max(-diferencia, 0));
        const sobrante  = esAdic ? 0 : (Math.abs(toNum(get('sobrante'))) || Math.max(diferencia, 0));
        return {
            Contenedor:  String(get('contenedor') || 'General').trim(),
            Piezas:      piezas,
            Registradas: registradas,
            Diferencia:  diferencia,
            Faltantes:   faltantes,
            Sobrante:    sobrante,
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

    // ── FILAS GUARDADAS ──────────────────────────────────────────────────────
    // Deja cada fila lista para calcular: números como número, textos reparados,
    // concepto definido y un Adicional que no se cuenta también como Sobrante.
    function prepareRows(rows, manifestoId) {
        const fix = window.fixText || (v => v);
        for (const r of rows) {
            for (const k in r) { const v = r[k]; if (typeof v === 'string' && v) r[k] = fix(v); }
            r.Piezas    = num(r.Piezas);
            r.Faltantes = num(r.Faltantes);
            r.Sobrante  = num(r.Sobrante);
            r.Adicional = num(r.Adicional);
            const hadRegistradas = r.Registradas !== undefined && r.Registradas !== null && r.Registradas !== '';
            r.Registradas = hadRegistradas ? num(r.Registradas) : Math.max(r.Piezas - r.Faltantes + r.Sobrante + r.Adicional, 0);
            r.Manifiesto = String(r.Manifiesto || manifestoId || 'GENERAL');
            r.Contenedor = String(r.Contenedor ?? 'General');
            r.Seccion    = String(r.Seccion ?? 'Sin sección');
            r.Articulo   = r.Articulo == null ? '' : String(r.Articulo);
            let c = CONCEPTOS[r.Concepto] ? r.Concepto : conceptoFromStatus(r.Concepto);
            if (!c) c = r.Adicional > 0 || (r.Piezas === 0 && r.Registradas > 0) ? 'adicional' : r.Faltantes > 0 ? 'faltante' : r.Sobrante > 0 ? 'sobrante' : 'correcto';
            r.Concepto = c;
            if (c === 'adicional') {
                if (r.Piezas > 0) r.Adicional = Math.max(r.Registradas - r.Piezas, 0);   // solo lo que excede lo manifestado
                else { if (!r.Adicional) r.Adicional = Math.max(r.Sobrante, r.Registradas, 0); r.Faltantes = 0; }
                r.Sobrante = 0;
            }
            r.Correcto = c === 'correcto' ? (num(r.Correcto) || r.Piezas) : 0;
        }
        return rows;
    }

    // Índices por reporte, sección y contenedor. Se calculan una vez al cargar
    // y los reutilizan filtros, tablas, gráficas y exportación.
    async function buildIndex(rows) {
        const byManif = new Map(), bySec = new Map(), byCont = new Map();
        const secInfo = new Map(), combos = new Map(), contInfo = new Map();
        // Números de contenedor (_ci, contenedor dentro de su reporte) y de línea (_ai, artículo
        // dentro del contenedor). Con ellos se agrupa después sin armar ni comparar textos.
        const ckTree = new Map();
        let nCk = 0, nAk = 0, treeM = null, mapM = null, entryC = null;
        let prevCombo = '', prevM = null, prevA = null, prevS = null, ci = null;
        let lastYield = performance.now();
        for (let i = 0; i < rows.length; i++) {
            // Cede el turno al navegador cada ~50 ms para que la página siga respondiendo.
            if ((i & 4095) === 0 && performance.now() - lastYield > 50) { await yieldToBrowser(); lastYield = performance.now(); }
            const r = rows[i];
            pushTo(byManif, r.Manifiesto, r);
            pushTo(bySec, r.Seccion, r);
            pushTo(byCont, r.Contenedor, r);
            if (r.Manifiesto !== treeM) {
                treeM = r.Manifiesto; entryC = null;
                mapM = ckTree.get(treeM);
                if (!mapM) ckTree.set(treeM, mapM = new Map());
            }
            if (!entryC || entryC.code !== r.Contenedor) {
                entryC = mapM.get(r.Contenedor);
                if (!entryC) mapM.set(r.Contenedor, entryC = { code: r.Contenedor, ci: nCk++, arts: new Map() });
            }
            r._ci = entryC.ci;
            let ai = entryC.arts.get(r.Articulo);
            if (ai === undefined) { ai = nAk++; entryC.arts.set(r.Articulo, ai); }
            r._ai = ai;
            let si = secInfo.get(r.Seccion);
            if (!si) secInfo.set(r.Seccion, si = { desc: '', area: r.Area });
            if (!si.desc && r.DescripcionSec && r.DescripcionSec !== r.Seccion) si.desc = r.DescripcionSec;
            if (r.Manifiesto !== prevM || r.Area !== prevA || r.Seccion !== prevS) {
                prevM = r.Manifiesto; prevA = r.Area; prevS = r.Seccion;
                prevCombo = prevM + '' + prevA + '' + prevS;
                if (!combos.has(prevCombo)) combos.set(prevCombo, { m: prevM, a: prevA, s: prevS });
                ci = null;
            }
            if (!ci || ci.code !== r.Contenedor) {
                ci = contInfo.get(r.Contenedor);
                if (!ci) contInfo.set(r.Contenedor, ci = { code: r.Contenedor, manifs: new Set(), combos: new Set(), lines: 0 });
                ci.manifs.add(r.Manifiesto); ci.combos.add(prevCombo);
            }
            ci.lines++;
        }
        const manifList = [...byManif.keys()].sort((a, b) => manifDate(b) - manifDate(a) || COLL.compare(a, b));
        const contCodes = [...contInfo.keys()].sort((a, b) => COLL.compare(a, b));
        return { byManif, bySec, byCont, secInfo, combos: [...combos.values()], comboMap: combos, contInfo, contCodes, manifList,
                 nCk, nAk, contSearch: null };
    }

    function pushTo(map, key, r) { const a = map.get(key); if (a) a.push(r); else map.set(key, [r]); }

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
            // Volver a leer para reflejar las nuevas áreas (las filas se enriquecen en su lugar)
            await loadReportes();
            Swal.fire({ icon: 'success', title: '¡Listo!', text: `${Object.keys(sections).length} secciones cargadas.`, timer: 2300, showConfirmButton: false });
        } catch (err) { console.error(err); showDatosError('Error al guardar.'); }
        finally { UI.btnDatosConfirm.disabled = false; UI.btnDatosConfirm.innerHTML = '<i class="bi bi-database-fill-up"></i> Guardar'; }
    });

    function showDatosError(msg) {
        UI.datosErrorMsg.textContent = msg;
        UI.datosError.style.display = 'block';
    }

    // ── CARGA DE REPORTES ────────────────────────────────────────────────────
    // opts.fresh: leer del servidor (después de subir o borrar). opts.background: sin pantalla de carga.
    async function loadReportes(opts = {}) {
        if (!opts.background) showLoading();
        try {
            // Primero lo que el navegador ya tiene guardado: se muestra al instante sin volver a
            // descargar todos los reportes. Después se revisa en segundo plano si hubo cambios.
            // Sin orderBy: los registros sin uploadedAt también deben aparecer.
            let snap = null, fromCache = false;
            if (!opts.fresh) {
                try {
                    snap = await db.collection(COLLECTION).get({ source: 'cache' });
                    fromCache = snap.docs.some(d => d.id !== META_ID);
                } catch (_) { snap = null; }
            }
            if (!fromCache) snap = await db.collection(COLLECTION).get(opts.fresh ? { source: 'server' } : undefined);
            // Reportes grandes se guardan en varias partes (límite 1 MiB por documento); se reagrupan por chunkGroup.
            const grouped = {};
            const reportes = [];
            // Se procesa por partes, cediendo el turno al navegador para que la página no se congele.
            let lastYield = performance.now();
            for (const d of snap.docs) {
                if (d.id === META_ID) continue;
                if (performance.now() - lastYield > 40) { await yieldToBrowser(); lastYield = performance.now(); }
                const data = d.data();
                const rows = prepareRows(data.rows || [], data.manifestoId);
                delete data.rows;
                if (data.chunkGroup) {
                    const g = grouped[data.chunkGroup];
                    if (g) { g.ids.push(d.id); g.parts.push({ part: data.part || 0, rows }); continue; }
                    const entry = { id: d.id, ...data, ids: [d.id], parts: [{ part: data.part || 0, rows }] };
                    grouped[data.chunkGroup] = entry;
                    reportes.push(entry);
                } else {
                    reportes.push({ id: d.id, ...data, ids: [d.id], rows });
                }
            }
            State.allReportes = reportes;
            Object.values(grouped).forEach(e => {
                e.parts.sort((a, b) => a.part - b.part);
                e.rows = [];
                e.parts.forEach(p => { for (const r of p.rows) e.rows.push(r); });
                delete e.parts;
            });
            State.allReportes.sort((a, b) => (toDate(b.uploadedAt)?.getTime() || 0) - (toDate(a.uploadedAt)?.getTime() || 0));

            State.manifestInfo = {};
            const all = [];
            State.allReportes.forEach(r => {
                const d = toDate(r.uploadedAt);
                const seen = new Set();
                for (const row of r.rows) { all.push(row); seen.add(row.Manifiesto); }
                seen.forEach(m => {
                    const prev = State.manifestInfo[m];
                    if (!prev || (d && (!prev.date || d > prev.date))) State.manifestInfo[m] = { date: d, by: r.uploadedByEmail || '', file: r.fileName || '' };
                });
                r.tot = agg(r.rows);
            });

            await yieldToBrowser();
            State.allRows = enrichRows(all);
            await yieldToBrowser();
            State.idx = await buildIndex(State.allRows);
            await yieldToBrowser();
            State.art.cache = null;
            renderAdminList();
            updateAdminSummary();
            applyFilters({ progressive: true });
            // El texto de búsqueda de contenedores se arma cuando el navegador está libre.
            prebuildContSearch();
            if (fromCache) checkForUpdates(snap);
        } catch (e) {
            console.error(e);
            UI.noDataState.style.display = 'block';
            UI.dataContent.style.display = 'none';
            UI.noDataState.querySelector('p').innerHTML = `No se pudieron leer los resultados.<br><small>${esc(e.code || e.message || 'Revisa Firebase y vuelve a intentar.')}</small>`;
            Swal.fire({ icon: 'error', title: 'No se pudieron cargar los resultados', text: e.code || e.message || 'Revisa Firebase y vuelve a intentar.' });
        } finally { if (!opts.background) hideLoading(); }
    }

    // Documento reportesDashboard/_meta: cambia su versión cada vez que se sube o borra un reporte.
    // Si la versión del servidor es la misma que la guardada en el navegador, no se descarga nada.
    async function checkForUpdates(cacheSnap) {
        try {
            const cached = cacheSnap.docs.find(d => d.id === META_ID)?.data()?.version || null;
            const server = await db.collection(COLLECTION).doc(META_ID).get({ source: 'server' });
            const current = server.exists ? server.data().version : null;
            if (current && current === cached) return;
            await loadReportes({ fresh: true, background: true });
            if (!current) { if (State.isAdmin) await bumpMeta(); return; }
            Swal.fire({ toast: true, position: 'bottom-end', icon: 'info', title: 'Datos actualizados', timer: 2500, showConfirmButton: false });
        } catch (e) { console.warn('No se pudo revisar si hay reportes nuevos', e); }
    }

    function bumpMeta() {
        return db.collection(COLLECTION).doc(META_ID).set({
            version: Date.now() + '-' + (State.currentUser?.uid || ''),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    }

    // ── FILTROS ──────────────────────────────────────────────────────────────
    function fillSelect(el, items, placeholder) {
        const current = el.value;
        const sig = placeholder + '\u0002' + items.map(it => it.value + '\u0001' + it.label).join('\u0002');
        if (el._sig !== sig) {          // solo se reconstruye si cambió la lista
            el._sig = sig;
            el.innerHTML = `<option value="">${placeholder}</option>` +
                items.map(it => `<option value="${esc(it.value)}">${esc(it.label)}</option>`).join('');
        }
        el.value = items.some(it => it.value === current) ? current : '';
        el.classList.toggle('is-set', !!el.value);
    }

    function refreshFilterOptions() {
        const idx = State.idx;
        if (!idx) return;
        fillSelect(UI.filterManifiesto, idx.manifList.map(m => ({ value: m, label: manifLabel(m) })), 'Todos los reportes');

        const fM = UI.filterManifiesto.value;
        const combosM = fM ? idx.combos.filter(c => c.m === fM) : idx.combos;
        const areas = uniq(combosM.map(c => c.a)).sort(areaSort);
        fillSelect(UI.filterJefatura, areas.map(a => ({ value: a, label: a })), 'Todas las áreas');

        const fJ = UI.filterJefatura.value;
        const secs = uniq((fJ ? combosM.filter(c => c.a === fJ) : combosM).map(c => c.s))
            .sort((a, b) => COLL.compare(a, b));
        fillSelect(UI.filterSeccion, secs.map(s => { const d = descSeccion(s); return { value: s, label: d && d !== s ? `${s} · ${d}` : s }; }), 'Todas las secciones');

        // Un contenedor que ya no existe con los otros filtros se quita.
        if (State.filterCont && !contMatches(State.filterCont)) setContFilterValue('');
    }

    function currentFilters() {
        return { m: UI.filterManifiesto.value, a: UI.filterJefatura.value, s: UI.filterSeccion.value, c: State.filterCont };
    }

    // ¿El contenedor tiene filas con el reporte/área/sección elegidos?
    function contMatches(code) {
        const ci = State.idx?.contInfo.get(code);
        if (!ci) return false;
        const { m, a, s } = currentFilters();
        if (!m && !a && !s) return true;
        for (const k of ci.combos) {
            const c = State.idx.comboMap.get(k);
            if ((!m || c.m === m) && (!a || c.a === a) && (!s || c.s === s)) return true;
        }
        return false;
    }

    function computeFiltered() {
        const { m, a, s, c } = currentFilters();
        if (!m && !a && !s && !c) return State.allRows;
        const idx = State.idx;
        // Se parte del índice más chico disponible en vez de recorrer todas las filas.
        const base = c ? idx.byCont.get(c) : s ? idx.bySec.get(s) : m ? idx.byManif.get(m) : State.allRows;
        if (!base) return [];
        return base.filter(r => (!m || r.Manifiesto === m) && (!a || r.Area === a) && (!s || r.Seccion === s) && (!c || r.Contenedor === c));
    }

    // opts.progressive: dibuja por partes (solo en la carga inicial). Los listeners pasan un Event, que se ignora.
    function applyFilters(opts) {
        const progressive = !!(opts && opts.progressive === true);
        refreshFilterOptions();
        State.filteredRows = computeFiltered();
        State.cont.page = 1;
        State.art.page = 1;
        State.art.cache = null;
        // Con un contenedor elegido se ven todos sus SKU, también los correctos;
        // al quitarlo se regresa a la vista que se tenía antes.
        const st = State.art;
        if (State.filterCont !== (st.lastCont || '')) {
            if (State.filterCont) { if (!st.lastCont) st.prevStatus = st.status; st.status = 'all'; }
            else st.status = st.prevStatus || 'dif';
            st.lastCont = State.filterCont;
        }
        renderActiveFilters();

        if (State.allRows.length === 0) {
            UI.noDataState.style.display = 'block';
            UI.dataContent.style.display = 'none';
            State.sum = summarize([]);
            renderHero(State.sum);
            return;
        }
        UI.noDataState.style.display = 'none';
        UI.dataContent.style.display = 'block';
        if (progressive) renderAllProgressive(); else renderAll();
    }

    [UI.filterManifiesto, UI.filterJefatura, UI.filterSeccion].forEach(el => el.addEventListener('change', applyFilters));
    $('btn-reset-filters').addEventListener('click', () => {
        UI.filterManifiesto.value = ''; UI.filterJefatura.value = ''; UI.filterSeccion.value = '';
        setContFilterValue('');
        applyFilters();
    });

    function setFilter(el, value) {
        el.value = el.value === value ? '' : value;
        applyFilters();
    }

    function renderActiveFilters() {
        const box = $('filter-active');
        const list = [
            { lbl: 'Reporte', text: UI.filterManifiesto.value ? UI.filterManifiesto.options[UI.filterManifiesto.selectedIndex]?.text : '', clear: () => { UI.filterManifiesto.value = ''; } },
            { lbl: 'Área',    text: UI.filterJefatura.value ? UI.filterJefatura.options[UI.filterJefatura.selectedIndex]?.text : '', clear: () => { UI.filterJefatura.value = ''; } },
            { lbl: 'Sección', text: UI.filterSeccion.value ? UI.filterSeccion.options[UI.filterSeccion.selectedIndex]?.text : '', clear: () => { UI.filterSeccion.value = ''; } },
            { lbl: 'Contenedor', text: State.filterCont, clear: () => setContFilterValue('') },
        ].filter(p => p.text);
        box.innerHTML = list.length ? '<span>Filtros activos:</span>' + list.map((p, i) =>
            `<span class="db-filter-pill">${p.lbl}: ${esc(p.text)} <button type="button" data-clear="${i}" aria-label="Quitar filtro ${p.lbl}">✕</button></span>`).join('') : '';
        box.classList.toggle('show', list.length > 0);
        box.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
            list[+b.dataset.clear].clear();
            applyFilters();
        }));
    }

    // ── FILTRO CONTENEDOR (se busca escribiendo) ─────────────────────────────
    let suggestTimer = null, suggestItems = [], suggestActive = -1, suggestQuery = null;

    function setContFilterValue(code) {
        State.filterCont = code || '';
        if (UI.filterCont) {
            UI.filterCont.value = State.filterCont;
            UI.filterCont.classList.toggle('is-set', !!State.filterCont);
        }
        closeSuggest();
    }

    function chooseContainer(code) {
        setContFilterValue(code);
        applyFilters();
    }

    function suggestContainers(q) {
        const idx = State.idx;
        if (!idx) return { items: [], more: 0 };
        q = q.trim().toUpperCase();
        const starts = [], contains = [];
        let more = 0;
        for (const code of idx.contCodes) {
            const up = code.toUpperCase();
            const pos = q ? up.indexOf(q) : 0;
            if (pos < 0 || !contMatches(code)) continue;
            if (starts.length + contains.length >= SUGGEST_MAX) { more++; continue; }
            (pos === 0 ? starts : contains).push(code);
        }
        return { items: starts.concat(contains), more };
    }

    function renderSuggest() {
        const list = UI.filterContList;
        if (!list) return;
        clearTimeout(suggestTimer); suggestTimer = null;
        if (document.activeElement !== UI.filterCont) { closeSuggest(); return; }
        suggestQuery = UI.filterCont.value;
        const { items, more } = suggestContainers(suggestQuery);
        suggestItems = items;
        suggestActive = items.length ? 0 : -1;
        if (!items.length) {
            list.innerHTML = '<li class="db-combo-empty">Ningún contenedor coincide con los filtros</li>';
        } else {
            list.innerHTML = items.map((code, i) => {
                const ci = State.idx.contInfo.get(code);
                const ms = [...ci.manifs];
                return `<li role="option" data-i="${i}" class="${i === suggestActive ? 'active' : ''}"><span class="db-mono">${esc(code)}</span><small>${ms.length > 1 ? ms.length + ' reportes' : esc(manifLabel(ms[0]))} · ${fmt(ci.lines)} líneas</small></li>`;
            }).join('') + (more ? `<li class="db-combo-more">+${fmt(more)} más · sigue escribiendo para acotar</li>` : '');
        }
        list.hidden = false;
        UI.filterCont.setAttribute('aria-expanded', 'true');
    }

    function closeSuggest() {
        clearTimeout(suggestTimer); suggestTimer = null;
        if (!UI.filterContList) return;
        UI.filterContList.hidden = true;
        suggestQuery = null;
        UI.filterCont?.setAttribute('aria-expanded', 'false');
        suggestItems = []; suggestActive = -1;
    }

    function moveSuggest(delta) {
        if (!suggestItems.length) return;
        suggestActive = (suggestActive + delta + suggestItems.length) % suggestItems.length;
        UI.filterContList.querySelectorAll('li[data-i]').forEach(li => li.classList.toggle('active', +li.dataset.i === suggestActive));
        UI.filterContList.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
    }

    if (UI.filterCont) {
        UI.filterCont.addEventListener('input', () => {
            clearTimeout(suggestTimer);
            if (!UI.filterCont.value.trim()) {
                closeSuggest();
                if (State.filterCont) chooseContainer('');   // se borró el texto: se quita el filtro
                return;
            }
            suggestTimer = setTimeout(renderSuggest, SEARCH_DELAY);
        });
        UI.filterCont.addEventListener('focus', () => { if (State.idx) { clearTimeout(suggestTimer); suggestTimer = setTimeout(renderSuggest, 0); } });
        UI.filterCont.addEventListener('keydown', e => {
            // La lista debe corresponder a lo escrito (un lector de códigos escribe y da Enter muy rápido).
            const stale = UI.filterContList.hidden || suggestQuery !== UI.filterCont.value;
            if (e.key === 'ArrowDown') { e.preventDefault(); if (stale) renderSuggest(); else moveSuggest(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
            else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); UI.filterCont.value = State.filterCont; }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const typed = UI.filterCont.value.trim();
                const exact = State.idx?.contInfo.has(typed) ? typed : State.idx?.contCodes.find(c => c.toUpperCase() === typed.toUpperCase());
                if (exact && contMatches(exact)) { chooseContainer(exact); return; }
                if (stale) { renderSuggest(); return; }
                if (suggestItems[suggestActive]) chooseContainer(suggestItems[suggestActive]);
            }
        });
        UI.filterCont.addEventListener('blur', () => setTimeout(() => {
            closeSuggest();
            if (UI.filterCont.value.trim() !== State.filterCont) UI.filterCont.value = State.filterCont;
        }, 150));
        UI.filterContList.addEventListener('mousedown', e => {
            const li = e.target.closest('li[data-i]');
            if (!li) return;
            e.preventDefault();
            chooseContainer(suggestItems[+li.dataset.i]);
            UI.filterCont.blur();
        });
    }

    // ── RESUMEN EN UNA SOLA PASADA ───────────────────────────────────────────
    function acc(key) { return { key, pz: 0, recibidas: 0, ft: 0, sb: 0, ad: 0, correcto: 0, lines: 0, pct: null }; }
    function addRow(a, r) {
        const pz = r.Piezas, rec = r.Registradas, ft = r.Faltantes;
        a.pz += pz;
        a.recibidas += rec > 0 ? rec : (pz - ft > 0 ? pz - ft : 0);
        a.ft += ft; a.sb += r.Sobrante; a.ad += r.Adicional; a.correcto += r.Correcto; a.lines++;
    }
    function done(a) { a.pct = pctOf(a.pz, a.ft); return a; }
    function areaAcc(key) { const a = acc(key); a.secFt = new Map(); a.contSet = new Set(); a.gerSet = new Set(); return a; }

    // Totales, áreas, secciones, contenedores y reportes de las filas dadas.
    function summarize(rows) {
        const tot = acc(''), areas = new Map(), secs = new Map(), manifs = new Map();
        const lineas = { correcto: 0, faltante: 0, sobrante: 0, adicional: 0 };
        const idx = State.idx;
        const slot = new Int32Array(idx ? idx.nCk : 0).fill(-1);
        const seenA = new Uint8Array(idx ? idx.nAk : 0);
        const contList = [];
        let a = null, s = null, m = null, c = null;
        for (const r of rows) {
            addRow(tot, r);
            lineas[r.Concepto]++;
            if (!a || a.key !== r.Area) {
                a = areas.get(r.Area);
                if (!a) areas.set(r.Area, a = areaAcc(r.Area));
            }
            addRow(a, r);
            if (a._ls !== r.Seccion) { a._ls = r.Seccion; if (!a.secFt.has(r.Seccion)) a.secFt.set(r.Seccion, 0); }
            if (r.Faltantes) a.secFt.set(r.Seccion, a.secFt.get(r.Seccion) + r.Faltantes);
            if (a._lc !== r._ci) { a._lc = r._ci; a.contSet.add(r._ci); }
            if (r.Gerente && a._lg !== r.Gerente) { a._lg = r.Gerente; a.gerSet.add(r.Gerente); }

            if (!s || s.key !== r.Seccion) {
                s = secs.get(r.Seccion);
                if (!s) { s = acc(r.Seccion); s.contSet = new Set(); secs.set(r.Seccion, s); }
            }
            addRow(s, r);
            if (s._lc !== r._ci) { s._lc = r._ci; s.contSet.add(r._ci); }

            if (!c || c.ci !== r._ci) {
                const k = slot[r._ci];
                if (k >= 0) c = contList[k];
                else {
                    c = acc(r._ci); c.ci = r._ci; c.contenedor = r.Contenedor; c.manifiesto = r.Manifiesto;
                    c.secciones = new Set(); c.areas = new Set(); c.nSkus = 0;
                    slot[r._ci] = contList.length; contList.push(c);
                }
            }
            addRow(c, r);
            if (c._ls !== r.Seccion) { c._ls = r.Seccion; c.secciones.add(r.Seccion); }
            if (c._la !== r.Area) { c._la = r.Area; c.areas.add(r.Area); }
            if (r.Articulo && !seenA[r._ai]) { seenA[r._ai] = 1; c.nSkus++; }

            if (!m || m.key !== r.Manifiesto) {
                m = manifs.get(r.Manifiesto);
                if (!m) manifs.set(r.Manifiesto, m = acc(r.Manifiesto));
            }
            addRow(m, r);
        }
        done(tot);
        for (const c of contList) {
            done(c);
            const sl = [...c.secciones], al = [...c.areas];
            c.lineas = c.lines;
            c.pctSort = c.pct ?? -1;
            c.estado = estadoOf(c.ft, c.sb + c.ad);
            c.seccion = sl[0] + (sl.length > 1 ? ` +${sl.length - 1}` : '');
            c.jefatura = al[0] + (al.length > 1 ? ` +${al.length - 1}` : '');
        }
        return {
            tot, lineas,
            areas: [...areas.values()].map(done),
            secs: [...secs.values()].map(done),
            conts: contList,
            manifs: [...manifs.values()].map(done),
        };
    }

    // ── RENDER GENERAL ───────────────────────────────────────────────────────
    // Cada dibujo lleva un número; un dibujo por partes se detiene si empieza otro.
    let renderToken = 0;

    // Primer dibujo con todos los datos: se divide en pasos cortos para que el navegador
    // no marque la página como "no responde" en equipos lentos.
    async function renderAllProgressive() {
        const token = ++renderToken;
        const sum = State.sum = summarize(State.filteredRows);
        renderHero(sum);
        renderKPIs(sum);
        renderInsights(sum);
        renderSemaforo(sum);
        const steps = [
            () => renderChartJefatura(sum), () => renderChartEstado(sum), () => renderChartDiferencias(sum),
            () => renderChartSecciones(sum), () => renderChartTendencia(sum), () => renderAreaCards(sum),
            () => renderTablaSecciones(), () => renderTablaContenedores(), () => renderArticulos(),
        ];
        for (const step of steps) {
            await yieldToBrowser();
            if (token !== renderToken) return;
            step();
        }
    }

    function renderAll() {
        renderToken++;
        const sum = State.sum = summarize(State.filteredRows);
        renderHero(sum);
        renderKPIs(sum);
        renderInsights(sum);
        renderSemaforo(sum);
        renderChartJefatura(sum);
        renderChartEstado(sum);
        renderChartDiferencias(sum);
        renderChartSecciones(sum);
        renderChartTendencia(sum);
        renderAreaCards(sum);
        renderTablaSecciones();
        renderTablaContenedores();
        renderArticulos();
    }

    // ── HERO ─────────────────────────────────────────────────────────────────
    function renderHero(sum) {
        const rows = State.filteredRows;
        const tot = sum.tot;
        animateNumber($('wb-manifiestos'), sum.manifs.length);
        animateNumber($('wb-jefaturas'), sum.areas.filter(a => a.key !== NO_AREA).length);
        animateNumber($('wb-secciones'), sum.secs.length);
        animateNumber($('wb-contenedores'), sum.conts.length);

        const parts = [];
        if (UI.filterManifiesto.value) parts.push(`reporte <strong>${esc(manifLabel(UI.filterManifiesto.value))}</strong>`);
        if (UI.filterJefatura.value)   parts.push(`área <strong>${esc(UI.filterJefatura.value)}</strong>`);
        if (UI.filterSeccion.value)    parts.push(`sección <strong>${esc(UI.filterSeccion.value)}</strong>`);
        if (State.filterCont)          parts.push(`contenedor <strong>${esc(State.filterCont)}</strong>`);
        const scope = parts.length ? `Viendo ${parts.join(' · ')}.` : 'Viendo <strong>todos los reportes</strong> cargados.';
        $('hero-scope').innerHTML = rows.length
            ? `${scope} VCM esperaba <strong>${fmt(tot.pz)}</strong> piezas; se registraron <strong>${fmt(tot.recibidas)}</strong>, faltan <strong>${fmt(tot.ft)}</strong>, sobran <strong>${fmt(tot.sb)}</strong> y llegaron <strong>${fmt(tot.ad)}</strong> adicionales.`
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
    function renderKPIs(sum) {
        const tot = sum.tot, conts = sum.conts;
        const recibidas = tot.recibidas;
        const faltPct = tot.pz > 0 ? tot.ft / tot.pz * 100 : 0;
        const sobrPct = tot.pz > 0 ? tot.sb / tot.pz * 100 : 0;
        const byEst = countBy(conts, c => c.estado);
        const contFalt = (byEst.falt || 0) + (byEst.mixto || 0);
        const contSobr = (byEst.sobr || 0) + (byEst.mixto || 0);
        const conDiferencias = conts.length - (byEst.ok || 0);

        animateNumber($('kpi-piezas'), tot.pz, true);
        $('kpi-piezas-sub').innerHTML = `${fmt(conts.length)} contenedores · ${fmt(tot.lines)} líneas`;

        animateNumber($('kpi-recibidas'), recibidas, true);
        $('kpi-recibidas-sub').innerHTML = `<b>${pctTxt(tot.pz ? recibidas / tot.pz * 100 : 0)}</b> de lo esperado por VCM`;

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

        $('kpi-cont-ok').textContent = fmt(conDiferencias);
        $('kpi-cont-ok-sub').innerHTML = `<b>${fmt(contFalt)}</b> con faltantes · <b>${fmt(contSobr)}</b> con sobrantes`;
        if ($('kpi-faltantes-vcm')) $('kpi-faltantes-vcm').textContent = fmt(tot.ft);
        if ($('kpi-sobrantes-vcm')) $('kpi-sobrantes-vcm').textContent = fmt(tot.sb);
        if ($('kpi-adicional')) $('kpi-adicional').textContent = fmt(tot.ad);
        if ($('kpi-correcto')) $('kpi-correcto').textContent = fmt(tot.correcto);
    }

    // ── HALLAZGOS ────────────────────────────────────────────────────────────
    function renderInsights(sum) {
        const items = [];
        const tot = sum.tot, conts = sum.conts;
        const areas = sum.areas.filter(a => a.key !== NO_AREA && a.pz > 0);
        const secs  = sum.secs;

        // Archivo sin lecturas de recepción: todo sale faltante aunque no lo sea.
        if (tot.pz > 0 && tot.recibidas === 0 && sum.lineas.faltante === tot.lines) {
            items.push({ tone: 'bad', icon: 'bi-exclamation-octagon-fill', title: 'Sin registros de recepción',
                text: `Las <strong>${fmt(tot.lines)}</strong> líneas vienen con <strong>Cant. Registrada en 0</strong> y status Faltante. Así lo trae el archivo VCM: revisa que se haya exportado después de escanear y con todos los status (Correcto, Faltante, Sobrante y Adicional).` });
        }

        if (tot.ft === 0 && tot.sb === 0 && tot.ad === 0) {
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
            let accu = 0, n = 0;
            for (const s of secFt) { accu += s.ft; n++; if (accu >= tot.ft * 0.8) break; }
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

        if (tot.ad > 0) {
            const nCont = conts.filter(c => c.ad > 0).length;
            items.push({ tone: 'info', icon: 'bi-box-seam-fill', title: 'Mercancía adicional',
                text: `Llegaron <strong>${fmt(tot.ad)}</strong> piezas no manifestadas en <strong>${fmt(nCont)}</strong> contenedores.` });
        }

        const sinArea = sum.areas.find(a => a.key === NO_AREA);
        if (sinArea) {
            items.push({ tone: 'info', icon: 'bi-database-exclamation', title: 'Datos incompletos',
                text: `<strong>${fmt(sinArea.pz)}</strong> piezas en <strong>${sinArea.secFt.size}</strong> secciones no tienen área asignada. Actualiza Datos Maestros.` });
        }

        $('insights-list').innerHTML = items.slice(0, 8).map(it => `
            <li class="db-insight" data-tone="${it.tone}">
                <span class="db-insight-icon"><i class="bi ${it.icon}"></i></span>
                <div><div class="db-insight-title">${it.title}</div><div class="db-insight-text">${it.text}</div></div>
            </li>`).join('');
    }

    // ── SEMÁFORO ─────────────────────────────────────────────────────────────
    function renderSemaforo(sum) {
        const tot = sum.tot;
        const areas = sum.areas.filter(a => a.key !== NO_AREA && a.pct != null);
        const c = countBy(areas, a => toneOf(a.pct));
        $('sem-good').textContent = c.good || 0;
        $('sem-warn').textContent = c.warn || 0;
        $('sem-bad').textContent  = c.bad  || 0;

        const recibidas = Math.max(tot.recibidas - tot.sb - tot.ad, 0);
        const base = recibidas + tot.ft + tot.sb + tot.ad || 1;
        const segs = [
            ['Recibidas', recibidas, C.ok],
            ['Faltantes', tot.ft, C.bad],
            ['Sobrantes', tot.sb, C.warn],
            ['Adicional', tot.ad, C.violeta],
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
            const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
            ctx.save();
            ctx.strokeStyle = C.txt; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
            if (y?.type === 'linear' && x?.type === 'category') {
                const yp = y.getPixelForValue(opts.value); ctx.beginPath(); ctx.moveTo(left, yp); ctx.lineTo(right, yp); ctx.stroke();
                ctx.setLineDash([]); ctx.fillStyle = C.txt; ctx.font = "700 10px Inter, sans-serif"; ctx.textAlign = 'right'; ctx.fillText(`Meta ${opts.value}%`, right, yp - 4);
            } else {
                const xp = x.getPixelForValue(opts.value); ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke();
                ctx.setLineDash([]); ctx.fillStyle = C.txt; ctx.font = "700 10px Inter, sans-serif"; ctx.textAlign = 'center'; ctx.fillText(`Meta ${opts.value}%`, xp, top - 4);
            }
            ctx.restore();
        }
    };

    function chartReset(name) { if (State.charts[name]) { State.charts[name].destroy(); State.charts[name] = null; } }

    // Actualiza la gráfica existente en vez de destruirla y crearla de nuevo.
    function drawChart(name, canvas, config) {
        const ch = State.charts[name];
        if (ch) {
            ch.data = config.data;
            ch.options = config.options;
            ch.update('none');
            return ch;
        }
        return (State.charts[name] = new Chart(canvas, config));
    }

    function chartEmpty(canvas, msg, name) {
        const wrap = canvas.parentElement;
        let el = wrap.querySelector('.db-chart-empty');
        if (msg) {
            if (name) chartReset(name);
            canvas.style.display = 'none';
            if (!el) { el = document.createElement('div'); el.className = 'db-chart-empty'; wrap.appendChild(el); }
            el.textContent = msg;
            return true;
        }
        canvas.style.display = '';
        if (el) el.remove();
        return false;
    }

    function renderChartJefatura(sum) {
        const canvas = $('chart-jefatura');
        const areas = sum.areas.filter(a => a.pct != null).sort((a, b) => b.pct - a.pct).slice(0, 10);
        if (chartEmpty(canvas, areas.length ? '' : 'Sin datos por área', 'jefatura')) return;
        $('wrap-jefatura').style.height = '330px';
        const colors = areas.map(a => toneColor(a.pct));

        drawChart('jefatura', canvas, {
            type: 'line',
            plugins: [metaLinePlugin],
            data: { labels: areas.map(a => a.key), datasets: [{ data: areas.map(a => +a.pct.toFixed(2)), backgroundColor: colors, borderColor: C.vino, borderWidth: 2, pointRadius: 7, pointHoverRadius: 10, pointBorderWidth: 2, pointBorderColor: '#fff', showLine: true, tension: .32 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 14, right: 8 } },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterJefatura, areas[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { display: false },
                    metaLine: { value: META },
                    tooltip: { ...tooltipStyle, callbacks: {
                        label: ctx => ` Exactitud: ${pctTxt(ctx.parsed.y)}`,
                        afterLabel: ctx => { const a = areas[ctx.dataIndex]; return [` Piezas: ${fmt(a.pz)}`, ` Faltantes: ${fmt(a.ft)}`, ` Sobrantes: ${fmt(a.sb)}`, ` Adicional: ${fmt(a.ad)}`]; }
                    } }
                },
                scales: {
                    x: { ticks: { font: { size: 10, weight: '700' }, color: C.txt, maxRotation: 45, minRotation: 25 }, grid: { display: false } },
                    y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: C.grid } }
                }
            }
        });
    }

    function renderChartEstado(sum) {
        const canvas = $('chart-estado');
        const conts = sum.conts;
        const keys = Object.keys(ESTADOS);
        const counts = countBy(conts, c => c.estado);
        const data = keys.map(k => counts[k] || 0);
        const total = conts.length;
        $('donut-total').textContent = fmt(total);

        drawChart('estado', canvas, {
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

    function renderChartDiferencias(sum) {
        const canvas = $('chart-diferencias');
        const areas = sum.areas.filter(a => a.ft + a.sb + a.ad > 0).sort((a, b) => (b.ft + b.sb + b.ad) - (a.ft + a.sb + a.ad)).slice(0, 12);
        if (chartEmpty(canvas, areas.length ? '' : 'Sin faltantes ni sobrantes 🎉', 'diferencias')) return;
        $('wrap-diferencias').style.height = '330px';

        drawChart('diferencias', canvas, {
            type: 'bar',
            data: { labels: areas.map(a => a.key), datasets: [
                { type: 'bar', label: 'Faltantes', data: areas.map(a => a.ft), backgroundColor: C.bad + 'B8', borderColor: C.bad, borderWidth: 1, borderRadius: 7, maxBarThickness: 30 },
                { type: 'bar', label: 'Sobrantes', data: areas.map(a => a.sb), backgroundColor: C.warn + 'B8', borderColor: C.warn, borderWidth: 1, borderRadius: 7, maxBarThickness: 30 },
                { type: 'bar', label: 'Adicional', data: areas.map(a => a.ad), backgroundColor: C.violeta + 'B8', borderColor: C.violeta, borderWidth: 1, borderRadius: 7, maxBarThickness: 30 },
                { type: 'line', label: 'Exactitud', data: areas.map(a => +((a.pct ?? 0).toFixed(2))), yAxisID: 'y1', borderColor: C.vino, backgroundColor: C.vino, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: '#fff', pointBorderWidth: 2, tension: .32 }
            ] },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterJefatura, areas[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 11, weight: '700' } } },
                    tooltip: { ...tooltipStyle, mode: 'index', intersect: false, callbacks: { label: ctx => ctx.dataset.yAxisID === 'y1' ? ` Exactitud: ${pctTxt(ctx.parsed.y)}` : ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)} pzas` } }
                },
                scales: {
                    x: { ticks: { font: { size: 10, weight: '700' }, color: C.txt, maxRotation: 45, minRotation: 25 }, grid: { display: false } },
                    y: { beginAtZero: true, title: { display: true, text: 'Piezas', font: { size: 10, weight: '700' } }, ticks: { callback: v => fmt(v), font: { size: 10 } }, grid: { color: C.grid } },
                    y1: { min: 0, max: 100, position: 'right', title: { display: true, text: 'Exactitud', font: { size: 10, weight: '700' } }, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { display: false } }
                }
            }
        });
    }

    function renderChartSecciones(sum) {
        const canvas = $('chart-secciones');
        const tot = sum.tot;
        const secs = sum.secs.filter(s => s.ft > 0).sort((a, b) => b.ft - a.ft).slice(0, 10);
        if (chartEmpty(canvas, secs.length ? '' : 'No hay secciones con faltantes 🎉', 'secciones')) return;
        $('wrap-secciones').style.height = '330px';
        const labels = secs.map(s => s.key);

        drawChart('secciones', canvas, {
            type: 'line',
            plugins: [],
            data: { labels, datasets: [{ data: secs.map(s => s.ft), borderColor: C.bad, backgroundColor: secs.map((_, i) => i < 3 ? C.bad : C.bad + '88'), pointRadius: 7, pointHoverRadius: 10, pointBorderColor: '#fff', pointBorderWidth: 2, showLine: true, tension: .32 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { right: 50 } },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterSeccion, secs[els[0].index].key); },
                onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { display: false },
                    tooltip: { ...tooltipStyle, callbacks: {
                        title: items => { const s = secs[items[0].dataIndex]; const d = descSeccion(s.key); return `Sección ${s.key}${d ? ' · ' + d : ''}`; },
                        label: ctx => { const s = secs[ctx.dataIndex]; return [` Faltantes: ${fmt(s.ft)} (${pctTxt(tot.ft ? s.ft / tot.ft * 100 : 0)} del total)`, ` Exactitud: ${pctTxt(s.pct ?? 0)}`, ` Área: ${areaOfSeccion(s.key)}`]; }
                    } }
                },
                scales: {
                    x: { ticks: { font: { size: 9, weight: '700' }, color: C.txt, maxRotation: 50, minRotation: 25 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { callback: v => fmt(v), font: { size: 10 } }, grid: { color: C.grid } }
                }
            }
        });
    }

    function renderChartTendencia(sum) {
        const canvas = $('chart-tendencia');
        const manifs = [...sum.manifs].sort((a, b) => manifDate(a.key) - manifDate(b.key) || COLL.compare(a.key, b.key));
        if (chartEmpty(canvas, manifs.length ? '' : 'Sin reportes', 'tendencia')) return;
        const labels = ['Exactitud', 'Recibidas', 'Faltantes', 'Sobrantes', 'Adicional'];
        const pctRows = manifs.map(m => ({
            accuracy: m.pct == null ? null : +m.pct.toFixed(2),
            received: m.pz ? +(m.recibidas / m.pz * 100).toFixed(2) : 0,
            missing: m.pz ? +(m.ft / m.pz * 100).toFixed(2) : 0,
            extra: m.pz ? +(m.sb / m.pz * 100).toFixed(2) : 0,
            additional: m.pz ? +(m.ad / m.pz * 100).toFixed(2) : 0
        }));
        const colors = ['#8E1A5B', '#0E9F6E', '#DC2626', '#D97706', '#2563EB', '#7C3AED'];
        const metricKeys = ['accuracy', 'received', 'missing', 'extra', 'additional'];
        const rawOf = { accuracy: m => m.pct, received: m => m.recibidas, missing: m => m.ft, extra: m => m.sb, additional: m => m.ad };
        const datasets = manifs.map((m, index) => ({
            label: manifLabel(m.key),
            data: metricKeys.map(key => pctRows[index][key]),
            borderColor: colors[index % colors.length],
            backgroundColor: '#fff',
            borderWidth: 3,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: '#fff',
            pointBorderColor: colors[index % colors.length],
            pointBorderWidth: 2.5,
            tension: .28,
            fill: false
        }));
        drawChart('tendencia', canvas, {
            type: 'line',
            plugins: [metaLinePlugin],
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onClick: (_e, els) => { if (els[0]) setFilter(UI.filterManifiesto, manifs[els[0].datasetIndex].key); },
                plugins: {
                    legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 5, font: { size: 11, weight: '700' } } },
                    metaLine: { value: META },
                    tooltip: { ...tooltipStyle, callbacks: {
                        title: items => `${items[0].label}`,
                        label: ctx => { const m = manifs[ctx.datasetIndex], key = metricKeys[ctx.dataIndex]; return ` ${ctx.dataset.label}: ${pctTxt(ctx.parsed.y)} · ${fmt(rawOf[key](m) ?? 0)}${key === 'accuracy' ? '' : ' pzas'}`; }
                    } }
                },
                scales: {
                    x: { ticks: { font: { size: 10, weight: '600' }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
                    y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: C.grid } }
                }
            }
        });
    }

    // ── TARJETAS DE ÁREA ─────────────────────────────────────────────────────
    function renderAreaCards(sum) {
        // Ignoran el filtro de área para que se puedan comparar y alternar
        const active = UI.filterJefatura.value;
        let areaList = sum.areas;
        if (active) {
            const fM = UI.filterManifiesto.value, fS = UI.filterSeccion.value, fC = State.filterCont;
            const base = fC ? State.idx.byCont.get(fC) || [] : fS ? State.idx.bySec.get(fS) || [] : fM ? State.idx.byManif.get(fM) || [] : State.allRows;
            const rows = (fM || fS || fC) ? base.filter(r => (!fM || r.Manifiesto === fM) && (!fS || r.Seccion === fS) && (!fC || r.Contenedor === fC)) : base;
            areaList = summarizeAreas(rows);
        }
        const areas = [...areaList].sort((a, b) =>
            (a.key === NO_AREA) - (b.key === NO_AREA) || (b.pct ?? -1) - (a.pct ?? -1) || b.pz - a.pz);
        const box = $('ranking-jefatura');

        if (!areas.length) { box.innerHTML = '<div class="db-empty" style="grid-column:1/-1">Sin datos por área</div>'; return; }

        box.innerHTML = areas.map((a, i) => {
            let worstKey = '', worstFt = 0;
            a.secFt.forEach((ft, k) => { if (ft > worstFt) { worstFt = ft; worstKey = k; } });
            const nSecs = a.secFt.size;
            const gerentes = [...a.gerSet];
            const tone = a.key === NO_AREA ? 'none' : toneOf(a.pct);
            const status = tone === 'good' ? 'En meta' : tone === 'warn' ? 'Atención' : tone === 'bad' ? 'Crítico' : 'Sin asignar';
            const wd = worstKey ? descSeccion(worstKey) : '';
            const foot = worstKey
                ? `<i class="bi bi-exclamation-triangle-fill"></i> Más afectada: <strong>${esc(worstKey)}${wd ? ' · ' + esc(truncate(wd, 20)) : ''}</strong> (${fmt(worstFt)} falt.)`
                : a.sb + a.ad > 0 ? `<i class="bi bi-info-circle-fill"></i> Sin faltantes; ${fmt(a.sb + a.ad)} piezas sobrantes o adicionales`
                : `<i class="bi bi-check-circle-fill"></i> Sin diferencias en ${nSecs} secciones`;
            return `<button type="button" class="db-area${active === a.key ? ' is-active' : ''}" data-tone="${tone}" data-area="${esc(a.key)}">
                <div class="db-area-head">
                    <span class="db-area-rank">${a.key === NO_AREA ? '?' : i + 1}</span>
                    <div>
                        <div class="db-area-name">${esc(a.key)}</div>
                        <div class="db-area-meta">${nSecs} secciones${gerentes.length ? ' · ' + esc(truncate(gerentes.join(', '), 30)) : ''}</div>
                    </div>
                    <div class="db-area-pct"><strong>${a.pct == null ? '—' : pctTxt(a.pct)}</strong><small>${status}</small></div>
                </div>
                <div class="db-area-bar"><span style="width:${Math.min(a.pct ?? 0, 100)}%"></span><i></i></div>
                <div class="db-area-stats">
                    <div class="db-area-stat"><b>${fmtShort(a.pz)}</b><small>Piezas</small></div>
                    <div class="db-area-stat falt"><b>${fmt(a.ft)}</b><small>Faltan</small></div>
                    <div class="db-area-stat sobr"><b>${fmt(a.sb + a.ad)}</b><small>Sobran</small></div>
                    <div class="db-area-stat"><b>${fmt(a.contSet.size)}</b><small>Cont.</small></div>
                </div>
                <div class="db-area-foot">${foot}</div>
            </button>`;
        }).join('');
        box.querySelectorAll('.db-area').forEach(el => el.addEventListener('click', () => setFilter(UI.filterJefatura, el.dataset.area)));
    }

    function summarizeAreas(rows) {
        const areas = new Map();
        for (const r of rows) {
            let a = areas.get(r.Area);
            if (!a) areas.set(r.Area, a = areaAcc(r.Area));
            addRow(a, r);
            if (r.Faltantes) a.secFt.set(r.Seccion, (a.secFt.get(r.Seccion) || 0) + r.Faltantes);
            else if (!a.secFt.has(r.Seccion)) a.secFt.set(r.Seccion, 0);
            a.contSet.add(r._ci);
            if (r.Gerente) a.gerSet.add(r.Gerente);
        }
        return [...areas.values()].map(done);
    }

    // ── TABLA SECCIONES ──────────────────────────────────────────────────────
    function renderTablaSecciones() {
        const sum = State.sum, tot = sum.tot;
        const q = (State.sec.search || '').trim().toLowerCase();
        let secs = sum.secs.map(s => ({ ...s, seccion: s.key, jefatura: areaOfSeccion(s.key), desc: descSeccion(s.key),
            contenedores: s.contSet.size, share: tot.ft ? s.ft / tot.ft * 100 : 0, pctSort: s.pct ?? -1 }));
        if (q) secs = secs.filter(s => (s.seccion + ' ' + s.jefatura + ' ' + s.desc).toLowerCase().includes(q));
        sortBy(secs, State.sec.sortKey === 'pct' ? 'pctSort' : State.sec.sortKey, State.sec.sortDir);
        $('sec-count').textContent = `${fmt(secs.length)} secciones`;
        $('tbody-secciones').innerHTML = secs.map(s => `<tr>
                <td data-label="Sección"><strong>${esc(s.seccion)}</strong>${s.desc && s.desc !== s.seccion ? `<span class="sub">${esc(s.desc)}</span>` : ''}</td>
                <td data-label="Área">${areaCell(s.jefatura)}</td>
                <td data-label="Contenedores" class="num">${fmt(s.contenedores)}</td>
                <td data-label="Piezas" class="num">${fmt(s.pz)}</td>
                <td data-label="Faltantes" class="num ${s.ft ? 'falt' : 'zero'}">${fmt(s.ft)}</td>
                <td data-label="Sobrantes" class="num ${s.sb ? 'sobr' : 'zero'}">${fmt(s.sb)}</td>
                <td data-label="Exactitud" class="num">${pctBadge(s.pct)}</td>
                <td data-label="Peso en faltantes"><div class="db-share"><div class="db-share-bar"><span style="width:${s.share}%"></span></div><small>${s.ft ? pctTxt(s.share) : '—'}</small></div></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">Sin datos</td></tr>';
        markSort('table-secciones', State.sec);
    }

    // ── TABLA CONTENEDORES ───────────────────────────────────────────────────
    // Texto de búsqueda por contenedor (código, reporte, secciones, áreas, SKU y descripciones).
    // Se arma una sola vez con todas las filas y se reutiliza en cada búsqueda.
    function ensureContSearch() {
        const idx = State.idx;
        if (!idx) return null;
        if (!idx.contSearch) { const b = contSearchBuilder(idx); while (!b.step(Infinity)); }
        return idx.contSearch;
    }

    // Arma los textos por partes para no bloquear la página (se usa en tiempo libre).
    function contSearchBuilder(idx) {
        const rows = State.allRows, parts = new Map();
        let i = 0;
        return {
            step(budgetMs) {
                if (idx.contSearch) return true;
                const end = performance.now() + budgetMs;
                for (; i < rows.length; i++) {
                    if ((i & 2047) === 0 && performance.now() > end) return false;
                    const r = rows[i];
                    let p = parts.get(r._ci);
                    if (!p) parts.set(r._ci, p = { base: [r.Contenedor, r.Manifiesto], seen: new Set() });
                    if (!p.seen.has(r.Seccion)) { p.seen.add(r.Seccion); p.base.push(r.Seccion, r.Area); }
                    if (r.Articulo && !p.seen.has('a' + r.Articulo)) { p.seen.add('a' + r.Articulo); p.base.push(r.Articulo, r.Descripcion || ''); }
                }
                const map = new Map();
                parts.forEach((p, k) => map.set(k, p.base.join(' ').toLowerCase()));
                idx.contSearch = map;
                return true;
            }
        };
    }

    function prebuildContSearch() {
        const idx = State.idx;
        if (!idx || idx.contSearch) return;
        const b = contSearchBuilder(idx);
        const tick = deadline => {
            if (State.idx !== idx) return;                       // se recargaron los datos
            const ms = deadline && deadline.timeRemaining ? Math.max(deadline.timeRemaining(), 5) : 12;
            if (!b.step(ms)) idle(tick);
        };
        idle(tick);
    }

    function renderTablaContenedores() {
        const conts = State.sum.conts;
        const counts = countBy(conts, c => c.estado);
        document.querySelectorAll('#cont-status-chips [data-count]').forEach(el => {
            el.textContent = fmt(el.dataset.count === 'all' ? conts.length : (counts[el.dataset.count] || 0));
        });
        document.querySelectorAll('#cont-status-chips .db-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.status === State.cont.status));

        const q = State.cont.search.trim().toLowerCase();
        const search = q ? ensureContSearch() : null;
        const list = conts.filter(c => (!State.cont.status || c.estado === State.cont.status) && (!q || (search.get(c.key) || '').includes(q)));
        sortBy(list, State.cont.sortKey === 'pct' ? 'pctSort' : State.cont.sortKey, State.cont.sortDir);

        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        State.cont.page = Math.min(State.cont.page, pages);
        const start = (State.cont.page - 1) * PAGE_SIZE;
        const pageRows = list.slice(start, start + PAGE_SIZE);

        $('cont-count').textContent = `${fmt(list.length)} de ${fmt(conts.length)} contenedores`;
        $('tbody-contenedor').innerHTML = pageRows.map(c => `<tr class="is-clickable${State.filterCont === c.contenedor ? ' is-active' : ''}" data-cont="${esc(c.contenedor)}" title="Ver la mercancía de este contenedor">
                <td data-label="Contenedor"><span class="db-mono">${esc(c.contenedor)}</span><span class="sub">${fmt(c.lineas)} líneas · ${fmt(c.nSkus)} SKU</span></td>
                <td data-label="Reporte">${esc(manifLabel(c.manifiesto))}</td>
                <td data-label="Sección">${esc(c.seccion)}</td>
                <td data-label="Área">${areaCell(c.jefatura)}</td>
                <td data-label="Piezas" class="num">${fmt(c.pz)}</td>
                <td data-label="Correcto" class="num ${c.correcto ? 'ok' : 'zero'}">${fmt(c.correcto)}</td>
                <td data-label="Faltante" class="num ${c.ft ? 'falt' : 'zero'}">${fmt(c.ft)}</td>
                <td data-label="Sobrante" class="num ${c.sb ? 'sobr' : 'zero'}">${fmt(c.sb)}</td>
                <td data-label="Adicional" class="num ${c.ad ? 'adic' : 'zero'}">${fmt(c.ad)}</td>
                <td data-label="Exactitud" class="num">${pctBadge(c.pct)}</td>
                <td data-label="Estado"><span class="db-status ${c.estado}"><i class="bi ${ESTADOS[c.estado].icon}"></i>${ESTADOS[c.estado].label}</span></td>
            </tr>`).join('') || '<tr><td colspan="11" class="empty">Ningún contenedor coincide con la búsqueda</td></tr>';
        markSort('table-contenedores', State.cont);
        renderPager($('cont-pager'), State.cont, list.length, pages, 'contenedores', renderTablaContenedores);
    }

    $('tbody-contenedor').addEventListener('click', e => {
        const tr = e.target.closest('tr[data-cont]');
        if (!tr) return;
        const code = tr.dataset.cont;
        chooseContainer(State.filterCont === code ? '' : code);
        if (State.filterCont) $('articulos-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function renderPager(pager, st, total, pages, noun, rerender) {
        const p = st.page;
        if (total <= PAGE_SIZE) { pager.innerHTML = `<span>Mostrando ${fmt(total)} ${noun}</span>`; return; }
        const nums = [];
        for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
        pager.innerHTML = `<span>Mostrando ${fmt((p - 1) * PAGE_SIZE + 1)}–${fmt(Math.min(p * PAGE_SIZE, total))} de ${fmt(total)}</span>
            <div class="db-pager-btns">
                <button data-page="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                ${nums.map(n => n === '…' ? '<button disabled>…</button>' : `<button data-page="${n}" class="${n === p ? 'active' : ''}">${n}</button>`).join('')}
                <button data-page="${p + 1}" ${p === pages ? 'disabled' : ''} aria-label="Siguiente"><i class="bi bi-chevron-right"></i></button>
            </div>`;
        pager.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
            st.page = +b.dataset.page; rerender();
        }));
    }

    function setContStatus(status) {
        State.cont.status = status; State.cont.page = 1;
        renderTablaContenedores();
    }

    document.querySelectorAll('#cont-status-chips .db-chip').forEach(ch => ch.addEventListener('click', () => setContStatus(ch.dataset.status)));

    // Los buscadores esperan a que se deje de escribir antes de recalcular.
    function debounced(fn, ms = SEARCH_DELAY) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }
    $('cont-search').addEventListener('input', debounced(e => { State.cont.search = e.target.value; State.cont.page = 1; renderTablaContenedores(); }));
    $('section-search')?.addEventListener('input', debounced(e => { State.sec.search = e.target.value; renderTablaSecciones(); }));
    $('article-search')?.addEventListener('input', debounced(e => { State.art.search = e.target.value; State.art.page = 1; renderArticulos(); }));

    bindSort('table-secciones', State.sec, () => renderTablaSecciones());
    bindSort('table-contenedores', State.cont, () => renderTablaContenedores());
    bindSort('table-articulos', State.art, () => renderArticulos());

    // ── ARTÍCULOS POR CONTENEDOR ─────────────────────────────────────────────
    // Una fila por SKU dentro de su contenedor. Sin contenedor elegido se listan las
    // líneas con diferencia; con contenedor elegido, toda su mercancía.
    function articleLines() {
        const st = State.art;
        const key = st.status;
        if (st.cache && st.cache.status === key && st.cache.rows === State.filteredRows) return st.cache.list;
        const rows = State.filteredRows;
        // Se agrupa por el número de línea (_ai) calculado al cargar, sin comparar textos.
        const nA = State.idx.nAk;
        const wanted = key === 'all' ? null : new Uint8Array(nA);
        if (wanted) for (const r of rows) {
            if (r.Articulo && (key === 'dif' ? r.Concepto !== 'correcto' : r.Concepto === key)) wanted[r._ai] = 1;
        }
        const slot = new Int32Array(nA).fill(-1), list = [];
        for (const r of rows) {
            if (!r.Articulo || (wanted && !wanted[r._ai])) continue;
            let g;
            const k = slot[r._ai];
            if (k >= 0) g = list[k];
            else {
                g = { contenedor: r.Contenedor, manifiesto: r.Manifiesto, articulo: r.Articulo, desc: '', area: r.Area,
                      pz: 0, reg: 0, ft: 0, sb: 0, ad: 0, mask: 0, search: null };
                slot[r._ai] = list.length;
                list.push(g);
            }
            g.pz += r.Piezas; g.reg += r.Registradas; g.ft += r.Faltantes; g.sb += r.Sobrante; g.ad += r.Adicional;
            g.mask |= CONCEPTO_BIT[r.Concepto];
            if (!g.desc && r.Descripcion) g.desc = r.Descripcion;
        }
        for (const g of list) {
            g.dif = g.reg - g.pz;
            g.difAbs = g.ft + g.sb + g.ad;
            g.conceptos = CONCEPTO_KEYS.filter(k => g.mask & CONCEPTO_BIT[k]);   // ya en orden de importancia
            g.concepto = g.conceptos[0];
        }
        st.cache = { status: key, rows: State.filteredRows, list, sorted: null, sortSig: '' };
        return list;
    }

    // El texto de búsqueda de cada línea se arma solo cuando se busca.
    function artSearchText(g) {
        return g.search || (g.search = (g.contenedor + ' ' + g.articulo + ' ' + g.desc + ' ' + g.area + ' ' + g.conceptos.map(c => CONCEPTOS[c].label).join(' ')).toLowerCase());
    }

    function renderArticulos() {
        const block = $('articulos-block');
        const hasArt = State.filteredRows.some(r => r.Articulo);
        block.style.display = hasArt ? 'block' : 'none';
        if (!hasArt) return;
        const st = State.art;
        const fC = State.filterCont;

        $('art-title').textContent = fC ? `Mercancía del contenedor ${fC}` : 'Artículos por contenedor';
        document.querySelectorAll('#art-status-chips .db-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.status === st.status));

        const q = (st.search || '').trim().toLowerCase();
        articleLines();
        // El orden se calcula una vez por vista; buscar solo filtra la lista ya ordenada.
        const cache = st.cache, sig = st.sortKey + '|' + st.sortDir;
        if (cache.sortSig !== sig) {
            const dir = st.sortDir === 'asc' ? 1 : -1;
            const sorted = cache.list.slice();
            if (st.sortKey === 'dif') sorted.sort((a, b) => (a.difAbs - b.difAbs) * dir || CONCEPTO_ORDEN[a.concepto] - CONCEPTO_ORDEN[b.concepto]);
            else if (st.sortKey === 'concepto') sorted.sort((a, b) => (CONCEPTO_ORDEN[a.concepto] - CONCEPTO_ORDEN[b.concepto]) * dir || b.difAbs - a.difAbs);
            else sortBy(sorted, st.sortKey, st.sortDir);
            cache.sorted = sorted; cache.sortSig = sig;
        }
        let list = cache.sorted;
        if (q) list = list.filter(g => artSearchText(g).includes(q));

        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        st.page = Math.min(st.page, pages);
        const start = (st.page - 1) * PAGE_SIZE;
        const pageRows = list.slice(start, start + PAGE_SIZE);
        const what = st.status === 'all' ? 'SKU' : st.status === 'dif' ? 'SKU con diferencia' : `SKU ${CONCEPTOS[st.status].label.toLowerCase()}`;
        $('art-count').textContent = `${fmt(list.length)} ${what}${fC ? '' : ' · elige un contenedor para ver toda su mercancía'}`;

        // El reporte se muestra si puede haber el mismo contenedor en varios reportes.
        const showRep = !UI.filterManifiesto.value && (!fC || (State.idx.contInfo.get(fC)?.manifs.size || 0) > 1);
        $('tbody-articulos').innerHTML = pageRows.map(a => `<tr>
                <td data-label="Contenedor"><span class="db-mono">${esc(a.contenedor)}</span>${showRep ? `<span class="sub">${esc(manifLabel(a.manifiesto))}</span>` : ''}</td>
                <td data-label="Artículo"><span class="db-mono">${esc(a.articulo)}</span></td>
                <td data-label="Descripción">${esc(a.desc || '—')}</td>
                <td data-label="Área">${areaCell(a.area)}</td>
                <td data-label="Esperadas" class="num">${fmt(a.pz)}</td>
                <td data-label="Registradas" class="num">${fmt(a.reg)}</td>
                <td data-label="Diferencia" class="num ${a.dif < 0 ? 'falt' : a.dif > 0 ? 'sobr' : 'zero'}">${a.dif > 0 ? '+' : ''}${fmt(a.dif)}</td>
                <td data-label="Concepto">${a.conceptos.map(conceptBadge).join(' ')}</td>
            </tr>`).join('') || `<tr><td colspan="8" class="empty">${st.status === 'dif' && !q ? 'Ningún artículo tiene diferencias 🎉' : 'Ningún artículo coincide'}</td></tr>`;
        markSort('table-articulos', st);
        renderPager($('art-pager'), st, list.length, pages, 'SKU', renderArticulos);
    }

    document.querySelectorAll('#art-status-chips .db-chip').forEach(ch => ch.addEventListener('click', () => {
        State.art.status = ch.dataset.status;
        State.art.page = 1;
        renderArticulos();
    }));

    // Cada KPI explica su origen y muestra el detalle que lo compone.
    function showKpiExplanation(kind) {
        const sum = State.sum || summarize(State.filteredRows), tot = sum.tot, conts = sum.conts;
        const titles = { expected: 'Piezas esperadas por VCM', received: 'Piezas recibidas / registradas', missing: 'Piezas faltantes', extra: 'Piezas sobrantes', accuracy: 'Exactitud de recepción', containers: 'Contenedores con diferencias' };
        let body = '';
        if (kind === 'expected') body = `<p>Es la suma de la columna Cant. Manf. del archivo VCM: <b>${fmt(tot.pz)}</b> piezas que el sistema esperaba recibir.</p>`;
        if (kind === 'received') body = `<p>Es la suma de las piezas registradas o escaneadas: <b>${fmt(tot.recibidas)}</b>. Comparadas contra ${fmt(tot.pz)} esperadas, quedan <b>${fmt(Math.max(tot.pz - tot.recibidas, 0))}</b> pendientes.</p>`;
        if (kind === 'missing') body = `<p>Son piezas esperadas que no aparecen como recibidas. Total: <b>${fmt(tot.ft)}</b>.</p>${topDetail(sum, 'ft')}`;
        if (kind === 'extra') body = `<p>Son piezas recibidas por encima de lo esperado (Sobrante): <b>${fmt(tot.sb)}</b>. La mercancía no manifestada (Adicional) se cuenta aparte: <b>${fmt(tot.ad)}</b>.</p>${topDetail(sum, 'sb')}`;
        if (kind === 'accuracy') body = `<p>Fórmula: (piezas esperadas − faltantes) ÷ piezas esperadas × 100.</p><div class="kpi-explain-formula">(<b>${fmt(tot.pz)}</b> − <b>${fmt(tot.ft)}</b>) ÷ <b>${fmt(tot.pz)}</b> = <strong>${pctTxt(tot.pct)}</strong></div><p>${tot.ft ? `La diferencia principal son ${fmt(tot.ft)} piezas faltantes.` : 'No hay faltantes registrados.'}</p>`;
        if (kind === 'containers') { const bad = conts.filter(c => c.estado !== 'ok').sort((a,b) => (b.ft+b.sb+b.ad)-(a.ft+a.sb+a.ad)); body = `<p><b>${fmt(bad.length)}</b> de ${fmt(conts.length)} contenedores tienen faltantes, sobrantes o adicionales.</p>` + (bad.length ? `<div class="kpi-detail-list">${bad.slice(0,12).map(c => `<div><b>${esc(c.contenedor)}</b><span>${[c.ft ? `Faltan ${fmt(c.ft)}` : '', c.sb ? `Sobran ${fmt(c.sb)}` : '', c.ad ? `Adicional ${fmt(c.ad)}` : ''].filter(Boolean).join(' · ')}</span></div>`).join('')}</div>` : '<p class="text-success">Todos están completos.</p>'); }
        Swal.fire({ title: titles[kind], html: `<div class="kpi-explain">${body}</div>`, confirmButtonText: 'Entendido', customClass: { popup: 'db-swal-popup' } });
    }
    function topDetail(sum, key) { const groups = sum.secs.filter(g => g[key] > 0).sort((a,b) => b[key] - a[key]).slice(0, 6); return groups.length ? `<div class="kpi-detail-list">${groups.map(g => `<div><b>Sección ${esc(g.key)}</b><span>${fmt(g[key])} piezas</span></div>`).join('')}</div>` : '<p class="text-success">No hay registros para este resultado.</p>'; }
    document.querySelectorAll('.db-kpi[data-kpi]').forEach(card => { card.addEventListener('click', () => showKpiExplanation(card.dataset.kpi)); card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showKpiExplanation(card.dataset.kpi); } }); });

    // ── EXPORTAR ─────────────────────────────────────────────────────────────
    $('btn-export').addEventListener('click', () => {
        const rows = State.filteredRows;
        if (!rows.length) { Swal.fire({ icon: 'info', title: 'Nada que exportar', text: 'No hay resultados con los filtros actuales.' }); return; }
        const run = withDetail => {
            showLoading();
            // Se deja pintar el indicador de carga antes de armar el archivo.
            setTimeout(() => {
                try { exportExcel(rows, withDetail); }
                catch (e) { console.error(e); Swal.fire({ icon: 'error', title: 'No se pudo exportar', text: e.message || '' }); }
                finally { hideLoading(); }
            }, 30);
        };
        if (rows.length <= EXPORT_DETAIL_MAX) { run(true); return; }
        // El detalle línea por línea de todo lo cargado pesa decenas de MB y tarda en armarse.
        Swal.fire({
            icon: 'question', title: 'Exportar a Excel',
            html: `Hay <b>${fmt(rows.length)}</b> líneas con los filtros actuales. El resumen por área, sección y contenedor sale al instante; incluir la hoja <b>Detalle</b> línea por línea puede tardar más de un minuto.<br><small>Tip: filtra por reporte o contenedor para un detalle más ligero.</small>`,
            showDenyButton: true, showCancelButton: true,
            confirmButtonText: 'Solo resumen', denyButtonText: 'Incluir detalle', cancelButtonText: 'Cancelar',
            customClass: { popup: 'db-swal-popup' }
        }).then(res => { if (res.isConfirmed) run(false); else if (res.isDenied) run(true); });
    });

    function exportExcel(rows, withDetail = true) {
        const sum = State.sum || summarize(rows), tot = sum.tot;
        const conts = [...sum.conts];
        const wb = XLSX.utils.book_new();

        const resumen = [
            ['Dashboard de Resultados — Sistema Liverpool'],
            ['Generado', fmtDateTime(new Date())],
            ['Reporte', UI.filterManifiesto.value ? manifLabel(UI.filterManifiesto.value) : 'Todos'],
            ['Área', UI.filterJefatura.value || 'Todas'],
            ['Sección', UI.filterSeccion.value || 'Todas'],
            ['Contenedor', State.filterCont || 'Todos'],
            [],
            ['Indicador', 'Valor'],
            ['Piezas esperadas (VCM)', tot.pz],
            ['Piezas recibidas / registradas', tot.recibidas],
            ['Correcto (piezas)', tot.correcto],
            ['Faltante (piezas)', tot.ft],
            ['Sobrante (piezas)', tot.sb],
            ['Adicional (piezas)', tot.ad],
            ['Exactitud %', round2(tot.pct ?? 0)],
            ['Meta %', META],
            ['Líneas', tot.lines],
            ...Object.keys(CONCEPTOS).map(k => [`Líneas · ${CONCEPTOS[k].label}`, sum.lineas[k]]),
            ['Contenedores', conts.length],
            ...Object.keys(ESTADOS).map(k => [`Contenedores · ${ESTADOS[k].label}`, conts.filter(c => c.estado === k).length]),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');

        const areas = [...sum.areas].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(areas.map(a => ({
            'Área': a.key, 'Piezas': a.pz, 'Correcto': a.correcto, 'Faltante': a.ft, 'Sobrante': a.sb, 'Adicional': a.ad, 'Exactitud %': round2(a.pct ?? 0),
            'Estado': a.key === NO_AREA ? 'Sin asignar' : ({ good: 'En meta', warn: 'Atención', bad: 'Crítico' })[toneOf(a.pct)] || '—'
        }))), 'Áreas');

        const secs = [...sum.secs].sort((a, b) => b.ft - a.ft);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(secs.map(s => ({
            'Sección': s.key, 'Descripción': descSeccion(s.key), 'Área': areaOfSeccion(s.key),
            'Piezas': s.pz, 'Correcto': s.correcto, 'Faltante': s.ft, 'Sobrante': s.sb, 'Adicional': s.ad, 'Exactitud %': round2(s.pct ?? 0),
            '% de faltantes': round2(tot.ft ? s.ft / tot.ft * 100 : 0)
        }))), 'Secciones');

        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conts.sort((a, b) => b.ft - a.ft).map(c => ({
            'Contenedor': c.contenedor, 'Reporte': manifLabel(c.manifiesto), 'Secciones': [...c.secciones].join(', '),
            'Áreas': [...c.areas].join(', '), 'Líneas': c.lineas, 'SKU': c.nSkus, 'Piezas': c.pz,
            'Correcto': c.correcto, 'Faltante': c.ft, 'Sobrante': c.sb, 'Adicional': c.ad,
            'Exactitud %': round2(c.pct ?? 0), 'Estado': ESTADOS[c.estado].label
        }))), 'Contenedores');

        // Detalle línea por línea; aoa_to_sheet es más rápido que json_to_sheet con muchas filas.
        if (withDetail) {
        const detalle = [['Manifiesto', 'Contenedor', 'Sección', 'Descripción sección', 'Área', 'Artículo', 'Descripción', 'Piezas esperadas', 'Registradas', 'Diferencia', 'Concepto', 'Correcto', 'Faltante', 'Sobrante', 'Adicional']];
        for (const r of rows) detalle.push([r.Manifiesto, r.Contenedor, r.Seccion, r.DescripcionSec, r.Area, r.Articulo || '', r.Descripcion || '',
            r.Piezas, r.Registradas, r.Registradas - r.Piezas, CONCEPTOS[r.Concepto].label, r.Correcto, r.Faltantes, r.Sobrante, r.Adicional]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), 'Detalle');
        }

        XLSX.writeFile(wb, `resultados_${State.filterCont ? State.filterCont + '_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
    }

    // ── LISTA ADMIN ──────────────────────────────────────────────────────────
    function renderAdminList() {
        if (!State.isAdmin) return;
        if (!State.allReportes.length) { UI.adminList.innerHTML = '<div class="db-file-empty">No hay reportes cargados aún.</div>'; return; }
        UI.adminList.innerHTML = State.allReportes.map(rep => {
            const d = toDate(rep.uploadedAt);
            const label = rep.manifestoId?.startsWith('varios') ? 'Varios manifiestos' : (rep.manifestoId || '—');
            const t = rep.tot || agg(rep.rows || []);
            return `<div class="db-file">
                <span class="db-file-icon"><i class="bi bi-file-earmark-spreadsheet-fill"></i></span>
                <div style="min-width:0">
                    <div class="db-file-name">${esc(manifLabel(label))}</div>
                    <div class="db-file-meta">${esc(rep.fileName || '—')} · ${d ? fmtDateTime(d) : 'sin fecha'}${rep.uploadedByEmail ? ' · ' + esc(rep.uploadedByEmail) : ''}</div>
                </div>
                <div class="db-file-stats">${fmt(rep.rows?.length || 0)} filas<br>${pctTxt(t.pct ?? 0)} exactitud</div>
                <button class="db-file-del" data-id="${esc((rep.ids || [rep.id]).join(','))}" data-name="${esc(label)}" title="Eliminar"><i class="bi bi-trash3-fill"></i></button>
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
            const batch = db.batch();
            docId.split(',').filter(Boolean).forEach(id => batch.delete(db.collection(COLLECTION).doc(id)));
            await batch.commit();
            await bumpMeta();
            Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1700, showConfirmButton: false });
            await loadReportes({ fresh: true });
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
        showUploadWarn('');
        UI.btnConfirmUpload.disabled = true;
        UI.dropZone.classList.remove('drag-over');
    }

    bindDropZone(UI.dropZone, UI.fileInput, handleFile);

    function handleFile(file) {
        showUploadError('');
        showUploadWarn('');
        UI.btnConfirmUpload.disabled = true;
        UI.filePreview.style.display = 'none';
        if (!/\.(xlsx|xls)$/i.test(file.name)) { showUploadError('El archivo debe ser .xlsx o .xls'); return; }

        readWorkbook(file, json => {
            if (json.length === 0) { showUploadError('El archivo está vacío.'); return; }
            const headers = uniq(json.slice(0, 50).flatMap(r => Object.keys(r)));
            const map = resolveHeaders(headers);

            // Columnas clave: sin ellas no se puede saber qué llegó y todo se contaría como faltante.
            if (!map.piezas) { showUploadError(`No se reconoció la columna de piezas manifestadas (Cant. Manf.). Encabezados del archivo: ${headers.join(', ')}`); return; }
            if (!map.registradas && !map.diferencia && !map.faltantes && !map.sobrante) {
                showUploadError(`No se reconoció la columna de cantidad registrada (Cant. Registrada) ni Diferencia, Faltantes o Sobrantes. Sin ella no se puede saber qué llegó y los resultados saldrían mal. Encabezados del archivo: ${headers.join(', ')}`);
                return;
            }

            const rows = enrichRows(json.map(r => normalizeResultRow(r, map)));
            rows.forEach(r => { delete r.Area; });

            const manifiestos = uniq(rows.map(r => r.Manifiesto));
            const isMultiple  = manifiestos.length > 1;
            const invalidM    = manifiestos.find(m => m !== 'GENERAL' && !/^\d{10}$/.test(m));
            if (invalidM) { showUploadError(`"Manifiesto" debe tener 10 dígitos. Se encontró: "${invalidM}"`); return; }

            const today     = new Date().toISOString().split('T')[0];
            const savedName = isMultiple ? `resultados_${today}.xlsx` : `${manifiestos[0]}_${today}.xlsx`;
            const jefaturas = uniq(rows.map(r => r.Jefatura).filter(j => areaOf(j) !== NO_AREA));
            const secciones = uniq(rows.map(r => r.Seccion));
            const t = agg(rows);
            const lineas = countBy(rows, r => r.Concepto);

            // Avisos: columnas que no se reconocieron y archivos que solo traen un concepto.
            const warns = [];
            const missing = ['registradas', 'estado', 'contenedor', 'seccion', 'articulo', 'descripcion', 'manifiesto'].filter(f => !map[f]);
            if (missing.length) warns.push(`No se reconocieron estas columnas: <b>${missing.map(f => FIELD_LABELS[f]).join(', ')}</b>.${!map.registradas && !map.diferencia ? ' Lo recibido se calculará con Faltantes/Sobrantes.' : ''}`);
            if (t.pz > 0 && t.recibidas === 0) warns.push(`<b>Todas las líneas vienen con Cant. Registrada en 0</b>: el tablero mostrará el 100% como faltante. Revisa que el reporte VCM se haya exportado después de escanear y con todos los status.`);
            const conceptosPresentes = Object.keys(CONCEPTOS).filter(k => lineas[k]);
            if (conceptosPresentes.length === 1 && rows.length > 1) warns.push(`El archivo solo trae líneas <b>${CONCEPTOS[conceptosPresentes[0]].label}</b>. Si esperabas también ${Object.keys(CONCEPTOS).filter(k => k !== conceptosPresentes[0]).map(k => CONCEPTOS[k].label).join(', ')}, vuelve a exportarlo sin filtrar el Status.`);

            State.parsedFile = { file, rows, manifiestos, isMultiple, savedName };
            $('prev-manifest-id').textContent = isMultiple ? `${manifiestos.length} manifiestos` : manifiestos[0];
            $('prev-multi-tag').style.display = isMultiple ? 'inline-flex' : 'none';
            $('prev-manifests-row').style.display = isMultiple ? 'flex' : 'none';
            $('prev-manifests-list').textContent = manifiestos.join(', ');
            $('prev-filename').textContent  = file.name;
            $('prev-rows').textContent      = fmt(rows.length);
            $('prev-totales').textContent   = `${fmt(t.pz)} / ${fmt(t.ft)} / ${fmt(t.sb)} · ${pctTxt(t.pct ?? 0)}`;
            if ($('prev-conceptos')) $('prev-conceptos').textContent = Object.keys(CONCEPTOS).map(k => `${CONCEPTOS[k].label} ${fmt(lineas[k] || 0)}`).join(' · ');
            if ($('prev-columnas')) $('prev-columnas').textContent = Object.keys(FIELD_LABELS).filter(f => map[f]).map(f => `${FIELD_LABELS[f]} ← "${map[f]}"`).join(' · ');
            $('prev-jefaturas').textContent = jefaturas.length ? jefaturas.join(', ') : '(se asignarán desde Datos Maestros)';
            $('prev-secciones').textContent = `${secciones.length}: ${truncate(secciones.join(', '), 120)}`;
            UI.filePreview.style.display = 'block';
            showUploadWarn(warns.join('<br>'));
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
                    localExisting.forEach(r => (r.ids || [r.id]).forEach(id => batch.delete(db.collection(COLLECTION).doc(id))));
                    await batch.commit();
                } else {
                    const existing = await db.collection(COLLECTION).where('manifestoId', '==', manifestoId).get();
                    if (existing.docs.length > 0) {
                        const batch = db.batch();
                        existing.docs.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                    }
                }
                const chunks = chunkRowsBySize(manifestRows);
                const chunkGroup = chunks.length > 1 ? db.collection(COLLECTION).doc().id : null;
                const meta = { manifestoId, fileName: savedName, uploadedBy: State.currentUser.uid, uploadedByEmail: State.currentUser.email, uploadedAt: firebase.firestore.FieldValue.serverTimestamp() };
                const batch = db.batch();
                chunks.forEach((chunk, i) => {
                    const doc = chunkGroup ? { ...meta, chunkGroup, part: i, parts: chunks.length, rows: chunk } : { ...meta, rows: chunk };
                    batch.set(db.collection(COLLECTION).doc(), doc);
                });
                await batch.commit();
            }
            await bumpMeta();
            State.uploadModal.hide();
            Swal.fire({ icon: 'success', title: '¡Listo!', text: isMultiple ? `${manifiestos.length} manifiestos cargados.` : `Manifiesto ${manifiestos[0]} cargado.`, timer: 2300, showConfirmButton: false });
            await loadReportes({ fresh: true });
        } catch (err) {
            console.error(err); showUploadError('Error al subir. Intenta de nuevo.');
        } finally {
            UI.btnConfirmUpload.disabled = false;
            UI.btnConfirmUpload.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Subir';
        }
    });

    // Divide filas en bloques de ~700 KB para respetar el límite de 1 MiB por documento de Firestore.
    function chunkRowsBySize(rows, maxBytes = 700000) {
        const chunks = [];
        let cur = [], size = 0;
        rows.forEach(r => {
            const s = new Blob([JSON.stringify(r)]).size + 16;
            if (cur.length && size + s > maxBytes) { chunks.push(cur); cur = []; size = 0; }
            cur.push(r); size += s;
        });
        if (cur.length || !chunks.length) chunks.push(cur);
        return chunks;
    }

    function showUploadError(msg) {
        if (!msg) { UI.uploadError.style.display = 'none'; return; }
        UI.uploadErrorMsg.textContent = msg;
        UI.uploadError.style.display = 'block';
    }

    function showUploadWarn(html) {
        if (!UI.uploadWarn) return;
        if (!html) { UI.uploadWarn.style.display = 'none'; return; }
        UI.uploadWarnMsg.innerHTML = html;
        UI.uploadWarn.style.display = 'block';
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────
    function showLoading() { UI.loading.style.display = 'flex'; }
    function hideLoading() { UI.loading.style.display = 'none'; }
    function yieldToBrowser() { return new Promise(r => setTimeout(r, 0)); }
    function idle(fn) { (window.requestIdleCallback || (f => setTimeout(f, 200)))(fn); }

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
            return COLL.compare(String(x ?? ''), String(y ?? '')) * m;
        });
        return arr;
    }

    // Totales de un conjunto de filas ya normalizadas (números como número).
    function agg(rows) {
        const a = acc('');
        for (const r of rows) {
            const pz = num(r.Piezas), rec = num(r.Registradas), ft = num(r.Faltantes);
            a.pz += pz;
            a.recibidas += rec > 0 ? rec : Math.max(pz - ft, 0);
            a.ft += ft; a.sb += num(r.Sobrante); a.ad += num(r.Adicional); a.correcto += num(r.Correcto); a.lines++;
        }
        return done(a);
    }

    function pctOf(pz, ft) { return pz > 0 ? Math.max(0, (pz - ft) / pz * 100) : null; }
    function estadoOf(ft, sb) { return ft > 0 && sb > 0 ? 'mixto' : ft > 0 ? 'falt' : sb > 0 ? 'sobr' : 'ok'; }
    function toneOf(p) { return p == null ? 'none' : p >= META ? 'good' : p >= WARN ? 'warn' : 'bad'; }
    function toneColor(p) { const t = toneOf(p); return t === 'good' ? C.ok : t === 'warn' ? C.warn : t === 'bad' ? C.bad : C.txt3; }

    function descSeccion(sec) { return State.idx?.secInfo.get(sec)?.desc || ''; }
    function areaOfSeccion(sec) { return State.idx?.secInfo.get(sec)?.area || NO_AREA; }
    function areaCell(a) { return String(a).startsWith(NO_AREA) ? `<span class="db-noarea"><i class="bi bi-exclamation-triangle-fill"></i>${esc(a)}</span>` : esc(a); }
    function areaSort(a, b) { return (a === NO_AREA) - (b === NO_AREA) || COLL.compare(a, b); }
    function conceptBadge(c) { const k = CONCEPTOS[c]; return k ? `<span class="db-concept ${c}"><i class="bi ${k.icon}"></i>${k.label}</span>` : ''; }

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
    function countBy(a, fn) { return a.reduce((accu, x) => { const k = fn(x); accu[k] = (accu[k] || 0) + 1; return accu; }, {}); }
    // Repara acentos dañados en datos ya guardados (ver fixText en shared-ui.js)
    function fixDeep(v) { return window.fixTextDeep ? window.fixTextDeep(v) : v; }
    function toNum(v) { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
    function num(v) { return typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : toNum(v ?? ''); }
    function fmt(n) { return NUM_FMT.format(Number(n)); }
    function fmtShort(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : fmt(n); }
    function pctTxt(p) { return (p ?? 0).toFixed(1) + '%'; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function esc(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function pctBadge(pct) {
        if (pct == null) return '<span class="badge-pct">—</span>';
        return `<span class="badge-pct ${toneOf(pct)}">${pctTxt(pct)}</span>`;
    }

    // Animaciones de cifras: una nueva cancela la anterior del mismo elemento.
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function animate(el, duration, render) {
        if (!el) return;
        if (el._anim) cancelAnimationFrame(el._anim);
        const start = performance.now();
        const step = now => {
            // El tiempo del cuadro puede ser anterior a start: se limita a 0..1.
            const p = Math.min(Math.max((now - start) / duration, 0), 1);
            render(easeOut(p));
            el._anim = p < 1 ? requestAnimationFrame(step) : null;
        };
        el._anim = requestAnimationFrame(step);
    }
    function animateNumber(el, target, isFmt) {
        animate(el, 700, e => { const v = Math.round(target * e); el.textContent = isFmt ? fmt(v) : v; });
    }
    function animatePct(el, target) {
        animate(el, 800, e => { el.textContent = (target * e).toFixed(1) + '%'; });
    }
});
