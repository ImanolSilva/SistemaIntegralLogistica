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

    // ── CONSTANTS ─────────────────────────────────────────────────────────────
    const ADMIN_UIDS       = ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"];
    const COLL_ENTREGAS    = "entregas";
    const COLL_BODEGAS_COL = "catalogoBodegas"; // catálogo subido desde Excel
    const COLL_DATOS       = "datosMaestros";
    const DOC_DATOS        = "secciones";
    const COLL_BODEGAS_DOC = "bodegasData";     // doc único con el map de bodegas
    const STORAGE_RECIBOS  = "recibos/";

    // ── STATE ─────────────────────────────────────────────────────────────────
    const State = {
        currentUser:    null,
        isAdmin:        false,
        userName:       null,
        userEmail:      null,
        // Catálogos cargados en memoria
        bodegasMap:      {},     // raw Firestore bodegas map
        bodegasMapMulti: {},    // { "B420023": [{seccion,descSeccion,descBodega}, ...] }
        masterMap:       {},    // { "101": { Jefatura, Gerente, ... } }
        bodegaToSeccion: {},    // índice inverso (legacy)
        // Entrega actual
        bodegaCodigo:   null,
        bodegaNombre:   null,
        bodegaSecciones: [],   // [{ seccion, desc, jefe }]
        bodegaJefes:    [],    // jefes únicos
        // legacy compat (para updateResumen / confirmarEntrega)
        bodegaSeccion:  null,
        bodegaDescSec:  null,
        bodegaJefe:     null,
        contenedores:   [],
        // Escaner
        escanerTarget:  null,
        zxingReader:    null,
        // Upload bodegas
        parsedBodegas:  null,
        modalBodegas:   null,
        // Historial
        historialUnsub: null,
    };

    // ── DOM ───────────────────────────────────────────────────────────────────
    const $  = id => document.getElementById(id);
    const UI = {
        loading:         $('globalLoading'),
        loadingText:     $('loadingText'),
        // Admin
        adminPanel:      $('adminPanel'),
        bodegasStatus:   $('bodegasStatus'),
        btnSubirBodegas: $('btnSubirBodegas'),
        // User banner
        userAvatar:      $('userAvatar'),
        userDisplayName: $('userDisplayName'),
        userEmailSmall:  $('userEmailSmall'),
        // Step cards
        step1Card: $('step1Card'), step2Card: $('step2Card'), step3Card: $('step3Card'),
        badge1: $('badge1'), badge2: $('badge2'), badge3: $('badge3'),
        // Paso 1
        bodegaInput:     $('bodegaInput'),
        btnEscanerBodega:$('btnEscanerBodega'),
        bodegaCardWrap:  $('bodegaCardWrap'),
        bodegaNombre:    $('bodegaNombre'),
        bodegaSeccion:   $('bodegaSeccion'),
        bodegaCodigo:    $('bodegaCodigo'),
        bodegaDescSeccion:$('bodegaDescSeccion'),
        bodegaJefe:      $('bodegaJefe'),
        // Paso 2
        contListWrap:    $('contListWrap'),
        contList:        $('contList'),
        contCountText:   $('contCountText'),
        contenedorInput: $('contenedorInput'),
        btnEscanerCont:  $('btnEscanerContenedor'),
        // Paso 3
        resEmp:          $('resEmp'),
        resConts:        $('resConts'),
        resBodega:       $('resBodega'),
        resSeccion:      $('resSeccion'),
        resJefe:         $('resJefe'),
        resFechaHora:    $('resFechaHora'),
        btnConfirmar:    $('btnConfirmar'),
        btnLimpiarTodo:  $('btnLimpiarTodo'),
        // Historial
        historialList:   $('historialList'),
        historialCount:  $('historialCount'),
        // Escaner
        modalEscaner:    $('modal-escaner'),
        videoEscaner:    $('video-escaner'),
        btnCerrarEsc:    $('btn-cerrar-escaner'),
        // Upload bodegas modal
        dropZoneBodegas: $('dropZoneBodegas'),
        bodegasFileInput:$('bodegasFileInput'),
        bodegasPreview:  $('bodegasPreview'),
        bodegasError:    $('bodegasError'),
        prevBodegasFile: $('prevBodegasFile'),
        prevBodegasCount:$('prevBodegasCount'),
        prevSeccionesCount:$('prevSeccionesCount'),
        btnConfirmarBodegas:$('btnConfirmarBodegas'),
        // Header
        logoutBtn:       $('logout-btn'),
        adminTab:        $('adminTab'),
    };

    const swal = (opts) => Swal.fire({ background:'rgba(20,20,40,0.98)', color:'#fff', confirmButtonColor:'#E6007E', cancelButtonColor:'rgba(255,255,255,0.12)', ...opts });

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const now = () => { const n=new Date(); return n.toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'})+' · '+n.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}); };
    const normalizeKey = k => k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');

    function showLoading(text='Cargando...') { UI.loading.style.display='flex'; UI.loadingText.textContent=text; }
    function hideLoading() { UI.loading.style.display='none'; }

    function setStep(num, state) { // 'active'|'done'|'idle'|'disabled'
        const card  = UI[`step${num}Card`];
        const badge = UI[`badge${num}`];
        if (!card || !badge) return;
        card.classList.remove('active-step','completed-step','disabled-step');
        badge.classList.remove('done');
        badge.textContent = num;
        if (state==='active')   card.classList.add('active-step');
        if (state==='done')     { card.classList.add('completed-step'); badge.classList.add('done'); badge.textContent='✓'; }
        if (state==='disabled') card.classList.add('disabled-step');
    }

    // ── AUTH ──────────────────────────────────────────────────────────────────
    auth.onAuthStateChanged(async user => {
        if (!user) { hideLoading(); window.location.href='../Login/login.html'; return; }
        State.currentUser = user;
        State.isAdmin     = ADMIN_UIDS.includes(user.uid);
        State.userName    = user.displayName || null;
        State.userEmail   = user.email       || null;

        // Banner usuario
        UI.userDisplayName.textContent = State.userName  || State.userEmail || 'Usuario';
        UI.userEmailSmall.textContent  = State.userEmail || '';
        if (user.photoURL) {
            UI.userAvatar.innerHTML = `<img src="${esc(user.photoURL)}" alt="avatar">`;
        } else {
            UI.userAvatar.textContent = (State.userName || State.userEmail || 'U').charAt(0).toUpperCase();
        }

        if (State.isAdmin && UI.adminTab) UI.adminTab.style.display = 'flex';
        // Panel de bodegas visible para todos — el catálogo lo puede subir cualquier usuario autorizado
        if (UI.adminPanel) UI.adminPanel.style.display = 'block';

        showLoading('Cargando catálogos...');
        await Promise.all([loadBodegas(), loadMasterData()]);
        hideLoading();
        initHistorial(isoHoy());
    });

    UI.logoutBtn.addEventListener('click', async () => {
        const r = await swal({ title:'¿Cerrar sesión?', icon:'question', showCancelButton:true, confirmButtonText:'Sí, salir', cancelButtonText:'Cancelar' });
        if (r.isConfirmed) { await auth.signOut(); window.location.href='../Login/login.html'; }
    });

    // ── LOAD CATÁLOGOS ────────────────────────────────────────────────────────
    async function loadBodegas() {
        try {
            const snap = await db.collection(COLL_BODEGAS_COL).doc(COLL_BODEGAS_DOC).get();
            if (snap.exists && snap.data().bodegas) {
                State.bodegasMap = snap.data().bodegas;
                // Construir índice multi: { "B420023": [ {seccion, descSeccion, descBodega}, ... ] }
                State.bodegasMapMulti = {};
                Object.entries(State.bodegasMap).forEach(([rawKey, val]) => {
                    // El parser puede guardar "B420023" o "B420023__321" (código__seccion)
                    const codigo = rawKey.split('__')[0].trim().toUpperCase();
                    if (!State.bodegasMapMulti[codigo]) State.bodegasMapMulti[codigo] = [];
                    State.bodegasMapMulti[codigo].push({
                        seccion:    String(val.seccion    || '').trim(),
                        descSeccion:String(val.descSeccion|| '').trim(),
                        descBodega: String(val.descBodega || val.nombre || '').trim(),
                    });
                });
                const codigos = Object.keys(State.bodegasMapMulti).length;
                const total   = Object.keys(State.bodegasMap).length;
                const fecha   = snap.data().uploadedAt
                    ? new Date(snap.data().uploadedAt.toDate()).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})
                    : '—';
                if (UI.bodegasStatus) UI.bodegasStatus.textContent = `✓ ${codigos} bodegas · ${total} secciones · actualizado ${fecha}`;
            } else {
                if (UI.bodegasStatus) UI.bodegasStatus.innerHTML = '⚠️ Sin catálogo — <strong>sube el archivo "Escaneo boegas.xlsx"</strong>';
            }
        } catch(e) { console.error('loadBodegas:', e); }
    }

    async function loadMasterData() {
        try {
            const doc = await db.collection(COLL_DATOS).doc(DOC_DATOS).get();
            if (doc.exists && doc.data().sections) {
                State.masterMap = doc.data().sections;
                // Construir índice inverso: bodega (uppercase) → { seccion, jefe, gerente, descSeccion }
                // El campo "Bodega" en Datos tiene el código de bodega o nombre de sección
                State.bodegaToSeccion = {};
                Object.entries(State.masterMap).forEach(([seccion, data]) => {
                    // Indexar por el campo Bodega si existe
                    if (data.Bodega) {
                        const key = String(data.Bodega).trim().toUpperCase();
                        if (key) State.bodegaToSeccion[key] = seccion;
                    }
                    // También indexar por la sección misma (por si el código escaneado ES la sección)
                    const secKey = String(seccion).trim().toUpperCase();
                    if (secKey && !State.bodegaToSeccion[secKey]) {
                        State.bodegaToSeccion[secKey] = seccion;
                    }
                });
            }
        } catch(e) { console.error('loadMasterData:', e); }
    }

    // Busca el jefe de una sección en masterMap con múltiples fallbacks
    function getJefeDeSeccion(seccion) {
        const s = String(seccion || '').trim();
        if (!s) return null;
        // Búsqueda directa
        const m = State.masterMap[s];
        if (m?.Jefatura && m.Jefatura !== 'Sin Asignar' && m.Jefatura !== '') return m.Jefatura;
        if (m?.Gerente  && m.Gerente  !== 'Sin Asignar' && m.Gerente  !== '') return m.Gerente;
        // Fallback: normalizar a número entero (por si viene "7.0" o " 7 ")
        const sInt = String(parseInt(s, 10));
        if (sInt !== 'NaN' && sInt !== s) {
            const m2 = State.masterMap[sInt];
            if (m2?.Jefatura && m2.Jefatura !== 'Sin Asignar') return m2.Jefatura;
            if (m2?.Gerente  && m2.Gerente  !== 'Sin Asignar') return m2.Gerente;
        }
        return null; // sección no está en Datos.xlsx — normal para algunas secciones
    }

    // Resuelve todos los datos de una bodega: puede tener MÚLTIPLES secciones y jefes
    // Retorna: { nombre, secciones: [{seccion, desc, jefe}], jefesUnicos: ['Nombre1','Nombre2'] }
    function resolverBodegaCompleta(codigoBodega) {
        const key = String(codigoBodega).trim().toUpperCase();

        // ── Buscar TODAS las entradas de este código en bodegasMap ───────────────
        // bodegasMap está indexado por "CODIGO__SECCION" para soportar múltiples secciones
        // pero el parser original guardó solo una entrada por código.
        // Usamos bodegasMapMulti que fue construido en loadBodegas().
        const entradasBodega = State.bodegasMapMulti?.[key] || [];

        if (entradasBodega.length > 0) {
            // nombre de la bodega (igual para todas las entradas del mismo código)
            const nombre = entradasBodega[0].descBodega || `Bodega ${codigoBodega}`;

            const secciones = entradasBodega.map(e => {
                const jefe = getJefeDeSeccion(e.seccion);
                return { seccion: e.seccion, desc: e.descSeccion || '', jefe: jefe || null };
            });

            // Para secciones sin jefe en Datos.xlsx, usar el jefe más frecuente de las demás
            const jefesConocidos = secciones.map(s => s.jefe).filter(Boolean);
            const jefeDefault = jefesConocidos.length > 0
                ? jefesConocidos.sort((a,b) =>
                    jefesConocidos.filter(j=>j===b).length - jefesConocidos.filter(j=>j===a).length)[0]
                : null;

            secciones.forEach(s => { if (!s.jefe) s.jefe = jefeDefault; });

            const jefesUnicos = [...new Set(secciones.map(s=>s.jefe).filter(Boolean))];

            return { nombre, secciones, jefesUnicos };
        }

        // Sin catálogo subido
        return { nombre: `Bodega ${codigoBodega}`, secciones: [], jefesUnicos: [] };
    }

    // ── PASO 1: BODEGA ────────────────────────────────────────────────────────
    UI.bodegaInput.addEventListener('input', () => {
        const v = UI.bodegaInput.value.trim().toUpperCase();
        UI.bodegaInput.value = v;
        if (v.length >= 1) resolverBodega(v);
        else {
            UI.bodegaCardWrap.style.display = 'none';
            State.bodegaCodigo = null;
            resetFromStep2();
        }
    });
    UI.bodegaInput.addEventListener('keydown', e => { if (e.key==='Enter') resolverBodega(UI.bodegaInput.value.trim().toUpperCase()); });
    UI.btnEscanerBodega.addEventListener('click', () => abrirEscaner('bodega'));

    function resolverBodega(codigo) {
        if (!codigo) return;
        const r = resolverBodegaCompleta(codigo);

        State.bodegaCodigo   = codigo;
        State.bodegaNombre   = r.nombre;
        State.bodegaSecciones = r.secciones;
        State.bodegaJefes    = r.jefesUnicos;
        // Legacy strings para resumen y Firestore (lista separada por comas)
        State.bodegaSeccion  = r.secciones.map(s => s.seccion).join(', ') || '—';
        State.bodegaDescSec  = r.secciones.map(s => s.desc).filter(Boolean).join(' / ') || '—';
        State.bodegaJefe     = r.jefesUnicos.join(', ') || '—';

        UI.bodegaNombre.textContent = r.nombre;
        UI.bodegaCodigo.textContent = codigo;

        // Renderizar lista de secciones con jefe
        if (r.secciones.length > 0) {
            UI.bodegaSeccion.innerHTML = r.secciones.map(s =>
                `<div class="seccion-row">
                    <span class="seccion-num">${esc(s.seccion)}</span>
                    <span class="seccion-desc">${esc(s.desc || '—')}</span>
                    <span class="${s.jefe ? 'seccion-jefe' : 'seccion-jefe-unknown'}">${esc(s.jefe || 'Sin asignar')}</span>
                </div>`
            ).join('');
            UI.bodegaDescSeccion.textContent = '';
            UI.bodegaDescSeccion.style.display = 'none';
            UI.bodegaJefe.textContent = r.jefesUnicos.length > 0 ? r.jefesUnicos.join(' · ') : '—';
        } else {
            UI.bodegaSeccion.textContent = '—';
            UI.bodegaDescSeccion.textContent = 'Sube el catálogo de bodegas para ver los detalles';
            UI.bodegaDescSeccion.style.display = '';
            UI.bodegaJefe.textContent = '—';
        }

        UI.bodegaCardWrap.style.display = 'block';
        setStep(1, 'done');
        enableStep2();
        updateResumen();
    }

    function enableStep2() {
        setStep(2, 'active');
        UI.contenedorInput.disabled = false;
        UI.btnEscanerCont.disabled  = false;
        UI.contenedorInput.focus();
    }

    function resetFromStep2() {
        State.contenedores = [];
        UI.contenedorInput.value      = '';
        UI.contenedorInput.disabled   = true;
        UI.btnEscanerCont.disabled    = true;
        UI.contListWrap.style.display = 'none';
        UI.contList.innerHTML         = '';
        setStep(2, 'disabled');
        setStep(3, 'disabled');
        updateResumen();
    }

    // ── PASO 2: CONTENEDORES ─────────────────────────────────────────────────
    // Bloquear escritura manual — solo permitir scanner (ráfaga rápida) y pegar
    let _scannerBuffer = '';
    let _scannerTimer  = null;
    UI.contenedorInput.addEventListener('keydown', e => {
        // Permitir: Ctrl/Cmd combos (pegar), Tab, Backspace, Delete, flechas, Escape
        if (e.ctrlKey || e.metaKey) return;
        if (['Tab','Backspace','Delete','ArrowLeft','ArrowRight','Escape'].includes(e.key)) return;
        // Permitir Enter para confirmar lo que llegó por scanner
        if (e.key === 'Enter') { agregarContenedor(); e.preventDefault(); return; }
        // Bloquear cualquier tecla alfanumérica individual (evita escritura manual)
        if (e.key.length === 1) e.preventDefault();
    });
    // Auto-agregar cuando el valor llega a 9+ caracteres (scanner o paste)
    UI.contenedorInput.addEventListener('input', () => {
        const val = UI.contenedorInput.value.trim();
        if (val.length >= 9) {
            // Pequeño delay para que scanner termine de escribir el código completo
            clearTimeout(_scannerTimer);
            _scannerTimer = setTimeout(() => agregarContenedor(), 80);
        }
    });

    function agregarContenedor() {
        clearTimeout(_scannerTimer);
        const val = UI.contenedorInput.value.trim().toUpperCase();
        if (!val) return;
        if (State.contenedores.includes(val)) {
            UI.contenedorInput.value = '';
            swal({ icon:'info', title:'Ya agregado', text:`El contenedor ${val} ya está en la lista.`, timer:2000, showConfirmButton:false });
            return;
        }
        State.contenedores.push(val);
        UI.contenedorInput.value = '';
        renderContList();
        if (State.contenedores.length > 0) {
            setStep(2, 'done');
            enableStep3();
        }
        updateResumen();
        UI.contenedorInput.focus();
    }

    function renderContList() {
        const n = State.contenedores.length;
        UI.contCountText.textContent  = `${n} contenedor${n!==1?'es':''}`;
        UI.contListWrap.style.display = n > 0 ? 'block' : 'none';
        UI.contList.innerHTML = State.contenedores.map((c, i) => `
            <div class="cont-item">
                <i class="bi bi-box-seam cont-item-icon"></i>
                <span class="cont-item-num">${esc(c)}</span>
                <button class="cont-item-del" data-idx="${i}" type="button" title="Quitar"><i class="bi bi-x-lg"></i></button>
            </div>`).join('');
        UI.contList.querySelectorAll('.cont-item-del').forEach(btn => {
            btn.addEventListener('click', () => {
                State.contenedores.splice(+btn.dataset.idx, 1);
                renderContList();
                if (State.contenedores.length === 0) { setStep(2,'active'); setStep(3,'disabled'); }
                updateResumen();
            });
        });
    }

    function enableStep3() {
        setStep(3, 'active');
    }

    // ── PASO 3: CONFIRMAR ─────────────────────────────────────────────────────
    UI.btnConfirmar.addEventListener('click', confirmarEntrega);

    function updateResumen() {
        UI.resEmp.textContent       = State.userName || State.userEmail || '—';
        UI.resBodega.textContent    = State.bodegaNombre  || '—';
        UI.resSeccion.textContent   = State.bodegaSeccion || '—';
        UI.resJefe.textContent      = State.bodegaJefe    || '—';
        UI.resFechaHora.textContent = now();
        UI.resConts.innerHTML = State.contenedores.length > 0
            ? State.contenedores.map(c=>`<span class="chip-cont">${esc(c)}</span>`).join('')
            : '<span style="color:var(--text-muted)">—</span>';
        UI.btnConfirmar.disabled = !(State.bodegaCodigo && State.contenedores.length > 0);
    }

    async function confirmarEntrega() {
        if (!State.bodegaCodigo || State.contenedores.length === 0) {
            swal({icon:'warning',title:'Faltan datos',text:'Selecciona una bodega y agrega al menos un contenedor.'});
            return;
        }
        const contHtml = State.contenedores.map(c=>`<span style="font-family:monospace;color:#E6007E;">${esc(c)}</span>`).join(', ');
        const r = await swal({
            icon:'question', title:'¿Registrar Entrega?',
            html:`<div style="text-align:left;line-height:2.2;font-size:0.88rem;">
                <b>Contenedores:</b> ${contHtml}<br>
                <b>Bodega:</b> ${esc(State.bodegaNombre)}<br>
                <b>Sección:</b> ${esc(State.bodegaSeccion)}<br>
                <b>Jefe:</b> ${esc(State.bodegaJefe)}<br>
                <b>Por:</b> ${esc(State.userName||State.userEmail)}
            </div>`,
            showCancelButton:true, confirmButtonText:'<i class="bi bi-check-lg"></i> Confirmar', cancelButtonText:'Revisar',
        });
        if (!r.isConfirmed) return;

        showLoading('Guardando entrega...');
        try {
            const ts = new Date();
            await db.collection(COLL_ENTREGAS).add({
                contenedores:   State.contenedores,
                codigoBodega:   State.bodegaCodigo,
                nombreBodega:   State.bodegaNombre,
                secciones:      State.bodegaSecciones,
                jefes:          State.bodegaJefes,
                seccionBodega:  State.bodegaSeccion,
                jefeBodega:     State.bodegaJefe,
                empleadoNombre: State.userName  || State.userEmail,
                empleadoEmail:  State.userEmail || '',
                registradoPor:  State.currentUser.uid,
                timestamp:      firebase.firestore.FieldValue.serverTimestamp(),
                fecha:          ts.toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'}),
                hora:           ts.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}),
            });

            hideLoading();
            const txt = State.contenedores.length === 1
                ? `Contenedor <strong style="color:#E6007E;">${esc(State.contenedores[0])}</strong>`
                : `<strong style="color:#E6007E;">${State.contenedores.length} contenedores</strong>`;
            await swal({
                html:`<div class="text-center">
                    <div style="font-size:3rem;margin-bottom:0.5rem;">✅</div>
                    <h3 style="font-weight:700;color:#01B574;margin-bottom:0.4rem;">¡Entrega Registrada!</h3>
                    <p style="color:rgba(255,255,255,0.7);margin:0;">${txt}<br>en <strong>${esc(State.bodegaNombre)}</strong></p>
                </div>`,
                confirmButtonText:'Nueva Entrega', timer:5000,
            });
            resetEntrega();
        } catch(e) {
            hideLoading();
            console.error(e);
            swal({icon:'error',title:'Error al guardar',text:e.message});
        }
    }

    // Reset manteniendo bodega (para entregar varios lotes a la misma bodega)
    function resetEntrega() {
        State.contenedores = [];
        UI.contenedorInput.value      = '';
        UI.contList.innerHTML         = '';
        UI.contListWrap.style.display = 'none';
        setStep(2, 'active');
        setStep(3, 'disabled');
        updateResumen();
        UI.contenedorInput.focus();
    }

    UI.btnLimpiarTodo.addEventListener('click', async () => {
        const r = await swal({title:'¿Limpiar todo?',text:'Se reiniciarán todos los campos incluyendo la bodega.',icon:'question',showCancelButton:true,confirmButtonText:'Sí, limpiar'});
        if (!r.isConfirmed) return;
        State.bodegaCodigo = null; State.bodegaNombre = null; State.bodegaSeccion = null; State.bodegaJefe = null;
        State.bodegaSecciones = []; State.bodegaJefes = [];
        UI.bodegaInput.value = ''; UI.bodegaCardWrap.style.display = 'none';
        setStep(1, 'active');
        resetFromStep2();
        UI.bodegaInput.focus();
    });

    // ── ESCANER ───────────────────────────────────────────────────────────────
    UI.btnEscanerCont.addEventListener('click', () => abrirEscaner('contenedor'));
    UI.btnCerrarEsc.addEventListener('click', cerrarEscaner);

    function abrirEscaner(target) {
        State.escanerTarget = target;
        UI.modalEscaner.classList.add('show');
        const tryInit = () => {
            if (!window.ZXing) { setTimeout(tryInit, 200); return; }
            try {
                State.zxingReader = new ZXing.BrowserMultiFormatReader();
                State.zxingReader.decodeFromVideoDevice(null, UI.videoEscaner, (result) => {
                    if (!result) return;
                    const code = result.getText().trim().toUpperCase();
                    cerrarEscaner();
                    if (State.escanerTarget === 'bodega') {
                        UI.bodegaInput.value = code;
                        resolverBodega(code);
                    } else {
                        UI.contenedorInput.value = code;
                        agregarContenedor();
                    }
                });
            } catch(_) {
                swal({icon:'error',title:'Error de cámara',text:'No se pudo acceder a la cámara.'});
                cerrarEscaner();
            }
        };
        tryInit();
    }

    function cerrarEscaner() {
        UI.modalEscaner.classList.remove('show');
        if (State.zxingReader) { try { State.zxingReader.reset(); } catch(_){} State.zxingReader = null; }
    }

    // ── UPLOAD BODEGAS (ADMIN) ────────────────────────────────────────────────
    const modalBodegasEl = document.getElementById('modalBodegas');
    if (modalBodegasEl) State.modalBodegas = new bootstrap.Modal(modalBodegasEl);

    UI.btnSubirBodegas?.addEventListener('click', () => {
        resetBodegasModal();
        State.modalBodegas?.show();
    });

    function resetBodegasModal() {
        State.parsedBodegas = null;
        UI.bodegasFileInput.value = '';
        UI.bodegasPreview.style.display = 'none';
        UI.bodegasError.style.display   = 'none';
        UI.btnConfirmarBodegas.disabled = true;
        UI.dropZoneBodegas.style.display = 'block';
    }

    UI.dropZoneBodegas.addEventListener('click', () => UI.bodegasFileInput.click());
    UI.bodegasFileInput.addEventListener('change', e => { if (e.target.files[0]) parseBodegasFile(e.target.files[0]); });
    UI.dropZoneBodegas.addEventListener('dragover',  e => { e.preventDefault(); UI.dropZoneBodegas.classList.add('drag-over'); });
    UI.dropZoneBodegas.addEventListener('dragleave', () => UI.dropZoneBodegas.classList.remove('drag-over'));
    UI.dropZoneBodegas.addEventListener('drop', e => {
        e.preventDefault(); UI.dropZoneBodegas.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) parseBodegasFile(e.dataTransfer.files[0]);
    });

    function parseBodegasFile(file) {
        UI.bodegasPreview.style.display = 'none';
        UI.bodegasError.style.display   = 'none';
        UI.btnConfirmarBodegas.disabled = true;

        if (!file.name.match(/\.(xlsx|xls)$/i)) {
            showBodegasError('El archivo debe ser .xlsx o .xls');
            return;
        }
        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const wb   = XLSX.read(evt.target.result, { type: 'array' });
                const ws   = wb.Sheets[wb.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
                if (!json.length) { showBodegasError('El archivo está vacío.'); return; }

                const rows = json.map(r => {
                    const out = {};
                    Object.keys(r).forEach(k => { out[normalizeKey(k)] = r[k]; });
                    return out;
                });

                // Validar columnas requeridas
                const required = ['seccion', 'bodega'];
                const missing  = required.filter(c => !(c in rows[0]));
                if (missing.length) { showBodegasError(`Columnas faltantes: ${missing.join(', ')}`); return; }

                // Construir mapa: "CODIGO__SECCION" → datos  (soporta múltiples secciones por bodega)
                const bodegas = {};
                rows.forEach(r => {
                    const codigo  = String(r.bodega   || '').trim().toUpperCase();
                    const seccion = String(r.seccion  || '').trim();
                    if (!codigo || !seccion) return;
                    const compKey = `${codigo}__${seccion}`;
                    bodegas[compKey] = {
                        seccion,
                        nombre:      String(r.descripcionbodega || r.bodega || '').trim(),
                        descBodega:  String(r.descripcionbodega || '').trim(),
                        descSeccion: String(r.descripcionseccion || '').trim(),
                    };
                });

                const codigos   = [...new Set(Object.keys(bodegas).map(k => k.split('__')[0]))];
                const secciones = [...new Set(Object.values(bodegas).map(b => b.seccion).filter(Boolean))];

                State.parsedBodegas = { file, bodegas };
                UI.prevBodegasFile.textContent  = file.name;
                UI.prevBodegasCount.textContent = codigos.length + ' bodegas';
                UI.prevSeccionesCount.textContent = secciones.length + ' secciones';
                UI.bodegasPreview.style.display = 'block';
                UI.btnConfirmarBodegas.disabled = false;
            } catch(e) {
                console.error(e);
                showBodegasError('No se pudo leer el archivo. Verifica que sea un Excel válido.');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function showBodegasError(msg) {
        UI.bodegasError.textContent     = msg;
        UI.bodegasError.style.display   = 'block';
    }

    UI.btnConfirmarBodegas?.addEventListener('click', async () => {
        if (!State.parsedBodegas) return;
        UI.btnConfirmarBodegas.disabled = true;
        UI.btnConfirmarBodegas.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';
        try {
            await db.collection(COLL_BODEGAS_COL).doc(COLL_BODEGAS_DOC).set({
                bodegas:    State.parsedBodegas.bodegas,
                uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
                uploadedBy: State.currentUser.uid,
            });
            State.bodegasMap = State.parsedBodegas.bodegas;
            const count = Object.keys(State.bodegasMap).length;
            UI.bodegasStatus.textContent = `✓ ${count} bodegas cargadas · recién actualizado`;
            State.modalBodegas?.hide();
            swal({icon:'success',title:'¡Catálogo actualizado!',text:`${count} bodegas guardadas correctamente.`,timer:2500,showConfirmButton:false});
        } catch(e) {
            console.error(e);
            showBodegasError('Error al guardar: ' + e.message);
            UI.btnConfirmarBodegas.disabled = false;
            UI.btnConfirmarBodegas.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Guardar Catálogo';
        }
    });

    // ── HISTORIAL ─────────────────────────────────────────────────────────────
    const historialFechaInput = $('historialFecha');
    const historialHoyBtn     = $('historialHoyBtn');
    const historialTitle      = $('historialTitle');

    // Set default to today
    function isoHoy() {
        const d = new Date();
        return d.toISOString().split('T')[0]; // YYYY-MM-DD for input[type=date]
    }

    // Format YYYY-MM-DD → DD/MM/YYYY (stored format in Firestore)
    function isoToFechaES(iso) {
        const [y, m, d] = iso.split('-');
        return `${d}/${m}/${y}`;
    }

    // Format YYYY-MM-DD → human label
    function isoToLabel(iso) {
        const today = isoHoy();
        if (iso === today) return 'Entregas de Hoy';
        const d = new Date(iso + 'T12:00:00');
        return 'Entregas del ' + d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    if (historialFechaInput) {
        historialFechaInput.value = isoHoy();
        historialFechaInput.addEventListener('change', () => {
            initHistorial(historialFechaInput.value);
        });
    }
    if (historialHoyBtn) {
        historialHoyBtn.addEventListener('click', () => {
            const hoy = isoHoy();
            if (historialFechaInput) historialFechaInput.value = hoy;
            initHistorial(hoy);
        });
    }

    function initHistorial(isoDate) {
        const fecha = isoDate ? isoToFechaES(isoDate) : isoToFechaES(isoHoy());
        if (historialTitle) historialTitle.textContent = isoToLabel(isoDate || isoHoy());
        if (State.historialUnsub) State.historialUnsub();
        State.historialUnsub = db.collection(COLL_ENTREGAS)
            .where('fecha','==',fecha)
            .onSnapshot(snap => {
                const docs = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
                renderHistorial(docs);
            }, err => console.error('historial:', err));
    }

    function renderHistorial(docs) {
        UI.historialCount.textContent = docs.length;
        if (!docs.length) {
            UI.historialList.innerHTML = '<div class="empty-historial"><i class="bi bi-inbox"></i><p>No hay entregas registradas para esta fecha.</p></div>';
            return;
        }
        UI.historialList.innerHTML = docs.map(d => {
            const conts = Array.isArray(d.contenedores) ? d.contenedores : (d.contenedor ? [d.contenedor] : []);
            return `<div class="historial-item">
                <div class="historial-top">
                    <div>
                        <div class="historial-bodega">${esc(d.nombreBodega||d.codigoBodega||'—')}</div>
                        <div class="historial-meta">
                            <span><i class="bi bi-grid-3x3-gap-fill"></i> ${esc(d.seccionBodega||'—')}</span>
                            <span><i class="bi bi-person-fill-check"></i> ${esc(d.jefeBodega||'—')}</span>
                            <span><i class="bi bi-person-fill"></i> ${esc(d.empleadoNombre||'—')}</span>
                            <span><i class="bi bi-clock"></i> ${esc(d.hora||'—')}</span>
                        </div>
                    </div>
                    ${d.fotoUrl?`<img src="${esc(d.fotoUrl)}" class="historial-foto" alt="Evidencia" onclick="window.open('${esc(d.fotoUrl)}','_blank')" title="Ver foto">` : ''}
                </div>
                <div class="historial-conts">${conts.map(c=>`<span class="historial-cont-chip">${esc(c)}</span>`).join('')}</div>
            </div>`;
        }).join('');
    }

});
