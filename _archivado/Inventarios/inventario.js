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

// ========== ESTADO Y VARIABLES GLOBALES ==========
const AppState = {
    currentUser: null,
    selectedFileName: "",
    inventoryData: [], // Array principal de objetos de inventario
    currentMarbete: "",
    currentStep: 1,
    // debounceTimeout: null, // ELIMINADO: Ya no es necesario para handleScan
    saveDebounceTimeout: null, // PARA EL GUARDADO EN LA NUBE (se mantiene)
    manualEditModal: null,
    viewSheetModal: null,
    adminUIDs: ["OaieQ6cGi7TnW0nbxvlk2oyLaER2", "V3gs0U4nKVeIZHvEfEfIiNLXq2Sy1", "doxhVo1D3aYQqqkqgRgfJ4qcCcU2"], // IDs de administradores
    isOnline: navigator.onLine, // Estado de conexión
    isSaving: false, // Indica si una operación de guardado en la nube está en curso
    idb: null, // Referencia a la base de datos IndexedDB
    offlineQueue: [], // Cola para operaciones pendientes de sincronizar offline (visual)
    firestoreListener: null, // Referencia al listener de Firestore para desvincularlo
    lastSavedLocalTimestamp: 0, // Timestamp de la última vez que se guardó localmente
    scanInputTimeout: null // Nuevo: para el escaneo automático por dígitos
};


// ========== INICIALIZACIÓN DE LA APP ==========
document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoded: Iniciando aplicación...");
    // Escucha cambios en el estado de autenticación de Firebase
    auth.onAuthStateChanged(handleAuthChange);
    // Inicializa IndexedDB al cargar la página
    await initDB();
    // Inicializa el asistente (wizard) y sus eventos
    initWizard();
    console.log("DOMContentLoded: Aplicación inicializada.");
});

/**
 * Inicializa IndexedDB. Crea las "object stores" si no existen.
 * @returns {Promise<void>} Una promesa que se resuelve cuando IndexedDB está listo.
 */
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("InventoryDB", 1); // Nombre de la DB, versión
        request.onerror = (event) => {
            console.error("Error al abrir IndexedDB:", event.target.errorCode);
            Swal.fire("Error Crítico", "No se pudo inicializar la base de datos local (IndexedDB). Esto podría causar pérdida de datos sin conexión.", "error");
            reject("Error de IndexedDB");
        };
        request.onsuccess = (event) => {
            AppState.idb = event.target.result;
            console.log("IndexedDB inicializado correctamente.");
            resolve();
        };
        // Se ejecuta solo si la base de datos es nueva o la versión es mayor
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("inventarios")) {
                // Almacena objetos de inventario por su `fileName`
                db.createObjectStore("inventarios", { keyPath: "fileName" });
                console.log("IndexedDB: Object store 'inventarios' creada.");
            }
            if (!db.objectStoreNames.contains("offline_queue")) {
                // Para guardar operaciones pendientes offline
                db.createObjectStore("offline_queue", { autoIncrement: true });
                console.log("IndexedDB: Object store 'offline_queue' creada.");
            }
        };
    });
}

/**
 * Maneja el cambio de estado de autenticación del usuario.
 * Redirige al login si no hay usuario autenticado.
 * @param {firebase.User} user - El objeto de usuario de Firebase.
 */
function handleAuthChange(user) {
    if (!user) {
        console.warn("handleAuthChange: No se detectó un usuario autenticado. Redirigiendo a la página de login.");
        Swal.fire({
            icon: "warning",
            title: "Acceso Denegado",
            text: "Debes iniciar sesión para acceder al inventario.",
            confirmButtonText: "Ir a Login",
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then(() => {
            window.location.href = "../Login/login.html"; // Ajusta la ruta a tu página de login
        });
    } else {
        AppState.currentUser = user;
        console.log(`handleAuthChange: Usuario autenticado: ${user.email} (UID: ${user.uid}).`);
        const adminSection = document.getElementById("adminUploadSection");
        const adminDeleteColumnsSection = document.getElementById("adminDeleteColumnsSection");

        const isAdmin = AppState.adminUIDs.includes(user.uid);
        if (adminSection) {
            adminSection.style.display = isAdmin ? "block" : "none";
            console.log(`Visibilidad de sección de admin para UID ${user.uid}: ${adminSection.style.display === 'block' ? 'Visible' : 'Oculta'}`);
        }
        if (adminDeleteColumnsSection) {
            adminDeleteColumnsSection.style.display = isAdmin ? "block" : "none";
            console.log(`Visibilidad de sección de eliminar columnas para UID ${user.uid}: ${adminDeleteColumnsSection.style.display === 'block' ? 'Visible' : 'Oculta'}`);
        }
        const adminTabNav = document.getElementById('adminTab');
        if (adminTabNav && isAdmin) adminTabNav.style.display = 'flex';
    }
}

/**
 * Inicializa todos los componentes y listeners del asistente (wizard).
 */
function initWizard() {
    console.log("initWizard: Inicializando componentes y listeners...");
    AOS.init({ once: true, duration: 600 }); // Inicializa Animate On Scroll

    // Inicializa modales de Bootstrap
    AppState.manualEditModal = new bootstrap.Modal(document.getElementById('manualEditModal'));
    AppState.viewSheetModal = new bootstrap.Modal(document.getElementById('viewSheetModal'));
    new bootstrap.Tooltip(document.getElementById('fab-manual-edit')); // Inicializa tooltip

    populateBossDropdowns();
    loadFileList();

    // Listeners para el estado de la conexión de red
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    updateStatusIndicator(); // Actualiza el indicador de estado al cargar

    // Asigna listeners a los botones y elementos interactivos
    document.getElementById('logout-btn').addEventListener('click', () => {
        console.log("Botón de logout clicado.");
        auth.signOut()
            .then(() => {
                console.log("Sesión cerrada exitosamente.");
                Swal.fire({ icon: "info", title: "Sesión Cerrada", text: "Has cerrado sesión. Redirigiendo al login.", showConfirmButton: false, timer: 1500 })
                    .then(() => { window.location.href = "../Login/login.html"; });
            })
            .catch(error => {
                console.error("Error al cerrar sesión:", error);
                Swal.fire("Error", "No se pudo cerrar la sesión. Por favor, inténtalo de nuevo.", "error");
            });
    });

    document.getElementById('nextBtn').addEventListener('click', handleNextStep);
    document.getElementById('backBtn').addEventListener('click', handlePreviousStep);

    // MODIFICACIÓN CRÍTICA AQUÍ: Escaneo automático al detectar 5+ dígitos
    const scanInput = document.getElementById("scanInput");
    scanInput.addEventListener("input", (event) => {
        clearTimeout(AppState.scanInputTimeout); // Limpiar cualquier timeout anterior

        // Si el valor ya tiene 5 o más caracteres, disparar handleScan inmediatamente
        if (event.target.value.length >= 10) {
            handleScan();
        } else {
            // Opcional: si quieres un pequeño retraso para escáneres muy rápidos que "pegue" el valor
            // AppState.scanInputTimeout = setTimeout(handleScan, 50); // Puedes ajustar este valor
        }
    });
    // Los eventos "change" y "blur" ya no son tan críticos si el input es vaciado en cada escaneo
    scanInput.addEventListener("change", handleScan);
    scanInput.addEventListener("blur", handleScan);

    document.getElementById("fileList").addEventListener("change", loadSelectedFile);
    document.getElementById("bossFilterSelect").addEventListener("change", loadFileList);
    document.getElementById("confirmMarbeteBtn").addEventListener("click", confirmMarbete);

    // Configuración del dropzone para subir archivos
    const dropzone = document.getElementById("dropzone");
    dropzone.addEventListener("dragover", e => e.preventDefault());
    dropzone.addEventListener("drop", handleFileDrop);
    dropzone.onclick = () => document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = e => handleFileDrop({ preventDefault: () => {}, dataTransfer: { files: e.target.files } });

    // Listeners para los botones de las FABs y modales
    document.getElementById("fab-manual-edit").addEventListener("click", () => AppState.manualEditModal.show());
    document.getElementById("saveDataBtn").addEventListener("click", () => {
        console.log("Botón 'Guardar datos' clicado. Forzando persistencia.");
        persistInventoryData(true); // Guarda forzadamente y sincroniza
    });
    document.getElementById("downloadBtn").addEventListener("click", downloadFile);
    document.getElementById("viewSheetBtn").addEventListener("click", viewSheet);
    document.getElementById("searchMarbeteBtn").addEventListener("click", searchMarbete);
    document.getElementById("saveManualBtn").addEventListener("click", saveManualEdits);

    // Listener para agregar columna a eliminar
    document.getElementById("addColumnToDeleteBtn").addEventListener("click", addColumnToDeleteInput);
    // Listener para procesar eliminación de columnas (botón de subida de archivo se encargará)

    navigateToStep(1); // Inicia en el primer paso del asistente
    console.log("initWizard: Componentes y listeners inicializados.");
}

/**
 * Añade un nuevo campo de entrada para especificar una columna a eliminar.
 */
function addColumnToDeleteInput() {
    const container = document.getElementById("columnsToDeleteContainer");
    const div = document.createElement("div");
    div.className = "input-group mb-2";
    div.innerHTML = `
        <input type="text" class="form-control column-to-delete-input" placeholder="Ej: Precio, Fecha" aria-label="Nombre de columna a eliminar">
        <button class="btn btn-outline-danger remove-column-input" type="button"><i class="bi bi-x-circle"></i></button>
    `;
    container.appendChild(div);

    // Añadir listener para el botón de remover
    div.querySelector(".remove-column-input").addEventListener("click", function() {
        div.remove();
        console.log("Columna a eliminar eliminada del UI.");
    });
    console.log("Nuevo campo para eliminar columna añadido.");
}

// ========== LÓGICA DEL ASISTENTE (WIZARD) ==========

/**
 * Avanza al siguiente paso del asistente si es posible.
 */
function handleNextStep() {
    console.log(`handleNextStep: Intentando avanzar del paso ${AppState.currentStep}.`);
    if (AppState.currentStep < 3) { // Asumiendo 3 pasos totales
        if (AppState.currentStep === 2 && !AppState.currentMarbete) {
            console.warn("handleNextStep: No se puede avanzar del paso 2 sin un marbete confirmado.");
            return Swal.fire("Sin Marbete", "Debes confirmar un marbete para continuar al paso de escaneo.", "warning");
        }
        if (AppState.currentStep === 2) {
            const summaryDiv = document.getElementById('scan-summary');
            if (summaryDiv) {
                summaryDiv.innerHTML = `<i class="bi bi-info-circle-fill fs-4"></i><div>Archivo: <strong>${AppState.selectedFileName || 'No seleccionado'}</strong> <br> Marbete: <strong>${AppState.currentMarbete || 'No confirmado'}</strong></div>`;
                console.log(`handleNextStep: Resumen del paso 3 actualizado para archivo '${AppState.selectedFileName}' y marbete '${AppState.currentMarbete}'.`);
            }
        }
        navigateToStep(AppState.currentStep + 1);
    } else {
        console.log("handleNextStep: Ya estás en el último paso.");
    }
}

/**
 * Regresa al paso anterior del asistente si es posible.
 */
function handlePreviousStep() {
    console.log(`handlePreviousStep: Intentando retroceder del paso ${AppState.currentStep}.`);
    if (AppState.currentStep > 1) {
        navigateToStep(AppState.currentStep - 1);
    } else {
        console.log("handlePreviousStep: Ya estás en el primer paso.");
    }
}

/**
 * Navega a un paso específico del asistente y actualiza la UI.
 * @param {number} stepNumber - El número del paso al que se desea navegar.
 */
function navigateToStep(stepNumber) {
    console.log(`MapsToStep: Navegando al paso ${stepNumber}.`);
    AppState.currentStep = stepNumber;
    const steps = document.querySelectorAll('.wizard-step');
    const progressBar = document.getElementById('progressBar');

    steps.forEach(step => step.classList.remove('active'));
    document.getElementById(`step-${AppState.currentStep}`).classList.add('active');
    AOS.refresh();

    const progress = Math.max(0, ((AppState.currentStep - 1) / (steps.length - 1)) * 100);
    progressBar.style.width = `${progress}%`;

    document.getElementById('backBtn').style.visibility = AppState.currentStep > 1 ? 'visible' : 'hidden';
    document.getElementById('nextBtn').style.display = AppState.currentStep < steps.length ? 'block' : 'none';

    if (AppState.currentStep === 3) {
        document.getElementById('scanInput').focus();
        console.log("navigateToStep: Enfocando campo de escaneo.");
    }
    validateStep();
}

/**
 * Valida si el usuario puede avanzar al siguiente paso del asistente.
 * Habilita/deshabilita el botón "Siguiente" basado en el estado actual.
 */
function validateStep() {
    const nextBtn = document.getElementById('nextBtn');
    let isValid = false;
    switch (AppState.currentStep) {
        case 1:
            isValid = AppState.selectedFileName && AppState.inventoryData.length > 0;
            console.log(`validateStep (Paso 1): Archivo seleccionado: ${!!AppState.selectedFileName}, Datos cargados: ${AppState.inventoryData.length > 0}. Botón Siguiente habilitado: ${isValid}`);
            break;
        case 2:
            isValid = !!AppState.currentMarbete;
            console.log(`validateStep (Paso 2): Marbete confirmado: ${!!AppState.currentMarbete}. Botón Siguiente habilitado: ${isValid}`);
            break;
        case 3:
            isValid = true; // En el paso 3, siempre se puede operar
            console.log(`validateStep (Paso 3): Siempre habilitado. Botón Siguiente habilitado: ${isValid}`);
            break;
        default:
            isValid = false;
    }
    nextBtn.disabled = !isValid;
}


// ========== MANEJO DE ESTADO Y SINCRONIZACIÓN ==========

/**
 * Maneja los cambios en el estado de conexión (online/offline).
 * Si se vuelve online, intenta procesar la cola de operaciones pendientes.
 */
function handleOnlineStatus() {
    AppState.isOnline = navigator.onLine;
    console.log(`handleOnlineStatus: Estado de conexión cambiado a ${AppState.isOnline ? 'Online' : 'Offline'}.`);
    updateStatusIndicator();
    if (AppState.isOnline) {
        console.log("Conexión restablecida. Procesando cola de espera...");
        processOfflineQueue();
    }
}

/**
 * Actualiza los indicadores visuales de estado de conexión y sincronización.
 */
function updateStatusIndicator() {
    const connIndicator = document.getElementById('connection-status');
    const syncIndicator = document.getElementById('sync-status');
    if (!connIndicator || !syncIndicator) return;

    if (AppState.isOnline) {
        connIndicator.innerHTML = '<i class="bi bi-wifi"></i> En línea';
        connIndicator.className = 'badge rounded-pill bg-success';
    } else {
        connIndicator.innerHTML = '<i class="bi bi-wifi-off"></i> Sin conexión';
        connIndicator.className = 'badge rounded-pill bg-danger';
    }

    if (AppState.isSaving) {
        syncIndicator.innerHTML = '<i class="bi bi-arrow-repeat"></i> Guardando...';
        syncIndicator.className = 'badge rounded-pill bg-info text-dark';
    } else if (AppState.offlineQueue.length > 0) {
        syncIndicator.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> ${AppState.offlineQueue.length} cambios pendientes`;
        syncIndicator.className = 'badge rounded-pill bg-warning text-dark';
    } else {
        syncIndicator.innerHTML = '<i class="bi bi-check-circle-fill"></i> Sincronizado';
        syncIndicator.className = 'badge rounded-pill bg-light text-dark';
    }
    console.log(`updateStatusIndicator: Conexión: ${AppState.isOnline ? 'Online' : 'Offline'}, Guardando: ${AppState.isSaving}, Cola Offline: ${AppState.offlineQueue.length}.`);
}

/**
 * Procesa la cola de operaciones pendientes guardadas en IndexedDB cuando se restablece la conexión.
 */
async function processOfflineQueue() {
    console.log("processOfflineQueue: Intentando procesar la cola de offline.");
    const transaction = AppState.idb.transaction(["offline_queue"], "readwrite");
    const store = transaction.objectStore("offline_queue");
    const items = await store.getAll();

    if (items.length === 0) {
        console.log("Cola de offline vacía. Nada que sincronizar.");
        return;
    }

    Swal.fire({
        title: 'Sincronizando...',
        text: `Se están subiendo ${items.length} cambios realizados sin conexión. Por favor, no cierres la aplicación.`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    try {
        await syncToFirebaseWithRetries(); // Fuerza la sincronización con la nube del estado actual
        await store.clear(); // Si fue exitoso, limpia la cola de offline
        AppState.offlineQueue = [];
        updateStatusIndicator();
        Swal.close();
        Swal.fire('¡Sincronizado!', 'Todos los cambios locales han sido guardados en la nube.', 'success');
        console.log("Cola de offline procesada y sincronizada.");
    } catch (error) {
        console.error("Fallo al procesar la cola de offline:", error);
        Swal.close();
        Swal.fire('Error de Sincronización', 'No se pudieron subir todos los cambios pendientes. Por favor, revisa tu conexión o intenta de nuevo más tarde.', 'error');
    }
}


// ========== MANEJO DE DATOS Y ARCHIVOS ==========

/**
 * Rellena los dropdowns de selección de jefe de área.
 */
async function populateBossDropdowns() {
    console.log("populateBossDropdowns: Rellenando dropdowns de jefes.");
    const bossUploadSelect = document.getElementById("bossUploadSelect");
    const bossFilterSelect = document.getElementById("bossFilterSelect");
    const bosses = ["Adriana Prieto", "Alejandro Morales", "Alexis Ricardo", "Alfredo Encinas", "Ana Vazquez", "Beatriz Herrera", "Blanca Lopez", "Fernando Dominguez", "Heidi Jacquez", "Irene Rojas", "Liliana Castillo", "Martin Cabrera", "Sergio Lopez", "Xareni Espindola Perez", "Yanet Matas Manzano"];

    bossUploadSelect.innerHTML = '<option value="">Seleccione jefe</option>';
    bosses.sort().forEach(boss => bossUploadSelect.add(new Option(boss, boss)));

    bossFilterSelect.innerHTML = '<option value="Todos">Todos</option>';
    bosses.sort().forEach(boss => bossFilterSelect.add(new Option(boss, boss)));
    console.log("populateBossDropdowns: Dropdowns de jefes rellenados.");
}

/**
 * Carga la lista de archivos de Excel "Inventario_" desde Firebase Storage.
 * Permite filtrar por jefe de área.
 */
async function loadFileList() {
    console.log("loadFileList: Iniciando carga de lista de archivos de Storage.");
    const fileListElem = document.getElementById("fileList");
    fileListElem.innerHTML = '<option value="">Cargando archivos...</option>';
    try {
        const listResult = await storage.ref("uploads").listAll();
        const bossFilter = document.getElementById("bossFilterSelect").value;
        console.log(`loadFileList: Obtenidos ${listResult.items.length} elementos de Storage. Filtro de jefe actual: '${bossFilter}'.`);

        const filesPromises = listResult.items.map(async fileRef => {
            try {
                const meta = await fileRef.getMetadata();
                return { fileRef, meta };
            } catch (e) {
                console.warn(`loadFileList DEBUG: No se pudieron obtener metadatos para ${fileRef.name}:`, e);
                return { fileRef, meta: null };
            }
        });
        const filesWithMetadata = await Promise.all(filesPromises);

        fileListElem.innerHTML = '<option value="">Seleccione archivo...</option>';
        let filesAddedCount = 0;

        filesWithMetadata
            .filter(item => {
                const hasMetadata = item.meta !== null;
                // Asegúrate de que tus archivos en Storage cumplan con este patrón EXACTAMENTE.
                const nameMatches = item.fileRef.name.toLowerCase().includes("inventario_");
                console.log(`loadFileList DEBUG: Procesando archivo: ${item.fileRef.name}, Tiene metadatos: ${hasMetadata}, Nombre coincide con 'inventario_': ${nameMatches}`);
                return hasMetadata && nameMatches;
            })
            .forEach(item => {
                const jefe = item.meta.customMetadata?.jefe || "Sin Jefe";
                if (bossFilter === "Todos" || bossFilter === jefe) {
                    const option = new Option(item.fileRef.name.replace('inventario_', ''), item.fileRef.name); // Muestra sin el prefijo "inventario_"
                    fileListElem.add(option);
                    filesAddedCount++;
                    console.log(`loadFileList DEBUG: Archivo '${item.fileRef.name}' AÑADIDO al select (Jefe: '${jefe}', Filtro: '${bossFilter}').`);
                } else {
                    console.log(`loadFileList DEBUG: Archivo '${item.fileRef.name}' FILTRADO por jefe (Jefe: '${jefe}', Filtro: '${bossFilter}').`);
                }
            });

        if (filesAddedCount === 0 && fileListElem.options.length === 1) {
            fileListElem.innerHTML += '<option disabled>No se encontraron archivos de inventario.</option>';
            console.warn("loadFileList: No se encontraron archivos que coincidieran con los filtros.");
        }

        console.log(`Lista de archivos cargada. Archivos visibles en el select: ${filesAddedCount}.`);
    } catch (error) {
        console.error("loadFileList: Error cargando lista de archivos:", error);
        fileListElem.innerHTML = '<option value="">Error al cargar</option>';
        Swal.fire("Error", "No se pudo cargar la lista de archivos desde la nube. Revisa tu conexión y las reglas de Storage.", "error");
    }
}

/**
 * Maneja la subida de un archivo Excel a Firebase Storage.
 * VERIFICA SI EL ARCHIVO YA EXISTE y pide confirmación para sobrescribir.
 * Aplica la eliminación de columnas antes de subir los datos a Firestore.
 * @param {DragEvent} e - Evento de drag-and-drop o cambio de input de archivo.
 */
async function handleFileDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    console.log(`handleFileDrop: Archivo recibido: ${file ? file.name : 'ninguno'}.`);

    // 1. Validaciones iniciales (sin cambios)
    if (!file || !file.name.toLowerCase().includes("inventario_") || !file.name.endsWith(".xlsx")) {
        return Swal.fire("Archivo Inválido", "El archivo debe ser un Excel (.xlsx) y su nombre debe contener 'inventario_' (ej. inventario_mi_tienda.xlsx).", "warning");
    }
    const selectedBoss = document.getElementById("bossUploadSelect").value;
    if (!selectedBoss) {
        return Swal.fire("Falta Jefe", "Debes seleccionar un jefe de área para el archivo.", "warning");
    }

    const fileRef = storage.ref(`uploads/${file.name}`);

    // 2. ---- NUEVA RESTRICCIÓN: VERIFICAR SI EL ARCHIVO EXISTE ----
    try {
        await fileRef.getMetadata(); // Intenta obtener metadatos. Si falla, el archivo no existe.
        
        // Si la línea anterior NO falló, el archivo existe. Pedimos confirmación.
        const result = await Swal.fire({
            title: 'Archivo Existente',
            html: `Un archivo con el nombre <strong>"${file.name}"</strong> ya existe. ¿Deseas sobrescribirlo? <br><small>Esta acción reemplazará el archivo y sus datos en la nube.</small>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Sí, sobrescribir',
            cancelButtonText: 'Cancelar'
        });

        if (!result.isConfirmed) {
            console.log("Subida cancelada por el usuario porque el archivo ya existía.");
            return Swal.fire('Cancelado', 'La subida del archivo fue cancelada.', 'info');
        }
        // Si el usuario confirma, la función continúa ejecutándose.
        console.log("El usuario confirmó sobrescribir el archivo existente.");

    } catch (error) {
        // Si el error es 'object-not-found', significa que el archivo es nuevo y podemos continuar.
        if (error.code !== 'storage/object-not-found') {
            // Si es otro tipo de error (ej: permisos), lo mostramos y detenemos.
            console.error("Error al verificar la existencia del archivo en Storage:", error);
            return Swal.fire("Error de Verificación", "No se pudo comprobar si el archivo ya existe. Revisa tu conexión y los permisos de Storage.", "error");
        }
        // El archivo no existe, lo cual es el escenario normal para un archivo nuevo.
        console.log("El archivo es nuevo. Procediendo con la subida normal.");
    }
    // ---- FIN DE LA NUEVA RESTRICCIÓN ----


    // 3. Proceso de subida (sin cambios, se ejecuta si la verificación pasa)
    Swal.fire({
        title: 'Subiendo archivo...',
        text: 'Por favor, espera.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    try {
        await fileRef.put(file, { customMetadata: { jefe: selectedBoss } });
        console.log(`Archivo ${file.name} subido correctamente a Storage.`);

        const columnsToDeleteInputs = document.querySelectorAll(".column-to-delete-input");
        const columnsToDelete = Array.from(columnsToDeleteInputs)
                                      .map(input => input.value.trim())
                                      .filter(name => name !== '');
        console.log("Columnas a eliminar especificadas:", columnsToDelete);

        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const invSheet = workbook.Sheets["Inventarios"] || XLSX.utils.json_to_sheet([]);
        let initialData = XLSX.utils.sheet_to_json(invSheet);

        if (columnsToDelete.length > 0) {
            initialData = initialData.map(row => {
                const newRow = {};
                for (const key in row) {
                    if (!columnsToDelete.map(col => col.toLowerCase()).includes(key.toLowerCase())) {
                        newRow[key] = row[key];
                    }
                }
                return newRow;
            });
            console.log(`handleFileDrop: Columnas (${columnsToDelete.join(', ')}) eliminadas. Nuevas filas:`, initialData.length);
        }

        initialData = initialData.map(row => ({
            SKU: String(row.SKU || '').trim(),
            DESCRIPCION: String(row.DESCRIPCION || "Sin Descripción"),
            OH: parseInt(row.CANTIDAD_INVENTARIO || row.OH, 10) || 0,
            PISO: parseInt(row.PISO, 10) || 0,
            BODEGA: parseInt(row.BODEGA, 10) || 0,
            AJUSTE: parseInt(row.AJUSTE, 10) || 0,
            MARBETE: String(row.MARBETE || '').trim()
        }));
        console.log(`handleFileDrop: Datos del Excel procesados para Firestore. Filas: ${initialData.length}.`);

        await db.collection("inventarios").doc(file.name).set({
            data: initialData,
            lastModified: firebase.firestore.FieldValue.serverTimestamp(),
            uploadedBy: AppState.currentUser.email,
            originalFileName: file.name,
            jefe: selectedBoss
        });
        console.log(`handleFileDrop: Datos iniciales del archivo '${file.name}' guardados en Firestore.`);

        Swal.fire({ icon: "success", title: "¡Subido y Procesado!", text: `'${file.name}' se ha subido a Storage y sus datos a Firestore.`, timer: 2500 });

        await loadFileList();
        const fileListElem = document.getElementById('fileList');
        const foundOption = Array.from(fileListElem.options).find(option => option.value === file.name);
        if (foundOption) {
            fileListElem.value = file.name;
            await loadSelectedFile();
            console.log(`handleFileDrop: Archivo '${file.name}' seleccionado y cargado automáticamente.`);
        } else {
            console.warn(`handleFileDrop: No se pudo seleccionar el archivo '${file.name}' en la lista después de la subida.`);
            Swal.fire("Advertencia", `El archivo se subió, pero no se pudo seleccionar automáticamente en la lista. Verifica los filtros.`, "warning");
        }
    } catch (error) {
        console.error("handleFileDrop: Error en la subida o procesamiento del archivo:", error);
        Swal.fire("Error", "Ocurrió un problema al subir o procesar el archivo. Asegúrate de que las columnas a eliminar existan si las especificaste.", "error");
    }
}

/**
 * Carga el contenido del archivo Excel seleccionado en `AppState.inventoryData` desde Firestore (prioridad) o Storage.
 * Implementa lógica de sincronización y resolución de conflictos.
 */
async function loadSelectedFile() {
    AppState.selectedFileName = document.getElementById("fileList").value;
    const fab = document.getElementById('fab-manual-edit');
    console.log(`loadSelectedFile: Intentando cargar archivo: '${AppState.selectedFileName}'.`);

    if (AppState.firestoreListener) {
        AppState.firestoreListener(); // Desconecta el listener anterior
        AppState.firestoreListener = null;
        console.log("loadSelectedFile: Listener de Firestore anterior desconectado.");
    }

    if (!AppState.selectedFileName) {
        AppState.inventoryData = [];
        fab.classList.remove('visible');
        validateStep();
        console.log("loadSelectedFile: No hay archivo seleccionado, datos limpios.");
        return;
    }

    Swal.fire({
        title: 'Cargando archivo...',
        text: 'Comparando versiones locales y en la nube...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    try {
        const localDataPromise = getFromDB("inventarios", AppState.selectedFileName);
        const docRef = db.collection('inventarios').doc(AppState.selectedFileName);
        const serverSnapshotPromise = docRef.get();

        const [localData, serverSnapshot] = await Promise.all([localDataPromise, serverSnapshotPromise]);
        console.log("loadSelectedFile: Datos de IndexedDB y Firestore obtenidos.");

        let dataToUse;
        let sourceMessage = "Datos cargados desde la nube.";

        if (serverSnapshot.exists) {
            const serverData = serverSnapshot.data().data;
            const serverTimestamp = serverSnapshot.data().lastModified?.toMillis() || 0;
            console.log(`loadSelectedFile: Servidor: Documento existe. Timestamp: ${serverTimestamp}. Local: ${localData ? localData.lastModified : 'No hay datos locales'}.`);

            // Resolución de conflictos: preferimos la versión local si es más reciente
            if (localData && localData.lastModified > (serverTimestamp + 1000)) {
                console.log("loadSelectedFile: ¡Conflicto detectado! Cambios locales más recientes.");
                const result = await Swal.fire({
                    title: 'Cambios locales sin guardar',
                    text: "Se detectaron cambios en este inventario que no se han subido a la nube. ¿Deseas restaurar tus cambios locales o usar la versión de la nube?",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, restaurar mis cambios',
                    cancelButtonText: 'No, usar versión de la nube'
                });
                if (result.isConfirmed) {
                    dataToUse = localData.data;
                    sourceMessage = "Datos restaurados desde tu copia local.";
                    console.log("loadSelectedFile: Usuario optó por restaurar cambios locales.");
                } else {
                    dataToUse = serverData;
                    sourceMessage = "Usando la versión más reciente de la nube.";
                    console.log("loadSelectedFile: Usuario optó por usar la versión de la nube.");
                }
            } else {
                dataToUse = serverData;
                console.log("loadSelectedFile: Usando la versión de la nube (más reciente o igual).");
            }
        } else {
            // Documento no existe en Firestore, lo que significa que es un archivo Legacy de Storage
            // O un archivo nuevo que aún no tiene su contraparte en Firestore
            sourceMessage = "Archivo nuevo o no encontrado en la base de datos, cargando desde el Excel original.";
            console.warn("loadSelectedFile: Documento no encontrado en Firestore. Intentando cargar desde Firebase Storage.");
            const fileRef = storage.ref(`uploads/${AppState.selectedFileName}`);
            const fileUrl = await fileRef.getDownloadURL();
            const response = await fetch(fileUrl);
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            const invSheet = workbook.Sheets["Inventarios"] || XLSX.utils.json_to_sheet([]);

            dataToUse = XLSX.utils.sheet_to_json(invSheet);
            // Limpieza y normalización de datos al cargar desde Excel
            dataToUse.forEach(row => {
                row.SKU = String(row.SKU || '').trim();
                row.DESCRIPCION = String(row.DESCRIPCION || "Sin Descripción");
                row.OH = parseInt(row.OH || row.CANTIDAD_INVENTARIO, 10) || 0;
                delete row.CANTIDAD_INVENTARIO; // Eliminar columna antigua si existía
                row.PISO = parseInt(row.PISO, 10) || 0;
                row.BODEGA = parseInt(row.BODEGA, 10) || 0;
                row.AJUSTE = parseInt(row.AJUSTE, 10) || 0;
                row.MARBETE = String(row.MARBETE || '').trim(); // Importante normalizar marbete
            });
            console.log("loadSelectedFile: Datos cargados desde el archivo Excel original y normalizados.");

            // Después de cargar desde Storage, guarda también en Firestore para que sea el principal
            await db.collection("inventarios").doc(AppState.selectedFileName).set({
                data: dataToUse,
                lastModified: firebase.firestore.FieldValue.serverTimestamp(),
                uploadedBy: AppState.currentUser.email || "desconocido",
                jefe: "Sin Asignar (cargado de Storage)", // Puedes buscar los metadatos de Storage si los necesitas
                originalFileName: AppState.selectedFileName
            });
            console.log("loadSelectedFile: Datos cargados de Storage y guardados inicialmente en Firestore.");
        }

        AppState.inventoryData = dataToUse;
        console.log(`loadSelectedFile: AppState.inventoryData establecido. Total de filas: ${AppState.inventoryData.length}.`);

        // Sincroniza el estado inicial resuelto en IndexedDB.
        await saveToDB("inventarios", {
            fileName: AppState.selectedFileName,
            data: AppState.inventoryData,
            lastModified: new Date().getTime() // Usa un timestamp local
        });
        AppState.lastSavedLocalTimestamp = new Date().getTime(); // Actualiza el timestamp local
        console.log("loadSelectedFile: Datos iniciales persistidos en IndexedDB.");

        // AHORA, empezar a escuchar cambios de otros usuarios en tiempo real
        AppState.firestoreListener = docRef.onSnapshot(snapshot => {
            if (snapshot.exists && snapshot.metadata.hasPendingWrites === false) {
                console.log("loadSelectedFile: Sincronización recibida desde la nube por listener.");
                const remoteData = snapshot.data().data;
                const remoteTimestamp = snapshot.data().lastModified?.toMillis() || 0;

                // Solo actualiza si los datos remotos son más recientes que la última vez que guardamos localmente
                if (remoteTimestamp > (AppState.lastSavedLocalTimestamp || 0)) {
                     AppState.inventoryData = remoteData;
                     saveToDB("inventarios", {
                         fileName: AppState.selectedFileName,
                         data: AppState.inventoryData,
                         lastModified: remoteTimestamp // Usa el timestamp remoto para esta actualización
                     });
                     console.log("loadSelectedFile: AppState.inventoryData y IndexedDB actualizado con datos de la nube por listener.");
                     if (AppState.viewSheetModal._isShown) viewSheet();
                     if (AppState.manualEditModal._isShown) searchMarbete();
                     Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 }).fire({ icon: 'info', title: 'Datos actualizados desde la nube.' });
                } else {
                    console.log(`loadSelectedFile: Datos remotos (${remoteTimestamp}) no más recientes que el último guardado local (${AppState.lastSavedLocalTimestamp}), no se actualiza AppState.inventoryData para evitar conflicto.`);
                }
            } else if (snapshot.metadata.hasPendingWrites === true) {
                console.log("loadSelectedFile: Snapshot de Firestore con escrituras pendientes (propio cambio local), ignorando actualización del listener.");
            }
        }, error => {
            console.error("loadSelectedFile: Error con el listener de Firestore:", error);
            Swal.fire("Error de Conexión", "No se pudo sincronizar en tiempo real con la nube. Algunos cambios podrían no aparecer de inmediato.", "error");
        });

        Swal.fire({ icon: "success", title: "Archivo Listo", text: sourceMessage, timer: 2500, showConfirmButton: false });
        fab.classList.add('visible');
        validateStep();
        console.log("loadSelectedFile: Archivo cargado y listo para operar.");

    } catch (error) {
        console.error("loadSelectedFile: Error crítico al cargar o procesar el archivo seleccionado:", error);
        Swal.fire("Error", "No se pudo cargar o procesar el archivo seleccionado. Por favor, verifica el archivo y tu conexión.", "error");
        AppState.inventoryData = [];
        fab.classList.remove('visible');
        validateStep();
    }
}

/**
 * Confirma el marbete actual y lo guarda en el AppState.
 */
function confirmMarbete() {
    const marbeteInput = document.getElementById("marbeteInput");
    const val = marbeteInput.value.trim();
    if (!val) {
        Swal.fire("Campo Vacío", "Por favor, ingresa un nombre o código para el marbete antes de confirmarlo.", "warning");
        AppState.currentMarbete = "";
        console.warn("confirmMarbete: Intento de confirmar marbete vacío.");
    } else {
        AppState.currentMarbete = val;
        Swal.fire({ icon: "success", title: "Marbete Confirmado", text: `Trabajando con marbete: ${AppState.currentMarbete}`, timer: 2000, showConfirmButton: false });
        console.log(`confirmMarbete: Marbete confirmado: '${AppState.currentMarbete}'.`);
    }
    validateStep();
}

/**
 * Procesa un código escaneado (SKU), actualizando el inventario.
 * ¡La búsqueda e inserción es ahora instantánea!
 */
async function handleScan() {
    console.log("handleScan: Procesando escaneo INSTANTÁNEO...");
    const scanInput = document.getElementById("scanInput");
    const code = String(scanInput.value).trim(); // Obtiene el código escaneado y lo normaliza

    if (!code) {
        console.warn("handleScan: Escaneo vacío ignorado.");
        return;
    }
    // Asegurarse de que el código sea de 5 dígitos o más ANTES de procesar
    if (code.length < 5) {
        console.log(`handleScan: Código '${code}' es menor a 5 dígitos, esperando más entrada.`);
        return; // No procesar si es muy corto
    }

    scanInput.value = ""; // Limpia el input inmediatamente
    scanInput.focus(); // Vuelve a enfocar el input

    if (!AppState.currentMarbete) {
        Swal.fire("Sin Marbete", "Debes confirmar un marbete antes de escanear.", "warning");
        console.warn("handleScan: Escaneo abortado: No hay marbete confirmado.");
        return;
    }
    if (!AppState.inventoryData || !Array.isArray(AppState.inventoryData)) {
        Swal.fire("Error Crítico", "Los datos del inventario no están cargados correctamente. Por favor, recarga el archivo.", "error");
        console.error("handleScan: Escaneo abortado: AppState.inventoryData no es un array válido o está vacío.");
        return;
    }

    const isPiso = document.getElementById("locationCheckbox").checked;
    let rowToUpdate = null; // La fila que finalmente se incrementará
    let hasUpdatedExistingRow = false; // Bandera para saber si se actualizó una fila existente

    try {
        // Normalizar el SKU del escaneo para la búsqueda
        const normalizedScannedSKU = code;

        // Búsqueda de la fila del SKU en el inventario cargado
        // Filtrar y normalizar SKUs para una búsqueda consistente
        const skuMatches = AppState.inventoryData.filter(row =>
            String(row.SKU || '').trim() === normalizedScannedSKU
        );

        // --- LÓGICA DE BÚSQUEDA Y ASIGNACIÓN/ACTUALIZACIÓN DE MARBETE ---

        // Prioridad 1: Buscar una fila que coincida con el SKU Y ya tenga el marbete actual
        rowToUpdate = skuMatches.find(row => String(row.MARBETE || '').trim() === AppState.currentMarbete);
        if (rowToUpdate) {
            console.log(`handleScan: SKU '${code}' encontrado con MARBETE actual ('${AppState.currentMarbete}'). Se actualizará esta fila.`);
            hasUpdatedExistingRow = true;
        } else {
            // Prioridad 2: Buscar una fila que coincida con el SKU y NO tenga marbete asignado (marbete vacío)
            const emptyMarbeteMatch = skuMatches.find(row => String(row.MARBETE || '').trim() === '');
            if (emptyMarbeteMatch) {
                // Si encontramos un SKU sin marbete, le asignamos el marbete actual
                rowToUpdate = emptyMarbeteMatch;
                rowToUpdate.MARBETE = AppState.currentMarbete;
                console.log(`handleScan: SKU '${code}' encontrado con MARBETE vacío. Se asigna '${AppState.currentMarbete}'.`);
                hasUpdatedExistingRow = true;
            } else {
                // Prioridad 3: Si el SKU existe, pero con un MARBETE DIFERENTE. Preguntar al usuario.
                const otherMarbeteMatch = skuMatches.find(row => String(row.MARBETE || '').trim() !== '' && String(row.MARBETE || '').trim() !== AppState.currentMarbete);
                if (otherMarbeteMatch) {
                    console.log(`handleScan: SKU '${code}' encontrado con un MARBETE diferente ('${String(otherMarbeteMatch.MARBETE || '').trim()}').`);

                    const result = await Swal.fire({
                        icon: 'warning',
                        title: 'SKU con Marbete Diferente',
                        html: `El SKU <strong>${code}</strong> ya existe con el marbete <strong>"${String(otherMarbeteMatch.MARBETE || '').trim()}"</strong>.<br><br>
                                ¿Qué deseas hacer?<br><br>
                                <ul>
                                    <li><strong>"Cambiar y Unir":</strong> Asigna el marbete actual ("${AppState.currentMarbete}") a la fila existente y une los conteos.</li>
                                    <li><strong>"Añadir Nueva Fila":</strong> Crea una nueva entrada para este SKU con el marbete actual ("${AppState.currentMarbete}").</li>
                                </ul>`,
                        showCancelButton: true,
                        confirmButtonText: 'Cambiar y Unir',
                        cancelButtonText: 'Añadir Nueva Fila',
                        reverseButtons: true, // Pone "Cambiar y Unir" a la izquierda
                        denyButtonText: 'Cancelar Escaneo',
                        showDenyButton: true
                    });

                    if (result.isConfirmed) { // Elige "Cambiar y Unir"
                        rowToUpdate = otherMarbeteMatch;
                        rowToUpdate.MARBETE = AppState.currentMarbete; // Sobreescribe el marbete
                        // Si había conteos en PISO/BODEGA para ese SKU con el marbete anterior, se suman aquí.
                        // Esto se manejará en el incremento de abajo.
                        console.log(`handleScan: Usuario optó por CAMBIAR Y UNIR para SKU '${code}'.`);
                        hasUpdatedExistingRow = true;
                    } else if (result.isDenied) { // Elige "Cancelar Escaneo"
                        Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 }).fire({ icon: 'info', title: 'Escaneo cancelado.' });
                        console.log(`handleScan: Usuario CANCELÓ el escaneo para SKU '${code}'.`);
                        return; // Salir de la función
                    } else { // Elige "Añadir Nueva Fila" (result.isDismissed o result.isDenied si no hubiera denyButton)
                        // Crear una nueva fila para este SKU con el marbete actual
                        rowToUpdate = {
                            SKU: normalizedScannedSKU,
                            DESCRIPCION: String(otherMarbeteMatch.DESCRIPCION || "Descripción no disponible"),
                            OH: parseInt(otherMarbeteMatch.OH, 10) || 0,
                            PISO: 0,
                            BODEGA: 0,
                            AJUSTE: 0,
                            MARBETE: AppState.currentMarbete
                        };
                        AppState.inventoryData.push(rowToUpdate);
                        console.log(`handleScan: Usuario optó por AÑADIR NUEVA FILA para SKU '${code}'.`);
                        // hasUpdatedExistingRow permanece false porque se añade una nueva fila
                    }
                } else {
                    // Prioridad 4: El SKU no existe en absoluto. Crear una nueva fila.
                    rowToUpdate = {
                        SKU: normalizedScannedSKU,
                        DESCRIPCION: "Nuevo SKU (añadido por escaneo)",
                        OH: 0, // OH inicial es 0 para un SKU nuevo
                        PISO: 0,
                        BODEGA: 0,
                        AJUSTE: 0,
                        MARBETE: AppState.currentMarbete
                    };
                    AppState.inventoryData.push(rowToUpdate);
                    console.log(`handleScan: SKU '${code}' no encontrado. Se añadió como nuevo SKU.`);
                }
            }
        }

        if (!rowToUpdate || typeof rowToUpdate !== 'object') {
            throw new Error("Error interno: No se pudo obtener o crear una fila válida para el SKU.");
        }

        // --- INCREMENTAR CONTEO ---
        // Normalizar los campos numéricos de la fila antes de operar
        rowToUpdate.PISO = parseInt(rowToUpdate.PISO, 10) || 0;
        rowToUpdate.BODEGA = parseInt(rowToUpdate.BODEGA, 10) || 0;
        rowToUpdate.OH = parseInt(rowToUpdate.OH, 10) || 0;

        if (isPiso) {
            rowToUpdate.PISO += 1;
            console.log(`handleScan: SKU ${code} (Marbete: ${AppState.currentMarbete}): PISO incrementado a ${rowToUpdate.PISO}.`);
        } else {
            rowToUpdate.BODEGA += 1;
            console.log(`handleScan: SKU ${code} (Marbete: ${AppState.currentMarbete}): BODEGA incrementado a ${rowToUpdate.BODEGA}.`);
        }
        rowToUpdate.AJUSTE = rowToUpdate.PISO + rowToUpdate.BODEGA;
        console.log(`handleScan: SKU ${code} (Marbete: ${AppState.currentMarbete}): Nuevo AJUSTE calculado: ${rowToUpdate.AJUSTE}.`);

        // --- VALIDACIÓN DE EXCESO DE INVENTARIO (OPCIONAL) ---
        // Se mantiene la validación de exceso de inventario.
        if (rowToUpdate.OH > 0 && rowToUpdate.AJUSTE > rowToUpdate.OH) {
            console.warn(`handleScan: Exceso de inventario detectado para SKU ${code}. Ajuste: ${rowToUpdate.AJUSTE}, OH: ${rowToUpdate.OH}.`);
            const result = await Swal.fire({
                icon: 'warning',
                title: 'Exceso de Inventario',
                html: `¡Atención! El total de este SKU (${code}) sería <strong>${rowToUpdate.AJUSTE}</strong>, superando el OH original de <strong>${rowToUpdate.OH}</strong>. <br> ¿Deseas continuar añadiéndolo?`,
                showCancelButton: true,
                confirmButtonText: 'Sí, continuar',
                cancelButtonText: 'No, cancelar',
                reverseButtons: true
            });

            if (!result.isConfirmed) {
                // Revertir el incremento si el usuario cancela
                if (isPiso) {
                    rowToUpdate.PISO -= 1;
                } else {
                    rowToUpdate.BODEGA -= 1;
                }
                rowToUpdate.AJUSTE = rowToUpdate.PISO + rowToUpdate.BODEGA;

                // Si la fila fue recién añadida y el usuario cancela el incremento, eliminarla
                if (!hasUpdatedExistingRow && AppState.inventoryData.includes(rowToUpdate)) {
                     const indexToRemove = AppState.inventoryData.indexOf(rowToUpdate);
                     if (indexToRemove > -1) {
                         AppState.inventoryData.splice(indexToRemove, 1);
                         console.warn(`handleScan: Operación cancelada por el usuario. Se eliminó la nueva fila para SKU ${code}.`);
                     }
                }
                Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 }).fire({ icon: 'info', title: 'Operación cancelada.' });
                return;
            }
        }

        Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 }).fire({ icon: 'success', title: `SKU ${code} sumado!` });

        // **PERSISTIR LOS DATOS INMEDIATAMENTE LOCALMENTE Y DISPARAR DEBOUNCED SYNC A LA NUBE**
        await persistInventoryData(false); // No forzar la sincronización de inmediato, el debounce se encarga de la nube
        console.log(`handleScan: Datos registrados LOCALMENTE para SKU ${code}. La sincronización con la nube se disparará en breve.`);

    } catch (error) {
        console.error(`handleScan: Error inesperado al procesar el escaneo del SKU ${code}:`, error);
        Swal.fire("Error Grave", `Ocurrió un problema al procesar el escaneo del SKU ${code}. Por favor, reintenta. Si el problema persiste, contacta a soporte.`, "error");
        // Lógica de reversión si algo salió mal en medio del proceso
        if (!hasUpdatedExistingRow && AppState.inventoryData.includes(rowToUpdate)) { // Si se añadió una fila nueva por error y falló
            const indexToRemove = AppState.inventoryData.indexOf(rowToUpdate);
            if (indexToRemove > -1) {
                AppState.inventoryData.splice(indexToRemove, 1);
                console.warn(`handleScan: Error crítico en escaneo. Se eliminó la fila recién creada para SKU ${code}.`);
            }
        }
    }
}

/**
 * Persiste los datos de inventario en localStorage, IndexedDB y Firestore (si hay conexión).
 * Implementa un debounce para el guardado en la nube.
 * @param {boolean} [forceSync=false] - Si es true, fuerza la sincronización con Firebase ignorando el debounce.
 */
async function persistInventoryData(forceSync = false) {
    console.log(`persistInventoryData: Iniciando persistencia. Forzar sincronización: ${forceSync}.`);
    if (!AppState.selectedFileName) {
        console.log("persistInventoryData: Persistencia evitada: No hay archivo seleccionado.");
        return;
    }

    const currentTimestamp = new Date().getTime();
    const dataToSave = {
        fileName: AppState.selectedFileName,
        data: AppState.inventoryData,
        lastModified: currentTimestamp
    };

    try {
        // 1. Guardar en localStorage (sincrónico, para acceso rápido)
        localStorage.setItem(AppState.selectedFileName, JSON.stringify(dataToSave));
        console.log("persistInventoryData: Datos guardados en localStorage.");

        // 2. Guardar en IndexedDB (asíncrono, persistente offline)
        await saveToDB("inventarios", dataToSave);
        console.log("persistInventoryData: Datos guardados en IndexedDB.");
        AppState.lastSavedLocalTimestamp = currentTimestamp; // Actualiza el timestamp de la última guardada local

        // 3. Sincronizar con Firebase (Firestore y Storage) si hay conexión
        if (AppState.isOnline) {
            clearTimeout(AppState.saveDebounceTimeout); // Limpia cualquier debounce anterior
            if (forceSync) {
                console.log("persistInventoryData: Sincronización con Firebase forzada inmediatamente.");
                await syncToFirebaseWithRetries();
            } else {
                // Retrasa la sincronización a la nube para no saturar con cada escaneo
                AppState.saveDebounceTimeout = setTimeout(async () => {
                    console.log("persistInventoryData: Disparando sincronización con Firebase después de debounce.");
                    try {
                        await syncToFirebaseWithRetries();
                        AppState.offlineQueue = []; // Limpia la cola visual si la sincronización fue exitosa
                        await clearDBStore("offline_queue"); // Limpia la cola real en IndexedDB
                        updateStatusIndicator();
                    } catch (syncError) {
                        console.error("persistInventoryData: Error durante la sincronización debounce:", syncError);
                        // El error ya se maneja en syncToFirebaseWithRetries, solo loguear aquí
                    } finally {
                        AppState.isSaving = false; // Asegurar que el estado de guardado se reinicie
                        updateStatusIndicator();
                    }
                }, 1500); // Sincroniza después de 1.5 segundos de inactividad
                console.log("persistInventoryData: Sincronización con Firebase programada con debounce.");
            }
        } else {
            // Si está offline, añade una entrada a la cola de operaciones pendientes (solo para el contador visual)
            // La data ya está en IndexedDB, esto solo sirve para que el contador de offline sepa que hay trabajo
            await addToDBQueue({ fileName: AppState.selectedFileName, timestamp: new Date() });
            AppState.offlineQueue.push(1); // Incrementa el contador visual
            console.warn("persistInventoryData: Dispositivo sin conexión. Los cambios están guardados localmente y en cola para sincronización futura.");
            updateStatusIndicator(); // Actualiza el indicador de cola
        }
    } catch (error) {
        console.error("persistInventoryData: Error grave al intentar persistir los datos en todos los niveles:", error);
        throw error;
    } finally {
        if (forceSync || !AppState.isOnline) { // Si se forzó o si estamos offline, actualiza el estado inmediatamente
             AppState.isSaving = false;
             updateStatusIndicator();
        }
        console.log("persistInventoryData: Proceso de persistencia local finalizado.");
    }
}

/**
 * Sincroniza los datos con Firebase (Firestore y Storage) con reintentos en caso de fallo.
 * Marca `AppState.isSaving` durante la operación.
 * @param {number} [retries=3] - Número de reintentos.
 */
async function syncToFirebaseWithRetries(retries = 3) {
    console.log(`syncToFirebaseWithRetries: Intentando sincronizar con Firebase. Intentos restantes: ${retries}.`);
    if (AppState.isSaving) {
        console.log("syncToFirebaseWithRetries: Ya hay una operación de guardado en la nube en curso. Abortando reintento.");
        return; // No intentar sincronizar si ya estamos haciéndolo
    }

    AppState.isSaving = true;
    updateStatusIndicator();

    try {
        // Prepara los datos para subir a Firestore
        const finalArr = AppState.inventoryData.map(row => ({
            SKU: String(row.SKU || '').trim(),
            DESCRIPCION: String(row.DESCRIPCION || "Sin Descripción"),
            OH: parseInt(row.OH, 10) || 0,
            PISO: parseInt(row.PISO, 10) || 0,
            BODEGA: parseInt(row.BODEGA, 10) || 0,
            AJUSTE: parseInt(row.AJUSTE, 10) || 0,
            MARBETE: String(row.MARBETE || '').trim()
        }));
        console.log(`syncToFirebaseWithRetries: Datos para subir a Firestore (primera fila):`, finalArr.length > 0 ? finalArr[0] : 'N/A');

        // 1. Actualizar el documento en Firestore (principal fuente de verdad)
        const docRef = db.collection("inventarios").doc(AppState.selectedFileName);
        await docRef.set({
            data: finalArr,
            lastModified: firebase.firestore.FieldValue.serverTimestamp() // Usa timestamp del servidor
        }, { merge: true }); // Usar merge para no sobrescribir otros campos si existen
        console.log(`syncToFirebaseWithRetries: Documento '${AppState.selectedFileName}' actualizado en Firestore.`);

        // 2. Opcional: Actualizar el archivo Excel en Firebase Storage
        // Esto podría hacerse con menos frecuencia si no se requiere una actualización inmediata del Excel descargable.
        // Por ahora, lo mantenemos aquí, pero se beneficiaría de un debounce o un trigger diferente.
        const newWb = XLSX.utils.book_new();
        // Genera el encabezado de la hoja basado en las claves de la primera fila, o un conjunto predefinido si no hay datos
        const headers = finalArr.length > 0 ? Object.keys(finalArr[0]) : ["SKU", "DESCRIPCION", "OH", "PISO", "BODEGA", "AJUSTE", "MARBETE"];
        const newSheet = XLSX.utils.json_to_sheet(finalArr, { header: headers });
        XLSX.utils.book_append_sheet(newWb, newSheet, "Inventarios");
        const wbOut = XLSX.write(newWb, { bookType: "xlsx", type: "array" });

        const fileRef = storage.ref(`uploads/${AppState.selectedFileName}`);
        const meta = await fileRef.getMetadata().catch((e) => {
            console.warn(`syncToFirebaseWithRetries: No se pudieron obtener metadatos existentes para ${AppState.selectedFileName}. Se usará un objeto vacío.`, e);
            return { customMetadata: {} };
        });
        await fileRef.put(new Blob([wbOut]), { customMetadata: meta.customMetadata });
        console.log(`syncToFirebaseWithRetries: Archivo Excel '${AppState.selectedFileName}' actualizado en Storage.`);

        AppState.isSaving = false;
        updateStatusIndicator();
        console.log("syncToFirebaseWithRetries: Sincronización exitosa con Firebase.");

    } catch (error) {
        console.error("syncToFirebaseWithRetries: Error al sincronizar con Firebase:", error);
        if (retries > 1) {
            console.log(`syncToFirebaseWithRetries: Reintentando sincronización con Firebase... (intentos restantes: ${retries - 1})`);
            await new Promise(res => setTimeout(res, 2000));
            await syncToFirebaseWithRetries(retries - 1);
        } else {
            console.error("syncToFirebaseWithRetries: Número máximo de reintentos alcanzado. Fallo la sincronización con Firebase.");
            AppState.isSaving = false; // Asegurar que el estado de guardado se reinicie
            updateStatusIndicator(); // Actualiza el estado a "cambios pendientes"
            throw error; // Lanza el error para que persistInventoryData lo maneje si es necesario
        }
    }
}

/**
 * Descarga el archivo Excel seleccionado desde Firebase Storage.
 * Asegura que se descargue la última versión guardada.
 */
function downloadFile() {
    console.log("downloadFile: Iniciando descarga del archivo.");
    if (!AppState.selectedFileName) {
        Swal.fire("Error", "No hay un archivo de inventario seleccionado para descargar.", "error");
        console.warn("downloadFile: No hay archivo seleccionado para descargar.");
        return;
    }
    Swal.fire({
        title: 'Preparando descarga...',
        text: 'Asegurando la versión más reciente...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    // Forzar una sincronización final antes de descargar para asegurar los últimos cambios
    persistInventoryData(true)
    .then(() => {
        return storage.ref(`uploads/${AppState.selectedFileName}`).getDownloadURL();
    })
    .then(url => {
        Swal.close();
        const a = document.createElement("a");
        a.href = url;
        a.download = AppState.selectedFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        Swal.fire("¡Descarga Exitosa!", `"${AppState.selectedFileName}" se ha descargado.`, "success", { timer: 2000 });
        console.log(`downloadFile: Archivo '${AppState.selectedFileName}' descargado exitosamente.`);
    })
    .catch(error => {
        Swal.close();
        console.error("downloadFile: Error al obtener URL de descarga o al sincronizar:", error);
        Swal.fire("Error", "No se pudo descargar el archivo. Asegúrate de que el archivo exista y los datos estén sincronizados.", "error");
    });
}


// ========== FUNCIONALIDAD DE MODALES ==========

/**
 * Muestra el modal con la tabla de datos del inventario actual.
 * Permite buscar SKUs o descripciones y eliminar filas.
 */
function viewSheet() {
    console.log("viewSheet: Abriendo modal de vista de hoja.");
    if (!AppState.inventoryData || AppState.inventoryData.length === 0) {
        Swal.fire({ icon: 'info', title: 'No hay datos que mostrar', text: 'Por favor, selecciona y carga un archivo de inventario en el Paso 1 para poder ver la tabla.', confirmButtonText: 'Entendido' });
        console.warn("viewSheet: No hay datos en AppState.inventoryData para mostrar.");
        return;
    }

    const tableBody = document.getElementById("viewSheetTableBody");
    const searchInput = document.getElementById("tableSearchInput");

    // Crear una copia profunda para que los cambios de filtro no afecten AppState.inventoryData directamente
    const currentData = JSON.parse(JSON.stringify(AppState.inventoryData));
    console.log(`viewSheet: Total de filas en AppState.inventoryData: ${currentData.length}.`);

    const renderTable = (data) => {
        if (data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay resultados que coincidan con la búsqueda.</td></tr>';
            console.log("viewSheet: Tabla vacía, no hay resultados para mostrar.");
            return;
        }
        tableBody.innerHTML = data.map((row, index) =>
            `<tr>
                <td>${String(row.SKU || '')}</td>
                <td>${String(row.DESCRIPCION || '')}</td>
                <td>${parseInt(row.OH, 10) || 0}</td>
                <td>${parseInt(row.PISO, 10) || 0}</td>
                <td>${parseInt(row.BODEGA, 10) || 0}</td>
                <td>${parseInt(row.AJUSTE, 10) || 0}</td>
                <td>${String(row.MARBETE || '')}</td>
                <td>
                    <button class="btn btn-danger btn-sm delete-row-btn" data-sku="${String(row.SKU || '')}" data-marbete="${String(row.MARBETE || '')}" data-original-index="${AppState.inventoryData.findIndex(item => item.SKU === row.SKU && item.MARBETE === row.MARBETE)}">
                        <i class="bi bi-x-circle"></i> Eliminar
                    </button>
                </td>
            </tr>`
        ).join('');

        // Añadir listeners a los botones de eliminar
        tableBody.querySelectorAll(".delete-row-btn").forEach(button => {
            button.addEventListener("click", async (event) => {
                const skuToDelete = event.currentTarget.dataset.sku;
                const marbeteToDelete = event.currentTarget.dataset.marbete;
                const originalIndex = parseInt(event.currentTarget.dataset.originalIndex, 10);

                await handleDeleteRow(skuToDelete, marbeteToDelete, originalIndex);
                // Una vez eliminada, re-renderizar la tabla para reflejar los cambios
                const query = searchInput.value.trim().toLowerCase();
                const filteredData = query
                    ? AppState.inventoryData.filter(row =>
                        String(row.SKU || '').toLowerCase().includes(query) ||
                        String(row.DESCRIPCION || '').toLowerCase().includes(query)
                      )
                    : AppState.inventoryData;
                renderTable(filteredData); // Re-renderiza con los datos actualizados de AppState
            });
        });

        console.log(`viewSheet: Tabla renderizada con ${data.length} filas.`);
    };

    renderTable(currentData);
    searchInput.value = "";

    searchInput.onkeyup = () => {
        const query = searchInput.value.trim().toLowerCase();
        // Filtrar AppState.inventoryData directamente para que la eliminación afecte los datos subyacentes
        const filteredData = query
            ? AppState.inventoryData.filter(row =>
                String(row.SKU || '').toLowerCase().includes(query) ||
                String(row.DESCRIPCION || '').toLowerCase().includes(query)
              )
            : AppState.inventoryData;
        console.log(`viewSheet: Filtrando tabla por '${query}'. Resultados: ${filteredData.length} filas.`);
        renderTable(filteredData);
    };

    AppState.viewSheetModal.show();
}

/**
 * Maneja la eliminación de una fila del inventario desde el modal de vista de hoja.
 * @param {string} sku - El SKU de la fila a eliminar.
 * @param {string} marbete - El marbete de la fila a eliminar (para casos de SKUs duplicados con diferente marbete).
 * @param {number} originalIndex - El índice original de la fila en AppState.inventoryData.
 */
async function handleDeleteRow(sku, marbete, originalIndex) {
    console.log(`handleDeleteRow: Intentando eliminar SKU: '${sku}', Marbete: '${marbete}', Índice Original: ${originalIndex}`);

    const result = await Swal.fire({
        title: '¿Estás seguro?',
        html: `Estás a punto de eliminar el registro de SKU: <strong>${sku}</strong> con Marbete: <strong>${marbete}</strong>. <br> ¡Esta acción no se puede deshacer!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        // Asegúrate de encontrar el índice correcto, especialmente si la tabla fue filtrada
        // o si los elementos fueron reordenados. Buscar por SKU y MARBETE es más robusto.
        const indexToDelete = AppState.inventoryData.findIndex(item =>
            String(item.SKU || '').trim() === sku &&
            String(item.MARBETE || '').trim() === marbete
        );

        if (indexToDelete > -1) {
            AppState.inventoryData.splice(indexToDelete, 1);
            await persistInventoryData(true); // Persistir inmediatamente los cambios a la nube
            Swal.fire(
                '¡Eliminado!',
                `El registro de SKU: ${sku} (Marbete: ${marbete}) ha sido eliminado.`,
                'success'
            );
            console.log(`handleDeleteRow: Fila eliminada: SKU '${sku}', Marbete '${marbete}'. Nuevo tamaño de inventario: ${AppState.inventoryData.length}.`);

            // Si el modal de edición manual está abierto y muestra el mismo marbete, refrescarlo
            const manualMarbeteSearch = document.getElementById("manualMarbeteSearch");
            if (AppState.manualEditModal._isShown && manualMarbeteSearch.value.trim() === marbete) {
                searchMarbete();
            }

        } else {
            Swal.fire('Error', 'No se encontró el registro para eliminar. Es posible que ya haya sido eliminado o los datos estén desactualizados.', 'error');
            console.warn(`handleDeleteRow: No se encontró la fila con SKU '${sku}' y Marbete '${marbete}' para eliminar.`);
        }
    } else {
        console.log("handleDeleteRow: Eliminación cancelada por el usuario.");
    }
}


/**
 * Busca registros en el inventario por marbete y los muestra en la tabla de edición manual.
 */
function searchMarbete() {
    console.log("searchMarbete: Buscando marbete para edición manual.");
    const searchValue = document.getElementById("manualMarbeteSearch").value.trim();
    const resultsDiv = document.getElementById("manualEditResults");
    const saveBtn = document.getElementById("saveManualBtn");

    if (!searchValue) {
        resultsDiv.innerHTML = "<p class='text-center text-muted'>Ingresa un marbete para buscar y editar sus registros.</p>";
        saveBtn.style.display = 'none';
        console.warn("searchMarbete: Búsqueda de marbete vacía.");
        return;
    }

    const filteredRecords = AppState.inventoryData
        .map((row, index) => ({ ...row, _originalIndex: index }))
        .filter(row => String(row.MARBETE || '').trim() === searchValue);

    console.log(`searchMarbete: Marbete buscado: '${searchValue}'. Registros encontrados: ${filteredRecords.length}.`);
    renderManualEditTable(filteredRecords);
}

/**
 * Renderiza la tabla para la edición manual de registros.
 * @param {Array<Object>} records - Los registros de inventario a mostrar.
 */
function renderManualEditTable(records) {
    console.log(`renderManualEditTable: Renderizando tabla con ${records.length} registros para edición.`);
    const resultsDiv = document.getElementById("manualEditResults");
    const saveBtn = document.getElementById("saveManualBtn");

    if (records.length === 0) {
        resultsDiv.innerHTML = "<p class='text-center text-muted'>No se encontraron registros con ese marbete.</p>";
        saveBtn.style.display = 'none';
        return;
    }

    let table = `<table class="table table-sm table-bordered table-hover manual-edit-table">
                    <thead>
                        <tr>
                            <th>SKU</th>
                            <th>Descripción</th>
                            <th>OH</th>
                            <th>PISO</th>
                            <th>BODEGA</th>
                            <th>AJUSTE</th>
                        </tr>
                    </thead>
                    <tbody>`;
    records.forEach(rec => {
        table += `<tr>
                    <td>${String(rec.SKU || '')}</td>
                    <td>${String(rec.DESCRIPCION || '')}</td>
                    <td>${parseInt(rec.OH, 10) || 0}</td>
                    <td><input type="number" class="form-control form-control-sm" data-original-index="${rec._originalIndex}" data-field="PISO" value="${parseInt(rec.PISO, 10) || 0}"></td>
                    <td><input type="number" class="form-control form-control-sm" data-original-index="${rec._originalIndex}" data-field="BODEGA" value="${parseInt(rec.BODEGA, 10) || 0}"></td>
                    <td class="ajuste-cell">${parseInt(rec.AJUSTE, 10) || 0}</td>
                  </tr>`;
    });
    table += '</tbody></table>';
    resultsDiv.innerHTML = table;
    saveBtn.style.display = 'block';

    resultsDiv.querySelectorAll("input[type='number']").forEach(input => {
        input.addEventListener('input', (event) => {
            const currentInput = event.target;
            const originalIdx = parseInt(currentInput.dataset.originalIndex, 10);
            const field = currentInput.dataset.field;
            const currentRow = AppState.inventoryData[originalIdx];

            currentRow[field] = parseInt(currentInput.value, 10) || 0;
            currentRow.AJUSTE = (currentRow.PISO || 0) + (currentRow.BODEGA || 0);

            const ajusteCell = currentInput.closest('tr').querySelector('.ajuste-cell');
            if (ajusteCell) {
                ajusteCell.textContent = currentRow.AJUSTE;
            }
            console.log(`renderManualEditTable: Edición manual en SKU ${currentRow.SKU}, campo ${field} a ${currentInput.value}. Ajuste calculado: ${currentRow.AJUSTE}.`);
        });
    });
}

/**
 * Guarda los cambios realizados en la tabla de edición manual.
 * Los cambios ya están en AppState.inventoryData, solo se necesita persistirlos.
 */
async function saveManualEdits() {
    console.log("saveManualEdits: Guardando ediciones manuales.");
    try {
        await persistInventoryData(true); // Persiste los datos (forzando sincronización)
        Swal.fire("Guardado", "Los cambios manuales han sido guardados exitosamente.", "success");
        searchMarbete();
        console.log("saveManualEdits: Ediciones manuales guardadas y tabla refrescada.");
    } catch (error) {
        console.error("saveManualEdits: Error al guardar ediciones manuales:", error);
        Swal.fire("Error", "No se pudieron guardar las ediciones manuales. Por favor, reintenta.", "error");
    }
}


// ========== HELPERS DE INDEXEDDB ==========

/**
 * Guarda datos en una Object Store específica de IndexedDB.
 * @param {string} storeName - El nombre de la Object Store (ej. "inventarios", "offline_queue").
 * @param {Object} data - El objeto de datos a guardar. Debe tener una keyPath si la store la tiene.
 * @returns {Promise<void>} Una promesa que se resuelve cuando los datos son guardados.
 */
function saveToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        if (!AppState.idb) return reject("IndexedDB no está inicializada.");
        const transaction = AppState.idb.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => {
            // console.log(`IndexedDB: Datos guardados en '${storeName}' (clave: ${data.fileName || 'autoincrement'}).`); // Comentado para reducir logs en escaneos masivos
            resolve();
        };
        request.onerror = (event) => {
            console.error(`IndexedDB: Error al guardar en '${storeName}':`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Obtiene datos de una Object Store específica de IndexedDB por su clave.
 * @param {string} storeName - El nombre de la Object Store.
 * @param {IDBValidKey} key - La clave del objeto a recuperar.
 * @returns {Promise<Object|undefined>} Una promesa que se resuelve con el objeto recuperado o `undefined`.
 */
function getFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!AppState.idb) return reject("IndexedDB no está inicializada.");
        const transaction = AppState.idb.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => {
            // console.log(`IndexedDB: Datos obtenidos de '${storeName}' (clave: ${key}). Resultado: ${request.result ? 'encontrado' : 'no encontrado'}.`); // Comentado para reducir logs
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error(`IndexedDB: Error al obtener de '${storeName}':`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Añade una operación a la cola de sincronización offline en IndexedDB.
 * @param {Object} data - Los datos de la operación pendiente.
 * @returns {Promise<void>} Una promesa que se resuelve cuando la operación es añadida a la cola.
 */
function addToDBQueue(data) {
    return saveToDB("offline_queue", data);
}

/**
 * Borra todos los objetos de una Object Store específica de IndexedDB.
 * @param {string} storeName - El nombre de la Object Store a limpiar.
 * @returns {Promise<void>} Una promesa que se resuelve cuando la store es limpiada.
 */
function clearDBStore(storeName) {
    return new Promise((resolve, reject) => {
        if (!AppState.idb) return reject("IndexedDB no está inicializada.");
        const transaction = AppState.idb.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => {
            console.log(`IndexedDB: Object store '${storeName}' limpiada.`);
            resolve();
        };
        request.onerror = (event) => {
            console.error(`IndexedDB: Error al limpiar '${storeName}':`, event.target.error);
            reject(event.target.error);
        };
    });
}