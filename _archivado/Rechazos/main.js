/*****************************************************
 * ========== CONFIGURACIÓN DE FIREBASE ==========
 *****************************************************/
        const firebaseConfig = {
            apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
            authDomain: "sistemaintegrall.firebaseapp.com",
            projectId: "sistemaintegrall",
            storageBucket: "sistemaintegrall.firebasestorage.app",
            messagingSenderId: "302291844621",
            appId: "1:302291844621:web:6ebf1845790bdeabfc1f44",
            measurementId: "G-E5BT7GXRZN"
        };
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        const db = firebase.firestore();
        const auth = firebase.auth();
        // Usa el bucket predeterminado del proyecto; evita errores cuando cambia
        // el nombre entre el bucket legacy (.appspot.com) y el actual (.firebasestorage.app).
        const storage = firebase.storage();

/*****************************************************
 * ========== VARIABLES GLOBALES ==========
 *****************************************************/
const AppState = {
    relacionesData: null,
    usuariosData: [],
    allRechazosEnExcel: [],
    rechazosGlobal: [],
    selectedFileData: null,
    isAdmin: false,
    fileVersion: "1",
    pendingChanges: {},
    isSyncing: false,
    sheetName: '',
    sheetHeader: [],
    liveStates: new Map(),   // key -> datos de Firestore (pdisEstados/{archivo}/items)
    rowByKey: new Map(),
    liveUnsub: null,
    liveOk: false
};
const autoSaveTimers = {};
const PENDING_DB_NAME = 'pdisPendingChanges';

function savePendingChangesOffline() {
    localStorage.setItem('pendingChanges', JSON.stringify(AppState.pendingChanges));
    try {
        const request = indexedDB.open(PENDING_DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'id' });
        request.onsuccess = () => {
            const tx = request.result.transaction('queue', 'readwrite');
            tx.objectStore('queue').put({ id: 'active', changes: AppState.pendingChanges, updatedAt: Date.now() });
        };
    } catch (error) { console.warn('No se pudo respaldar la cola offline:', error); }
}
function clearPendingChangesOffline() {
    localStorage.removeItem('pendingChanges');
    try {
        const request = indexedDB.open(PENDING_DB_NAME, 1);
        request.onsuccess = () => request.result.transaction('queue', 'readwrite').objectStore('queue').delete('active');
    } catch (error) { console.warn('No se pudo limpiar la cola offline:', error); }
}

/*****************************************************
 * ========== MANEJO DE CACHÉ Y SINCRONIZACIÓN ==========
 *****************************************************/
function queueChange(remision, field, value) {
    if (!remision) return;
    console.log(`En cola para autoguardado: Remisión ${remision}, Campo: ${field}`);
    if (!AppState.pendingChanges[remision]) {
        AppState.pendingChanges[remision] = {};
    }
    AppState.pendingChanges[remision][field] = value;
    savePendingChangesOffline();
    updateSyncStatus('pending');
}

async function loadPendingChanges() {
    let savedChanges = localStorage.getItem('pendingChanges');
    try {
        const request = indexedDB.open(PENDING_DB_NAME, 1);
        await new Promise(resolve => { request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'id' }); request.onsuccess = resolve; request.onerror = resolve; });
        if (request.result) {
            const record = await new Promise(resolve => { const get = request.result.transaction('queue').objectStore('queue').get('active'); get.onsuccess = () => resolve(get.result); get.onerror = () => resolve(null); });
            if (record?.changes) savedChanges = JSON.stringify(record.changes);
        }
    } catch (error) { console.warn('No se pudo leer la cola offline:', error); }
    if (savedChanges) {
        AppState.pendingChanges = JSON.parse(savedChanges);
        console.log("Cambios pendientes cargados desde localStorage.", AppState.pendingChanges);
        if (Object.keys(AppState.pendingChanges).length > 0) {
            updateSyncStatus('pending');
        }
    }
}

function updateSyncStatus(status) {
    const statusIndicator = document.getElementById('syncStatus');
    if (!statusIndicator) return;
    switch (status) {
        case 'syncing':
            statusIndicator.innerHTML = `<i class="bi bi-arrow-repeat"></i> Guardando...`;
            statusIndicator.className = 'text-warning';
            break;
        case 'synced':
            statusIndicator.innerHTML = `<i class="bi bi-check-circle-fill"></i> Autoguardado.`;
            statusIndicator.className = 'text-success';
            break;
        case 'pending':
            statusIndicator.innerHTML = `<i class="bi bi-pencil-fill"></i> Cambios sin guardar...`;
            statusIndicator.className = 'text-info';
            break;
        case 'error':
            statusIndicator.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Error al guardar.`;
            statusIndicator.className = 'text-danger';
            break;
        default:
            statusIndicator.innerHTML = '';
            break;
    }
}

async function syncPendingChanges(isAutoSave = false) {
    if (Object.keys(AppState.pendingChanges).length === 0 || AppState.isSyncing) {
        return;
    }
    AppState.isSyncing = true;
    if (!navigator.onLine) {
        AppState.isSyncing = false;
        updateSyncStatus('pending');
        return;
    }
    if (isAutoSave) {
        updateSyncStatus('syncing');
    } else {
        Swal.fire({ title: 'Guardando Cambios...', html: 'Por favor, espera.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    }

    try {
        const fileRef = AppState.selectedFileData?.ref;
        if (!fileRef) throw new Error("No hay un archivo de referencia seleccionado.");
        
        // --- INICIO DEL CAMBIO CLAVE ---
        // 1. Leemos los metadatos existentes ANTES de hacer cualquier cambio.
        const currentMetadata = await fileRef.getMetadata();
        const serverVersion = (currentMetadata.customMetadata && currentMetadata.customMetadata.version) || "1";
        // Rescatamos la fecha de subida original. Si no existe, usamos la fecha de creación actual como respaldo.
        const originalUploadDate = (currentMetadata.customMetadata && currentMetadata.customMetadata.originalUploadDate) || currentMetadata.timeCreated;
        // --- FIN DEL CAMBIO CLAVE ---

        // Si otra persona guardó antes, se descarga la versión del servidor y se
        // combinan los cambios (ya no se muestra "Conflicto de versiones").
        const sameVersion = serverVersion === AppState.fileVersion;

        // Si el archivo es del formato PDIS y la versión del servidor es la que
        // tenemos en memoria, se reconstruye desde los datos locales sin volver
        // a descargarlo. Los archivos anteriores (hoja Rechazos) se descargan.
        let workbook, sheetName, excelData;
        const useLocal = sameVersion && AppState.sheetName === PDIS_SHEET && AppState.sheetHeader.length > 0 && AppState.allRechazosEnExcel.length > 0;
        if (useLocal) {
            sheetName = PDIS_SHEET;
            const header = [...new Set([...AppState.sheetHeader, 'Status', 'Auditor', 'Fotos'])];
            excelData = AppState.allRechazosEnExcel.map(r => Object.fromEntries(header.map(h => [h, r[h] ?? ''])));
            workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), sheetName);
        } else {
            const url = await fileRef.getDownloadURL();
            const response = await fetch(url);
            const data = await response.arrayBuffer();
            workbook = XLSX.read(data, { type: "array" });
            sheetName = getPdisSheetName(workbook);
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) throw new Error("No se encontró la hoja de datos en el archivo.");
            excelData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        }

        let hasChanges = useLocal;
        // Los estados capturados en vivo (Firestore) por cualquier auditor también se escriben al Excel.
        excelData.forEach(row => {
            const live = AppState.liveStates.get(rowKey(row));
            if (!live) return;
            ['Status', 'Auditor', 'Fotos'].forEach(field => {
                if (field in live && (row[field] ?? '') !== (live[field] ?? '')) { row[field] = live[field] ?? ''; hasChanges = true; }
            });
        });
        const updatesMap = new Map(Object.entries(AppState.pendingChanges));
        excelData.forEach(row => {
            const remision = rowKey(row);
            if (remision && updatesMap.has(remision)) {
                const updates = updatesMap.get(remision);
                for (const field in updates) {
                    if (row[field] !== updates[field]) {
                        row[field] = updates[field];
                        hasChanges = true;
                    }
                }
            }
        });

        if (!hasChanges) {
             console.log("No se encontraron cambios netos para sincronizar.");
             AppState.pendingChanges = {};
             clearPendingChangesOffline();
             if (isAutoSave) updateSyncStatus('synced'); else Swal.close();
             AppState.isSyncing = false;
             return;
        }

        const headerOrder = [...new Set(excelData.flatMap(row => Object.keys(row)))];
        const newSheet = XLSX.utils.json_to_sheet(excelData, { header: headerOrder });
        workbook.Sheets[sheetName] = newSheet;
        const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const newBlob = new Blob([wbout], { type: "application/octet-stream" });
        const newVersion = (parseInt(serverVersion) + 1).toString();
        
        // --- INICIO DEL CAMBIO CLAVE ---
        // 2. Preparamos los NUEVOS metadatos, asegurándonos de preservar la fecha original.
        const newMetadata = {
            customMetadata: {
                ...(currentMetadata.customMetadata || {}),
                'version': newVersion,
                'originalUploadDate': originalUploadDate
            }
        };
        // --- FIN DEL CAMBIO CLAVE ---

        await fileRef.put(newBlob, newMetadata); // Guardamos el archivo con los metadatos actualizados
        
        AppState.fileVersion = newVersion;
        if (!useLocal) AppState.allRechazosEnExcel = excelData;
        AppState.pendingChanges = {};
        clearPendingChangesOffline();
        
        if (isAutoSave) {
            updateSyncStatus('synced');
        } else {
            showAlert("success", "¡Guardado!", "Todos tus cambios han sido guardados correctamente.");
        }

    } catch (error) {
        console.error("Error durante la sincronización:", error);
        showAlert("error", "Error al Sincronizar", error.message);
        if (isAutoSave) updateSyncStatus('error');
    } finally {
        AppState.isSyncing = false;
        if (!isAutoSave && Swal.isVisible()) {
            Swal.close();
        }
    }
}

/*****************************************************
 * ========== ESTADOS EN VIVO (FIRESTORE) ==========
 * Cada cambio de estado/foto se guarda en pdisEstados/{archivo}/items/{ID}
 * y todos los auditores lo reciben al instante con onSnapshot. Cada cambio
 * también deja un registro en pdisEstados/{archivo}/historial.
 * El Excel se actualiza cuando guarda un administrador (Storage solo admite
 * escrituras de administradores) y el Dashboard PDIS combina ambos.
 *****************************************************/
function pdisFileId(name) { return String(name || AppState.selectedFileData?.name || 'pdis').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140); }
function pdisItemId(key) { return String(key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140); }
function pdisFileDoc(name) { return db.collection('pdisEstados').doc(pdisFileId(name)); }

function setLiveIndicator(state) {
    const el = document.getElementById('liveIndicator');
    if (!el) return;
    const map = { on: ['is-on', 'En vivo'], off: ['is-off', 'Sin conexión en vivo'], wait: ['is-wait', 'Conectando…'] };
    const [cls, text] = map[state] || map.wait;
    el.className = `pdi-live ${cls}`;
    el.innerHTML = `<span class="pdi-live-dot"></span>${text}`;
}

function stopLiveStates() {
    if (AppState.liveUnsub) { AppState.liveUnsub(); AppState.liveUnsub = null; }
}

// Aplica en pantalla el estado de una fila sin volver a dibujar la lista.
function paintRowState(row) {
    const idx = row._rowIndex;
    if (idx == null || AppState.rechazosGlobal[idx] !== row) return;
    const estado = row.Status || 'Sin Estado';
    const badge = document.querySelector(`#heading-${idx} .pdi-status`);
    if (badge) { badge.className = 'badge rounded-pill me-2 pdi-status ' + pdiStatusClass(estado); badge.textContent = estado; }
    const select = document.getElementById(`status-${idx}`);
    if (select && document.activeElement !== select) {
        const value = normalizePdiStatus(row.Status);
        if (value) { select.querySelector('option[value=""]')?.remove(); select.value = value; }
        const picker = select.closest('.status-picker');
        if (picker) picker.className = `status-picker status-${estado.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
    }
    const preview = document.getElementById(`evidencia-preview-${idx}`);
    if (preview && preview.dataset.url !== (row.Fotos || '')) updatePhotoPreview(idx, row.Fotos || '');
    const item = document.getElementById(`item-${idx}`);
    if (item) { item.classList.remove('pdi-flash'); void item.offsetWidth; item.classList.add('pdi-flash'); }
}

// Se suscribe a los estados del archivo. Resuelve cuando llega la primera foto de datos.
function startLiveStates() {
    stopLiveStates();
    AppState.liveStates = new Map();
    AppState.rowByKey = new Map(AppState.allRechazosEnExcel.map(r => [rowKey(r), r]));
    setLiveIndicator('wait');
    return new Promise(resolve => {
        let first = true;
        const done = () => { if (first) { first = false; resolve(); } };
        setTimeout(done, 5000);
        try {
            AppState.liveUnsub = pdisFileDoc().collection('items').onSnapshot(snap => {
                const myUid = auth.currentUser?.uid;
                let others = 0;
                snap.docChanges().forEach(change => {
                    if (change.type === 'removed') return;
                    const d = change.doc.data();
                    const key = String(d.key ?? '');
                    const row = AppState.rowByKey.get(key);
                    AppState.liveStates.set(key, d);
                    if (!row) return;
                    if ('Status' in d) row.Status = d.Status || '';
                    if ('Auditor' in d) row.Auditor = d.Auditor || '';
                    if ('Fotos' in d) row.Fotos = d.Fotos || '';
                    if (!first) { paintRowState(row); if (d.auditorUid !== myUid && !snap.metadata.hasPendingWrites) others++; }
                });
                AppState.liveOk = true;
                setLiveIndicator('on');
                if (others) showAlert('info', others === 1 ? 'Un artículo actualizado por otro auditor' : `${others} artículos actualizados por otros auditores`, '', { timer: 2200 });
                done();
            }, error => {
                console.error('Estados en vivo no disponibles:', error);
                AppState.liveOk = false;
                setLiveIndicator('off');
                done();
            });
        } catch (error) {
            console.error('No se pudo iniciar el modo en vivo:', error);
            setLiveIndicator('off');
            done();
        }
    });
}

// Guarda un cambio en vivo. Respeta la protección: solo quien capturó el
// artículo o un administrador puede modificarlo. Devuelve true, false o 'error'.
async function saveLiveState(row, fields) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sin sesión');
    const key = rowKey(row);
    const ref = pdisFileDoc().collection('items').doc(pdisItemId(key));
    const auditor = user.displayName || user.email;
    const data = { key, sku: pdisView(row).sku, ...fields, Auditor: auditor, auditorEmail: user.email || '', auditorUid: user.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const anterior = { Status: row.Status || '', Fotos: row.Fotos || '', Auditor: row.Auditor || '' };
    const log = () => pdisFileDoc().collection('historial').add({
        key, sku: data.sku, descripcion: pdisView(row).desc, cambio: fields, anterior,
        auditor, email: user.email || '', uid: user.uid, archivo: AppState.selectedFileData?.name || '',
        at: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.warn('No se pudo registrar el historial:', err));
    try {
        if (!navigator.onLine) { ref.set(data, { merge: true }); log(); return true; } // Firestore lo envía al reconectar
        const ok = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const owner = snap.exists ? snap.data().auditorUid : '';
            if (owner && owner !== user.uid && !AppState.isAdmin) return false;
            tx.set(ref, data, { merge: true });
            return true;
        });
        if (ok) log();
        return ok;
    } catch (error) {
        console.error('No se pudo guardar en vivo:', error);
        return 'error';
    }
}

// Programa la escritura al Excel (solo administradores pueden escribir en Storage).
function scheduleExcelSync(row, fields, delay = 4000) {
    if (!AppState.isAdmin) return;
    const key = rowKey(row);
    Object.entries(fields).forEach(([field, value]) => queueChange(key, field, value));
    if (autoSaveTimers.excel) clearTimeout(autoSaveTimers.excel);
    autoSaveTimers.excel = setTimeout(() => syncPendingChanges(true), delay);
}

// Guarda un cambio: primero en vivo; si el modo en vivo no está disponible,
// usa el guardado anterior al Excel.
async function persistRowChange(row, fields) {
    const user = auth.currentUser;
    const auditor = user ? (user.displayName || user.email) : '';
    if (AppState.liveOk) {
        const result = await saveLiveState(row, fields);
        if (result === false) return { ok: false, reason: 'protegido' };
        if (result === true) {
            Object.assign(row, fields, { Auditor: auditor });
            scheduleExcelSync(row, { ...fields, Auditor: auditor });
            return { ok: true };
        }
    }
    if (!AppState.isAdmin) return { ok: false, reason: 'sin-permiso' };
    Object.assign(row, fields, { Auditor: auditor });
    scheduleExcelSync(row, { ...fields, Auditor: auditor }, 1500);
    return { ok: true };
}

/*****************************************************
 * ========== FUNCIONES AUXILIARES Y DE LÓGICA ==========
 *****************************************************/
function showAlert(icon, title, text = '', config = {}) { const defaultConfig = { toast: true, position: "top-end", showConfirmButton: false, timer: 3000, timerProgressBar: true, didOpen: (toast) => { toast.addEventListener('mouseenter', Swal.stopTimer); toast.addEventListener('mouseleave', Swal.resumeTimer); } }; return Swal.fire({ icon, title, text, ...defaultConfig, ...config }); }
function setUIForRole(isAdmin) { document.getElementById("dropzone").classList.toggle("hidden", !isAdmin); }
function fixEncoding(str) { if (!str) return ""; if (window.fixText) return window.fixText(String(str)); try { return decodeURIComponent(escape(str)); } catch { return str; } }
function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }
function parseExcelDate(value) { if (!value) return ""; if (typeof value === "number") { const dateObj = new Date(Math.round((value - 25569) * 86400 * 1000)); return dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); } const parsed = Date.parse(value); if (!isNaN(parsed)) { const dateObj = new Date(parsed); return dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); } return value; }
/*****************************************************
 * ========== FORMATO BASE "ALMACEN PDIS" ==========
 * Archivo base: Complementos/ALMACEN PDIS _Liverpool_Tabla.xlsx
 * Los archivos se suben con estas mismas columnas. Al subir se agregan
 * FECHA_CARGA (para filtrar), ID_PDIS (llave única por fila) y las columnas
 * de seguimiento Status, Auditor y Fotos. Los archivos antiguos con la hoja
 * "Rechazos" (llave Remisión) se siguen leyendo.
 *****************************************************/
const PDIS_SHEET = 'PDIS';
const PDIS_BASE_COLUMNS = ['JEFE', 'SKU', 'DESCRIPCION', 'SECCION', 'ESTATUS', 'VISIBLES', 'ULT_MOV', 'DÍAS ANTIGÜEDAD', 'ANT_DIA_MES', 'ENVASE', 'DIR_DES', 'INVENTARIO', 'NEGS_PISO', 'COSTO_TOTAL'];
const PDIS_REQUIRED_COLUMNS = ['JEFE', 'SKU', 'DESCRIPCION', 'SECCION'];
const PDIS_EXTRA_COLUMNS = ['FECHA_CARGA', 'ID_PDIS', 'Status', 'Auditor', 'Fotos'];

const normKeyCache = new Map();
function normKey(k) {
    const raw = String(k ?? '');
    if (!normKeyCache.has(raw)) normKeyCache.set(raw, fixEncoding(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    return normKeyCache.get(raw);
}
function pickField(row, ...names) {
    if (!row) return '';
    const wanted = names.map(normKey);
    const key = Object.keys(row).find(k => wanted.includes(normKey(k)));
    return key ? row[key] : '';
}
function rowKey(row) { return String(pickField(row, 'ID_PDIS', 'Remisión') ?? '').trim(); }
function normSeccion(s) { return String(s ?? '').trim().replace(/^0+(?=\d)/, ''); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatFechaCarga(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return parseExcelDate(v);
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}
// Hoja de trabajo: "PDIS" (formato nuevo), "Rechazos" (formato anterior) o la primera.
function getPdisSheetName(workbook) {
    if (workbook.Sheets[PDIS_SHEET]) return PDIS_SHEET;
    if (workbook.Sheets['Rechazos']) return 'Rechazos';
    return workbook.SheetNames[0];
}
// Vista normalizada de una fila, sin importar si viene del formato nuevo o del anterior.
const pdisViewCache = new WeakMap();
function pdisView(row) {
    if (row && typeof row === 'object' && pdisViewCache.has(row)) return pdisViewCache.get(row);
    const view = buildPdisView(row);
    if (row && typeof row === 'object') pdisViewCache.set(row, view);
    return view;
}
function buildPdisView(row) {
    const isLegacy = !pickField(row, 'ID_PDIS') && !!pickField(row, 'Remisión');
    return {
        key: rowKey(row),
        sku: String(pickField(row, 'SKU', 'Sku') ?? '').trim(),
        desc: fixEncoding(pickField(row, 'DESCRIPCION', 'Descripción Sku')),
        seccion: String(pickField(row, 'SECCION', 'Sección') ?? '').trim(),
        jefe: fixEncoding(pickField(row, 'JEFE', 'Jefatura')),
        piezas: pickField(row, 'INVENTARIO', 'Piezas'),
        fecha: isLegacy ? parseExcelDate(pickField(row, 'Fecha y Hora Rechazo')) : formatFechaCarga(pickField(row, 'FECHA_CARGA')),
        fechaCargaRaw: pickField(row, 'FECHA_CARGA', 'Fecha y Hora Rechazo'),
        usuario: fixEncoding(pickField(row, 'Usuario de Rechazo')),
        isLegacy
    };
}

// Lee el Excel que sube el administrador, valida las columnas base y devuelve
// las filas con el orden de columnas del archivo base.
function parseBaseWorkbook(data) {
    const workbook = XLSX.read(data, { type: 'array' });
    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const headerIndex = matrix.slice(0, 15).findIndex(r => {
            const keys = r.map(normKey);
            return PDIS_REQUIRED_COLUMNS.every(c => keys.includes(normKey(c)));
        });
        if (headerIndex === -1) continue;
        const headerKeys = matrix[headerIndex].map(normKey);
        const missing = PDIS_BASE_COLUMNS.filter(c => !headerKeys.includes(normKey(c)));
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerIndex });
        const rows = raw.filter(r => String(pickField(r, 'SKU')).trim() || String(pickField(r, 'DESCRIPCION')).trim());
        return { rows, missing, sheetName: name };
    }
    return null;
}
function buildPdisRows(rows, fechaCarga) {
    const stamp = fechaCarga.replace(/-/g, '');
    return rows.map((r, i) => {
        const out = {};
        PDIS_BASE_COLUMNS.forEach(col => {
            let v = pickField(r, col);
            if (col === 'SKU' || col === 'SECCION') v = String(v ?? '').trim();
            out[col] = v ?? '';
        });
        out.FECHA_CARGA = fechaCarga;
        out.ID_PDIS = `${stamp}-${String(i + 1).padStart(4, '0')}`;
        out.Status = pickField(r, 'Status') || '';
        out.Auditor = pickField(r, 'Auditor') || '';
        out.Fotos = pickField(r, 'Fotos') || '';
        return out;
    });
}

function showSection(sectionId) { const section = document.getElementById(sectionId); if (section) { section.classList.remove('hidden'); setTimeout(() => section.classList.add('visible'), 50); } }
async function claimPdiLock(remision, user, status) {
    if (AppState.isAdmin) return true;
    const fileName = AppState.selectedFileData?.name || 'pdis';
    const lockId = `${fileName}_${remision}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140);
    const ref = db.collection('pdisLocks').doc(lockId);
    try {
        return await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.data().ownerUid !== user.uid) return false;
            tx.set(ref, { ownerUid: user.uid, ownerEmail: user.email || '', status, fileName, remision: String(remision), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return true;
        });
    } catch (error) { console.error('No se pudo reservar el PDIS:', error); return false; }
}

function loadDynamicImage(sku, seccion, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="d-flex align-items-center justify-content-center" style="height: 150px;"><div class="spinner-border text-secondary" role="status"></div></div>`;

    // Liverpool sirve la imagen por SKU en su CDN (ss628 funciona para todos los SKU);
    // la sección no forma parte del host. Se intenta tamaño xl y luego lg.
    const skuLimpio = String(sku || '').trim();

    const fallbackImageHTML = `<div class="product-image-empty"><i class="bi bi-image"></i><strong>Imagen no disponible</strong><span>No encontramos una imagen para este SKU</span><a href="https://www.liverpool.com.mx/tienda/busca?busqueda=${encodeURIComponent(sku || '')}" target="_blank" rel="noopener"><i class="bi bi-search"></i> Buscar en Liverpool</a></div>`;

    const imageCandidates = skuLimpio ? [`https://ss628.liverpool.com.mx/xl/${encodeURIComponent(skuLimpio)}.jpg`, `https://ss628.liverpool.com.mx/lg/${encodeURIComponent(skuLimpio)}.jpg`] : [];
    if (!imageCandidates.length) { container.innerHTML = fallbackImageHTML; return; }
    const img = new Image();
    let imageIndex = 0;
    img.className = "pdi-product-img";
    img.alt = skuLimpio;

    img.onload = () => {
        container.innerHTML = '';
        container.appendChild(img);
    };

    img.onerror = () => {
        imageIndex += 1;
        if (imageIndex < imageCandidates.length) { img.src = imageCandidates[imageIndex]; return; }
        container.innerHTML = fallbackImageHTML;
    };
    img.src = imageCandidates[imageIndex];
}

async function loadStaticExcelFiles() { try { const [userResponse, relResponse] = await Promise.all([fetch("../ExcelReferencia/ArchivosExcel/Usuarios.xlsx"), fetch("../ExcelReferencia/ArchivosExcel/relaciones.xlsx")]); if (!userResponse.ok) console.error("No se encontró Usuarios.xlsx"); const userBlob = await userResponse.blob(); const userData = await userBlob.arrayBuffer(); const userWorkbook = XLSX.read(userData, { type: "array" }); const userSheet = userWorkbook.Sheets["Usuarios"]; if (userSheet) AppState.usuariosData = XLSX.utils.sheet_to_json(userSheet, { defval: "" }); if (!relResponse.ok) console.error("No se encontró relaciones.xlsx"); const relBlob = await relResponse.blob(); const relData = await relBlob.arrayBuffer(); const relWorkbook = XLSX.read(relData, { type: "array" }); const relSheet = relWorkbook.Sheets["Usuarios"]; if (relSheet) AppState.relacionesData = XLSX.utils.sheet_to_json(relSheet); } catch (error) { console.error("Error al cargar archivos estáticos:", error); showAlert("error", "Error Crítico", "No se pudieron cargar los archivos de configuración."); } }

/*****************************************************
 * ========== INICIO DE APP Y MANEJO DE EVENTOS ==========
 *****************************************************/
document.addEventListener("DOMContentLoaded", () => {
    const preloader = document.querySelector('.preloader');
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            document.getElementById("correoUsuario").innerHTML = `<i class="bi bi-person-circle me-2"></i>${user.email}`;
            AppState.isAdmin = await window.isSystemAdmin(user, db);
            const adminTabNav = document.getElementById('adminTab');
            if (adminTabNav && AppState.isAdmin) adminTabNav.style.display = 'flex';
            loadPendingChanges();
            setUIForRole(AppState.isAdmin);
            await loadStaticExcelFiles();
            await loadFilesFromFirebase();
            showSection('file-selection-section');
        } else {
            window.location.href = "../Login/login.html";
        }
        preloader.classList.add('hidden');
    });
    setupEventListeners();
});


// ===== SECCIÓN MODIFICADA (INICIO) =====
// Se ha mejorado el listener para que el ícono de comentario cambie de forma más visible.
function setupEventListeners() {
    // Listener para el botón de logout (Cerrar Sesión)
    document.getElementById("logout-btn").addEventListener("click", () => auth.signOut());
    window.addEventListener('online', () => {
        if (Object.keys(AppState.pendingChanges).length) syncPendingChanges(true);
    });
    
    // Listener para el botón de confirmar selección de archivo
    document.getElementById("confirmFileSelection").addEventListener("click", () => {
        if (AppState.selectedFileData) {
            showAlert("success", "Archivo Confirmado", `Cargando reportes...`);
            document.getElementById("file-selection-section").style.display = "none";
            loadRechazosFileBasedOnRole();
            showSection('tools-section');
            showSection('content-section');
        } else {
            showAlert("warning", "Atención", "Debes seleccionar un archivo.");
        }
    });

    // Listener para la zona de carga de archivos (dropzone)
    const dropzone = document.getElementById("dropzone");
    if (dropzone) {
        const handleFileSelect = (file) => {
            if (file) {
                handleFileUpload(file);
            }
        };

        dropzone.addEventListener("click", () => {
            if (!AppState.isAdmin) return;
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".xlsx, .xls";
            fileInput.onchange = (e) => handleFileSelect(e.target.files[0]);
            fileInput.click();
        });
    }

    // --- INICIO DE LA CORRECCIÓN ---
    // Verificamos que cada botón exista antes de asignarle un listener.

    const totalBtn = document.getElementById("generarDashboardTotalBtn");
    if (totalBtn) {
        totalBtn.addEventListener("click", () => generarDashboard());
    }

    const rangoBtn = document.getElementById("generarDashboardRangoBtn");
    if (rangoBtn) {
        rangoBtn.addEventListener("click", generarDashboardPorRango);
    }

    const auditoresBtn = document.getElementById("generarDashboardAuditoresBtn");
    if (auditoresBtn) {
        auditoresBtn.addEventListener("click", generarDashboardAuditores);
    }
    // --- FIN DE LA CORRECCIÓN ---


    // Listener para acciones en la tabla (elegir/borrar foto)
    document.addEventListener("click", (e) => {
        const target = e.target.closest("[data-action]");
        if (!target) return;
        const action = target.dataset.action;
        const rowIndex = target.dataset.rowIndex;
        if (action === "choose-photo") {
            choosePhoto(rowIndex);
        } else if (action === "delete-photo") {
            deletePhoto(rowIndex);
        }
    });
    
    // Cambio de estado: se guarda en vivo y los demás auditores lo ven al instante.
    document.addEventListener("change", async (e) => {
        if (!e.target.classList.contains("status-select")) return;
        const select = e.target;
        const rowIndex = Number(select.dataset.rowIndex);
        const row = AppState.rechazosGlobal[rowIndex];
        const user = auth.currentUser;
        if (!row) return;
        if (!user) { showAlert("error", "Error de Sesión", "No se pudo identificar al usuario. Recarga la página."); return; }
        const previous = normalizePdiStatus(row.Status);
        const revert = () => { if (previous) select.value = previous; else select.selectedIndex = 0; };
        const myName = user.displayName || user.email;
        if (!AppState.isAdmin && row.Status && row.Auditor && row.Auditor !== myName && !AppState.liveOk) {
            revert();
            showAlert('warning', 'Registro protegido', `Este PDIS ya fue capturado por ${row.Auditor}. Solo esa persona o un administrador puede modificarlo.`);
            return;
        }
        select.disabled = true;
        updateSyncStatus('syncing');
        const result = await persistRowChange(row, { Status: select.value });
        select.disabled = false;
        if (!result.ok) {
            revert();
            updateSyncStatus('error');
            showAlert('warning', result.reason === 'protegido' ? 'PDIS protegido' : 'No se pudo guardar',
                result.reason === 'protegido' ? `Este PDIS ya fue capturado por ${row.Auditor || 'otro auditor'}. Solo esa persona o un administrador puede modificarlo.` : 'El modo en vivo no está disponible. Avisa a un administrador.');
            return;
        }
        select.querySelector('option[value=""]')?.remove();
        paintRowState(row);
        updateSyncStatus('synced');
    });
}
/*****************************************************
 * ========== MANEJO DE ARCHIVOS (FIREBASE) ==========
 *****************************************************/
async function checkExistingFile() { const storageRef = storage.ref("uploads"); const fileList = await storageRef.listAll(); return fileList.items.some(item => item.name.toLowerCase() === "rechazos.xlsx"); }
async function loadFilesFromFirebase() {
    try {
        const storageRef = storage.ref("uploads");
        const fileList = await storageRef.listAll();
        const rechazosItems = fileList.items.filter(item => {
            const name = item.name.toLowerCase();
            return name.includes('rechazos') || name.includes('pdis');
        });

        if (rechazosItems.length === 0) {
            showAlert("warning", "Sin archivos", "No se encontró ningún reporte de 'Rechazos'. Un administrador debe subir el primero.");
            const mgmtContainer = document.getElementById("filesManagementContainer");
            if (mgmtContainer) mgmtContainer.innerHTML = "";
            return;
        }
        
        const filesWithMetadata = await Promise.all(
            rechazosItems.map(async (item) => {
                const metadata = await item.getMetadata();
                
                // --- INICIO DEL CAMBIO CLAVE ---
                // Priorizamos nuestra fecha personalizada. Si no existe, usamos timeCreated.
                const displayDate = (metadata.customMetadata && metadata.customMetadata.originalUploadDate) 
                                    ? new Date(metadata.customMetadata.originalUploadDate)
                                    : new Date(metadata.timeCreated);
                // --- FIN DEL CAMBIO CLAVE ---

                return {
                    name: item.name,
                    ref: item,
                    timeCreated: displayDate, // Usamos la fecha correcta para mostrar
                    fechaCarga: (metadata.customMetadata && metadata.customMetadata.fechaCarga) || "",
                    size: metadata.size,
                    version: (metadata.customMetadata && metadata.customMetadata.version) || "1"
                };
            })
        );

        // Ordena por fecha de carga (FECHA_CARGA) y, en empate, por fecha de subida.
        filesWithMetadata.sort((a, b) => String(b.fechaCarga).localeCompare(String(a.fechaCarga)) || b.timeCreated - a.timeCreated);

        const controlStats = document.getElementById('controlStats');
        if (controlStats) {
            const latest = filesWithMetadata[0]?.timeCreated;
            controlStats.innerHTML = `
                <div class="control-stat"><i class="bi bi-files"></i><div><strong>${filesWithMetadata.length}</strong><span>Archivos PDIS</span></div></div>
                <div class="control-stat"><i class="bi bi-clock-history"></i><div><strong>${latest ? latest.toLocaleDateString('es-MX') : '—'}</strong><span>Última actualización</span></div></div>
                <div class="control-stat"><i class="bi bi-shield-check"></i><div><strong>Activo</strong><span>Almacenamiento conectado</span></div></div>`;
        }
        
        renderFileSelectOptions(filesWithMetadata);

        if (AppState.isAdmin) {
            renderFilesManagement(filesWithMetadata);
        }
        
    } catch (error) {
        console.error("Error al listar archivos de Firebase:", error);
        showAlert("error", "Error de Red", "No se pudo conectar con Firebase.");
    }
}

function renderFileSelectOptions(files) { const container = document.getElementById("fileListContainer"); container.innerHTML = files.map(file => `<div class="card file-card mb-2" style="border-radius: 12px;"><div class="card-body d-flex justify-content-between align-items-center p-3"><div><i class="bi bi-file-earmark-excel-fill me-2 text-success fs-4"></i><span class="fw-bold">${file.name}</span>${file.fechaCarga ? `<small class="d-block text-muted"><i class="bi bi-calendar-event me-1"></i>Fecha de carga: ${formatFechaCarga(file.fechaCarga)}</small>` : ''}</div><div class="file-card-actions">${AppState.isAdmin ? `<button type="button" class="btn btn-pill btn-pill-sm btn-delete file-delete-btn" data-filename="${file.name}" title="Eliminar archivo"><i class="bi bi-trash3-fill"></i> Eliminar</button>` : ''}<button class="btn btn-pill btn-pill-sm btn-select">Seleccionar</button></div></div></div>`).join(''); container.querySelectorAll('.file-delete-btn').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); confirmDeletePdisFile(e.currentTarget.dataset.filename); })); container.querySelectorAll('.btn-select').forEach((button, index) => { button.addEventListener('click', () => { AppState.selectedFileData = files[index]; document.getElementById("selectedFileFeedback").textContent = `Archivo seleccionado: ${files[index].name}`; document.getElementById("confirmFileSelection").disabled = false; container.querySelectorAll('.file-card').forEach(card => card.style.border = "1px solid var(--gris-medio)"); button.closest('.file-card').style.border = "2px solid var(--rosa-principal)"; }); }); }

// Elimina un archivo PDIS de Storage. Solo administradores (también lo exige storage.rules).
async function confirmDeletePdisFile(fileName) {
    if (!AppState.isAdmin || !fileName) return;
    const { isConfirmed } = await Swal.fire({
        title: '¿Eliminar archivo?',
        text: `El archivo "${fileName}" se borrará permanentemente. Esta acción no se puede deshacer.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef5350',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (!isConfirmed) return;
    Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        await storage.ref(`uploads/${fileName}`).delete();
        showAlert("success", "Eliminado", "El archivo ha sido eliminado.");
        setTimeout(() => location.reload(), 1500);
    } catch (error) {
        console.error('No se pudo eliminar el archivo:', error);
        showAlert("error", "Error", "No se pudo eliminar el archivo.");
    }
}

async function renderFilesManagement(files) {
    if (!files.length) return;

    const container = document.getElementById("filesManagementContainer");

    const filesHTML = await Promise.all(files.map(async file => {
        
        const fileSize = file.size;
        const formattedSize = fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : 'N/A';

        const dateOptions = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' };
        const formattedDate = (file.fechaCarga ? `Carga: ${formatFechaCarga(file.fechaCarga)}<br>` : '') + `Subido: ${file.timeCreated.toLocaleDateString('es-MX', dateOptions)}`;

        return `
        <tr class="align-middle animate__animated animate__fadeIn">
            <td class="ps-3 py-3">
            <div class="d-flex align-items-center">
                <div class="flex-shrink-0 me-3">
                <div class="file-icon-wrapper bg-success-subtle text-success rounded-3 d-flex align-items-center justify-content-center" style="width: 40px; height: 40px;">
                    <i class="bi bi-file-earmark-excel-fill fs-5"></i>
                </div>
                </div>
                <div class="flex-grow-1">
                <div class="fw-bold text-dark">${file.name}</div>
                <small class="text-muted">${formattedSize}</small>
                </div>
            </div>
            </td>
            <td class="py-3 text-center">
            <span class="badge fs-6 bg-primary-subtle text-primary-emphasis rounded-pill fw-semibold border border-primary-subtle">v${file.version}</span>
            </td>
            <td class="py-3">
            <span class="text-muted small">${formattedDate}</span>
            </td>
            <td class="text-end pe-3 py-3">
            <div class="dropdown">
                <button class="btn btn-sm btn-ghost-secondary rounded-circle" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Más opciones">
                <i class="bi bi-three-dots-vertical fs-5"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end shadow border-0 rounded-3">
                <li>
                    <button type="button" class="dropdown-item d-flex align-items-center gap-2 file-download-btn" data-filename="${file.name}">
                    <i class="bi bi-download"></i> Descargar
                    </button>
                </li>
                <li>
                    <button type="button" class="dropdown-item d-flex align-items-center gap-2 file-copy-btn" data-filename="${file.name}">
                    <i class="bi bi-link-45deg"></i> Copiar enlace
                    </button>
                </li>
                <li><hr class="dropdown-divider"></li>
                <li>
                    <button class="dropdown-item d-flex align-items-center gap-2 text-danger admin-delete-btn" data-filename="${file.name}">
                    <i class="bi bi-trash3-fill"></i> Eliminar Archivo
                    </button>
                </li>
                </ul>
            </div>
            </td>
        </tr>
        `;
    }));

    container.innerHTML = `
        <div class="card shadow-sm border-0 rounded-4 mt-4">
            <div class="card-header bg-light-subtle border-0 pt-3 pb-2 rounded-top-4">
                <h5 class="mb-0 fw-bold text-secondary">
                    <i class="bi bi-folder-gear me-2"></i>Gestión de Archivos (Admin)
                </h5>
            </div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-hover table-borderless align-middle mb-0">
                        <thead class="text-muted small text-uppercase">
                            <tr>
                                <th class="ps-3 py-3">Nombre del Archivo</th>
                                <th class="py-3">Versión</th>
                                <th class="py-3">Fecha de Subida</th>
                                <th class="text-end pe-3 py-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>${filesHTML.join('')}</tbody>
                    </table>
                </div>
            </div>
        </div>`;

    const urlOf = name => storage.ref(`uploads/${name}`).getDownloadURL();
    container.querySelectorAll('.file-download-btn').forEach(btn => btn.addEventListener('click', async e => {
        try { window.open(await urlOf(e.currentTarget.dataset.filename), '_blank', 'noopener'); } catch { showAlert('error', 'Error', 'No se pudo obtener el archivo.'); }
    }));
    container.querySelectorAll('.file-copy-btn').forEach(btn => btn.addEventListener('click', async e => {
        try { await navigator.clipboard.writeText(await urlOf(e.currentTarget.dataset.filename)); showAlert('success', '¡Enlace copiado!'); } catch { showAlert('error', 'Error', 'No se pudo copiar el enlace.'); }
    }));
    document.querySelectorAll('#filesManagementContainer .admin-delete-btn').forEach(button => {
        button.addEventListener('click', e => confirmDeletePdisFile(e.currentTarget.dataset.filename));
    });
}
async function handleFileUpload(file) {
    // 1. Validamos que el archivo tenga las columnas del archivo base ALMACEN PDIS.
    let parsed;
    try {
        parsed = parseBaseWorkbook(await file.arrayBuffer());
    } catch (error) {
        console.error('No se pudo leer el Excel:', error);
        return showAlert('error', 'Archivo inválido', 'No se pudo leer el Excel seleccionado.', { toast: false, timer: undefined, showConfirmButton: true });
    }
    if (!parsed) {
        return Swal.fire({ icon: 'error', title: 'Formato incorrecto', html: `El archivo debe tener las columnas del archivo base <strong>ALMACEN PDIS</strong>:<br><small>${PDIS_BASE_COLUMNS.join(', ')}</small>` });
    }
    if (!parsed.rows.length) {
        return Swal.fire({ icon: 'warning', title: 'Archivo vacío', text: 'El archivo no tiene filas con SKU o descripción.' });
    }

    // 2. Pedimos la fecha de carga que se agregará a cada fila (FECHA_CARGA).
    const { value: fechaCarga, isConfirmed } = await Swal.fire({
        title: '¿Subir este archivo?',
        html: `Se cargará <strong>${file.name}</strong> con <strong>${parsed.rows.length.toLocaleString('es-MX')}</strong> artículos.` +
            (parsed.missing.length ? `<div class="alert alert-warning small mt-3 mb-0">Columnas faltantes (se dejarán vacías): ${parsed.missing.join(', ')}</div>` : '') +
            `<label class="form-label fw-semibold mt-3 mb-1" for="swal-fecha-carga">Fecha de carga</label>`,
        input: 'date',
        inputValue: todayISO(),
        inputAttributes: { id: 'swal-fecha-carga', max: todayISO() },
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, subir',
        cancelButtonText: 'Cancelar',
        inputValidator: value => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? undefined : 'Selecciona la fecha de carga.')
    });

    if (isConfirmed) {
        // 3. Construimos el archivo normalizado: columnas base + FECHA_CARGA, ID_PDIS, Status, Auditor y Fotos.
        const rows = buildPdisRows(parsed.rows, fechaCarga);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: [...PDIS_BASE_COLUMNS, ...PDIS_EXTRA_COLUMNS] }), PDIS_SHEET);
        const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        const newFileName = `PDIS_${fechaCarga}_${hora}.xlsx`;
        const fileRef = storage.ref(`uploads/${newFileName}`);

        // Metadatos: fecha real de subida, fecha de carga elegida y archivo origen.
        const metadata = {
            customMetadata: {
                'version': '1',
                'originalUploadDate': new Date().toISOString(),
                'fechaCarga': fechaCarga,
                'originalName': file.name.slice(0, 200),
                'rows': String(rows.length)
            }
        };

        const uploadTask = fileRef.put(blob, metadata);

        Swal.fire({
            title: 'Subiendo archivo...',
            html: `<div class="progress"><div id="upload-progress-bar" class="progress-bar" role="progressbar" style="width: 0%; background-color: var(--rosa-principal);"></div></div>`,
            allowOutsideClick: false,
            showConfirmButton: false
        });

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                document.getElementById('upload-progress-bar').style.width = progress + '%';
            },
            (error) => {
                Swal.close();
                showAlert("error", "Error de subida", error.message);
            },
            () => {
                Swal.close();
                showAlert("success", "Éxito", "Archivo subido correctamente.");
                setTimeout(() => location.reload(), 1500);
            }
        );
    }
}
async function sendFileByEmail() { if (!AppState.selectedFileData?.ref) { return showAlert("error", "Error", "No hay un archivo seleccionado."); } const fileUrl = await AppState.selectedFileData.ref.getDownloadURL(); const subject = encodeURIComponent("Archivo de Rechazos - Liverpool"); const body = encodeURIComponent(`Hola,\n\nSe comparte el enlace de descarga para el archivo de rechazos actualizado:\n\n${fileUrl}\n\nSaludos.`); window.location.href = `mailto:?subject=${subject}&body=${body}`; }

/*****************************************************
 * ========== MANEJO DE FOTOS (VERSIÓN MEJORADA) ==========
 *****************************************************/
function saveEvidenceDraft(remision, file) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('pdisEvidenceDrafts', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const tx = request.result.transaction('drafts', 'readwrite');
            tx.objectStore('drafts').put({ id: String(remision), remision: String(remision), name: file.name, type: file.type, blob: file, savedAt: Date.now() });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        };
    });
}
function deleteEvidenceDraft(remision) {
    return new Promise(resolve => {
        const request = indexedDB.open('pdisEvidenceDrafts', 1);
        request.onsuccess = () => { const tx = request.result.transaction('drafts', 'readwrite'); tx.objectStore('drafts').delete(String(remision)); tx.oncomplete = resolve; };
        request.onerror = resolve;
    });
}
function choosePhoto(rowIndex) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const remisionData = AppState.rechazosGlobal[rowIndex];
        if (!remisionData) {
            console.error("No se encontraron datos para el índice de fila:", rowIndex);
            showAlert("error", "Error Interno", "No se pudieron obtener los datos del reporte. Recarga la página.");
            return;
        }

        const remision = rowKey(remisionData) || `evidencia_${Date.now()}`;
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '');
        const filename = `uploads/evidencias/${remision}_${cleanFileName}`;
        const storageRef = storage.ref(filename);

        Swal.fire({
            title: 'Subiendo foto...',
            html: 'Por favor, espera.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        saveEvidenceDraft(remision, file).catch(() => {});
        const uploadTask = storageRef.put(file, { contentType: file.type, customMetadata: { remision: String(remision), uploadedBy: auth.currentUser?.email || '' } });

        uploadTask.on('state_changed',
            null,
            (error) => {
                console.error("Error al subir foto:", error);
                updateSyncStatus('pending');
                Swal.close();
                showAlert("error", "Error al subir", `No se pudo guardar la evidencia. Código: ${error.code}`);
            },
            () => {
                uploadTask.snapshot.ref.getDownloadURL().then(async downloadURL => {
                    const result = await persistRowChange(remisionData, { Fotos: downloadURL });
                    Swal.close();
                    if (!result.ok) {
                        showAlert('warning', 'No se pudo guardar la evidencia', result.reason === 'protegido' ? 'Este PDIS pertenece a otro auditor.' : 'El modo en vivo no está disponible.');
                        return;
                    }
                    updatePhotoPreview(rowIndex, downloadURL);
                    deleteEvidenceDraft(remision);
                    showAlert('success', '¡Evidencia Guardada!', 'La foto ya la ven todos los auditores.');
                });
            }
        );
    };

    fileInput.click();
}

function deletePhoto(rowIndex) { Swal.fire({ title: '¿Estás seguro?', text: "La foto de evidencia se eliminará permanentemente.", icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--rojo-peligro)', cancelButtonColor: 'var(--gris-oscuro)', confirmButtonText: 'Sí, ¡Eliminar!', cancelButtonText: 'Cancelar' }).then((result) => { if (result.isConfirmed) { const photoUrl = AppState.rechazosGlobal[rowIndex].Fotos; if (photoUrl && photoUrl.startsWith('https://firebasestorage.googleapis.com')) { const photoRef = storage.refFromURL(photoUrl); photoRef.delete().catch(err => console.error("Error al borrar de Storage:", err)); } persistRowChange(AppState.rechazosGlobal[rowIndex], { Fotos: "" }).then(result => { if (!result.ok) { showAlert('warning', 'No se pudo quitar la evidencia', 'Este PDIS pertenece a otro auditor.'); return; } updatePhotoPreview(rowIndex, ""); Swal.fire('¡Eliminada!', 'La foto ha sido eliminada.', 'success'); }); } }); }

function updatePhotoPreview(rowIndex, url) {
    const previewContainer = document.getElementById(`evidencia-preview-${rowIndex}`);
    if (!previewContainer) return;
    previewContainer.dataset.url = url || '';

    if (url && url.trim() !== "") {
        previewContainer.innerHTML = `
            <div class="evidence-thumbnail-container">
                <a href="${url}" target="_blank" title="Ver imagen completa">
                    <img src="${url}" alt="Evidencia" class="evidence-thumbnail">
                </a>
            </div>
            <div class="evidence-actions">
                <button class="btn btn-pill btn-pill-sm btn-photo" data-action="choose-photo" data-row-index="${rowIndex}"><i class="bi bi-camera-fill"></i> Cambiar</button>
                <button class="btn btn-pill btn-pill-sm btn-delete" data-action="delete-photo" data-row-index="${rowIndex}"><i class="bi bi-trash-fill"></i> Eliminar</button>
            </div>`;
    } else {
        previewContainer.innerHTML = `
            <div class="evidence-placeholder" data-action="choose-photo" data-row-index="${rowIndex}" style="cursor: pointer; text-align: center; padding: 20px; border: 2px dashed #dee2e6; border-radius: 8px;">
                <button class="btn btn-pill btn-pill-sm btn-primary">
                    <i class="bi bi-camera-fill me-2"></i>Agregar Evidencia
                </button>
            </div>`;
    }
}

// PDIS usa únicamente tres resultados operativos. Los estados antiguos se
// muestran con su equivalente actual.
const PDI_ESTADOS = ['Encontrada buen estado', 'Encontrada mal estado', 'No encontrada'];
function normalizePdiStatus(status) {
    const v = String(status || '').trim();
    if (v === 'Sí encontrada' || v === 'Encontrada en exhibición') return 'Encontrada buen estado';
    if (v === 'Encontrada Merma') return 'Encontrada mal estado';
    return PDI_ESTADOS.includes(v) ? v : '';
}


/*****************************************************
 * ========== LÓGICA DE VISUALIZACIÓN DE DATOS ==========
 *****************************************************/
// Los usuarios con acceso al Gestor (pocos) ven todos los PDIS y filtran desde la lista.
async function loadRechazosFileBasedOnRole() { loadRechazosFile([]); }
async function loadRechazosFile(secciones) {
    try {
        const archivoRechazosRef = AppState.selectedFileData?.ref;
        if (!archivoRechazosRef) throw new Error("No se ha seleccionado un archivo de rechazos.");

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Obtenemos los metadatos PRIMERO para saber la versión del archivo
        const metadata = await archivoRechazosRef.getMetadata();
        AppState.fileVersion = (metadata.customMetadata && metadata.customMetadata.version) || "1";
        console.log(`Versión del archivo establecida en: ${AppState.fileVersion}`);
        // --- FIN DE LA CORRECCIÓN CLAVE ---
        
        const url = await archivoRechazosRef.getDownloadURL();
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        AppState.sheetName = getPdisSheetName(workbook);
        const sheet = workbook.Sheets[AppState.sheetName];

        if (!sheet) return showAlert("error", "Error de Formato", "No se encontró la hoja de datos en el Excel.");

        AppState.sheetHeader = (XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' })[0] || []).map(String).filter(Boolean);
        AppState.allRechazosEnExcel = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const updatesMap = new Map(Object.entries(AppState.pendingChanges));
        if (updatesMap.size > 0) {
            console.log("Aplicando cambios pendientes a los datos cargados...");
            AppState.allRechazosEnExcel.forEach(row => {
                const remision = rowKey(row);
                if (remision && updatesMap.has(remision)) {
                    const updates = updatesMap.get(remision);
                    Object.assign(row, updates);
                }
            });
        }

        let rechazosFiltrados = AppState.allRechazosEnExcel;

        if (!AppState.isAdmin && secciones.length > 0) {
            const seccionesNorm = secciones.map(normSeccion);
            rechazosFiltrados = rechazosFiltrados.filter(row => { const s = normSeccion(pdisView(row).seccion); return s && seccionesNorm.includes(s); });
        }

        // Los filtros de la lista (jefatura, sección, estado y búsqueda) trabajan
        // únicamente dentro del conjunto de PDIS que el usuario tiene permitido ver.
        const oldBoss = document.getElementById("bossFilterContainer");
        if (oldBoss) oldBoss.innerHTML = "";
        await startLiveStates();
        renderListFilters(rechazosFiltrados);

    } catch (error) {
        console.error("Error al cargar rechazos.xlsx:", error);
        showAlert("error", "Error de Carga", "No se pudo procesar el archivo 'rechazos.xlsx'.");
    }
}
/*****************************************************
 * ========== FILTROS DE LA LISTA ==========
 *****************************************************/
const ListFilters = { base: [], jefe: '', seccion: '', estado: '', q: '' };
const ESTADO_FILTROS = [['pdi-st-pend', 'Sin estado'], ['pdi-st-buen', 'Encontrada buen estado'], ['pdi-st-mal', 'Encontrada mal estado'], ['pdi-st-no', 'No encontrada']];
function escAttr(t) { return String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function renderListFilters(baseRows) {
    ListFilters.base = baseRows;
    const box = document.getElementById('listFiltersContainer');
    if (!box) { renderRechazos(baseRows); return; }
    box.innerHTML = `
        <div class="pdi-filters">
            <div class="pdi-filter pdi-filter-search">
                <label for="flt-q"><i class="bi bi-search"></i> Buscar</label>
                <input id="flt-q" type="search" class="form-control" placeholder="SKU o descripción" autocomplete="off">
            </div>
            <div class="pdi-filter">
                <label for="flt-jefe"><i class="bi bi-person-workspace"></i> Jefatura</label>
                <select id="flt-jefe" class="form-select"></select>
            </div>
            <div class="pdi-filter">
                <label for="flt-seccion"><i class="bi bi-tag-fill"></i> Sección</label>
                <select id="flt-seccion" class="form-select"></select>
            </div>
            <div class="pdi-filter">
                <label for="flt-estado"><i class="bi bi-check-circle-fill"></i> Estado</label>
                <select id="flt-estado" class="form-select"></select>
            </div>
        </div>
        <div class="pdi-filters-foot">
            <span class="pdi-filters-meta"><span id="liveIndicator" class="pdi-live is-wait"><span class="pdi-live-dot"></span>Conectando…</span><span id="flt-count" class="pdi-filter-count"></span></span>
            <button type="button" id="flt-clear" class="pdi-filter-clear"><i class="bi bi-x-circle"></i> Limpiar filtros</button>
        </div>`;
    const q = document.getElementById('flt-q');
    q.value = ListFilters.q;
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ListFilters.q = q.value; applyListFilters(); }, 250); });
    document.getElementById('flt-jefe').addEventListener('change', e => { ListFilters.jefe = e.target.value; ListFilters.seccion = ''; applyListFilters(); });
    document.getElementById('flt-seccion').addEventListener('change', e => { ListFilters.seccion = e.target.value; applyListFilters(); });
    document.getElementById('flt-estado').addEventListener('change', e => { ListFilters.estado = e.target.value; applyListFilters(); });
    document.getElementById('flt-clear').addEventListener('click', () => { Object.assign(ListFilters, { jefe: '', seccion: '', estado: '', q: '' }); q.value = ''; applyListFilters(); });
    applyListFilters();
    setLiveIndicator(AppState.liveOk ? 'on' : (AppState.liveUnsub ? 'wait' : 'off'));
}
function fillFilterSelect(id, items, allLabel, current) {
    const el = document.getElementById(id);
    if (!el) return '';
    el.innerHTML = `<option value="">${allLabel}</option>` + items.map(([value, label, n]) => `<option value="${escAttr(value)}">${escAttr(label)} (${n.toLocaleString('es-MX')})</option>`).join('');
    el.value = items.some(([value]) => value === current) ? current : '';
    el.classList.toggle('is-active', !!el.value);
    return el.value;
}
function applyListFilters() {
    const base = ListFilters.base;
    const views = base.map(row => ({ row, v: pdisView(row), st: pdiStatusClass(row.Status) }));
    const q = normKey(ListFilters.q);
    const byJefe = x => !ListFilters.jefe || x.v.jefe === ListFilters.jefe;
    const bySec = x => !ListFilters.seccion || x.v.seccion === ListFilters.seccion;
    const byEst = x => !ListFilters.estado || x.st === ListFilters.estado;
    const byQ = x => !q || normKey(`${x.v.sku} ${x.v.desc}`).includes(q);
    const count = (list, keyFn) => { const m = new Map(); list.forEach(x => { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }); return m; };

    // Cada lista de opciones se calcula con los demás filtros aplicados.
    const jefes = count(views.filter(x => bySec(x) && byEst(x) && byQ(x)), x => x.v.jefe);
    ListFilters.jefe = fillFilterSelect('flt-jefe', [...jefes].filter(([k]) => k).sort((x, y) => x[0].localeCompare(y[0], 'es')).map(([k, n]) => [k, k, n]), 'Todas las jefaturas', ListFilters.jefe);
    const secs = count(views.filter(x => byJefe(x) && byEst(x) && byQ(x)), x => x.v.seccion);
    ListFilters.seccion = fillFilterSelect('flt-seccion', [...secs].sort((x, y) => String(x[0]).localeCompare(String(y[0]), 'es', { numeric: true })).map(([k, n]) => [k, k || 'Sin sección', n]), 'Todas las secciones', ListFilters.seccion);
    const ests = count(views.filter(x => byJefe(x) && bySec(x) && byQ(x)), x => x.st);
    ListFilters.estado = fillFilterSelect('flt-estado', ESTADO_FILTROS.filter(([k]) => ests.has(k)).map(([k, label]) => [k, label, ests.get(k)]), 'Todos los estados', ListFilters.estado);

    const result = views.filter(x => byJefe(x) && bySec(x) && byEst(x) && byQ(x)).map(x => x.row);
    const countEl = document.getElementById('flt-count');
    if (countEl) countEl.innerHTML = `Mostrando <strong>${result.length.toLocaleString('es-MX')}</strong> de ${base.length.toLocaleString('es-MX')} artículos`;
    const clearBtn = document.getElementById('flt-clear');
    if (clearBtn) clearBtn.hidden = !(ListFilters.jefe || ListFilters.seccion || ListFilters.estado || ListFilters.q);
    renderRechazos(result);
}
const LIST_PAGE_SIZE = 40;
let listObserver = null;
function renderRechazos(rechazosData) {
    const container = document.getElementById("rechazosContainer");
    rechazosData.forEach((item, index) => { item._rowIndex = index; item.Comentarios = item.Comentarios || ""; item.Fotos = item.Fotos || ""; });
    AppState.rechazosGlobal = rechazosData;
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    if (!rechazosData.length) {
        container.innerHTML = `<div class="alert alert-info text-center"><i class="bi bi-info-circle-fill"></i> No hay reportes que coincidan con tu filtro actual.</div>`;
        return;
    }
    // Solo se dibujan bloques de LIST_PAGE_SIZE encabezados; el resto se agrega
    // al acercarse al final o con "Mostrar más". El detalle se arma al abrirlo.
    container.innerHTML = `<div class="accordion" id="rechazosAccordion"></div><div class="pdi-list-more" id="listMore"></div>`;
    const accordion = document.getElementById('rechazosAccordion');
    const more = document.getElementById('listMore');
    let shown = 0;
    const renderMore = () => {
        const next = rechazosData.slice(shown, shown + LIST_PAGE_SIZE);
        if (!next.length) return;
        accordion.insertAdjacentHTML('beforeend', next.map(row => renderRechazoItem(row, row._rowIndex)).join(''));
        shown += next.length;
        const left = rechazosData.length - shown;
        more.innerHTML = left > 0 ? `<button type="button" class="pdi-more-btn"><i class="bi bi-chevron-down"></i> Mostrar más (${left.toLocaleString('es-MX')} restantes)</button>` : '';
    };
    more.addEventListener('click', e => { if (e.target.closest('.pdi-more-btn')) renderMore(); });
    if ('IntersectionObserver' in window) {
        listObserver = new IntersectionObserver(entries => { if (entries.some(en => en.isIntersecting)) renderMore(); }, { rootMargin: '400px 0px' });
        listObserver.observe(more);
    }
    accordion.addEventListener('show.bs.collapse', e => {
        const index = Number(String(e.target.id).replace('collapse-', ''));
        const body = document.getElementById(`body-${index}`);
        const row = rechazosData[index];
        if (!body || !row || body.dataset.ready) return;
        body.dataset.ready = '1';
        body.innerHTML = renderRechazoItem(row, index, 'body');
        updatePhotoPreview(index, row.Fotos);
        const v = pdisView(row);
        loadDynamicImage(v.sku, v.seccion, `imgContainer-${index}`);
    });
    renderMore();
}

// ===== SECCIÓN MODIFICADA (INICIO) =====
// Se ajusta la función para renderizar el ícono de comentario correcto desde el inicio.
// ===== INICIO DE LA FUNCIÓN ACTUALIZADA =====
// Clase visual de la etiqueta de estado (acepta nombres actuales y anteriores)
function pdiStatusClass(status) { const c = String(status || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); if (!c || c === "sin estado") return "pdi-st-pend"; if (c.includes("mal estado") || c.includes("merma")) return "pdi-st-mal"; if (c.includes("no encontr")) return "pdi-st-no"; if (c.includes("buen estado") || c.includes("si encontrada") || c.includes("exhibicion")) return "pdi-st-buen"; return "pdi-st-pend"; }
const escHTML = t => String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const formatMoneyMX = n => { const x = Number(String(n ?? '').replace(/[$,\s]/g, '')); return n === '' || n == null || isNaN(x) ? 'N/A' : x.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); };
function initialsOf(name) { return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'; }
function ageTone(days) { const d = Number(days); if (!isFinite(d) || days === '') return 'neutral'; return d <= 60 ? 'good' : d <= 120 ? 'warn' : 'bad'; }
function cleanAgeLabel(v) { const t = String(v || '').replace(/^[A-Z]\)\s*/i, '').trim().toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }

// Encabezado del artículo (lo único que se dibuja en la lista).
function renderRechazoItem(rechazo, i, mode = 'header') {
    if (mode === 'body') return renderRechazoBody(rechazo, i);
    const { _rowIndex } = rechazo;
    const v = pdisView(rechazo);
    const estadoActual = rechazo.Status || "Sin Estado";
    const descripcion = v.desc || "N/A";
    let subtitulo = v.jefe || "N/A";
    if (v.isLegacy) {
        const user = v.usuario ? AppState.usuariosData.find(u => u.Usuarios && u.Usuarios.toString().trim().toLowerCase() === v.usuario.toLowerCase()) : null;
        subtitulo = user?.Nombre || v.usuario || "N/A";
    }
    const etiqueta = v.isLegacy ? v.key : (v.sku || v.key);
    return `
    <div class="accordion-item report-card shadow-sm mb-3 rounded-4 border-0" id="item-${_rowIndex}">
        <h2 class="accordion-header" id="heading-${_rowIndex}">
            <button class="accordion-button collapsed px-2 py-2 d-flex flex-row align-items-center gap-2" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${_rowIndex}">
                <span class="badge rounded-pill me-2 pdi-status ${pdiStatusClass(estadoActual)}">${escHTML(estadoActual)}</span>
                <div class="report-summary flex-grow-1 d-flex flex-column flex-md-row align-items-md-center gap-2">
                    <span class="sku-title fw-semibold" title="${escHTML(descripcion)}">${escHTML(descripcion)}</span>
                    <span class="user-info text-muted small"><i class="bi bi-person"></i> ${escHTML(subtitulo)}</span>
                </div>
                <span class="ms-2 badge bg-dark rounded-pill">${escHTML(etiqueta)}</span>
            </button>
        </h2>
        <div id="collapse-${_rowIndex}" class="accordion-collapse collapse" data-bs-parent="#rechazosAccordion">
            <div class="accordion-body pdi-detail" id="body-${_rowIndex}"></div>
        </div>
    </div>`;
}

// Detalle del artículo: se arma solo cuando se abre.
function renderRechazoBody(rechazo, i) {
    const { _rowIndex } = rechazo;
    const v = pdisView(rechazo);
    const sku = v.sku;
    const descripcion = v.desc || "N/A";
    const piezas = v.piezas === "" || v.piezas == null ? "N/A" : fixEncoding(v.piezas);
    const field = (...names) => { const val = fixEncoding(pickField(rechazo, ...names)); return val === '' ? 'N/A' : val; };

    const estadoActual = rechazo.Status || "Sin Estado";
    const estadoSelect = normalizePdiStatus(rechazo.Status);
    const opcionesHTML = (estadoSelect ? '' : '<option value="" selected disabled>Selecciona un estado…</option>') +
        PDI_ESTADOS.map(opt => `<option value="${opt}" ${estadoSelect === opt ? 'selected' : ''}>${opt}</option>`).join('');

    const liverpoolUrl = /^\d{10,}$/.test(sku) ? `https://www.liverpool.com.mx/tienda/pdp/producto/${sku}`
        : `https://www.liverpool.com.mx/tienda/busca?busqueda=${encodeURIComponent(sku || descripcion)}`;
    const googleUrlSku = `https://www.google.com/search?q=${encodeURIComponent(sku || descripcion)}`;
    const googleUrlDesc = `https://www.google.com/search?q=${encodeURIComponent(descripcion)}`;

    let kpis, tags, facts, persona;
    if (v.isLegacy) {
        kpis = [['bi-box-seam', 'Piezas', piezas, 'blue'], ['bi-calendar-event', 'Fecha', v.fecha || 'N/A', 'pink'], ['bi-tag-fill', 'Sección', v.seccion || 'N/A', 'violet']];
        tags = [];
        facts = [['bi-person-badge', 'Usuario de rechazo', v.usuario || 'N/A']];
        persona = ['Jefatura', v.jefe || 'N/A'];
    } else {
        const dias = pickField(rechazo, 'DÍAS ANTIGÜEDAD', 'DIAS ANTIGUEDAD');
        const tone = ageTone(dias);
        const antiguedad = cleanAgeLabel(pickField(rechazo, 'ANT_DIA_MES'));
        kpis = [
            ['bi-box-seam', 'Inventario', piezas, 'blue'],
            ['bi-cash-coin', 'Costo total', formatMoneyMX(pickField(rechazo, 'COSTO_TOTAL')), 'green'],
            ['bi-hourglass-split', 'Días antigüedad', dias === '' ? 'N/A' : dias, tone]
        ];
        tags = [['bi-tag-fill', `Sección ${v.seccion || 'N/A'}`, 'neutral']];
        if (antiguedad) tags.push(['bi-calendar-range', antiguedad, tone]);
        facts = [
            ['bi-calendar-check', 'Fecha de carga', v.fecha || 'N/A'],
            ['bi-clock-history', 'Último movimiento', field('ULT_MOV')],
            ['bi-info-circle', 'Estatus', field('ESTATUS')]
        ];
        persona = ['Jefe', v.jefe || 'N/A'];
    }

    return `<div class="pdi-detail-grid">
        <aside class="pdi-media">
            <div id="imgContainer-${i}" class="product-image-container pdi-product-image"></div>
            <div class="pdi-links">
                <a href="${liverpoolUrl}" target="_blank" rel="noopener" title="Ver producto en Liverpool"><i class="bi bi-bag-heart-fill"></i> Liverpool</a>
                <a href="${googleUrlSku}" target="_blank" rel="noopener" title="Buscar en Google por SKU"><i class="bi bi-google"></i> SKU</a>
                <a href="${googleUrlDesc}" target="_blank" rel="noopener" title="Buscar en Google por descripción"><i class="bi bi-search"></i> Nombre</a>
            </div>
        </aside>
        <section class="pdi-info">
            <header class="pdi-info-head">
                <span class="pdi-eyebrow"><i class="bi bi-upc-scan"></i> SKU ${escHTML(sku || 'N/A')}</span>
                <h5 class="pdi-desc">${escHTML(descripcion)}</h5>
                ${tags.length ? `<div class="pdi-tags">${tags.map(([icon, text, tone]) => `<span class="pdi-tag tone-${tone}"><i class="bi ${icon}"></i>${escHTML(text)}</span>`).join('')}</div>` : ''}
            </header>
            <div class="pdi-kpis">
                ${kpis.map(([icon, label, value, tone]) => `<div class="pdi-kpi tone-${tone}"><span class="pdi-kpi-icon"><i class="bi ${icon}"></i></span><div><small>${label}</small><strong>${escHTML(value)}</strong></div></div>`).join('')}
            </div>
            <div class="pdi-person">
                <span class="pdi-avatar">${escHTML(initialsOf(persona[1]))}</span>
                <div><small>${persona[0]}</small><strong>${escHTML(persona[1])}</strong></div>
            </div>
            <ul class="pdi-facts">
                ${facts.map(([icon, label, value]) => `<li><span class="pdi-fact-icon"><i class="bi ${icon}"></i></span><div><small>${label}</small><strong>${escHTML(value)}</strong></div></li>`).join('')}
            </ul>
            <div class="pdi-status-box">
                <label for="status-${_rowIndex}" class="form-label"><i class="bi bi-clipboard-check-fill"></i> Estado del PDIS</label>
                <div class="status-picker status-${estadoActual.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}">
                    <span class="status-picker-icon"><i class="bi bi-circle-fill"></i></span>
                    <select id="status-${_rowIndex}" class="form-select status-select rounded-3 shadow-sm" data-row-index="${_rowIndex}">
                    ${opcionesHTML}
                    </select>
                </div>
            </div>
            <div class="pdi-evidence">
                <h6><i class="bi bi-camera-fill"></i> Evidencia</h6>
                <div id="evidencia-preview-${_rowIndex}" class="evidence-preview-container w-100"></div>
            </div>
        </section>
    </div>`;
}

// Aplica a filas de un Excel los estados en vivo guardados en Firestore.
async function mergeLiveStatesInto(fileName, rows) {
    try {
        const snap = await pdisFileDoc(fileName).collection('items').get();
        if (snap.empty) return rows;
        const byKey = new Map();
        snap.forEach(doc => { const d = doc.data(); byKey.set(String(d.key ?? ''), d); });
        rows.forEach(row => { const d = byKey.get(rowKey(row)); if (!d) return; ['Status', 'Auditor', 'Fotos'].forEach(f => { if (f in d) row[f] = d[f] ?? ''; }); });
    } catch (error) { console.warn('No se pudieron leer los estados en vivo de', fileName, error); }
    return rows;
}

async function generarDashboardPorRango() {
    const fechaInicioStr = document.getElementById('fechaInicio').value; // e.g., "2025-08-01"
    const fechaFinStr = document.getElementById('fechaFin').value;     // e.g., "2025-08-03"

    if (!fechaInicioStr || !fechaFinStr) {
        return showAlert("warning", "Fechas incompletas", "Por favor, selecciona una fecha de inicio y una de fin.");
    }

    // --- CORRECCIÓN CLAVE: Creación de fechas en UTC para evitar problemas de zona horaria ---
    const inicioParts = fechaInicioStr.split('-').map(Number); // [2025, 8, 1]
    const finParts = fechaFinStr.split('-').map(Number);     // [2025, 8, 3]

    // Creamos la fecha de inicio a la medianoche del día seleccionado, en tiempo universal (UTC)
    // El mes en JS es 0-indexado, por eso restamos 1.
    const fechaInicio = new Date(Date.UTC(inicioParts[0], inicioParts[1] - 1, inicioParts[2]));

    // Creamos la fecha de fin para que apunte al inicio del DÍA SIGUIENTE.
    // Esto hace la comparación más segura y fácil (usaremos '<' en lugar de '<=')
    const fechaFin = new Date(Date.UTC(finParts[0], finParts[1] - 1, finParts[2]));
    fechaFin.setUTCDate(fechaFin.getUTCDate() + 1);
    // --- FIN DE LA CORRECCIÓN ---

    if (fechaInicio >= fechaFin) {
        return showAlert("error", "Rango inválido", "La fecha de inicio no puede ser posterior a la fecha de fin.");
    }
    
    // Llamamos a la función principal pasándole el rango de fechas corregido.
    generarDashboard({ fechaInicio, fechaFin });
}

async function generarDashboard(dateRange = null) {
    // Muestra un popup de carga mientras se procesan los datos.
    Swal.fire({
        title: 'Generando Reporte...',
        html: dateRange ? `Filtrando datos...` : 'Analizando historial completo...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        // Carga todos los archivos de "Rechazos" desde Firebase Storage.
        const storageRef = storage.ref("uploads");
        const fileList = await storageRef.listAll();
        const rechazosItems = fileList.items.filter(item => { const name = item.name.toLowerCase(); return name.includes('rechazos') || name.includes('pdis'); });

        if (rechazosItems.length === 0) {
            return Swal.fire("Sin Datos", "No se encontraron archivos de 'Rechazos' para analizar.", "info");
        }

        let todosLosRechazosHistoricos = [];
        await Promise.all(rechazosItems.map(async (fileRef) => {
            const url = await fileRef.getDownloadURL();
            const data = await (await fetch(url)).arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets[getPdisSheetName(workbook)];
            if (sheet) {
                // Acumula los datos de todos los archivos en un solo arreglo.
                todosLosRechazosHistoricos.push(...await mergeLiveStatesInto(fileRef.name, XLSX.utils.sheet_to_json(sheet, { defval: "" })));
            }
        }));

        let datosParaDashboard = todosLosRechazosHistoricos;

        // Si se proporcionó un rango de fechas, se filtra el arreglo de datos.
        if (dateRange) {
            // Función interna para interpretar fechas de Excel de forma segura (números o texto).
            const _parseDateForCompare = (excelDate) => {
                if (!excelDate) return null;

                // Caso 1: La fecha es un número (formato serial de Excel).
                if (typeof excelDate === 'number') {
                    // Convierte el número de serie de Excel a milisegundos UTC.
                    const utcMilliseconds = (excelDate - 25569) * 86400 * 1000;
                    return new Date(utcMilliseconds);
                }

                // Caso 2: La fecha es un string.
                if (typeof excelDate === 'string') {
                    const parsed = Date.parse(excelDate);
                    if (isNaN(parsed)) return null;
                    return new Date(parsed);
                }

                return null;
            };

            datosParaDashboard = todosLosRechazosHistoricos.filter(rechazo => {
                const fechaRechazo = _parseDateForCompare(pdisView(rechazo).fechaCargaRaw);
                if (!fechaRechazo) return false;
                
                // Compara si la fecha del rechazo está dentro del rango seleccionado.
                // Es inclusivo para el inicio y exclusivo para el fin (cubre el día completo).
                return fechaRechazo >= dateRange.fechaInicio && fechaRechazo < dateRange.fechaFin;
            });
        }

        // Si después de filtrar no quedan datos, muestra una alerta.
        if (datosParaDashboard.length === 0) {
             return Swal.fire("Sin Resultados", "No se encontraron registros en el rango de fechas seleccionado.", "info");
        }

        // Procesa los datos filtrados para agruparlos por jefatura y calcular el rendimiento.
        const statsHistoricas = agregarDatosPorJefatura(datosParaDashboard);
        if (statsHistoricas.length === 0) {
             return Swal.fire("Sin Datos", "No se encontraron jefaturas en los datos filtrados para generar el reporte.", "info");
        }

        const maxPiezasRechazadas = Math.max(...statsHistoricas.map(j => j.totalPiezas).filter(p => p > 0));

        const datosConRendimiento = statsHistoricas.map(jefeData => {
            const rendimiento = maxPiezasRechazadas > 0 ? 100 - (jefeData.totalPiezas / maxPiezasRechazadas) * 100 : 100;
            return {
                ...jefeData,
                rendimiento: parseFloat(rendimiento.toFixed(1))
            };
        }).sort((a, b) => b.rendimiento - a.rendimiento);

        // Llama a la función que dibuja la interfaz del dashboard con los datos finales.
        renderDashboardUI(datosConRendimiento, dateRange);

    } catch (error) {
        console.error("Error generando dashboard:", error);
        Swal.fire("Error", "No se pudo generar el dashboard. Revisa la consola para más detalles.", "error");
    }
}

function agregarDatosPorJefatura(rechazos) {
    const stats = {};
    const estadosPosibles = ["Encontrada buen estado", "Encontrada mal estado", "Sí encontrada", "No encontrada", "Encontrada en exhibición", "Encontrada Merma", "Sin Estado"];

    rechazos.forEach(rechazo => {
        const view = pdisView(rechazo);
        const jefatura = view.jefe || "Sin Asignar";
        const estado = rechazo.Status || "Sin Estado";
        const piezas = Number(view.piezas) || 0;

        if (!stats[jefatura]) {
            stats[jefatura] = { totalReportes: 0, totalPiezas: 0, statusCounts: {}, statusPieces: {} };
            estadosPosibles.forEach(s => {
                stats[jefatura].statusCounts[s] = 0;
                stats[jefatura].statusPieces[s] = 0;
            });
        }

        stats[jefatura].totalPiezas += piezas;
        stats[jefatura].totalReportes += 1;
        
        if (estadosPosibles.includes(estado)) {
            stats[jefatura].statusCounts[estado] += 1;
            stats[jefatura].statusPieces[estado] += piezas;
        }
    });

    return Object.entries(stats).map(([jefe, data]) => ({
        jefe, ...data
    }));
}
// Función para generar iniciales a partir de un nombre
function generarIniciales(nombre) {
    if (!nombre || typeof nombre !== 'string') return '?';
    return nombre.split(' ').map(palabra => palabra[0]).slice(0, 2).join('').toUpperCase();
}

// Función para obtener un color en una escala de verde a rojo
function obtenerColorParaValor(valor, maxValor) {
    if (maxValor === 0) return '#f8f9fa'; // Color neutral si no hay piezas
    const porcentaje = Math.min(valor / maxValor, 1);
    // Interpola de verde (120) a rojo (0) en el espectro HSL
    const hue = (1 - porcentaje) * 120;
    return `hsl(${hue}, 80%, 90%)`; // Tono pastel para el fondo
}
async function generarDashboardAuditores() {
    Swal.fire({
        title: 'Generando Dashboard de Auditores...',
        html: 'Analizando el rendimiento de los auditores.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        // Carga todos los datos históricos
        const storageRef = storage.ref("uploads");
        const fileList = await storageRef.listAll();
        const rechazosItems = fileList.items.filter(item => { const name = item.name.toLowerCase(); return name.includes('rechazos') || name.includes('pdis'); });

        if (rechazosItems.length === 0) {
            return Swal.fire("Sin Datos", "No se encontraron archivos de 'Rechazos' para analizar.", "info");
        }
        
        let todosLosRechazosHistoricos = [];
        await Promise.all(rechazosItems.map(async (fileRef) => {
            const url = await fileRef.getDownloadURL();
            const data = await (await fetch(url)).arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets[getPdisSheetName(workbook)];
            if (sheet) {
                todosLosRechazosHistoricos.push(...await mergeLiveStatesInto(fileRef.name, XLSX.utils.sheet_to_json(sheet, { defval: "" })));
            }
        }));

        // Procesa los datos para contar las auditorías por usuario
        const statsAuditores = {};
        todosLosRechazosHistoricos.forEach(rechazo => {
            const auditor = rechazo.Auditor;
            if (auditor) {
                if (!statsAuditores[auditor]) {
                    statsAuditores[auditor] = { totalAuditado: 0 };
                }
                statsAuditores[auditor].totalAuditado += 1;
            }
        });

        const datosParaDashboard = Object.entries(statsAuditores).map(([auditor, data]) => ({
            auditor,
            ...data
        })).sort((a, b) => b.totalAuditado - a.totalAuditado);

        if (datosParaDashboard.length === 0) {
            return Swal.fire("Sin Datos", "No se encontraron registros con auditor asignado.", "info");
        }

        // Llama a la función que crea la interfaz del dashboard
        renderAuditorDashboardUI(datosParaDashboard);

    } catch (error) {
        console.error("Error generando dashboard de auditores:", error);
        Swal.fire("Error", "No se pudo generar el dashboard. Revisa la consola.", "error");
    }
}

/**
 * Dibuja la interfaz (la ventana emergente) para el dashboard de auditores.
 */
function renderAuditorDashboardUI(data) {
    const modalHTML = `
        <style>
            .auditor-card {
                display: flex;
                align-items: center;
                padding: 1rem;
                margin-bottom: 0.75rem;
                border-radius: 12px;
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
            }
            .auditor-rank {
                font-size: 1.5rem;
                font-weight: 700;
                color: #adb5bd;
                width: 50px;
            }
            .auditor-name {
                flex-grow: 1;
                font-size: 1.1rem;
                font-weight: 600;
            }
            .auditor-total {
                font-size: 1.75rem;
                font-weight: 700;
                color: #E6007E; /* Rosa Liverpool */
            }
        </style>
        <div>
            ${data.map((item, index) => `
                <div class="auditor-card">
                    <div class="auditor-rank">#${index + 1}</div>
                    <div class="auditor-name">${item.auditor}</div>
                    <div class="auditor-total">${item.totalAuditado.toLocaleString()}</div>
                </div>
            `).join('')}
        </div>
    `;

    Swal.fire({
        title: '🏆 <strong>Rendimiento de Auditores</strong>',
        html: modalHTML,
        width: '800px',
        showCloseButton: true,
        showConfirmButton: false,
    });
}
function renderDashboardUI(dataConRendimiento, dateRange) {
    let title = '🏆 <strong>Dashboard de Productividad</strong> (Historial Completo)';
    if (dateRange) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        title = `📊 <strong>Dashboard de Productividad</strong> <br><span class="fw-normal fs-6 text-muted">${dateRange.fechaInicio.toLocaleDateString('es-MX', options)} - ${dateRange.fechaFin.toLocaleDateString('es-MX', options)}</span>`;
    }

    const modalHTML = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
            .swal2-container { font-family: 'Poppins', sans-serif; }
            :root { --rosa-liverpool: #E6007E; --azul-profundo: #0b1f48; --gris-claro: #f4f7fa; --gris-borde: #e9ecef; }
            .dashboard-main-container { background-color: var(--gris-claro); padding: 1rem; border-radius: 1rem; }
            .nav-pills .nav-link { font-weight: 600; color: #5a6a7d; border-radius: 8px; padding: 0.5rem 1rem; transition: all 0.3s ease; }
            .nav-pills .nav-link.active { color: #fff; background-color: var(--rosa-liverpool); box-shadow: 0 4px 12px rgba(230, 0, 126, 0.4); }
            .dashboard-card { background-color: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 25px rgba(0,0,0,0.05); height: 100%; }
            
            /* -- Estilos Rendimiento -- */
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .rendimiento-card {
                background-color: #ffffff;
                background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f0f2f5' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            }
            .podium-container { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: flex-end; gap: 1rem; text-align: center; }
            .podium-item { background: linear-gradient(145deg, #f9f9f9, #e7e7e7); padding: 1.5rem 1rem; border-radius: 16px; border: 1px solid var(--gris-borde); box-shadow: 0 8px 16px rgba(0,0,0,0.1); transition: transform 0.3s ease; animation: slideUp 0.5s ease-out forwards; }
            .podium-item:hover { transform: translateY(-10px) scale(1.05) !important; }
            .podium-item.rank-1 { order: 2; transform: scale(1.15); z-index: 1; border-color: #ffd700; background: linear-gradient(145deg, #fff9e6, #ffd700); animation-delay: 0.2s; }
            .podium-item.rank-2 { order: 1; animation-delay: 0.1s; }
            .podium-item.rank-3 { order: 3; animation-delay: 0s; }
            .podium-rank { font-size: 2.5rem; font-weight: 700; }
            .podium-rank.rank-1 { color: #e6a200; } .podium-rank.rank-2 { color: #a0a0a0; } .podium-rank.rank-3 { color: #c57b3f; }
            .leaderboard-list { list-style: none; padding: 0; margin-top: 2rem; }
            .leaderboard-item { display: flex; align-items: center; padding: 0.75rem; border-radius: 8px; transition: background-color 0.2s; }
            .leaderboard-item:hover { background-color: var(--gris-claro); }

            /* -- Estilos Análisis de Estados -- */
            .analysis-chart-container { height: 600px; }
        </style>
        <div class="dashboard-main-container">
            <ul class="nav nav-pills justify-content-center mb-4" id="dashboardTab" role="tablist">
                <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#rendimiento">Rendimiento</button></li>
                <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#desglose">Análisis por Jefatura</button></li>
                <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabla">Tabla de Datos</button></li>
            </ul>
            <div class="tab-content" id="dashboardTabContent">
                <div class="tab-pane fade show active dashboard-card rendimiento-card" id="rendimiento">
                    <div id="podium-section" class="mb-4"></div>
                    <div id="leaderboard-section"></div>
                </div>
                <div class="tab-pane fade" id="desglose">
                    <div class="dashboard-card">
                       <div class="analysis-chart-container" id="analysis-chart-wrapper"></div>
                    </div>
                </div>
                <div class="tab-pane fade" id="tabla"></div>
            </div>
        </div>
    `;

    Swal.fire({
        title: title,
        html: modalHTML,
        width: '95%',
        maxWidth: '1200px',
        showCloseButton: true,
        showConfirmButton: false,
        didOpen: () => {
            // --- Pestaña 1: Rendimiento (Con mejoras visuales) ---
            // La lógica JS no cambia, las mejoras son principalmente en CSS.
            const top3 = dataConRendimiento.slice(0, 3);
            const a_partir_del_4 = dataConRendimiento.slice(3);
            document.getElementById('podium-section').innerHTML = `<div class="podium-container">${top3.map((item, index) => `<div class="podium-item rank-${index + 1}"><div class="podium-rank rank-${index + 1}"><i class="bi bi-trophy-fill"></i></div><div class="h5">${item.jefe}</div><div class="display-6 fw-bold">${item.rendimiento}%</div><small class="text-muted">${item.totalPiezas.toLocaleString()} pzas.</small></div>`).join('')}</div>`;
            document.getElementById('leaderboard-section').innerHTML = `<ul class="leaderboard-list">${a_partir_del_4.map((item, index) => `<li class="leaderboard-item"><strong class="me-3">${index + 4}.</strong><div class="flex-grow-1 h6 mb-0">${item.jefe}</div><strong class="fs-5">${item.rendimiento}%</strong></li>`).join('')}</ul>`;

            // --- Pestaña 2: Análisis de Estados (Lógica completamente nueva) ---
            const analysisWrapper = document.getElementById('analysis-chart-wrapper');
            analysisWrapper.innerHTML = '<canvas id="stackedBarChart"></canvas>';

            const labels = dataConRendimiento.map(d => d.jefe);
            const statusColors = {
                'Encontrada buen estado': 'rgba(14, 159, 110, 0.85)',
                'Encontrada mal estado': 'rgba(217, 119, 6, 0.85)',
                'Sí encontrada': 'rgba(40, 167, 69, 0.8)',
                'No encontrada': 'rgba(220, 53, 69, 0.8)',
                'Encontrada en exhibición': 'rgba(13, 110, 253, 0.8)',
                'Encontrada Merma': 'rgba(255, 193, 7, 0.8)',
                'Sin Estado': 'rgba(108, 117, 125, 0.8)'
            };

            const datasets = Object.keys(statusColors).map(status => {
                return {
                    label: status,
                    data: dataConRendimiento.map(jefe => jefe.statusPieces[status] || 0),
                    backgroundColor: statusColors[status],
                };
            });

            new Chart(document.getElementById('stackedBarChart').getContext('2d'), {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: { display: true, text: 'Desglose de Piezas Rechazadas por Jefatura', font: { size: 18, weight: 'bold' } },
                        legend: { position: 'top' },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: { stacked: true, title: { display: true, text: 'Cantidad de Piezas' } },
                        y: { stacked: true }
                    }
                }
            });

            // --- Pestaña 3: Tabla de Datos (La lógica no cambia) ---
            const tablaContainer = document.getElementById('tabla');
            const maxPiezas = Math.max(...dataConRendimiento.map(item => item.totalPiezas));
            tablaContainer.innerHTML = `<div class="dashboard-card"><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr><th>Jefatura</th><th class="text-center">Buen estado</th><th class="text-center">Mal estado</th><th class="text-center">No encontrada</th><th class="text-center">Sin estado</th><th class="text-center">Total Piezas</th></tr></thead><tbody>${dataConRendimiento.map(item => `<tr><td class="fw-bold">${item.jefe}</td><td class="text-center">${(item.statusCounts['Encontrada buen estado'] + item.statusCounts['Sí encontrada'] + item.statusCounts['Encontrada en exhibición']).toLocaleString()}</td><td class="text-center">${(item.statusCounts['Encontrada mal estado'] + item.statusCounts['Encontrada Merma']).toLocaleString()}</td><td class="text-center">${item.statusCounts['No encontrada'].toLocaleString()}</td><td class="text-center">${item.statusCounts['Sin Estado'].toLocaleString()}</td><td class="text-center fw-bolder" style="background-color: ${obtenerColorParaValor(item.totalPiezas, maxPiezas)};">${item.totalPiezas.toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div>`;
        }
    });
}
