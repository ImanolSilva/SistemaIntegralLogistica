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
        const storage = firebase.app().storage("gs://sistemaintegrall.firebasestorage.app");

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
    isSyncing: false
};
let adminBossFilter = "";
const ADMIN_UIDS = ["8NfEfPSyusZdNUFgXWPtvi3p6Ns1", "wz4A81Vp8tQIjzVXMANmOHUlsNH2", "AdRGcxSGPEejg2goMYWftQG5rlj1", "awNwmt9acXa7rLCsfx14cBMsT6y1", "MlRuwWe8WhMzfnW3Mko94VEMacc2", "TCiYd7MxGGeVpelbA8goOcNSifo1"];
const autoSaveTimers = {};

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
    localStorage.setItem('pendingChanges', JSON.stringify(AppState.pendingChanges));
    updateSyncStatus('pending');
}

function loadPendingChanges() {
    const savedChanges = localStorage.getItem('pendingChanges');
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

        if (serverVersion !== AppState.fileVersion) {
           throw new Error("Conflicto de versiones. Por favor, recarga la página para obtener los cambios más recientes.");
        }

        const url = await fileRef.getDownloadURL();
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets["Rechazos"];
        if (!sheet) throw new Error("La hoja 'Rechazos' no fue encontrada en el archivo.");
        
        let excelData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        
        let hasChanges = false;
        const updatesMap = new Map(Object.entries(AppState.pendingChanges));
        excelData.forEach(row => {
            const remision = row.Remisión?.toString();
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
             localStorage.removeItem('pendingChanges');
             if (isAutoSave) updateSyncStatus('synced'); else Swal.close();
             AppState.isSyncing = false;
             return;
        }

        const newSheet = XLSX.utils.json_to_sheet(excelData);
        workbook.Sheets["Rechazos"] = newSheet;
        const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const newBlob = new Blob([wbout], { type: "application/octet-stream" });
        const newVersion = (parseInt(serverVersion) + 1).toString();
        
        // --- INICIO DEL CAMBIO CLAVE ---
        // 2. Preparamos los NUEVOS metadatos, asegurándonos de preservar la fecha original.
        const newMetadata = {
            customMetadata: {
                'version': newVersion,
                'originalUploadDate': originalUploadDate 
            }
        };
        // --- FIN DEL CAMBIO CLAVE ---

        await fileRef.put(newBlob, newMetadata); // Guardamos el archivo con los metadatos actualizados
        
        AppState.fileVersion = newVersion;
        AppState.allRechazosEnExcel = excelData;
        AppState.pendingChanges = {};
        localStorage.removeItem('pendingChanges');
        
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
 * ========== FUNCIONES AUXILIARES Y DE LÓGICA ==========
 *****************************************************/
const NOT_FOUND_GIFS = [
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdHRjZjM3aWR1eGFyNTBhY3ptcDdhZTJwMTAzamptMjNyZGhudzExNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/IpKxfPy33hMRy/giphy.gif',
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdHRjZjM3aWR1eGFyNTBhY3ptcDdhZTJwMTAzamptMjNyZGhudzExNCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ViZylgfPSfJFm/giphy.gif',
    'https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3Z3hkajZkemQ5ZTJoa2g1YXp6bWYycWlpbzFoMjdhanh5MDA0cjkyNSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/dSeTdOmmA1u8e0LBsx/giphy.gif'
];

function getRandomNotFoundGif() {
    const randomIndex = Math.floor(Math.random() * NOT_FOUND_GIFS.length);
    return NOT_FOUND_GIFS[randomIndex];
}

function showAlert(icon, title, text = '', config = {}) { const defaultConfig = { toast: true, position: "top-end", showConfirmButton: false, timer: 3000, timerProgressBar: true, didOpen: (toast) => { toast.addEventListener('mouseenter', Swal.stopTimer); toast.addEventListener('mouseleave', Swal.resumeTimer); } }; return Swal.fire({ icon, title, text, ...defaultConfig, ...config }); }
function setUIForRole(isAdmin) { document.getElementById("dropzone").classList.toggle("hidden", !isAdmin); }
function fixEncoding(str) { if (!str) return ""; try { return decodeURIComponent(escape(str)); } catch { return str; } }
function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }
function parseExcelDate(value) { if (!value) return ""; if (typeof value === "number") { const dateObj = new Date(Math.round((value - 25569) * 86400 * 1000)); return dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); } const parsed = Date.parse(value); if (!isNaN(parsed)) { const dateObj = new Date(parsed); return dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); } return value; }
function showSection(sectionId) { const section = document.getElementById(sectionId); if (section) { section.classList.remove('hidden'); setTimeout(() => section.classList.add('visible'), 50); } }

function loadDynamicImage(sku, seccion, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `<div class="d-flex align-items-center justify-content-center" style="height: 150px;"><div class="spinner-border text-secondary" role="status"></div></div>`;

    const imageUrl = `https://ss${seccion}.liverpool.com.mx/lg/${sku}.jpg`;

    const fallbackImageHTML = `<img src="${getRandomNotFoundGif()}" alt="Imagen de producto no encontrada" class="img-fluid rounded" style="max-height: 150px; width: 100%; object-fit: cover;">`;

    const img = new Image();
    img.src = imageUrl;
    img.className = "img-fluid rounded";
    img.style.maxHeight = "200px";

    img.onload = () => {
        container.innerHTML = '';
        container.appendChild(img);
    };

    img.onerror = () => {
        container.innerHTML = fallbackImageHTML;
    };
}

async function loadStaticExcelFiles() { try { const [userResponse, relResponse] = await Promise.all([fetch("../ArchivosExcel/Usuarios.xlsx"), fetch("../ArchivosExcel/relaciones.xlsx")]); if (!userResponse.ok) console.error("No se encontró Usuarios.xlsx"); const userBlob = await userResponse.blob(); const userData = await userBlob.arrayBuffer(); const userWorkbook = XLSX.read(userData, { type: "array" }); const userSheet = userWorkbook.Sheets["Usuarios"]; if (userSheet) AppState.usuariosData = XLSX.utils.sheet_to_json(userSheet, { defval: "" }); if (!relResponse.ok) console.error("No se encontró relaciones.xlsx"); const relBlob = await relResponse.blob(); const relData = await relBlob.arrayBuffer(); const relWorkbook = XLSX.read(relData, { type: "array" }); const relSheet = relWorkbook.Sheets["Usuarios"]; if (relSheet) AppState.relacionesData = XLSX.utils.sheet_to_json(relSheet); } catch (error) { console.error("Error al cargar archivos estáticos:", error); showAlert("error", "Error Crítico", "No se pudieron cargar los archivos de configuración."); } }

/*****************************************************
 * ========== INICIO DE APP Y MANEJO DE EVENTOS ==========
 *****************************************************/
document.addEventListener("DOMContentLoaded", () => {
    const preloader = document.querySelector('.preloader');
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            document.getElementById("correoUsuario").innerHTML = `<i class="bi bi-person-circle me-2"></i>${user.email}`;
            AppState.isAdmin = ADMIN_UIDS.includes(user.uid);
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
    
    // Listener para el guardado automático de cambios (Estado y Auditor)
    document.addEventListener("change", (e) => {
        if (e.target.classList.contains("status-select")) {
            const rowIndex = e.target.dataset.rowIndex;
            const newStatus = e.target.value;

            if (AppState.rechazosGlobal[rowIndex]) {
                const remision = AppState.rechazosGlobal[rowIndex].Remisión;
                const user = auth.currentUser;
                if (!user) {
                    showAlert("error", "Error de Sesión", "No se pudo identificar al usuario. Por favor, recarga la página.");
                    return;
                }
                const auditorName = user.displayName || user.email;

                AppState.rechazosGlobal[rowIndex].Status = newStatus;
                AppState.rechazosGlobal[rowIndex].Auditor = auditorName;

                queueChange(remision, 'Status', newStatus);
                queueChange(remision, 'Auditor', auditorName);
                
                const headerBadge = document.querySelector(`#heading-${rowIndex} .badge`);
                if(headerBadge) {
                    const statusColors = { "Sí encontrada": "var(--verde-exito)", "No encontrada": "var(--rojo-peligro)", "Encontrada en exhibición": "var(--azul-info)", "Encontrada Merma": "#ff9800", "Sin Estado": "var(--gris-oscuro)" };
                    headerBadge.style.backgroundColor = statusColors[newStatus] || 'var(--gris-oscuro)';
                    headerBadge.textContent = newStatus;
                }

                if (autoSaveTimers[rowIndex]) clearTimeout(autoSaveTimers[rowIndex]);
                autoSaveTimers[rowIndex] = setTimeout(() => syncPendingChanges(true), 2000);
            }
        }
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
        const rechazosItems = fileList.items.filter(item => 
            item.name.toLowerCase().includes('rechazos')
        );

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
                    version: (metadata.customMetadata && metadata.customMetadata.version) || "1"
                };
            })
        );

        filesWithMetadata.sort((a, b) => b.timeCreated - a.timeCreated);
        
        renderFileSelectOptions(filesWithMetadata);

        if (AppState.isAdmin) {
            renderFilesManagement(filesWithMetadata);
        }
        
    } catch (error) {
        console.error("Error al listar archivos de Firebase:", error);
        showAlert("error", "Error de Red", "No se pudo conectar con Firebase.");
    }
}

function renderFileSelectOptions(files) { const container = document.getElementById("fileListContainer"); container.innerHTML = files.map(file => `<div class="card file-card mb-2" style="border-radius: 12px;"><div class="card-body d-flex justify-content-between align-items-center p-3"><div><i class="bi bi-file-earmark-excel-fill me-2 text-success fs-4"></i><span class="fw-bold">${file.name}</span></div><button class="btn btn-pill btn-pill-sm btn-select">Seleccionar</button></div></div>`).join(''); container.querySelectorAll('.btn-select').forEach((button, index) => { button.addEventListener('click', () => { AppState.selectedFileData = files[index]; document.getElementById("selectedFileFeedback").textContent = `Archivo seleccionado: ${files[index].name}`; document.getElementById("confirmFileSelection").disabled = false; container.querySelectorAll('.file-card').forEach(card => card.style.border = "1px solid var(--gris-medio)"); button.closest('.file-card').style.border = "2px solid var(--rosa-principal)"; }); }); }

async function renderFilesManagement(files) {
    if (!files.length) return;

    const container = document.getElementById("filesManagementContainer");

    const filesHTML = await Promise.all(files.map(async file => {
        // Obtenemos la URL de descarga para cada archivo
        const downloadUrl = await file.ref.getDownloadURL();
        
        const fileSize = file.ref.metadata?.size;
        const formattedSize = fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : 'N/A';

        const dateOptions = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' };
        const formattedDate = file.timeCreated.toLocaleDateString('es-MX', dateOptions);

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
                    <a class="dropdown-item d-flex align-items-center gap-2" href="${downloadUrl}" target="_blank" download="${file.name}">
                    <i class="bi bi-download"></i> Descargar
                    </a>
                </li>
                <li>
                    <button class="dropdown-item d-flex align-items-center gap-2" onclick="navigator.clipboard.writeText('${downloadUrl}'); showAlert('success', '¡Enlace copiado!')">
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

    document.querySelectorAll('.admin-delete-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const fileName = e.currentTarget.dataset.filename;
            const fileRef = storage.ref(`uploads/${fileName}`);

            const { isConfirmed } = await Swal.fire({
                title: '¿Estás seguro?',
                text: `El archivo "${fileName}" se borrará permanentemente. Esta acción no se puede deshacer.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: 'var(--rojo-peligro)',
                cancelButtonColor: 'var(--gris-oscuro)',
                confirmButtonText: 'Sí, ¡Eliminar!',
                cancelButtonText: 'Cancelar'
            });


            if (isConfirmed) {
                Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                try {
                    await fileRef.delete();
                    showAlert("success", "Eliminado", "El archivo ha sido eliminado.");
                    setTimeout(() => location.reload(), 1500);
                } catch (error) {
                    showAlert("error", "Error", "No se pudo eliminar el archivo.");
                }
            }
        });
    });
}
async function handleFileUpload(file) {
    const { isConfirmed } = await Swal.fire({
        title: '¿Subir este archivo?',
        text: `Se cargará "${file.name}" como un nuevo reporte de rechazos.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, subir'
    });

    if (isConfirmed) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const newFileName = `Rechazos_${timestamp}.xlsx`;
        const fileRef = storage.ref(`uploads/${newFileName}`);

        // --- INICIO DEL CAMBIO CLAVE ---
        // Preparamos los metadatos personalizados con la fecha de subida original.
        const metadata = {
            customMetadata: {
                'version': '1',
                'originalUploadDate': new Date().toISOString() // "Tatuamos" la fecha
            }
        };
        // --- FIN DEL CAMBIO CLAVE ---

        const uploadTask = fileRef.put(file, metadata); // Subimos el archivo con los nuevos metadatos

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

        const remision = remisionData.Remisión || `evidencia_${Date.now()}`;
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

        const uploadTask = storageRef.put(file);

        uploadTask.on('state_changed',
            null,
            (error) => {
                console.error("Error al subir foto:", error);
                Swal.close();
                showAlert("error", "Error al subir", `No se pudo guardar la evidencia. Código: ${error.code}`);
            },
            () => {
                uploadTask.snapshot.ref.getDownloadURL().then(downloadURL => {
                    AppState.rechazosGlobal[rowIndex].Fotos = downloadURL;
                    updatePhotoPreview(rowIndex, downloadURL);
                    queueChange(remision, 'Fotos', downloadURL);
                    if (autoSaveTimers[rowIndex]) clearTimeout(autoSaveTimers[rowIndex]);
                    autoSaveTimers[rowIndex] = setTimeout(() => syncPendingChanges(true), 500);

                    Swal.close();
                    showAlert('success', '¡Evidencia Guardada!', 'La foto se subió correctamente y se guardará en breve.');
                });
            }
        );
    };

    fileInput.click();
}

function deletePhoto(rowIndex) { Swal.fire({ title: '¿Estás seguro?', text: "La foto de evidencia se eliminará permanentemente.", icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--rojo-peligro)', cancelButtonColor: 'var(--gris-oscuro)', confirmButtonText: 'Sí, ¡Eliminar!', cancelButtonText: 'Cancelar' }).then((result) => { if (result.isConfirmed) { const photoUrl = AppState.rechazosGlobal[rowIndex].Fotos; if (photoUrl && photoUrl.startsWith('https://firebasestorage.googleapis.com')) { const photoRef = storage.refFromURL(photoUrl); photoRef.delete().catch(err => console.error("Error al borrar de Storage:", err)); } const remision = AppState.rechazosGlobal[rowIndex].Remisión; AppState.rechazosGlobal[rowIndex].Fotos = ""; updatePhotoPreview(rowIndex, ""); queueChange(remision, 'Fotos', ''); Swal.fire('¡Eliminada!', 'La foto ha sido eliminada.', 'success'); } }); }

function updatePhotoPreview(rowIndex, url) {
    const previewContainer = document.getElementById(`evidencia-preview-${rowIndex}`);
    if (!previewContainer) return;

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


/*****************************************************
 * ========== LÓGICA DE VISUALIZACIÓN DE DATOS ==========
 *****************************************************/
async function loadRechazosFileBasedOnRole() { if (!AppState.relacionesData) { return showAlert("error", "Error de datos", "No se pudo cargar la información de relaciones."); } let secciones = []; if (!AppState.isAdmin) { const correoUsuario = auth.currentUser.email; const usuarioData = AppState.relacionesData.filter(row => row.Correo === correoUsuario); if (usuarioData.length === 0) { return showAlert("error", "Acceso denegado", "No se encontró información para este usuario."); } usuarioData.forEach(row => { for (const key in row) { if (key.toLowerCase().includes('sección') && row[key]) { secciones = secciones.concat(row[key].toString().split(',').map(s => s.trim())); } } }); secciones = [...new Set(secciones.filter(Boolean))]; } loadRechazosFile(secciones); }
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
        const sheet = workbook.Sheets["Rechazos"];
        
        if (!sheet) return showAlert("error", "Error de Formato", "No existe la hoja 'Rechazos' en el Excel.");
        
        AppState.allRechazosEnExcel = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const updatesMap = new Map(Object.entries(AppState.pendingChanges));
        if (updatesMap.size > 0) {
            console.log("Aplicando cambios pendientes a los datos cargados...");
            AppState.allRechazosEnExcel.forEach(row => {
                const remision = row.Remisión?.toString();
                if (remision && updatesMap.has(remision)) {
                    const updates = updatesMap.get(remision);
                    Object.assign(row, updates);
                }
            });
        }

        let rechazosFiltrados = AppState.allRechazosEnExcel;

        if (AppState.isAdmin) {
            renderBossFilter(rechazosFiltrados);
            if (adminBossFilter) {
                rechazosFiltrados = rechazosFiltrados.filter(row => fixEncoding(row["Jefatura"]) === adminBossFilter);
            }
        } else if (secciones.length > 0) {
            rechazosFiltrados = rechazosFiltrados.filter(row => row.Sección && secciones.includes(row.Sección.toString().trim()));
        }
        
        renderRechazos(rechazosFiltrados);

    } catch (error) {
        console.error("Error al cargar rechazos.xlsx:", error);
        showAlert("error", "Error de Carga", "No se pudo procesar el archivo 'rechazos.xlsx'.");
    }
}
function renderBossFilter(allRechazos) { const container = document.getElementById("bossFilterContainer"); const jefesUnicos = [...new Set(allRechazos.map(r => fixEncoding(r["Jefatura"])).filter(Boolean))]; container.innerHTML = `<h5><i class="bi bi-person-video3 me-2"></i>Filtrar por Jefatura</h5><select class="form-select" id="bossFilterSelect"><option value="">Mostrar Todas</option>${jefesUnicos.map(j => `<option value="${j}">${j}</option>`).join('')}</select>`; const select = document.getElementById('bossFilterSelect'); select.value = adminBossFilter; select.addEventListener("change", (e) => { adminBossFilter = e.target.value; const filtrados = adminBossFilter ? AppState.allRechazosEnExcel.filter(row => fixEncoding(row["Jefatura"]) === adminBossFilter) : AppState.allRechazosEnExcel; renderRechazos(filtrados); }); }
function renderRechazos(rechazosData) { const container = document.getElementById("rechazosContainer"); AppState.rechazosGlobal = rechazosData.map((item, index) => ({ ...item, _rowIndex: index, Comentarios: item.Comentarios || "", Fotos: item.Fotos || "" })); if (!rechazosData.length) { container.innerHTML = `<div class="alert alert-info text-center"><i class="bi bi-info-circle-fill"></i> No hay reportes que coincidan con tu filtro actual.</div>`; return; } container.innerHTML = `<div class="accordion" id="rechazosAccordion">${AppState.rechazosGlobal.map(renderRechazoItem).join('')}</div>`; AppState.rechazosGlobal.forEach((rechazo, i) => { loadDynamicImage(rechazo.Sku, rechazo.Sección, `imgContainer-${rechazo.Sku}-${i}`); updatePhotoPreview(rechazo._rowIndex, rechazo.Fotos); }); }

// ===== SECCIÓN MODIFICADA (INICIO) =====
// Se ajusta la función para renderizar el ícono de comentario correcto desde el inicio.
// ===== INICIO DE LA FUNCIÓN ACTUALIZADA =====
function renderRechazoItem(rechazo, i) {
    const { _rowIndex, Remisión, Sku, Sección } = rechazo;
    const fecha = parseExcelDate(rechazo["Fecha y Hora Rechazo"]) || "N/A";
    const descripcionSku = fixEncoding(rechazo["Descripción Sku"]) || "N/A";
    const piezas = fixEncoding(rechazo.Piezas) || "N/A";
    const jefatura = fixEncoding(rechazo.Jefatura) || "N/A";
    const usuarioRechazo = fixEncoding(rechazo["Usuario de Rechazo"]) || "N/A";
    const user = AppState.usuariosData.find(u => u.Usuarios && u.Usuarios.toString().trim().toLowerCase() === usuarioRechazo.toLowerCase());
    const usuarioName = user?.Nombre || usuarioRechazo;

    const estadosPosibles = ["Sin Estado", "Sí encontrada", "No encontrada", "Encontrada en exhibición", "Encontrada Merma"];
    const estadoActual = rechazo.Status || "Sin Estado";

    const statusColors = {
        "Sí encontrada": "var(--verde-exito)",
        "No encontrada": "var(--rojo-peligro)",
        "Encontrada en exhibición": "var(--azul-info)",
        "Encontrada Merma": "#ff9800",
        "Sin Estado": "var(--gris-oscuro)"
    };
    
    const opcionesHTML = estadosPosibles.map(opt => 
        `<option value="${opt}" ${estadoActual === opt ? 'selected' : ''}>${opt}</option>`
    ).join('');

    let liverpoolUrl = "#";
    if (/^\d{10,}$/.test(Sku)) {
        liverpoolUrl = `https://www.liverpool.com.mx/tienda/pdp/producto/${Sku}`;
    } else if (Sku && Sku.toString().trim() !== "") {
        liverpoolUrl = `https://www.liverpool.com.mx/tienda/busca?busqueda=${encodeURIComponent(Sku)}`;
    } else if (descripcionSku && descripcionSku !== "N/A") {
        liverpoolUrl = `https://www.liverpool.com.mx/tienda/busca?busqueda=${encodeURIComponent(descripcionSku)}`;
    }

    let googleQuerySku = Sku && Sku.toString().trim() !== "" ? Sku : descripcionSku;
    const googleUrlSku = `https://www.google.com/search?q=${encodeURIComponent(googleQuerySku)}`;
    const googleUrlDesc = descripcionSku && descripcionSku !== "N/A" ? `https://www.google.com/search?q=${encodeURIComponent(descripcionSku)}` : "#";
    
    const createDetailRow = (icon, label, value) => `
        <div class="detail-row d-flex justify-content-between align-items-center py-2 px-1 flex-wrap">
            <div class="d-flex align-items-center gap-2">
                <i class="bi ${icon} text-secondary me-2" title="${label}"></i>
                <span class="text-muted small">${label}</span>
            </div>
            <strong class="text-dark text-end small">${value}</strong>
        </div>
    `;

    return `
    <div class="accordion-item report-card shadow-sm mb-3 rounded-4 border-0" id="item-${_rowIndex}">
        <h2 class="accordion-header" id="heading-${_rowIndex}">
            <button class="accordion-button collapsed px-2 py-2 d-flex flex-row align-items-center gap-2" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${_rowIndex}">
                <span class="badge rounded-pill me-2" style="background-color: ${statusColors[estadoActual]}; min-width: 120px; font-size: 0.75rem;">${estadoActual}</span>
                <div class="report-summary flex-grow-1 d-flex flex-column flex-md-row align-items-md-center gap-2">
                    <span class="sku-title fw-semibold" title="${descripcionSku}">${descripcionSku}</span>
                    <span class="user-info text-muted small"><i class="bi bi-person"></i> ${usuarioName}</span>
                </div>
                <span class="ms-2 badge bg-dark rounded-pill">${Remisión}</span>
            </button>
        </h2>
        <div id="collapse-${_rowIndex}" class="accordion-collapse collapse" data-bs-parent="#rechazosAccordion">
            <div class="accordion-body px-2 py-3">
                <div class="row g-3">
                    <div class="col-12 col-lg-7">
                        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                            <h5 class="mb-0 fw-bold text-dark"><i class="bi bi-info-circle me-2"></i>Detalles del Rechazo</h5>
                            <div class="d-flex gap-2">
                                <a href="${liverpoolUrl}" target="_blank" class="btn btn-sm btn-outline-dark rounded-pill d-flex align-items-center gap-1" title="Ver producto en Liverpool">
                                    <i class="bi bi-box-arrow-up-right"></i> <span class="d-none d-md-inline">Ver en Liverpool</span>
                                </a>
                                <a href="${googleUrlSku}" target="_blank" class="btn btn-sm btn-outline-primary rounded-pill d-flex align-items-center gap-1" title="Buscar en Google por SKU">
                                    <i class="bi bi-google"></i> <span class="d-none d-md-inline">Google SKU</span>
                                </a>
                                <a href="${googleUrlDesc}" target="_blank" class="btn btn-sm btn-outline-success rounded-pill d-flex align-items-center gap-1" title="Buscar en Google por descripción">
                                    <i class="bi bi-google"></i> <span class="d-none d-md-inline">Google Descripción</span>
                                </a>
                            </div>
                        </div>
                        <div class="details-list-container border rounded-3 p-2 bg-light">
                            ${createDetailRow('bi-upc-scan', 'SKU', Sku)}
                            ${createDetailRow('bi-box-seam', 'Piezas', piezas)}
                            ${createDetailRow('bi-calendar-event', 'Fecha', fecha)}
                            ${createDetailRow('bi-tag-fill', 'Sección', Sección)}
                            ${createDetailRow('bi-person-workspace', 'Jefatura', jefatura)}
                        </div>
                        <div class="mt-3">
                            <label for="status-${_rowIndex}" class="form-label fw-bold text-dark">
                                <i class="bi bi-check-circle-fill"></i> Estado del Rechazo:
                            </label>
                            <select id="status-${_rowIndex}" class="form-select status-select rounded-3 shadow-sm" data-row-index="${_rowIndex}">
                                ${opcionesHTML}
                            </select>
                        </div>
                    </div>
                    <div class="col-12 col-lg-5">
                        <div class="evidence-section">
                            <h6 class="mb-2 fw-bold text-dark"><i class="bi bi-camera-fill me-2"></i>Evidencia</h6>
                            <div id="imgContainer-${Sku}-${i}" class="product-image-container mb-2 w-100 d-flex justify-content-center"></div>
                            <div id="evidencia-preview-${_rowIndex}" class="evidence-preview-container w-100"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
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
        const rechazosItems = fileList.items.filter(item => item.name.toLowerCase().includes('rechazos'));

        if (rechazosItems.length === 0) {
            return Swal.fire("Sin Datos", "No se encontraron archivos de 'Rechazos' para analizar.", "info");
        }

        let todosLosRechazosHistoricos = [];
        await Promise.all(rechazosItems.map(async (fileRef) => {
            const url = await fileRef.getDownloadURL();
            const data = await (await fetch(url)).arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets["Rechazos"];
            if (sheet) {
                // Acumula los datos de todos los archivos en un solo arreglo.
                todosLosRechazosHistoricos.push(...XLSX.utils.sheet_to_json(sheet, { defval: "" }));
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
                const fechaRechazo = _parseDateForCompare(rechazo["Fecha y Hora Rechazo"]);
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
    const estadosPosibles = ["Sí encontrada", "No encontrada", "Encontrada en exhibición", "Encontrada Merma", "Sin Estado"];

    rechazos.forEach(rechazo => {
        const jefatura = fixEncoding(rechazo.Jefatura) || "Sin Asignar";
        const estado = rechazo.Status || "Sin Estado";
        const piezas = Number(rechazo.Piezas) || 0;

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
        const rechazosItems = fileList.items.filter(item => item.name.toLowerCase().includes('rechazos'));

        if (rechazosItems.length === 0) {
            return Swal.fire("Sin Datos", "No se encontraron archivos de 'Rechazos' para analizar.", "info");
        }
        
        let todosLosRechazosHistoricos = [];
        await Promise.all(rechazosItems.map(async (fileRef) => {
            const url = await fileRef.getDownloadURL();
            const data = await (await fetch(url)).arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets["Rechazos"];
            if (sheet) {
                todosLosRechazosHistoricos.push(...XLSX.utils.sheet_to_json(sheet, { defval: "" }));
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
            tablaContainer.innerHTML = `<div class="dashboard-card"><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr><th>Jefatura</th><th class="text-center">Sí Encontrada</th><th class="text-center">No Encontrada</th><th class="text-center">Exhibición</th><th class="text-center">Merma</th><th class="text-center">Total Piezas</th></tr></thead><tbody>${dataConRendimiento.map(item => `<tr><td class="fw-bold">${item.jefe}</td><td class="text-center">${item.statusCounts['Sí encontrada'].toLocaleString()}</td><td class="text-center">${item.statusCounts['No encontrada'].toLocaleString()}</td><td class="text-center">${item.statusCounts['Encontrada en exhibición'].toLocaleString()}</td><td class="text-center">${item.statusCounts['Encontrada Merma'].toLocaleString()}</td><td class="text-center fw-bolder" style="background-color: ${obtenerColorParaValor(item.totalPiezas, maxPiezas)};">${item.totalPiezas.toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div>`;
        }
    });
}