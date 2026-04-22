/***************************************************
 * CONFIGURACIÓN DE FIREBASE
 ***************************************************/
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


/***************************************************
 * CONSTANTES Y REFERENCIAS (Elementos del DOM)
 ***************************************************/
const MASTER_FILES_PATH = 'Entregas/ArchivosMaestros/';
const bodegaInput = document.getElementById('bodegaInput');
const containerInput = document.getElementById('containerInput');
const jefeInfoBox = document.getElementById('jefeInfoBox');
const progressBtn = document.getElementById('progressBtn');
const summaryBtn = document.getElementById('summaryBtn');
const logArea = document.getElementById('logArea');
const appContainer = document.getElementById('app-container');
const errorContainer = document.getElementById('error-container');
const logoutBtn = document.getElementById('logoutBtn');
const userEmailSpan = document.getElementById('userEmail');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');

// Modales y otros elementos de la UI
const progressModal = document.getElementById('progressModal');
const summaryModal = document.getElementById('summaryModal');
const fileSelectModal = document.getElementById('fileSelectModal');
const closeModalBtns = document.querySelectorAll('.close-button');
const fileListUl = document.getElementById('fileList');
const summaryFileListUl = document.getElementById('summaryFileList');
const jefeFilter = document.getElementById('jefeFilter');
const seccionFilter = document.getElementById('seccionFilter');
const dashboardContent = document.getElementById('dashboardContent');
const summaryGlobalStats = document.getElementById('summaryGlobalStats');
const summaryModalTitle = document.getElementById('summaryModalTitle');


/***************************************************
 * VARIABLES GLOBALES
 ***************************************************/
let currentUser = null;
let bodegaRelations = [];
let containerFiles = [];
let dashboardData = new Map();

/***************************************************
 * LÓGICA DE AUTENTICACIÓN Y ARRANQUE
 ***************************************************/
auth.onAuthStateChanged(async(user) => {
    if (user) {
        currentUser = user;
        appContainer.style.display = 'flex';
        errorContainer.style.display = 'none';
        if (userEmailSpan) userEmailSpan.textContent = `Usuario: ${currentUser.email}`;
        await initializeAppData();
    } else {
        currentUser = null;
        appContainer.style.display = 'none';
        errorContainer.style.display = 'block';
        if (userEmailSpan) userEmailSpan.textContent = `Usuario: No Autenticado`;
    }
});

logoutBtn.addEventListener('click', async() => {
    try {
        await auth.signOut();
        window.location.href = '../Login/login.html';
    } catch (error) {
        console.error("Error al cerrar sesión:", error);
        Swal.fire({ icon: 'error', title: 'Error al cerrar sesión', text: 'Hubo un problema al cerrar tu sesión.' });
    }
});


/***************************************************
 * LÓGICA DE LA APLICACIÓN PRINCIPAL
 ***************************************************/
const BODEGAS_RELACION_PATH = 'BodegasRelacion/RelacionBodegas.xlsx';
const BODEGAS_SHEET_NAME = 'Bodegas';

// REAJUSTADO: El flujo de inicialización asegura que se comience por la bodega.
async function initializeAppData() {
    logToScreen("Inicializando sistema...");
    try {
        await Promise.all([
            loadValidBodegas(),
            listContainerFiles()
        ]);

        bodegaInput.disabled = false;
        containerInput.disabled = true; // El contenedor siempre empieza deshabilitado
        progressBtn.disabled = false;
        summaryBtn.disabled = false;
        bodegaInput.focus();
        logToScreen("Sistema listo. Ingrese el ID de la bodega.");

    } catch (error) {
        console.error("Error de inicialización:", error);
        logToScreen(`🔥 ERROR FATAL: ${error.message}. La aplicación no puede continuar.`);
        bodegaInput.disabled = true;
        containerInput.disabled = true;
        progressBtn.disabled = true;
        summaryBtn.disabled = true;
    }
}
/***************************************************
 * LÓGICA PARA SUBIR ARCHIVOS MAESTROS
 ***************************************************/

// Función para manejar la lógica de subida para uno o más archivos
const handleFiles = (files) => {
    // Convierte el FileList a un array para poder iterar sobre él
    const filesArray = Array.from(files);

    if (filesArray.length === 0) {
        return; // No hacer nada si no hay archivos
    }

    logToScreen(`Iniciando subida de ${filesArray.length} archivo(s)...`);

    // Muestra una notificación de carga
    Swal.fire({
        title: 'Subiendo Archivos...',
        text: 'Por favor, espera.',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    const uploadPromises = filesArray.map(file => {
        // Define la ruta en Firebase Storage donde se guardará el archivo
        const storageRef = storage.ref(`${MASTER_FILES_PATH}${file.name}`);
        
        // Sube el archivo
        return storageRef.put(file)
            .then(() => {
                logToScreen(`✅ Archivo "${file.name}" subido con éxito.`);
            })
            .catch(error => {
                logToScreen(`🔥 Error al subir "${file.name}": ${error.message}`);
                console.error(`Error en la subida de ${file.name}:`, error);
                // Retornamos el error para manejarlo después
                return Promise.reject(error);
            });
    });

    // Espera a que todas las promesas de subida se completen
    Promise.allSettled(uploadPromises)
        .then(async (results) => {
            const successfulUploads = results.filter(r => r.status === 'fulfilled').length;
            const failedUploads = results.length - successfulUploads;

            // Refresca la lista de archivos en la aplicación para incluir los nuevos
            await listContainerFiles();
            
            Swal.close();

            if (failedUploads > 0) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Subida Parcial',
                    text: `${successfulUploads} archivo(s) subidos con éxito, pero ${failedUploads} fallaron.`
                });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: '¡Subida Completa!',
                    text: `Se subieron ${successfulUploads} archivo(s) correctamente.`
                });
            }
        });
};

// Evento para cuando se hace clic y se selecciona un archivo
fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

// Eventos para arrastrar y soltar (drag and drop)
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault(); // Previene el comportamiento por defecto del navegador
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); // Previene que el navegador abra el archivo
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});

// Permite hacer clic en el drop-zone para abrir el selector de archivos
dropZone.addEventListener('click', () => {
    fileInput.click();
});
async function loadValidBodegas() {
    try {
        const url = await storage.ref(BODEGAS_RELACION_PATH).getDownloadURL();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`No se pudo descargar el archivo de bodegas (status: ${response.status}).`);
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[BODEGAS_SHEET_NAME];
        if (!worksheet) throw new Error(`La hoja "${BODEGAS_SHEET_NAME}" no fue encontrada.`);
        const relations = XLSX.utils.sheet_to_json(worksheet);
        bodegaRelations = relations.map(row => ({
            Bodega: String(row['Bodega']).trim().toUpperCase(),
            Jefatura: String(row['Jefatura']).trim(),
            Seccion: String(row['Seccion']).trim()
        })).filter(r => r.Bodega && r.Jefatura && r.Seccion);
        if (bodegaRelations.length === 0) throw new Error("No se encontraron relaciones válidas.");
        logToScreen(`✔️ ${bodegaRelations.length} relaciones Bodega-Jefe-Sección cargadas.`);
    } catch (error) {
        console.error("Error cargando relaciones de bodegas:", error);
        throw new Error(`No se pudieron cargar las relaciones de bodegas: ${error.message}`);
    }
}

async function listContainerFiles() {
    try {
        const listResult = await storage.ref(MASTER_FILES_PATH).listAll();
        containerFiles = listResult.items;
        if (containerFiles.length === 0) {
            logToScreen("⚠️ ADVERTENCIA: No hay archivos maestros. Arrastra uno para empezar.");
        } else {
            logToScreen(`✔️ ${containerFiles.length} archivo(s) maestro(s) encontrado(s).`);
        }
    } catch (error) {
        console.error("Error listando archivos maestros:", error);
        throw new Error(`No se pudo acceder a los archivos maestros: ${error.message}`);
    }
}

// REAJUSTADO: Este listener es ahora el primer paso obligatorio del usuario.
bodegaInput.addEventListener('change', () => {
    const bodegaId = bodegaInput.value.trim().toUpperCase();
    containerInput.disabled = true; // Deshabilita por defecto al cambiar
    jefeInfoBox.style.display = 'none';

    if (bodegaId.length === 0) {
        logToScreen("Ingrese un ID de bodega.");
        return;
    }

    const relationsForBodega = bodegaRelations.filter(r => r.Bodega === bodegaId);

    if (relationsForBodega.length > 0) {
        const potentialJefes = [...new Set(relationsForBodega.map(r => r.Jefatura))];
        jefeInfoBox.innerHTML = `<i class="bi bi-info-circle-fill me-1"></i>Esta bodega pertenece a: <strong>${potentialJefes.join(', ')}</strong>`;
        jefeInfoBox.style.display = 'block';
        logToScreen(`Bodega ${bodegaId} válida. Escanee el contenedor.`);
        containerInput.disabled = false; // Habilita el siguiente paso
        containerInput.focus();
    } else {
        logToScreen(`❌ ERROR: Bodega "${bodegaId}" no es válida.`);
        Swal.fire({
            icon: 'error',
            title: 'Bodega Inválida',
            text: `El ID de bodega "${bodegaId}" no está registrado.`
        });
        bodegaInput.select();
    }
});

// NUEVO: Disparador automático para la bodega al llegar a 7 dígitos.
bodegaInput.addEventListener('input', () => {
    // Si la longitud del valor (sin espacios) es exactamente 7...
    if (bodegaInput.value.trim().length === 7) {
        // ...simulamos el evento "change" (como si se presionara Enter)
        // para ejecutar la validación y mover el foco al siguiente campo.
        bodegaInput.dispatchEvent(new Event('change'));
    }
});


// Este listener dispara la validación final.
containerInput.addEventListener('input', () => {
    if (containerInput.value.trim().length >= 9 && !containerInput.disabled) {
        handleRegisterDelivery();
    }
});

// REAJUSTADO: Lógica principal con el flujo Bodega -> Contenedor -> Validación.
async function handleRegisterDelivery() {
    const bodegaId = bodegaInput.value.trim().toUpperCase();
    const containerId = containerInput.value.trim().toUpperCase();

    if (!currentUser || bodegaId.length === 0 || containerId.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Datos Incompletos', text: 'Asegúrese de ingresar la bodega y el contenedor.' });
        return;
    }

    containerInput.disabled = true;

    try {
        // 1. Verifica si el contenedor ya está entregado
        const q = db.collection("entregasContenedores").where("contenedor", "==", containerId).limit(1);
        const querySnapshot = await q.get();
        if (!querySnapshot.empty) {
            const docData = querySnapshot.docs[0].data();
            const deliveryDate = docData.fechaHora.toDate();
            Swal.fire({ /* ... código de alerta "Ya Registrado" ... */ });
            return;
        }

        // 2. Encuentra la sección del contenedor
        logToScreen(`🔎 Buscando ${containerId}...`);
        const result = await findContainerInFiles(containerId);
        if (!result) {
            Swal.fire({ icon: 'error', title: 'Contenedor No Encontrado', text: `El contenedor "${containerId}" no se encontró.` });
            return;
        }
        const seccionContenedor = String(result.row['SECCION'] || '').trim();
        if (!seccionContenedor) {
            Swal.fire({ icon: 'error', title: 'Sección Faltante', text: `El contenedor "${containerId}" no tiene una sección válida.` });
            return;
        }
        logToScreen(`Contenedor ${containerId} pertenece a la sección: ${seccionContenedor}`);

        // 3. LÓGICA DE VALIDACIÓN CENTRAL (LA RELACIÓN)
        logToScreen(`Validando si Bodega "${bodegaId}" es compatible con Sección "${seccionContenedor}"...`);
        const finalRelation = bodegaRelations.find(r => r.Bodega === bodegaId && r.Seccion === seccionContenedor);

        if (!finalRelation) {
            logToScreen(`❌ ERROR DE VALIDACIÓN: La Sección "${seccionContenedor}" no corresponde a la Bodega "${bodegaId}".`);
            const validBodegasForSection = bodegaRelations.filter(r => r.Seccion === seccionContenedor).map(r => r.Bodega);
            const errorText = validBodegasForSection.length > 0 ?
                `Bodegas válidas para esta sección: ${[...new Set(validBodegasForSection)].join(', ')}.` :
                'Además, esta sección no tiene bodegas válidas asociadas.';
            Swal.fire({ icon: 'error', title: 'Entrega Incorrecta', html: `La sección <strong>"${seccionContenedor}"</strong> del contenedor no es válida para la bodega <strong>"${bodegaId}"</strong>.<br><br>${errorText}` });
            return;
        }

        // 4. Procede con el registro
        const jefeFinal = finalRelation.Jefatura;
        const fechaHoraEntrega = new Date();
        logToScreen(`✔️ Validación exitosa. Jefe asignado: ${jefeFinal}. Registrando...`);

        await db.collection("entregasContenedores").add({
            contenedor: String(result.row['CONTENEDOR']).toUpperCase(),
            tarima: result.row['TARIMA'] || '',
            manifiesto: result.row['MANIFIESTO'] || '',
            seccion: seccionContenedor,
            bodega: bodegaId,
            jefe: jefeFinal,
            usuario: currentUser.email,
            fechaHora: firebase.firestore.Timestamp.fromDate(fechaHoraEntrega),
            archivoOrigen: result.archivo
        });
        logToScreen(`✅ Registrado: ${containerId} -> ${bodegaId}`);

        // 5. Actualiza el archivo maestro
        logToScreen(`🔄 Actualizando archivo: ${result.archivo}...`);
        const actualizado = await actualizarArchivoMaestro(result.row, result.archivo, bodegaId, currentUser.email, fechaHoraEntrega);
        if (actualizado) {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '¡Entrega registrada!', showConfirmButton: false, timer: 2000, timerProgressBar: true });
        } else {
            Swal.fire({ icon: 'warning', title: 'Advertencia', text: 'El contenedor se registró, pero no se pudo actualizar el archivo maestro.' });
        }

    } catch (error) {
        logToScreen("🔥 ERROR: Problema inesperado durante el registro.");
        console.error("Error en handleRegisterDelivery:", error);
        Swal.fire({ icon: 'error', title: 'Error de Registro', text: `Ocurrió un error: ${error.message}` });
    } finally {
        containerInput.value = '';
        containerInput.disabled = false;
        containerInput.focus();
    }
}

/***************************************************
 * FUNCIONES AUXILIARES Y DE UI (SIN CAMBIOS)
 ***************************************************/

async function findContainerInFiles(containerId) {
    for (const fileRef of containerFiles) {
        try {
            const url = await fileRef.getDownloadURL();
            const response = await fetch(url);
            const data = await response.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            for (const row of jsonData) {
                if (row['CONTENEDOR'] && String(row['CONTENEDOR']).toUpperCase() === containerId) {
                    return { row: row, archivo: fileRef.name };
                }
            }
        } catch (error) {
            console.warn(`No se pudo procesar ${fileRef.name}.`, error);
        }
    }
    return null;
}

async function actualizarArchivoMaestro(deliveredRow, fileName, bodegaId, responsableEmail, fechaHora) {
    const fileRef = storage.ref(`${MASTER_FILES_PATH}${fileName}`);
    try {
        const url = await fileRef.getDownloadURL();
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        let jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const containerIdToUpdate = String(deliveredRow['CONTENEDOR']).toUpperCase();
        let updated = false;

        jsonData = jsonData.map(row => {
            if (String(row['CONTENEDOR'] || '').toUpperCase() === containerIdToUpdate) {
                row['Estatus'] = 'ENTREGADO';
                row['Bodega_Entrega'] = bodegaId;
                row['Responsable_Entrega'] = responsableEmail;
                row['Fecha_Hora_Entrega'] = fechaHora.toLocaleString('es-MX');
                updated = true;
            }
            return row;
        });

        if (!updated) return false;

        const newWorksheet = XLSX.utils.json_to_sheet(jsonData);
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Hoja1');
        const newExcelBuffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'array' });
        await fileRef.put(new Blob([newExcelBuffer]));
        return true;
    } catch (error) {
        console.error("Error al actualizar archivo maestro:", error);
        return false;
    }
}


function resetInputs(clearBodega = true) {
    if (clearBodega) {
        bodegaInput.value = '';
        jefeInfoBox.style.display = 'none';
    }
    containerInput.value = '';
    containerInput.disabled = !clearBodega;
    if (clearBodega) bodegaInput.focus();
    else containerInput.focus();
}

const greenFill = { fgColor: { rgb: "C6EFCE" } }; // Verde para entregado
const redFill = { fgColor: { rgb: "FFC7CE" } };   // Rojo para pendiente

function applyRowStyles(worksheet, jsonData) {
    const headers = Object.keys(jsonData[0] || {}); // Obtiene encabezados de forma segura
    jsonData.forEach((row, rowIndex) => {
        if (row.hasOwnProperty('Estatus')) {
            const style = row['Estatus'] === 'ENTREGADO' ? { fill: greenFill } : { fill: redFill };
            headers.forEach((_, colIndex) => {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex }); // +1 para índice 0 a 1 en Excel
                if (worksheet[cellAddress]) {
                    if (!worksheet[cellAddress].s) worksheet[cellAddress].s = {}; // Asegura que el objeto de estilo exista
                    Object.assign(worksheet[cellAddress].s, style); // Aplica estilo de relleno
                }
            });
        }
    });
}

async function handleDeleteFile(fileName) {
    const result = await Swal.fire({
        title: `¿Eliminar "${fileName}"?`,
        text: "Esta acción es irreversible y borrará el archivo y todos sus registros de entregas en la base de datos.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, ¡eliminar!',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    logToScreen(`Eliminando ${fileName}...`);
    try {
        await deletePreviousEntriesForFile(fileName); // Elimina primero las entradas relacionadas de la base de datos
        await storage.ref(`${MASTER_FILES_PATH}${fileName}`).delete(); // Luego elimina el archivo
        Swal.fire('¡Eliminado!', `El archivo ${fileName} ha sido eliminado.`, 'success');
        await listContainerFiles(); // Refresca la lista de archivos
        populateProgressModal(); // Actualiza el modal de progreso
    } catch (error) {
        Swal.fire('Error', `No se pudo eliminar ${fileName}. Error: ${error.message}`, 'error');
        console.error("Error de eliminación:", error);
        logToScreen(`ERROR al eliminar ${fileName}: ${error.message}`);
    }
}

function populateProgressModal() {
    if (!fileListUl) {
        console.error("fileListUl no encontrado.");
        return;
    }
    fileListUl.innerHTML = ''; // Limpia la lista anterior
    if (containerFiles.length === 0) {
        fileListUl.innerHTML = '<li class="list-group-item text-center text-muted py-3">No hay archivos maestros cargados.</li>';
    } else {
        containerFiles.forEach(fileRef => {
            const li = document.createElement('li');
            li.className = 'list-group-item file-list-item d-flex justify-content-between align-items-center';

            const span = document.createElement('span');
            span.className = 'file-name flex-grow-1';
            span.textContent = fileRef.name;
            span.onclick = async () => {
                logToScreen(`Preparando descarga de ${fileRef.name}...`);
                try {
                    const url = await fileRef.getDownloadURL();
                    const response = await fetch(url);
                    const data = await response.arrayBuffer();
                    const workbook = XLSX.read(data, { type: 'array' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

                    let jsonData = XLSX.utils.sheet_to_json(worksheet);

                    // Agrega la columna Jefe_Responsable basada en Bodega_Entrega y SECCION
                    jsonData = jsonData.map(row => {
                        const bodegaEntrega = String(row['Bodega_Entrega'] || '').trim().toUpperCase();
                        const seccion = String(row['SECCION'] || '').trim();
                        const finalRelation = bodegaRelations.find(r => r.Bodega === bodegaEntrega && r.Seccion === seccion);
                        return { ...row, "Jefe_Responsable": finalRelation ? finalRelation.Jefatura : 'N/A' };
                    });

                    const newWorksheet = XLSX.utils.json_to_sheet(jsonData);
                    applyRowStyles(newWorksheet, jsonData); // Aplica colores basados en el Estatus

                    const newWorkbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Hoja1');
                    XLSX.writeFile(newWorkbook, `AVANCE_${fileRef.name}`);
                    logToScreen(`✔️ ${fileRef.name} descargado.`);
                } catch (e) {
                    logToScreen(`🔥 ERROR al descargar o procesar ${fileRef.name}.`);
                    console.error(e);
                    Swal.fire('Error de Descarga', `No se pudo descargar o procesar el archivo ${fileRef.name}.`, 'error');
                }
                progressModal.style.display = 'none'; // Cierra el modal después del intento de descarga
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-outline-danger delete-btn ms-2'; // Añadido ms-2 para espaciado
            deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
            deleteBtn.title = `Eliminar ${fileRef.name}`;
            deleteBtn.onclick = (event) => {
                event.stopPropagation(); // Evita que se active el onclick del <span> padre
                handleDeleteFile(fileRef.name);
            };

            li.appendChild(span);
            li.appendChild(deleteBtn);
            fileListUl.appendChild(li);
        });
    }
}

// Event listener para el botón de "Gestionar Archivos"
if (progressBtn) {
    progressBtn.addEventListener('click', async () => {
        await listContainerFiles(); // Asegura que la lista de archivos esté actualizada
        populateProgressModal(); // Rellena el modal con los archivos actuales
        progressModal.style.display = 'flex'; // Muestra el modal
    });
}


// --- LÓGICA DEL DASHBOARD DE RESUMEN ---
async function generateSummaryData(fileRef) {
    let allContainers = [];
    try {
        const url = await fileRef.getDownloadURL();
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        allContainers = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    } catch (e) {
        console.warn(`No se pudo procesar ${fileRef.name} para el resumen.`, e);
        logToScreen(`ADVERTENCIA: No se pudo leer el archivo ${fileRef.name} para el resumen.`);
        return null;
    }

    dashboardData = new Map(); // Reinicia los datos globales del dashboard

    // Popula la estructura dashboardData
    allContainers.forEach(container => {
        const seccion = String(container.SECCION || '').trim();
        const relation = bodegaRelations.find(r => r.Seccion === seccion);

        if (relation) {
            const jefe = relation.Jefatura;
            // Inicializa el mapa para el jefe si no existe
            if (!dashboardData.has(jefe)) {
                dashboardData.set(jefe, new Map());
            }
            // Inicializa el mapa para la sección si no existe para este jefe
            if (!dashboardData.get(jefe).has(seccion)) {
                dashboardData.get(jefe).set(seccion, { entregados: [], pendientes: [] });
            }

            const containerData = {
                id: String(container.CONTENEDOR || '').toUpperCase(),
                bodega: String(container.Bodega_Entrega || '').toUpperCase() // Incluye información de bodega para el detalle del dashboard
            };

            // Categoriza basándose en 'Estatus' (o la ausencia del mismo, asumiendo pendiente si no hay estatus o no es 'ENTREGADO')
            if (String(container.Estatus || '').toUpperCase() === 'ENTREGADO') {
                dashboardData.get(jefe).get(seccion).entregados.push(containerData);
            } else {
                dashboardData.get(jefe).get(seccion).pendientes.push(containerData); // Mantiene todos los datos del contenedor para pendientes también
            }
        }
    });
    return allContainers.length; // Retorna el número total de contenedores procesados
}

// --- RENDERIZADO DEL DASHBOARD Y ALERTA MINI ---
function renderDashboard(jefeF = '', seccionF = '') {
    if (!dashboardContent) {
        console.error("dashboardContent no encontrado.");
        return;
    }
    dashboardContent.innerHTML = '';
    let totalEntregados = 0;
    let totalPendientes = 0;

    // Itera a través de dashboardData para renderizar las tarjetas
    dashboardData.forEach((sections, jefe) => {
        // Aplica filtro por jefe
        if (jefeF && jefe !== jefeF) return;

        sections.forEach((data, section) => {
            // Aplica filtro por sección
            if (seccionF && section !== seccionF) return;

            const card = createSectionCard(jefe, section, data);
            if (card) {
                dashboardContent.appendChild(card);
                totalEntregados += data.entregados.length;
                totalPendientes += data.pendientes.length;
            }
        });
    });

    // Actualiza la visualización de las estadísticas globales
    const totalGlobal = totalEntregados + totalPendientes;
    const globalPerc = totalGlobal > 0 ? (totalEntregados / totalGlobal) * 100 : 0;

    let alertMsg, alertColor;
    // Define mensajes de alerta y colores basados en el porcentaje de progreso global
    if (globalPerc === 100) {
        alertMsg = '¡Misión Cumplida! Todos los contenedores entregados. 🏆';
        alertColor = 'var(--verde-completo)';
    } else if (globalPerc >= 75) {
        alertMsg = '¡Casi llegamos! Excelente progreso. 🚀';
        alertColor = 'var(--naranja-aviso)';
    } else if (globalPerc >= 50) {
        alertMsg = '¡A mitad de camino! Buen ritmo. 💪';
        alertColor = 'var(--rosa-principal)'; // Usar rosa principal para la mitad
    } else if (globalPerc > 0) {
        alertMsg = '¡El viaje ha comenzado! Sigamos adelante. ⚡️';
        alertColor = 'var(--rosa-suave)'; // Color alentador
    } else {
        alertMsg = 'Esperando el primer registro para iniciar. ⏳';
        alertColor = 'var(--texto-secundario)'; // Color neutral para sin progreso
    }


    if (summaryGlobalStats) {
        summaryGlobalStats.innerHTML = `
            <div class="epic-alert-mini animate__animated animate__fadeInUp" style="color:${alertColor};border-left-color:${alertColor};background:${alertColor}20;">
                <i class="bi bi-lightning-charge-fill me-2 fs-4"></i><span class="fs-5">${alertMsg}</span>
            </div>
            <div class="d-flex justify-content-center gap-4 align-items-center flex-wrap mt-3">
                <div>
                    <div class="epic-stat-number">${totalEntregados}</div>
                    <div class="epic-stat-label"><i class="bi bi-check-circle-fill text-success me-1"></i>Entregados</div>
                </div>
                <div>
                    <div class="epic-stat-number text-warning">${totalPendientes}</div>
                    <div class="epic-stat-label"><i class="bi bi-clock-history text-warning me-1"></i>Pendientes</div>
                </div>
                <div>
                    <div class="epic-stat-number" style="color:var(--rosa-principal)">${totalGlobal}</div>
                    <div class="epic-stat-label"><i class="bi bi-box-seam-fill me-1"></i>Total</div>
                </div>
            </div>
        `;
    }
}

function createSectionCard(jefe, section, data) {
    const total = data.entregados.length + data.pendientes.length;
    if (total === 0) return null; // No crea una tarjeta si no hay datos

    const percentage = total > 0 ? (data.entregados.length / total) * 100 : 0;
    const isCompleted = percentage === 100;
    const uniqueId = `details-${jefe.replace(/\s+/g, '-')}-${section.replace(/\s+/g, '-')}`; // Asegura uniqueId válido para HTML

    // --- Paleta de Temas Dinámica (Centrada en Rosas/Morados) ---
    let theme = {
        progressColor: '#adb5bd', // Gris para pendiente/sin iniciar
        cardClass: 'card-pending',
        icon: '<i class="bi bi-hourglass-split"></i>',
        statusText: 'Esperando Inicio',
    };

    if (isCompleted) {
        theme = {
            progressColor: 'var(--violeta-exito)',
            cardClass: 'card-completed',
            icon: '<i class="bi bi-award-fill"></i>', // Trofeo o medalla
            statusText: '¡Completado!',
        };
    } else if (percentage >= 75) {
        theme = {
            progressColor: 'var(--rosa-fuerte)',
            cardClass: 'card-final-lap',
            icon: '<i class="bi bi-rocket-takeoff-fill"></i>', // Cohete
            statusText: '¡Recta Final!',
        };
    } else if (percentage >= 50) {
        theme = {
            progressColor: 'var(--rosa-medio)', // Naranja para buen ritmo
            cardClass: 'card-good-pace',
            icon: '<i class="bi bi-fire"></i>', // Fuego
            statusText: '¡Buen Ritmo!',
        };
    } else if (percentage > 0) {
        theme = {
            progressColor: 'var(--rosa-suave)', // Amarillo para en progreso
            cardClass: 'card-in-progress',
            icon: '<i class="bi bi-fast-forward-fill"></i>', // Adelantar
            statusText: 'En Progreso',
        };
    }

    const card = document.createElement('div');
    card.className = 'col'; // Columna de Bootstrap para grid responsivo

    card.innerHTML = `
        <div class="card h-100 dashboard-card-professional ${theme.cardClass}" style="border-left: 5px solid ${theme.progressColor};">
            <div class="card-body p-4 d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start mb-3">
                    <div>
                        <h6 class="card-title fw-bold mb-0 d-flex align-items-center text-dark">
                            <i class="bi bi-person-badge me-2" style="color: ${theme.progressColor};"></i>${jefe}
                        </h6>
                        <small class="text-muted ps-4"><i class="bi bi-tag me-1"></i>Sección ${section}</small>
                    </div>
                    <div class="status-badge rounded-pill px-3 py-1 d-flex align-items-center fw-bold" style="background-color: ${theme.progressColor}20; color: ${theme.progressColor};">
                        ${theme.icon}
                        <span class="ms-1 small">${theme.statusText}</span>
                    </div>
                </div>

                <div class="my-3">
                    <div class="d-flex justify-content-between align-items-center mb-2 small">
                        <span class="text-muted"><i class="bi bi-graph-up me-1"></i>Progreso</span>
                        <span class="fw-bold" style="color: ${theme.progressColor};">${Math.round(percentage)}%</span>
                    </div>
                    <div class="progress" style="height: 10px; border-radius: 5px; background-color: #e9ecef;">
                        <div class="progress-bar" role="progressbar" style="width: ${percentage}%; background-color: ${theme.progressColor}; border-radius: 5px;" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </div>

                <div class="d-flex justify-content-around text-center small mt-3 border-top pt-3">
                    <div class="mx-2">
                        <div class="stat-value-small text-success fw-bold"><i class="bi bi-check2-circle me-1"></i>${data.entregados.length}</div>
                        <div class="stat-label-small text-muted">Entregados</div>
                    </div>
                    <div class="mx-2">
                        <div class="stat-value-small text-warning fw-bold"><i class="bi bi-hourglass-split me-1"></i>${data.pendientes.length}</div>
                        <div class="stat-label-small text-muted">Pendientes</div>
                    </div>
                    <div class="mx-2">
                        <div class="stat-value-small text-info fw-bold"><i class="bi bi-boxes me-1"></i>${total}</div>
                        <div class="stat-label-small text-muted">Total</div>
                    </div>
                </div>
                
                <div class="d-grid mt-auto pt-4">
                    <button class="btn btn-outline-secondary btn-sm rounded-pill btn-details-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#${uniqueId}" aria-expanded="false" aria-controls="${uniqueId}">
                        <i class="bi bi-eye me-1"></i>Ver Detalles<i class="bi bi-chevron-down ms-1 small chevron-icon"></i>
                    </button>
                </div>

                <div class="collapse mt-3" id="${uniqueId}">
                    <div class="details-wrapper-compact p-3 border rounded bg-light">
                        ${data.pendientes.length > 0 ? `
                            <div class="mb-3">
                                <h6 class="details-title-pendiente small fw-bold text-warning mb-2 d-flex align-items-center">
                                    <i class="bi bi-clock-history me-2"></i>Pendientes (${data.pendientes.length})
                                </h6>
                                <div class="d-flex flex-wrap gap-2">
                                    ${data.pendientes.map(c => `<span class="badge bg-warning-subtle text-warning border border-warning-subtle rounded-pill px-3 py-2"><i class="bi bi-box-seam me-1"></i>${c.id}</span>`).join('')}
                                </div>
                            </div>` : ''}
                        ${data.entregados.length > 0 ? `
                            <div>
                                <h6 class="details-title-entregado small fw-bold text-success mb-2 d-flex align-items-center">
                                    <i class="bi bi-check-circle-fill me-2"></i>Entregados (${data.entregados.length})
                                </h6>
                                <div class="d-flex flex-wrap gap-2">
                                    ${data.entregados.map(c => `<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-3 py-2"><i class="bi bi-box-seam-fill me-1"></i>${c.id} ${c.bodega ? `(${c.bodega})` : ''}</span>`).join('')}
                                </div>
                            </div>` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Añadir el listener para la rotación del icono de chevron
    card.querySelector('.btn-details-toggle').addEventListener('click', function () {
        const chevron = this.querySelector('.chevron-icon');
        chevron.classList.toggle('rotate');
    });

    return card;
}

function populateSelect(selectElement, options, placeholder) {
    selectElement.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(optionValue => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        selectElement.appendChild(option);
    });
}

async function selectFileForSummary(fileRef) {
    if (!fileSelectModal || !summaryModal || !summaryModalTitle || !jefeFilter || !seccionFilter) {
        console.error("Error: Falta uno o más elementos críticos del modal de resumen en el DOM.");
        Swal.fire({
            icon: 'error',
            title: 'Error de Interfaz',
            text: 'No se pueden mostrar los resúmenes porque faltan componentes de la página. Contacte a soporte.'
        });
        return;
    }

    closeAllModals();
    Swal.fire({
        title: 'Preparando Dashboard Épico...',
        html: `Analizando <b>${fileRef.name}</b>`,
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
    logToScreen(`🚀 Iniciando análisis para ${fileRef.name}...`);

    try {
        const totalContainers = await generateSummaryData(fileRef);

        if (totalContainers === null) {
            throw new Error(`El archivo ${fileRef.name} no pudo ser procesado. Puede que no sea un archivo Excel válido o esté corrupto.`);
        }

        summaryModalTitle.innerHTML = `<i class="bi bi-bar-chart-line-fill me-2"></i>Resumen: ${fileRef.name}`;

        const jefes = Array.from(dashboardData.keys()).sort();
        populateSelect(jefeFilter, jefes, '-- Todos los Jefes --');
        jefeFilter.value = '';
        seccionFilter.innerHTML = '<option value="">-- Todas las Secciones --</option>';
        seccionFilter.disabled = true;

        renderDashboard();
        summaryModal.style.display = 'flex';

        Swal.close();
        logToScreen(`✔️ Dashboard para ${fileRef.name} generado con ${totalContainers} contenedores.`);

    } catch (error) {
        console.error("Error al generar el resumen:", error);
        logToScreen(`🔥 ERROR: ${error.message}`);
        Swal.fire({
            icon: 'error',
            title: '¡Error al Generar Resumen!',
            text: error.message
        });
    }
}

// Event listener for Summary Button
if (summaryBtn) {
    summaryBtn.addEventListener('click', async () => {
        await listContainerFiles();
        if (!summaryFileListUl) {
            console.error("summaryFileListUl not found.");
            return;
        }
        summaryFileListUl.innerHTML = '';
        if (containerFiles.length === 0) {
            Swal.fire('Sin Archivos', 'Primero debes subir un archivo de contenedores para generar un resumen.', 'info');
            return;
        }

        const fragment = document.createDocumentFragment();
        containerFiles.forEach(fileRef => {
            const li = document.createElement('li');
            li.className = 'list-group-item list-group-item-action py-3 px-4';
            li.style.cursor = 'pointer';
            li.textContent = fileRef.name;
            li.onclick = () => selectFileForSummary(fileRef);
            fragment.appendChild(li);
        });
        summaryFileListUl.appendChild(fragment);
        fileSelectModal.style.display = 'flex';
    });
}

// Event listeners for filters
if (jefeFilter) {
    jefeFilter.addEventListener('change', () => {
        const selectedJefe = jefeFilter.value;
        if (selectedJefe && dashboardData.has(selectedJefe)) {
            const sections = Array.from(dashboardData.get(selectedJefe).keys()).sort();
            populateSelect(seccionFilter, sections, '-- Todas las Secciones --');
            if (seccionFilter) seccionFilter.disabled = false;
        } else {
            if (seccionFilter) {
                seccionFilter.innerHTML = '<option value="">-- Todas las Secciones --</option>';
                seccionFilter.disabled = true;
            }
        }
        if (seccionFilter) seccionFilter.value = '';
        renderDashboard(selectedJefe, '');
    });
}

if (seccionFilter) {
    seccionFilter.addEventListener('change', () => {
        renderDashboard(jefeFilter.value, seccionFilter.value);
    });
}

// --- MODALES ---
function closeAllModals() {
    if (progressModal) progressModal.style.display = 'none';
    if (summaryModal) summaryModal.style.display = 'none';
    if (fileSelectModal) fileSelectModal.style.display = 'none';
}

// Add event listeners to all close buttons
closeModalBtns.forEach(btn => btn.addEventListener('click', closeAllModals));

// Close modals when clicking outside of them
window.addEventListener('click', (event) => {
    if (event.target === progressModal || event.target === summaryModal || event.target === fileSelectModal) {
        closeAllModals();
    }
});

function logToScreen(message) {
    if (!logArea) return;
    if (logArea.style.display === 'none') {
        logArea.style.display = 'block';
    }
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${new Date().toLocaleTimeString('es-MX')}] ${message}`;
    logArea.appendChild(logEntry);
    logArea.scrollTop = logArea.scrollHeight;
}

// Initial calls when script loads (after DOM is ready)
document.addEventListener('DOMContentLoaded', () => {
    // This part is handled by auth.onAuthStateChanged.
    // The initial state of appContainer and errorContainer is set there.
});