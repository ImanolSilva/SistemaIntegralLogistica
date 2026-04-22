(function () {
    /* INICIO DE LA FUNCIÓN DE VALIDACIÓN DE ARCHIVO */

    /**
     * Valida que un archivo Excel de manifiesto tenga las columnas requeridas.
     * @param {Array} jsonData - El JSON de la primera hoja del Excel.
     * @returns {boolean} - true si es válido, false si no.
     */
    function validateManifestFile(jsonData) {
        if (!jsonData || jsonData.length === 0) {
            return false;
        }
        const requiredHeaders = new Set(['MANIFIESTO', 'CONTENEDOR', 'SKU', 'SAP']);
        const firstRowKeys = Object.keys(jsonData[0]).map(k => k.toUpperCase());

        for (let header of requiredHeaders) {
            if (!firstRowKeys.includes(header)) {
                return false;
            }
        }
        return true;
    }

    /* FIN DE LA FUNCIÓN DE VALIDACIÓN DE ARCHIVO */
    // MEJORA: Utilidades globales optimizadas
    const Utils = {
        showLoading() {
            document.getElementById('globalLoading').style.display = 'flex';
        },

        hideLoading() {
            document.getElementById('globalLoading').style.display = 'none';
        },

        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        isMobile() {
            return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        },

        handleError(error, context = '') {
            console.error(`Error en ${context}:`, error);

            let message = 'Ha ocurrido un error inesperado.';

            if (error.code === 'permission-denied') {
                message = 'No tienes permisos para realizar esta acción.';
            } else if (error.code === 'network-request-failed') {
                message = 'Error de conexión. Verifica tu internet.';
            } else if (error.message) {
                message = error.message;
            }

            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: message,
                confirmButtonColor: '#E6007E'
            });
        }
    };

    // Helper global (una única vez)
    const getPropCaseInsensitive = (obj, key) => {
        if (!obj) return undefined;
        const lk = String(key).toLowerCase();
        const realKey = Object.keys(obj).find(k => k.toLowerCase() === lk);
        return realKey ? obj[realKey] : undefined;
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('.main-container').removeAttribute('aria-hidden');
        AOS.init();
        const hamburgerBtn = document.getElementById('hamburger-btn');
        const menuLateral = document.getElementById('menuLateral');

        if (hamburgerBtn && menuLateral) {
            menuLateral.addEventListener('show.bs.offcanvas', () => {
                hamburgerBtn.classList.add('open');
            });

            menuLateral.addEventListener('hide.bs.offcanvas', () => {
                hamburgerBtn.classList.remove('open');
            });
        }
        const menuResumenSemanal = document.getElementById('menuResumenSemanal');
        if (menuResumenSemanal) {
            menuResumenSemanal.addEventListener('click', async (event) => {
                event.preventDefault(); // Detiene el comportamiento por defecto del enlace (no recarga la página)

                // Cierra el menú lateral si está abierto (mejora la experiencia de usuario)
                const offcanvasElement = document.getElementById('menuLateral');
                const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasElement);
                if (offcanvasInstance) {
                    offcanvasInstance.hide();
                }

                await loadSeccionToJefeMap();

                // Llama a tu función principal de resumen semanal
                await generarResumenSemanal();

                // Opcional: Actualiza la clase 'active' para resaltar el elemento del menú actual
                document.querySelectorAll('.offcanvas .nav-link').forEach(link => {
                    link.classList.remove('active');
                });
                menuResumenSemanal.classList.add('active');
            });
        }

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
         * VARIABLES GLOBALES
         ***************************************************/
        let seccionToJefeMap = new Map();
        const ADMIN_UID = "8NfEfPSyusZdNUFgXWPtvi3p6Ns1";
        let currentUser = null;
        let currentUserStore = null;
        let currentUserRole = null;
        let currentContenedor = null;
        let currentContainerRecords = [];
        let excelDataGlobal = {};
        let currentFileName = "";
        let currentEmployeeNumber = "";
        let debounceTimerBusqueda = null;
        let debounceTimerScan = null;
        let allFilesList = null;
        /* CÓDIGO NUEVO PARA AGREGAR A LAS VARIABLES GLOBALES */
        let globalContainerMap = {};
        let currentDanioSKU = null;
        let permissions = {
            canScan: false,
            canUpload: false,
            canGenerateReport: false,
            canArchive: false,
            hasFullAccess: false
        };
        let debouncedUpdateTimer = null;
        let lastKnownClosedState = {}; // <- ¡AÑADE ESTA LÍNEA!
        /* CÓDIGO NUEVO PARA AGREGAR A LAS VARIABLES GLOBALES */
        let unsubscribeFromPresence = null;

        const calculateProStatistics = (data) => {
            let tSAP = 0;
            // Renombrada para mayor claridad: esto almacenará la suma de los artículos escaneados HASTA su cantidad SAP.
            let tSCAN_for_expected = 0;
            let falt = 0;
            let exc = 0; // Esto acumulará el total de excedentes

            const contF = {}, contE = {}, secF = {}, secE = {};

            data.forEach(r => {
                const sap = Number(r.SAP) || 0;
                const scan = Number(r.SCANNER) || 0;
                const cont = (r.CONTENEDOR || 'SIN NOMBRE').toUpperCase().trim();
                const sec = (r.SECCION || 'Sin sección').toString().trim();

                tSAP += sap;

                // Calcula los artículos correctamente escaneados: solo hasta la cantidad SAP para cada SKU.
                tSCAN_for_expected += Math.min(scan, sap);

                if (scan < sap) {
                    const diff = sap - scan;
                    falt += diff;
                    contF[cont] = (contF[cont] || 0) + diff;
                    secF[sec] = (secF[sec] || 0) + diff;
                } else if (scan > sap) {
                    const diff = scan - sap;
                    exc += diff; // Acumula el excedente para el conteo total de excedentes
                    contE[cont] = (contE[cont] || 0) + diff;
                    secE[sec] = (secE[sec] || 0) + diff;
                }
            });

            // El avance debe calcularse en función de `tSCAN_for_expected` (lo escaneado correctamente)
            // MEJORA: Cambia Math.round por Math.floor para un porcentaje preciso.
            const av = tSAP ? Math.floor((tSCAN_for_expected / tSAP) * 100) : 0;
            const getTopItems = (obj) => Object.entries(obj)
                .sort(([, a], [, b]) => b - a);

            return {
                totalSAP: tSAP,
                totalSCAN: tSCAN_for_expected, // Este es el valor corregido
                faltantes: falt,
                excedentes: exc,
                avance: av,
                totalSKUs: data.length,
                topContenedoresFaltantes: getTopItems(contF),
                topSeccionesFaltantes: getTopItems(secF),
                topContenedoresExcedentes: getTopItems(contE),
                topSeccionesExcedentes: getTopItems(secE),
            };
        };


        async function reconstructManifestDataFromFirebase(manifestoId) {
            try {
                const manifestDoc = await db.collection('manifiestos').doc(manifestoId).get();
                if (!manifestDoc.exists) {
                    console.warn(`[reconstruct] Manifiesto ${manifestoId} no existe. Saltando reconstrucción.`);
                    return null; // Return null if manifest doesn't exist
                }

                const manifestData = manifestDoc.data();
                const { store: folder, fileName } = manifestData;

                if (!folder || !fileName) {
                    console.warn(`[reconstruct] Manifiesto ${manifestoId} sin info de tienda o nombre de archivo. Saltando reconstrucción.`);
                    return null; // Return null if essential data is missing
                }

                const url = await storage.ref(`Manifiestos/${folder}/${fileName}`).getDownloadURL();
                const buffer = await (await fetch(url)).arrayBuffer();
                const workbook = XLSX.read(buffer, { type: "array" });
                const baseData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                const getProp = (obj, key) => { // Helper function for case-insensitive property access
                    if (!obj) return undefined;
                    const lowerKey = String(key).toLowerCase();
                    const objKey = Object.keys(obj).find(k => k.toLowerCase() === lowerKey);
                    return objKey ? obj[objKey] : undefined;
                };

                const dataMap = new Map(); // Stores the reconstructed data
                baseData.forEach(row => {
                    const sku = String(getProp(row, 'SKU') || '').toUpperCase();
                    const container = String(getProp(row, 'CONTENEDOR') || '').trim().toUpperCase();
                    if (!sku || !container) {
                        // console.warn(`[reconstruct] Skipping base data row due to missing SKU or Container:`, row);
                        return;
                    }
                    const key = `${sku}|${container}`;

                    if (dataMap.has(key)) {
                        const existing = dataMap.get(key);
                        existing.SAP = (Number(existing.SAP) || 0) + (Number(getProp(row, 'SAP')) || 0);
                        dataMap.set(key, existing);
                    } else {
                        const cleanRow = { ...row };
                        cleanRow.SAP = Number(getProp(row, 'SAP')) || 0;
                        cleanRow.SCANNER = 0;
                        cleanRow.DANIO_CANTIDAD = 0;
                        cleanRow.DANIO_FOTO_URL = "";
                        cleanRow.LAST_SCANNED_BY = "";
                        cleanRow.ENTREGADO_A = "";
                        cleanRow.FECHA_ESCANEO = null;
                        cleanRow.SECCION = String(getProp(row, 'SECCION') || 'N/A').trim().toUpperCase();
                        dataMap.set(key, cleanRow);
                    }
                });

                const scansSnapshot = await db.collection('manifiestos').doc(manifestoId).collection('scans').orderBy('scannedAt').get();

                scansSnapshot.docs.forEach(doc => {
                    const scan = doc.data();
                    const skuUpper = String(scan.sku || "").toUpperCase();
                    const containerUpper = String(scan.container || "").trim().toUpperCase();

                    if (!skuUpper || !containerUpper) {
                        console.warn(`[reconstruct] Scan record missing SKU or Container, skipping:`, scan);
                        return;
                    }

                    const key = `${skuUpper}|${containerUpper}`;
                    let record = dataMap.get(key);

                    if (scan.type === 'delete') {
                        dataMap.delete(key);
                        return;
                    }

                    // If record doesn't exist in base dataMap (it's a new item added via scan)
                    if (!record) {
                        if (scan.type !== 'add') {
                            console.warn(`[reconstruct] Attempted to modify non-existent item (type: ${scan.type}): ${key}, skipping.`);
                            return;
                        }

                        // --- INICIO DE LA LÓGICA CLAVE PARA ARTÍCULOS NUEVOS EN RECONSTRUCCIÓN ---
                        // Determina la sección base a partir del scan.section o un valor por defecto.
                        let determinedSection = String(scan.section || "ARTICULO NUEVO").trim().toUpperCase();

                        // Si es un artículo nuevo (SAP:0) y la sección actual es genérica o problemática,
                        // intenta inferirla de otros artículos ya procesados en este contenedor.
                        // Esta es la parte modificada para FORZAR la re-inferencia.
                        if ((Number(scan.sap) || 0) === 0 && ["ARTICULO NUEVO", "N/A", "147"].includes(determinedSection)) {
                            for (const [existingKey, existingRecord] of dataMap.entries()) {
                                const existingContainer = String(getProp(existingRecord, 'CONTENEDOR') || '').trim().toUpperCase();
                                const existingSection = String(getProp(existingRecord, 'SECCION') || '').trim().toUpperCase();

                                if (existingContainer === containerUpper && existingSection && !["ARTICULO NUEVO", "N/A", "147"].includes(existingSection)) {
                                    determinedSection = existingSection; // Found a good section, use it
                                    console.log(`[reconstruct] Inferred section for new item ${skuUpper} in ${containerUpper}: ${determinedSection}`);
                                    break;
                                }
                            }
                        }
                        // --- FIN DE LA LÓGICA CLAVE ---

                        const refBaseRow = baseData.length > 0 ? baseData[0] : {}; // Use first row as template
                        record = {
                            'MANIFIESTO': getProp(refBaseRow, 'MANIFIESTO') || 'N/A',
                            'SKU': skuUpper,
                            'CONTENEDOR': containerUpper,
                            'DESCRIPCION': scan.description || "ARTÍCULO NUEVO (Añadido)",
                            'SECCION': determinedSection, // Use the determined section
                            'SAP': 0, // New items are always SAP 0
                            'SCANNER': 0,
                            'DANIO_CANTIDAD': 0,
                            'DANIO_FOTO_URL': "",
                            'LAST_SCANNED_BY': "",
                            'ENTREGADO_A': "",
                            'FECHA_ESCANEO': null
                        };
                        dataMap.set(key, record);
                    }

                    // Apply scan changes to the record
                    switch (scan.type) {
                        case 'add':
                            record.SCANNER = (Number(record.SCANNER) || 0) + (Number(scan.quantity) || 1);
                            // Also update section if scan.section is better than current record.SECCION
                            // or if record.SECCION is problematic ("147") and scan.section is good.
                            const scanSection = String(scan.section || '').trim().toUpperCase();
                            if (scanSection && !["ARTICULO NUEVO", "N/A", "147"].includes(scanSection) && record.SECCION !== scanSection) {
                                record.SECCION = scanSection;
                                console.log(`[reconstruct] Updated existing record section for ${record.SKU} in ${record.CONTENEDOR} from scan: ${scanSection}`);
                            } else if (scanSection && ["ARTICULO NUEVO", "N/A", "147"].includes(record.SECCION) && !["ARTICULO NUEVO", "N/A", "147"].includes(scanSection)) {
                                // If record current section is problematic (e.g. "147") but scan has a good section, update it.
                                record.SECCION = scanSection;
                                console.log(`[reconstruct] Corrected problematic section for ${record.SKU} in ${record.CONTENEDOR}: ${record.SECCION}`);
                            }
                            break;
                        case 'subtract':
                            record.SCANNER = (record.SCANNER || 0) - (Number(scan.quantity) || 1);
                            break;
                        case 'damage':
                            record.DANIO_CANTIDAD = (record.DANIO_CANTIDAD || 0) + (Number(scan.quantity) || 1);
                            if (scan.photoURL) record.DANIO_FOTO_URL = scan.photoURL;
                            break;
                        case 'delete_photo':
                            record.DANIO_FOTO_URL = "";
                            break;
                    }

                    // Update metadata for tracking
                    record.LAST_SCANNED_BY = scan.user || "Desconocido";
                    record.ENTREGADO_A = scan.employee || record.ENTREGADO_A || "";
                    if (scan.scannedAt) {
                        record.FECHA_ESCANEO = scan.scannedAt.toDate();
                    }
                });

                const finalData = Array.from(dataMap.values()).filter(record => {
                    if ((Number(record.SAP) || 0) > 0) return true; // Keep all original manifest items
                    return (Number(record.SCANNER) || 0) > 0; // For new items (SAP 0), only keep if scanner > 0
                });

                excelDataGlobal[manifestoId] = { data: finalData, ...manifestData };
                return { data: finalData, ...manifestData };

            } catch (error) {
                console.error(`Error al reconstruir datos para el manifiesto ${manifestoId}:`, error);
                throw new Error(`No se pudieron reconstruir los datos del manifiesto ${manifestoId}.`);
            }
        }
        // --- FIN DE LA FUNCIÓN ACTUALIZADA: reconstructManifestDataFromFirebase ---
        /***************************************************
         * REFERENCIAS DEL DOM
         ***************************************************/
        const logoutBtn = document.getElementById("logout-btn");
        const userInfoEl = document.getElementById("userInfo");
        const employeeNumberInput = document.getElementById("employeeNumberInput");
        const restoInterfaz = document.getElementById("restoInterfaz");
        const uploadAndSearchSection = document.getElementById("uploadAndSearchSection");
        const dropzone = document.getElementById("dropzone");
        const fileInput = document.getElementById("fileInput");
        const selectedFileNameEl = document.getElementById("selectedFileName");
        const uploadFileBtn = document.getElementById("uploadFileBtn");
        const uploadProgressContainer = document.getElementById("uploadProgressContainer");
        const uploadProgressBar = document.getElementById("uploadProgressBar");
        const btnVerArchivos = document.getElementById("btnVerArchivos");
        const inputBusqueda = document.getElementById("inputBusqueda");
        const containerResultsSection = document.getElementById("containerResultsSection");
        const containerDetailsEl = document.getElementById("containerDetails");
        const selectedFileToWorkEl = document.getElementById("selectedFileToWork");
        const lastUserUpdateEl = document.getElementById("lastUserUpdate");
        const scanEntrySection = document.getElementById("scanEntrySection");
        const inputScanCode = document.getElementById("inputScanCode");
        const btnCerrarContenedor = document.getElementById("btnCerrarContenedor");
        const btnRegistrarManual = document.getElementById("btnRegistrarManual");
        const btnCambiarEmpleado = document.getElementById("btnCambiarEmpleado");
        const btnCambiarContenedor = document.getElementById("btnCambiarContenedor");
        const modalDanios = new bootstrap.Modal(document.getElementById("modalDanios"));
        const danioCantidadInput = document.getElementById("danioCantidad");
        const danioFotoInput = document.getElementById("danioFoto");
        const btnGuardarDanio = document.getElementById("btnGuardarDanio");
        const uploadColumn = document.getElementById("upload-column");

        /***************************************************
         * INICIO: LÓGICA DEL ESCÁNER DE CÁMARA
         ***************************************************/
        const codeReader = new ZXing.BrowserMultiFormatReader();
        const modalEscaner = document.getElementById('modal-escaner');
        const videoElement = document.getElementById('video-escaner');
        const btnCerrarModal = document.getElementById('btn-cerrar-modal');
        let inputDestinoEscaner = null; // Variable para saber a qué input enviar el código

        // Añadimos el evento a TODOS los botones que tengan la clase .btn-escaner
        document.querySelectorAll('.btn-escaner').forEach(button => {
            button.addEventListener('click', () => {
                const targetSelector = button.getAttribute('data-target');
                inputDestinoEscaner = document.querySelector(targetSelector);
                if (inputDestinoEscaner) {
                    iniciarEscaner();
                } else {
                    console.error('El campo de destino para el escáner no fue encontrado:', targetSelector);
                }
            });
        });

        // Función que enciende la cámara y empieza a escanear
        function iniciarEscaner() {
            modalEscaner.style.display = 'flex';
            codeReader.listVideoInputDevices()
                .then(videoInputDevices => {
                    // Usamos la cámara trasera por defecto si es posible (ideal para móviles)
                    const deviceId = videoInputDevices.length > 1 ? videoInputDevices[1].deviceId : videoInputDevices[0].deviceId;

                    codeReader.decodeFromVideoDevice(deviceId, 'video-escaner', (result, err) => {
                        if (result) {
                            console.log('Código de barras detectado:', result.getText());
                            const codigoDetectado = result.getText();

                            // ¡LA MAGIA DE LA INTEGRACIÓN!
                            // Llenamos el valor del input para que el usuario lo vea.
                            inputDestinoEscaner.value = codigoDetectado;

                            // Dependiendo del input, llamamos a la función que TÚ YA CREASTE.
                            if (inputDestinoEscaner.id === 'inputBusqueda') {
                                handleSearch(codigoDetectado); // Llama a tu función de búsqueda
                            } else if (inputDestinoEscaner.id === 'inputScanCode') {
                                handleScanCode(codigoDetectado); // Llama a tu función de escaneo de piezas
                            }

                            detenerEscaner();
                        }
                        if (err && !(err instanceof ZXing.NotFoundException)) {
                            console.error('Error de escaneo:', err);
                            detenerEscaner();
                        }
                    });
                })
                .catch(err => {
                    console.error('Error al acceder a la cámara:', err);
                    Utils.handleError(err, 'Acceso a Cámara');
                    detenerEscaner();
                });
        }

        // Función que apaga la cámara y cierra la ventana
        function detenerEscaner() {
            codeReader.reset();
            modalEscaner.style.display = 'none';
        }

        // Evento para el botón de cancelar en la ventana de la cámara
        btnCerrarModal.addEventListener('click', () => {
            detenerEscaner();
        });
        /***************************************************
         * FIN: LÓGICA DEL ESCÁNER DE CÁMARA
         ***************************************************/


        /***************************************************
         * AUTH / LOGOUT
         ***************************************************/
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.href = "../Login/login.html";
                return;
            }
            currentUser = user;
            try {
                const docSnap = await db.collection("usuarios").doc(user.uid).get();
                const ADMIN_UIDS_ALL = ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"];
                const isAdmin = ADMIN_UIDS_ALL.includes(user.uid);
                const adminTabNav = document.getElementById('adminTab');
                if (adminTabNav && isAdmin) adminTabNav.style.display = 'flex';

                if (isAdmin || (docSnap.exists && docSnap.data().status === "aprobado")) {
                    const data = docSnap.data() || {};
                    currentUserStore = isAdmin ? "ALL" : (data.store || "");
                    currentUserRole = isAdmin ? "admin" : (data.role || "vendedor");

                    const userName = data.name || (isAdmin ? 'Admin' : 'Usuario');
                    userInfoEl.textContent = `Usuario: ${userName} (Tienda: ${currentUserStore}, Rol: ${currentUserRole})`;
                    // ¡AÑADE ESTA LÍNEA AQUÍ! Esto asegura que el mapa se cargue al inicio.
                    await loadSeccionToJefeMap();
                    switch (currentUserRole) {
                        case 'vendedor':
                            permissions.canScan = true;
                            break;
                        case 'bodeguero':
                            permissions.canScan = true;
                            permissions.canUpload = true;
                            break;
                        case 'jefe':
                            permissions.canScan = true;
                            permissions.canUpload = true;
                            permissions.canGenerateReport = true;
                            permissions.canArchive = true;
                            break;
                        case 'admin':
                            permissions.hasFullAccess = true;
                            break;
                    }
                    if (permissions.hasFullAccess) {
                        permissions = {
                            canScan: true,
                            canUpload: true,
                            canGenerateReport: true,
                            canArchive: true,
                            hasFullAccess: true
                        };
                    }

                    if (permissions.canScan || permissions.hasFullAccess) {
                        uploadAndSearchSection.style.display = 'block';
                    } else {
                        uploadAndSearchSection.style.display = 'none';
                    }
                    if (uploadColumn) {
                        if (permissions.canUpload || permissions.hasFullAccess) {
                            uploadColumn.style.display = 'block';
                        } else {
                            uploadColumn.style.display = 'none';
                        }
                    }
                } else {
                    Swal.fire({
                        icon: 'info',
                        title: 'Acceso Denegado',
                        text: 'Tu cuenta no está aprobada. Contacta al administrador.'
                    }).then(() => auth.signOut());
                }
            } catch (error) {
                console.error("Error de autenticación:", error);
                auth.signOut();
            }
        });

        logoutBtn.addEventListener("click", () => {
            auth.signOut().then(() => window.location.href = "../Login/login.html")
                .catch(e => console.error(e));
        });

        /***************************************************
                * SECCIÓN: SUBIR ARCHIVO MANIFIESTO + BARRA DE PROGRESO (CON VALIDACIÓN)
                ***************************************************/
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--rosa-principal)';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#ced4da';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#ced4da';
            if (e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                const file = fileInput.files[0];
                if (file) {
                    selectedFileNameEl.textContent = file.name;
                    uploadFileBtn.disabled = false;
                }
            }
        });

        fileInput.addEventListener('change', () => {
            console.log("El evento de cambio de archivo se disparó"); // <--- AÑADE ESTA LÍNEA
            const file = fileInput.files[0];
            if (!file) return;
            selectedFileNameEl.textContent = file.name;
            uploadFileBtn.disabled = false;
        });

        /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA */
        uploadFileBtn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            uploadFileBtn.disabled = true;

            const folder = "0042";
            const storageRef = storage.ref(`Manifiestos/${folder}/${file.name}`);

            try {
                await storageRef.getDownloadURL();

                Swal.fire({
                    icon: 'error',
                    title: 'Archivo Duplicado',
                    text: `Ya existe un manifiesto con el nombre "${file.name}" en la tienda 0042.`
                });
                uploadFileBtn.disabled = false;
                return;

            } catch (error) {
                if (error.code === 'storage/object-not-found') {
                    uploadProgressContainer.style.display = 'block';
                    const uploadTask = storageRef.put(file);

                    uploadTask.on('state_changed',
                        snapshot => {
                            const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                            uploadProgressBar.style.width = percent + '%';
                            uploadProgressBar.textContent = percent + '%';
                            uploadProgressBar.setAttribute('aria-valuenow', percent);
                        },
                        uploadError => {
                            console.error(uploadError);
                            Swal.fire({
                                icon: 'error',
                                title: 'Error de Subida',
                                text: 'Ocurrió un error al subir el archivo.'
                            });
                            uploadProgressContainer.style.display = 'none';
                            uploadFileBtn.disabled = false;
                        },
                        async () => {
                            try {
                                const reader = new FileReader();
                                reader.readAsArrayBuffer(file);
                                reader.onload = async (e) => {
                                    const data = new Uint8Array(e.target.result);
                                    const workbook = XLSX.read(data, { type: 'array' });
                                    const firstSheetName = workbook.SheetNames[0];
                                    const worksheet = workbook.Sheets[firstSheetName];
                                    const json = XLSX.utils.sheet_to_json(worksheet);

                                    // ✅ VALIDACIÓN AÑADIDA AQUÍ
                                    if (!validateManifestFile(json)) {
                                        Swal.fire({
                                            icon: 'error',
                                            title: 'Formato de Archivo Inválido',
                                            html: 'El archivo Excel debe contener las columnas <strong>MANIFIESTO, CONTENEDOR, SKU, y SAP</strong>. Por favor, verifica el formato y vuelve a intentarlo.'
                                        });
                                        // Cancelamos la subida y limpiamos la interfaz
                                        uploadProgressContainer.style.display = 'none';
                                        uploadProgressBar.style.width = '0%';
                                        selectedFileNameEl.textContent = '';
                                        fileInput.value = '';
                                        uploadFileBtn.disabled = false;
                                        return;
                                    }

                                    const numeroManifiesto = (json.length > 0 && json[0].MANIFIESTO) ? String(json[0].MANIFIESTO) : "N/A";

                                    await db.collection('manifiestos').doc(file.name).set({
                                        fileName: file.name,
                                        store: folder,
                                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                        lastUser: currentUser.email || currentUser.uid,
                                        numeroManifiesto: numeroManifiesto,
                                        closedContainers: {}
                                    }, { merge: true });

                                    Swal.fire({
                                        icon: 'success',
                                        title: '¡Éxito!',
                                        text: `El manifiesto "${file.name}" fue subido y procesado correctamente.`
                                    });

                                    uploadProgressContainer.style.display = 'none';
                                    uploadProgressBar.style.width = '0%';
                                    selectedFileNameEl.textContent = '';
                                    fileInput.value = '';
                                    uploadFileBtn.disabled = true;
                                };
                            } catch (readError) {
                                console.error("Error al leer el excel para metadatos:", readError);
                                Swal.fire('Error al Procesar', 'El archivo se subió, pero no se pudieron leer sus datos internos.', 'error');
                            }
                        }
                    );
                } else {
                    // Manejo de errores más específico
                    console.error("Error de Storage:", error);
                    let userMessage = 'No se pudo verificar el archivo en la nube. Por favor, inténtalo de nuevo.';
                    if (error.code === 'storage/unknown') {
                        userMessage = 'Error de conexión con el servidor. Por favor, verifica tu internet e inténtalo de nuevo.';
                    } else if (error.code === 'storage/unauthenticated') {
                        userMessage = 'Tu sesión ha expirado. Por favor, cierra sesión y vuelve a entrar.';
                    }

                    Swal.fire('Error Inesperado', userMessage, 'error');
                    uploadFileBtn.disabled = false;
                }
            }
        });

        /* FIN DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA */
        /***************************************************
         * DETECCIÓN DE EMPLEADO (8 dígitos)
         ***************************************************/
        const debounce = (func, delay = 400) => {
            let timeoutId;
            return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    func.apply(this, args);
                }, delay);
            };
        };

        employeeNumberInput.addEventListener("input", debounce(() => {
            const restoInterfaz = document.getElementById("restoInterfaz");
            const inputScanCode = document.getElementById("inputScanCode");
            const val = employeeNumberInput.value.trim();

            if (!restoInterfaz || !inputScanCode) {
                console.error("Error Crítico: No se encontraron 'restoInterfaz' o 'inputScanCode'.");
                return;
            }

            if (/^\d{8}$/.test(val)) {
                currentEmployeeNumber = val;
                restoInterfaz.style.display = "block";
                inputScanCode.disabled = false;
                inputScanCode.focus();
            } else {
                currentEmployeeNumber = "";
                restoInterfaz.style.display = "none";
                inputScanCode.disabled = true;
            }
        }));

        btnCambiarEmpleado.addEventListener("click", () => {
            Swal.fire({
                title: "Cambiar Empleado",
                input: "text",
                inputLabel: "Ingrese el nuevo número de empleado",
                inputPlaceholder: "Debe contener 8 dígitos...",
                inputAttributes: {
                    maxlength: 8,
                    autocapitalize: "off",
                    autocorrect: "off"
                },
                showCancelButton: true,
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#43A047',
                cancelButtonColor: '#6c757d',
                customClass: {
                    popup: 'animated animate__fadeInDown'
                },
                preConfirm: (value) => {
                    if (!/^\d{8}$/.test(value)) {
                        Swal.showValidationMessage("El número debe contener exactamente 8 dígitos numéricos");
                        return false;
                    }
                    return value;
                }
            }).then(result => {
                if (result.isConfirmed) {
                    currentEmployeeNumber = result.value.trim();
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'Número actualizado con éxito',
                        html: `Ahora se usará: <strong>${currentEmployeeNumber}</strong>`,
                        showConfirmButton: false,
                        timer: 2500
                    });
                    restoInterfaz.style.display = "block";
                    inputScanCode.disabled = false;
                    inputScanCode.focus();
                }
            });
        });

        /***************************************************
         * LISTAR / DESCARGAR / ELIMINAR MANIFIESTOS
         ***************************************************/
        const SUPER_ADMINS = ["OaieQ6cGi7TnW0nbxvlk2oyLaER2", "doxhVo1D3aYQqqkqgRgfJ4qcKcU2"];

        btnVerArchivos.addEventListener("click", listarArchivos);

        /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN listarArchivos COMPLETA */

        async function listarArchivos() {
            Swal.fire({
                title: '<i class="bi bi-stars" style="color: var(--rosa-principal);"></i> Desplegando Centro de Comando...',
                html: `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1rem 0;">
            <div class="epic-loader"></div>
            <p class="text-muted fw-bold mt-2">Sincronizando con la flota de manifiestos de la tienda 0042...</p>
            <p class="text-muted small">Calculando vectores de progreso. ¡Prepárate!</p>
        </div>
        <style>
            .epic-loader { width: 60px; height: 60px; border-radius: 50%; background: conic-gradient(from 180deg at 50% 50%, #E6007E, #0d6efd, #ffc107, #E6007E); animation: spin 1.2s linear infinite; -webkit-mask: radial-gradient(farthest-side, #0000 calc(100% - 8px), #000 0); mask: radial-gradient(farthest-side, #0000 calc(100% - 8px), #000 0); }
            @keyframes spin { to { transform: rotate(1turn); } }
        </style>
    `,
                allowOutsideClick: false,
                showConfirmButton: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                let query = db.collection('manifiestos').where('store', '==', '0042');
                const manifestosSnapshot = await query.orderBy('createdAt', 'desc').get();

                if (manifestosSnapshot.empty) {
                    Swal.close();
                    return Swal.fire("Sin Manifiestos", "No se encontraron archivos para la tienda 0042.", "info");
                }

                const promises = manifestosSnapshot.docs.map(async (doc) => {
                    const docId = doc.id;
                    if (excelDataGlobal[docId]) {
                        const data = excelDataGlobal[docId].data;
                        const stats = calculateProStatistics(data);
                        return { id: docId, name: docId, folder: doc.data().store, createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : new Date(0), progreso: stats };
                    } else {
                        try {
                            const reconstructedData = await reconstructManifestDataFromFirebase(docId);
                            const stats = calculateProStatistics(reconstructedData.data);
                            return { id: docId, name: docId, folder: doc.data().store, createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : new Date(0), progreso: stats };
                        } catch (e) {
                            console.error(`Falló al procesar el manifiesto ${docId} durante la lista:`, e);
                            return { id: docId, name: docId, folder: doc.data().store, error: e.message || 'Error desconocido' };
                        }
                    }
                });

                const results = await Promise.allSettled(promises);
                const archivosValidos = results.map(result => result.status === 'fulfilled' ? result.value : null).filter(a => a && !a.error);
                const failedManifestsDuringList = results.map(result => result.status === 'fulfilled' ? null : { id: result.reason.id, error: result.reason.error }).filter(a => a);

                let totalContenedoresCerrados = 0;
                let totalPiezasEscaneadas = 0;

                archivosValidos.forEach(file => {
                    totalPiezasEscaneadas += file.progreso.totalSCAN;
                    const manifestData = excelDataGlobal[file.id];
                    if (manifestData && manifestData.closedContainers) {
                        totalContenedoresCerrados += Object.values(manifestData.closedContainers).filter(isClosed => isClosed === true).length;
                    }
                });

                const totalManifiestosEnFirebase = manifestosSnapshot.docs.length;
                const topArchivos = [...archivosValidos].sort((a, b) => b.progreso.totalSCAN - a.progreso.totalSCAN).slice(0, 2);
                const topArchivosSet = new Set(topArchivos.map(f => f.name));
                archivosValidos.sort((a, b) => b.createdAt - a.createdAt);

                let failedProcessingAlertHTML = '';
                if (failedManifestsDuringList.length > 0) {
                    const failedNames = failedManifestsDuringList.map(f => `<strong>${f.id}</strong>`).join(', ');
                    failedProcessingAlertHTML = `
            <div class="mt-3 alert alert-danger p-3 small" role="alert" style="border-radius: 12px; box-shadow: 0 4px 10px rgba(220,53,69,0.1);">
                <h6 class="alert-heading"><i class="bi bi-exclamation-triangle-fill me-2"></i>¡Problemas al procesar manifiestos!</h6>
                <p class="mb-0">Algunos manifiestos no se pudieron cargar completamente para su análisis en el dashboard. Esto podría deberse a un formato incorrecto o datos corruptos en el archivo Excel.</p>
                <hr class="my-2" style="border-color: rgba(255,255,255,0.3);">
                <p class="mb-0">Manifiestos afectados: ${failedNames}. Por favor, revisa la consola del navegador para más detalles técnicos.</p>
            </div>`;
                }

                const dashboardHTML = `
            <style>
                /* Estilos que ya tienes para el dashboard... */
                .dashboard-pro-container {
                    --color-primary: #E6007E;
                    --color-secondary: #0d6efd;
                    --color-success: #198754;
                    --color-danger: #dc3545;
                    --color-warning: #ffc107;
                    --color-info: #6f42c1;
                    --color-bg: #fff;
                    --color-border: #e9ecef;
                    --color-muted: #6c757d;
                    --radius: 18px;
                    --shadow: 0 8px 32px #e6007e11;
                    --shadow-hover: 0 12px 40px rgba(0,0,0,0.12);
                    --font-main: 'Poppins', system-ui, Arial, sans-serif;
                }
                .dashboard-pro-container {
                    font-family: var(--font-main);
                    background: linear-gradient(135deg, var(--color-bg) 80%, #e6007e08 100%);
                    border-radius: var(--radius);
                    box-shadow: var(--shadow);
                    padding: 2.2rem 1.5rem 2.5rem 1.5rem;
                    margin: 0 auto;
                    max-width: 1400px;
                }
                .dashboard-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 1.5rem;
                    padding-bottom: 1.5rem;
                    border-bottom: 2px solid #e6007e22;
                }
                .dashboard-header .title {
                    font-size: 2.1rem;
                    font-weight: 800;
                    color: var(--color-primary);
                    display: flex;
                    align-items: center;
                    gap: 0.7rem;
                    margin: 0;
                }
                .dashboard-header .title .material-icons {
                    font-size: 2.5rem;
                    color: var(--color-secondary);
                }
                .search-filter-controls {
                    display: flex;
                    gap: 1.2rem;
                    align-items: center;
                }
                .search-filter-controls .form-control,
                .search-filter-controls .form-select {
                    max-width: 240px;
                    border-radius: 12px;
                    border: 2px solid #e6007e22;
                    font-size: 1rem;
                    padding: 0.5rem 1rem;
                    transition: border-color .3s, box-shadow .3s;
                }
                .search-filter-controls .form-select { max-width: 170px; }
                .search-filter-controls .form-control:focus,
                .search-filter-controls .form-select:focus {
                    border-color: var(--color-primary);
                    box-shadow: 0 0 0 3px #e6007e22;
                    outline: none;
                }
                .global-stats-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(210px,1fr));
                    gap: 1.5rem;
                    padding: 2.2rem 0 2.2rem 0;
                }
                .global-stat-card {
                    display: flex;
                    align-items: center;
                    gap: 1.2rem;
                    background: var(--color-bg);
                    padding: 1.3rem 1.1rem;
                    border-radius: 14px;
                    border: 1px solid var(--color-border);
                    transition: transform .3s, box-shadow .3s;
                    box-shadow: 0 2px 8px #e6007e11;
                }
                .global-stat-card:hover {
                    transform: translateY(-5px) scale(1.02);
                    box-shadow: var(--shadow-hover);
                }
                .global-stat-card .stat-icon {
                    font-size: 2.5rem;
                    padding: 0.7rem;
                    border-radius: 50%;
                    display: grid;
                    place-items: center;
                }
                .stat-icon.icon-manifiestos { background: #6f42c11a; color: #6f42c1; }
                .stat-icon.icon-contenedores { background: #dc35451a; color: #dc3545; }
                .stat-icon.icon-piezas { background: #1987541a; color: #198754; }
                .global-stat-card .stat-content { line-height: 1.2; }
                .global-stat-card .stat-value {
                    font-size: 2.1rem;
                    font-weight: 700;
                    color: #343a40;
                }
                .global-stat-card .stat-label {
                    font-size: 0.97rem;
                    color: var(--color-muted);
                    font-weight: 500;
                }
                #manifestCardsContainer { padding-top: 1rem; }
                .filter-results-counter {
                    display: inline-block;
                    margin-left: 1rem;
                    font-size: 1rem;
                    color: var(--color-primary);
                    font-weight: 600;
                    opacity: 0;
                    transition: opacity .3s;
                    vertical-align: middle;
                }
                .filter-results-counter.show { opacity: 1; }
                @media (max-width: 900px) {
                    .dashboard-pro-container { padding: 1.2rem .5rem; }
                    .dashboard-header { flex-direction: column; align-items: flex-start; }
                    .search-filter-controls { width: 100%; flex-direction: column; align-items: stretch; }
                    .search-filter-controls .form-control, .search-filter-controls .form-select { max-width: 100%; }
                }
                @media (max-width: 600px) {
                    .global-stats-container { grid-template-columns: 1fr; gap: .7rem; }
                    .global-stat-card { min-width: 120px; padding: .7rem .3rem; }
                }
            </style>
            <div class="dashboard-pro-container">
            <header class="dashboard-header">
                <h2 class="title">
                <i class="material-icons">view_quilt</i>
                Centro de Manifiestos (Tienda 0042)
                </h2>
                <div class="search-filter-controls">
                <input type="text" id="dashboardSearchInput" class="form-control" placeholder="Buscar por nombre..." aria-label="Buscar manifiesto por nombre">
                <select id="statusFilter" class="form-select" aria-label="Filtrar manifiestos por estado" title="Selecciona un estado para filtrar">
                    <option value="Todos">📋 Todos los estados</option>
                    <option value="Sin Iniciar">⏸️ Sin Iniciar</option>
                    <option value="En Progreso">🔄 En Progreso</option>
                    <option value="Avanzado">⚡ Avanzado</option>
                    <option value="Completo">✅ Completo</option>
                    <option value="Con Sobrantes">📦 Con Sobrantes</option>
                    <option value="Accion Requerida">⚠️ Acción Requerida</option>
                </select>
                </div>
            </header>
            <div class="global-stats-container">
                <div class="global-stat-card">
                <i class="bi bi-shop-window stat-icon icon-manifiestos"></i>
                <div class="stat-content">
                    <div class="stat-value">${totalManifiestosEnFirebase}</div>
                    <div class="stat-label">Manifiestos en Tienda</div>
                </div>
                </div>
                <div class="global-stat-card">
                <i class="bi bi-lock-fill stat-icon icon-contenedores"></i>
                <div class="stat-content">
                    <div class="stat-value">${totalContenedoresCerrados}</div>
                    <div class="stat-label">Contenedores Cerrados</div>
                </div>
                </div>
                <div class="global-stat-card">
                <i class="bi bi-qr-code-scan stat-icon icon-piezas"></i>
                <div class="stat-content">
                    <div class="stat-value">${totalPiezasEscaneadas.toLocaleString('es-MX')}</div>
                    <div class="stat-label">Piezas Escaneadas (Total)</div>
                </div>
                </div>
            </div>
            ${failedProcessingAlertHTML}
            <div id="manifestCardsContainer" class="manifest-cards-container"></div>
            </div>
        `;
                await Swal.fire({
                    html: dashboardHTML,
                    width: '95%',
                    customClass: { popup: 'dashboard-modal' },
                    showConfirmButton: false,
                    showCloseButton: true,
                    didOpen: () => {
                        const searchInput = document.getElementById('dashboardSearchInput');
                        const statusFilter = document.getElementById('statusFilter');
                        const btnResumenSemanal = document.getElementById('btnResumenSemanal');
                        if (btnResumenSemanal) {
                            btnResumenSemanal.addEventListener('click', generarResumenSemanal);
                        }
                        const renderizar = () => {
                            const searchTerm = searchInput.value.toLowerCase();
                            const statusFiltro = statusFilter.value;
                            const fiveDaysInMillis = 5 * 24 * 60 * 60 * 1000;

                            statusFilter.setAttribute('data-filtered', statusFiltro !== 'Todos');

                            const archivosFiltrados = archivosValidos.filter(file => {
                                const isOld = (new Date() - file.createdAt) > fiveDaysInMillis;
                                let searchMatch = file.name.toLowerCase().includes(searchTerm);

                                let estadoArchivo;
                                if (file.progreso.totalSAP === 0 && file.progreso.totalSCAN === 0) {
                                    estadoArchivo = "Sin Iniciar";
                                } else if (file.progreso.avance >= 100) {
                                    estadoArchivo = (file.progreso.excedentes > 0) ? "Con Sobrantes" : "Completo";
                                } else if (file.progreso.avance >= 50) {
                                    estadoArchivo = "Avanzado";
                                } else if (file.progreso.avance > 0) {
                                    estadoArchivo = "En Progreso";
                                } else {
                                    estadoArchivo = "Sin Iniciar";
                                }

                                let statusMatch = true;
                                if (statusFiltro === 'Accion Requerida') statusMatch = isOld;
                                else if (statusFiltro !== 'Todos') statusMatch = estadoArchivo === statusFiltro;
                                return searchMatch && statusMatch;
                            });

                            updateResultsCounter(archivosFiltrados.length, archivosValidos.length, statusFiltro);

                            const container = document.getElementById('manifestCardsContainer');
                            if (archivosFiltrados.length === 0) {
                                container.innerHTML = `
                            <div class="text-center p-5 text-muted w-100">
                                <h4><i class="material-icons">search_off</i> Sin resultados</h4>
                                <p>No se encontraron manifiestos que coincidan con tu búsqueda.</p>
                                ${statusFiltro !== 'Todos' ? `<button class="btn btn-outline-primary btn-sm mt-2" onclick="document.getElementById('statusFilter').value='Todos'; document.getElementById('statusFilter').dispatchEvent(new Event('change'));">
                                    <i class="material-icons">clear</i> Limpiar filtros
                                </button>` : ''}
                            </div>`;
                            } else {
                                container.innerHTML = archivosFiltrados.map(file => renderItems(file, topArchivosSet.has(file.name))).join('');
                            }
                        };
                        searchInput.addEventListener('keyup', renderizar);
                        statusFilter.addEventListener('change', renderizar);
                        function updateResultsCounter(filtered, total, currentFilter) {
                            let counter = document.querySelector('.filter-results-counter');

                            if (!counter) {
                                counter = document.createElement('div');
                                counter.className = 'filter-results-counter';
                                statusFilter.parentNode.appendChild(counter);
                            }

                            if (currentFilter !== 'Todos') {
                                counter.innerHTML = `<i class="material-icons">filter_list</i> ${filtered} de ${total}`;
                                counter.classList.add('show');
                            } else {
                                counter.classList.remove('show');
                            }
                        }
                        renderizar();
                    }
                });
            } catch (err) {
                console.error("Error al listar archivos:", err);
                Swal.fire("Error Inesperado", "No se pudo listar los archivos.", "error");
            }
        }

        /* FIN DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN listarArchivos COMPLETA */

        /**
         * Crea el HTML para la cuadrícula de resumen del contenedor.
         * @param {Array} records - Los registros del contenedor actual.
         * @returns {string} - El HTML de la cuadrícula de resumen.
         */
        // CÓDIGO NUEVO Y MEJORADO CON ICONOS
        function getContainerSummaryGridHTML(records) {
            let sapSum = 0;
            let missingSum = 0;
            let excessSum = 0;

            records.forEach(r => {
                const sap = Number(r.SAP) || 0;
                const scanner = Number(r.SCANNER) || 0;
                sapSum += sap;
                const diff = scanner - sap;
                if (diff < 0) {
                    missingSum += Math.abs(diff);
                } else if (diff > 0) {
                    excessSum += diff;
                }
            });

            // La nueva estructura incluye un <i> para el icono en cada item
            return `
        <div class="summary-item-pro">
            <i class="bi bi-tags-fill"></i>
            <div>
                <div class="label">Total SKUs</div>
                <div class="value">${records.length}</div>
            </div>
        </div>
        <div class="summary-item-pro">
            <i class="bi bi-archive-fill"></i>
            <div>
                <div class="label">Piezas SAP</div>
                <div class="value">${sapSum}</div>
            </div>
        </div>
        <div class="summary-item-pro">
            <i class="bi bi-dash-circle-fill icon-missing"></i>
            <div>
                <div class="label">Faltantes</div>
                <div class="value is-missing">${missingSum}</div>
            </div>
        </div>
        <div class="summary-item-pro">
            <i class="bi bi-plus-circle-fill icon-excess"></i>
            <div>
                <div class="label">Excedentes</div>
                <div class="value is-excess">${excessSum}</div>
            </div>
        </div>
    `;
        }
        /**
         * Determina el estado de un contenedor (Completo, Incompleto, Con Excedentes).
         * @param {Array} records - Los registros del contenedor.
         * @returns {object} Un objeto con el texto del estado, clase CSS e icono.
         */
        function getContainerStatus(records) {
            let sapSum = 0, scanSum = 0, excessSum = 0, missingSum = 0;

            for (const r of records || []) {
                const sap = Number(r.SAP) || 0;
                const sc = Number(r.SCANNER) || 0;
                sapSum += sap;
                scanSum += sc;

                if (sc >= sap) {
                    excessSum += (sc - sap);
                } else {
                    missingSum += (sap - sc);
                }
            }

            // Caso especial: nadie ha escaneado nada
            if (scanSum === 0) {
                return {
                    text: 'AÚN NO MANIFIESTA',
                    colorClass: 'status-gray',          // usa esta clase en tu CSS
                    icon: 'bi-hourglass-split'
                };
            }

            if (missingSum === 0 && excessSum === 0) {
                return { text: 'COMPLETO', colorClass: 'status-green', icon: 'bi-check-circle-fill' };
            }
            if (missingSum === 0 && excessSum > 0) {
                return { text: 'COMPLETO CON EXCEDENTES', colorClass: 'status-yellow', icon: 'bi-plus-circle-dotted' };
            }
            return { text: 'INCOMPLETO', colorClass: 'status-red', icon: 'bi-exclamation-triangle-fill' };
        }

        function renderItems(file, isDestacado) {
            const p = file.progreso;
            const ultimaModificacion = formatFecha(file.createdAt);
            const diasDesdeSubida = Math.floor((new Date() - file.createdAt) / (1000 * 60 * 60 * 24));

            let estadoInfo;
            if (p.avance >= 100) {
                estadoInfo = (p.totalSCAN > p.totalSAP) ? { texto: 'Con Sobrantes', clase: 'con-sobrantes' } : { texto: 'Completo', clase: 'completo' };
            } else if (p.avance >= 50) {
                estadoInfo = { texto: 'Avanzado', clase: 'avanzado' };
            } else if (p.avance > 0) {
                estadoInfo = { texto: 'En Progreso', clase: 'en-progreso' };
            } else {
                estadoInfo = { texto: 'Sin Iniciar', clase: 'sin-iniciar' };
            }

            const isOld = diasDesdeSubida > 5;
            // --- NUEVO CÓDIGO PARA COLORES DINÁMICOS ---
            let progressColorClass = '';
            if (p.avance >= 100) {
                progressColorClass = 'progreso-verde'; // Verde (Completo)
            } else if (p.avance >= 75) {
                progressColorClass = 'progreso-amarillo'; // Amarillo (Avanzado)
            } else if (p.avance >= 40) {
                progressColorClass = 'progreso-naranja'; // Naranja (En progreso)
            } else {
                progressColorClass = 'progreso-rojo'; // Rojo (Iniciado)
            }
            // --- FIN DEL NUEVO CÓDIGO ---

            const actionButtons = [];
            if (permissions.canScan) {
                actionButtons.push(`<button class="btn btn-sm btn-primary" onclick="verDashboardArchivo('${file.folder}','${file.name}')" title="Ver análisis detallado y abrir contenedor" aria-label="Abrir ${file.name}">
            <i class="bi bi-box-arrow-in-right fs-5"></i>
        </button>`);
            }

            if (permissions.canGenerateReport) {
                // ✅ Este es el botón que ejecuta toda la nueva lógica
                actionButtons.push(`<button class="btn btn-sm btn-success text-white" onclick="window.generarReportesYCorreo('${file.folder}','${file.name}')" title="Generar reportes (Excel, PDF, Captura) y enviar por correo" aria-label="Generar reportes y correo para ${file.name}">
            <i class="bi bi-envelope-paper-heart-fill fs-5"></i>
        </button>`);

                actionButtons.push(`<button class="btn btn-sm btn-danger" onclick="window.generatePdfReport('${file.folder}','${file.name}')" title="Generar reporte PDF" aria-label="Generar PDF para ${file.name}">
            <i class="bi bi-file-earmark-pdf-fill fs-5"></i>
        </button>`);
            }

            if (permissions.canArchive) {
                actionButtons.push(`<button class="btn btn-sm btn-secondary" onclick="window.archivarManifiesto('${file.name}', '${file.folder}')" title="Archivar este manifiesto" aria-label="Archivar manifiesto ${file.name}">
            <i class="bi bi-archive-fill fs-5"></i>
        </button>`);
            }

            let statusClass = isOld ? 'is-archivable' : `status-${estadoInfo.clase}`;



            return `
        <div class="manifest-card-pro ${statusClass}">
            ${isDestacado ? `<div class="badge-destacado"><i class="bi bi-fire"></i> Destacado</div>` : ''}
            ${isOld ? `<div class="archivable-notice">ACCIÓN REQUERIDA (Subido hace ${diasDesdeSubida} días)</div>` : ''}
            <div class="card-header">
                <div class="file-name">${file.name}</div>
                <div class="file-store">Tienda: <strong>${file.folder}</strong> | Subido: ${ultimaModificacion}</div>
            </div>
            <div class="card-body">
                <div class="progress-preview">
                    <div class="progress-title">
                        <span>Progreso de Escaneo</span>
                        <span>${p.avance}%</span>
                    </div>
                    <div class="progress-bar-container">
<div class="progress-bar-fill ${progressColorClass}" style="width: ${p.avance}%;"></div>                    </div>
                </div>
                <div class="card-stats">
                    <div>
<div class="stat-value">${p.totalSCAN.toLocaleString()} / ${p.totalSAP.toLocaleString()}</div>
                        <div class="stat-label">Escaneado vs. SAP</div>
                    </div>
                    <div>
                        <span class="status-tag ${estadoInfo.clase}">${estadoInfo.texto}</span>
                        <div class="stat-label">Estado</div>
                    </div>
                </div>
            </div>
            <div class="card-footer">
                ${actionButtons.join('')}
            </div>
        </div>`;
        }

        window.archivarManifiesto = async (fileName, folder) => {
            const {
                isConfirmed
            } = await Swal.fire({
                title: '¿Archivar Manifiesto?',
                html: `Esto moverá <strong>${fileName}</strong> a una carpeta de archivados y lo quitará de esta vista. Esta acción es difícil de revertir. ¿Continuar?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, Archivar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#dc3545'
            });

            if (isConfirmed) {
                Swal.fire({
                    title: 'Archivando...',
                    text: 'Por favor espera.',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                try {
                    const originalRef = storage.ref(`Manifiestos/${folder}/${fileName}`);
                    const archivedRef = storage.ref(`Archivados/${folder}/${fileName}`);
                    const url = await originalRef.getDownloadURL();
                    const blob = await (await fetch(url)).blob();

                    await archivedRef.put(blob);
                    await originalRef.delete();
                    await db.collection('manifiestos').doc(fileName).delete();

                    await Swal.fire('¡Archivado!', 'El manifiesto ha sido archivado con éxito.', 'success');

                    listarArchivos();
                } catch (error) {
                    console.error("Error al archivar:", error);
                    Swal.fire('Error', 'No se pudo completar el archivado del manifiesto.', 'error');
                }
            }
        };
        window.verDashboardArchivo = async (folder, fileName) => {
            try {
                // --- FUNCIÓN INTERNA DE CÁLCULO (YA CORREGIDA) ---
                const calculateProStatistics = (data) => {
                    let tSAP = 0, tSCAN_for_expected = 0, exc = 0;
                    const faltantesPorSeccion = {}, excedentesPorSeccion = {};
                    data.forEach(r => {
                        const sap = Number(r.SAP) || 0, scan = Number(r.SCANNER) || 0;
                        const cont = (r.CONTENEDOR || 'SIN NOMBRE').toUpperCase().trim(), sec = (r.SECCION || 'Sin sección').toString().trim();
                        tSAP += sap;
                        if (sap > 0) {
                            tSCAN_for_expected += Math.min(scan, sap);
                            if (scan > sap) {
                                const excess_amount = scan - sap;
                                exc += excess_amount;
                                if (!excedentesPorSeccion[sec]) excedentesPorSeccion[sec] = { total: 0, contenedores: {} };
                                excedentesPorSeccion[sec].total += excess_amount;
                                excedentesPorSeccion[sec].contenedores[cont] = (excedentesPorSeccion[sec].contenedores[cont] || 0) + excess_amount;
                            }
                        } else {
                            exc += scan;
                            if (scan > 0) {
                                if (!excedentesPorSeccion[sec]) excedentesPorSeccion[sec] = { total: 0, contenedores: {} };
                                excedentesPorSeccion[sec].total += scan;
                                excedentesPorSeccion[sec].contenedores[cont] = (excedentesPorSeccion[sec].contenedores[cont] || 0) + scan;
                            }
                        }
                        if (scan < sap) {
                            const missing_amount = sap - scan;
                            if (!faltantesPorSeccion[sec]) faltantesPorSeccion[sec] = { total: 0, contenedores: {} };
                            faltantesPorSeccion[sec].total += missing_amount;
                            faltantesPorSeccion[sec].contenedores[cont] = (faltantesPorSeccion[sec].contenedores[cont] || 0) + missing_amount;
                        }
                    });
                    const falt = tSAP - tSCAN_for_expected;
                    const av = tSAP > 0 ? Math.floor((tSCAN_for_expected / tSAP) * 100) : 0; // ✅ CORRECCIÓN 1: Cálculo preciso
                    const sortDetailedBreakdown = (obj) => {
                        const sortedSections = Object.entries(obj).sort(([, a], [, b]) => b.total - a.total);
                        sortedSections.forEach(([, sectionData]) => {
                            sectionData.contenedores = Object.entries(sectionData.contenedores).sort(([, a], [, b]) => b - a);
                        });
                        return sortedSections;
                    };
                    return {
                        totalSAP: tSAP, totalSCAN: tSCAN_for_expected, faltantes: falt, excedentes: exc, avance: av,
                        totalSKUs: data.length, faltantesDetallado: sortDetailedBreakdown(faltantesPorSeccion),
                        excedentesDetallado: sortDetailedBreakdown(excedentesPorSeccion),
                    };
                };

                await reconstructManifestDataFromFirebase(fileName);
                const datos = excelDataGlobal[fileName].data;
                const stats = calculateProStatistics(datos);

                // --- FUNCIONES AUXILIARES PARA CREAR EL HTML (ASEGÚRATE DE QUE ESTÉN PRESENTES) ---
                const statColors = {
                    total: { bg: 'linear-gradient(135deg, #E6007E 0%, #fff 100%)', icon: 'apps', color: '#E6007E' },
                    expected: { bg: 'linear-gradient(135deg, #6f42c1 0%, #fff 100%)', icon: 'inventory', color: '#6f42c1' },
                    scanned: { bg: 'linear-gradient(135deg, #198754 0%, #fff 100%)', icon: 'task_alt', color: '#198754' },
                    missing: { bg: 'linear-gradient(135deg, #dc3545 0%, #fff 100%)', icon: 'remove_circle', color: '#dc3545' },
                    excess: { bg: 'linear-gradient(135deg, #ffc107 0%, #fff 100%)', icon: 'add_circle', color: '#ffc107' }
                };

                const createProStatCard = (title, value, iconKey, className) => {
                    const colorObj = statColors[className] || statColors.total;
                    return `<div class="stat-card ${className} animate__animated animate__fadeInUp" style="display:flex;align-items:center;justify-content:center;gap:1.2rem;box-shadow:0 8px 24px rgba(0,0,0,0.10);border-left:8px solid ${colorObj.color};background:${colorObj.bg};transition:transform 0.3s cubic-bezier(.4,2,.3,1);text-align:center;"><div class="stat-icon d-flex align-items-center justify-content-center" style="background:${colorObj.bg};border-radius:50%;width:56px;height:56px;box-shadow:0 4px 16px ${colorObj.color}22;animation:bounceIn 1s;"><i class="material-icons" style="font-size:2.5rem;color:${colorObj.color};filter:drop-shadow(0 2px 4px ${colorObj.color}33);">${colorObj.icon}</i></div><div class="stat-info" style="flex:1;"><div class="stat-value" style="font-size:2.5rem;font-weight:800;color:#343a40;margin-bottom:4px;letter-spacing:1px;text-shadow:0 2px 8px ${colorObj.color}11;animation:pulse 1.2s;">${value.toLocaleString('es-MX')}</div><div class="stat-title" style="font-size:1.05rem;color:${colorObj.color};font-weight:700;letter-spacing:0.5px;">${title}</div></div></div><style>@keyframes bounceIn{0%{transform:scale(0.7);opacity:0}60%{transform:scale(1.15);opacity:1}80%{transform:scale(0.95)}100%{transform:scale(1)}}@keyframes pulse{0%{text-shadow:0 0 0 #e6007e11}50%{text-shadow:0 4px 16px #e6007e33}100%{text-shadow:0 2px 8px #e6007e11}}</style>`;
                };

                const createKeyInsightsPanel = (stats) => {
                    const createAccordionItems = (items, type) => {
                        if (items.length === 0) return `<div class="text-center p-3 text-muted">No hay ${type === 'faltantes' ? 'faltantes' : 'excedentes'} que reportar.</div>`;
                        return items.map(([sectionName, data], index) => {
                            const accordionId = `accordion-${type}-${index}`, color = type === 'faltantes' ? '#dc3545' : '#ffc107', icon = type === 'faltantes' ? 'bi-arrow-down-circle' : 'bi-arrow-up-circle';
                            const containerList = data.contenedores.map(([contName, qty]) => `<li class="list-group-item d-flex justify-content-between align-items-center"><span><i class="bi bi-box-seam me-2"></i>${contName}</span><span class="badge" style="background-color:${color};">${qty.toLocaleString('es-MX')} pz.</span></li>`).join('');
                            return `<div class="accordion-item"><h2 class="accordion-header" id="heading-${accordionId}"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${accordionId}" aria-expanded="false" aria-controls="collapse-${accordionId}"><i class="bi ${icon} me-2" style="color:${color};"></i><strong>${sectionName}</strong><span class="ms-auto me-3 badge rounded-pill" style="background-color:${color};font-size:0.9rem;">Total: ${data.total.toLocaleString('es-MX')} pz.</span></button></h2><div id="collapse-${accordionId}" class="accordion-collapse collapse" aria-labelledby="heading-${accordionId}"><div class="accordion-body"><h6 class="text-muted">Desglose por Contenedor:</h6><ul class="list-group list-group-flush">${containerList}</ul></div></div></div>`;
                        }).join('');
                    };
                    return `<div class="key-insights-panel" style="background:linear-gradient(135deg,#f8f9fa 80%,#e6007e08 100%);border-radius:18px;box-shadow:0 8px 32px rgba(230,0,126,0.07);padding:2rem 1.5rem;margin-top:1rem;"><h4 style="display:flex;align-items:center;gap:12px;font-size:1.5rem;font-weight:800;color:#E6007E;margin-bottom:2rem;justify-content:center;"><i class="bi bi-lightbulb" style="font-size:2rem;color:#E6007E;opacity:0.7;"></i> Insights Clave del Manifiesto</h4><div class="row gx-5"><div class="col-lg-6"><h5 class="text-center mb-3" style="color:#dc3545;">Análisis de Faltantes</h5><div class="accordion" id="accordionFaltantes">${createAccordionItems(stats.faltantesDetallado, 'faltantes')}</div></div><div class="col-lg-6 mt-4 mt-lg-0"><h5 class="text-center mb-3" style="color:#ffc107;">Análisis de Excedentes</h5><div class="accordion" id="accordionExcedentes">${createAccordionItems(stats.excedentesDetallado, 'excedentes')}</div></div></div></div>`;
                };

                const isComplete = stats.avance >= 100 && stats.faltantes === 0;
                const statusClass = isComplete ? 'is-success' : 'is-warning';
                const statusMessage = isComplete ? `<i class="material-icons">celebration</i> ¡Manifiesto completo! Excelente trabajo 🎉` : `<i class="material-icons">warning</i> Aún falta un ${100 - stats.avance}% por completar. ¡Ánimo!`;

                const canvasId = `grafico_pro_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
                const dashboardHTML = `
            <div class="analisis-dashboard-pro" style="max-width:1200px;margin:0 auto;padding:2.5rem 1.5rem;background:linear-gradient(135deg,#fff 80%,#e6007e10 100%);border-radius:32px;box-shadow:0 12px 40px rgba(230,0,126,0.10);">
                <div class="status-message ${statusClass}" style="justify-content:center;text-align:center;font-size:1.25rem;border-radius:12px;margin-bottom:2rem;box-shadow:0 2px 8px #e6007e11;">${statusMessage}</div>
                <div class="stats-grid stats-grid-responsive" style="margin:0 auto;max-width:950px;gap:2rem;">
                    ${createProStatCard('SKUs Totales', stats.totalSKUs, 'apps', 'total')}
                    ${createProStatCard('Piezas Esperadas (SAP)', stats.totalSAP, 'inventory', 'expected')}
                    ${createProStatCard('Piezas Escaneadas', stats.totalSCAN, 'task_alt', 'scanned')}
                    ${createProStatCard('Piezas Faltantes', stats.faltantes, 'error', 'missing')}
                    ${createProStatCard('Piezas Excedentes', stats.excedentes, 'add_shopping_cart', 'excess')}
                </div>
                <div class="progress-container" style="margin:2.5rem auto 2.5rem auto;max-width:520px;height:32px;box-shadow:0 2px 8px #e6007e11;border-radius:32px;background:#f8f9fa;overflow:hidden">
                    <div class="progress-fill" style="width:${stats.avance}%;font-size:1.25rem;display:flex;align-items:center;justify-content:center;height:100%;border-radius:32px;color:#fff;font-weight:700;transition:width .5s cubic-bezier(.4,2,.3,1);
                        background: linear-gradient(90deg, 
                        ${stats.avance < 40 ? '#dc3545, #f87d8a' :
                        stats.avance < 75 ? '#fd7e14, #ffac6a' :
                            stats.avance < 100 ? '#ffc107, #ffe08a' :
                                '#198754, #52c58a'});">
                        <span style="font-weight:700;">${stats.avance}%</span>
                    </div>
                </div>
                <div class="dashboard-main-layout" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:2.5rem;">
                    <div class="chart-container" style="flex:1 1 350px;max-width:400px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;border-radius:20px;box-shadow:0 4px 24px #e6007e11;padding:2rem 1rem;">
                        <canvas id="${canvasId}" style="margin:0 auto;display:block;max-width:340px;max-height:340px;"></canvas>
                        <div style="text-align:center;margin-top:1.2rem;font-size:1.05rem;color:#6c757d;"><i class="material-icons" style="vertical-align:middle;color:#0d6efd;">pie_chart</i><span>Distribución de piezas</span></div>
                    </div>
                    <div style="flex:2 1 600px;max-width:700px;">${createKeyInsightsPanel(stats)}</div>
                </div>
            </div>
            <style>
                 .analisis-dashboard-pro{background:linear-gradient(135deg,#fff 80%,#e6007e10 100%);border-radius:32px;box-shadow:0 12px 40px rgba(230,0,126,0.10);padding:2.5rem 1.5rem}.stats-grid.stats-grid-responsive{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:2rem;justify-content:center;margin-bottom:2rem}.stat-card{min-width:210px;max-width:260px;width:100%;padding:1.2rem 1rem;margin:0 auto;box-sizing:border-box}.stat-card .stat-value{font-size:2.2rem!important;font-weight:800;color:#343a40;margin-bottom:4px;letter-spacing:1px;text-shadow:0 2px 8px #e6007e11;animation:pulse 1.2s}.stat-card .stat-title{font-size:1rem!important;color:inherit;font-weight:700;letter-spacing:.5px}.stat-card .stat-icon{width:48px!important;height:48px!important;font-size:2rem!important}.progress-container{box-shadow:0 2px 8px #e6007e11;height:32px;border-radius:32px;background:#f8f9fa;overflow:hidden}.progress-fill{height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.25rem;transition:width .5s cubic-bezier(.4,2,.3,1);}.dashboard-main-layout{margin-top:2rem;gap:2.5rem}.chart-container{background:#fff;border-radius:20px;box-shadow:0 4px 24px #e6007e11;padding:2rem 1rem;min-width:320px}@media (max-width:900px){.dashboard-main-layout{flex-direction:column;gap:1.5rem}.chart-container,.key-insights-panel{max-width:100%!important}.analisis-dashboard-pro{padding:1.2rem .5rem}.stats-grid.stats-grid-responsive{grid-template-columns:1fr 1fr;gap:1rem}.stat-card{min-width:160px;max-width:100%;padding:1rem .5rem}}@media (max-width:600px){.stats-grid.stats-grid-responsive{grid-template-columns:1fr;gap:.7rem}.stat-card{min-width:120px;padding:.7rem .3rem}}
            </style>
        `;

                Swal.fire({
                    title: `<div style="display:flex;align-items:center;gap:1rem;padding:0.5rem 1rem;"><i class="bi bi-bar-chart-line-fill" style="font-size:2.5rem;color:var(--rosa-principal);"></i><div><h2 style="font-size:1.7rem;font-weight:700;color:var(--texto-principal);margin:0;">Análisis PRO</h2><p style="font-size:1rem;color:#6c757d;margin:0;">${fileName}</p></div></div>`,
                    html: dashboardHTML,
                    width: '98vw',
                    maxWidth: '1400px',
                    padding: '0',
                    showCloseButton: true,
                    showConfirmButton: false,
                    customClass: { popup: 'dashboard-modal animate__animated animate__fadeInUp', header: 'p-3 border-bottom-0' },
                    grow: 'row',
                    didOpen: () => {
                        const chartContainer = document.getElementById(canvasId);
                        if (chartContainer) {
                            chartContainer.height = 340;
                            chartContainer.width = 340;
                            const ctx = chartContainer.getContext('2d');
                            new Chart(ctx, {
                                type: 'doughnut',
                                data: {
                                    labels: ['Correcto', 'Faltante', 'Excedente'],
                                    datasets: [{
                                        data: [stats.totalSCAN - stats.excedentes, stats.faltantes, stats.excedentes],
                                        backgroundColor: ['#20c997', '#e53935', '#ffb22d'],
                                        borderColor: '#ffffff',
                                        borderWidth: 8,
                                        hoverOffset: 20,
                                        hoverBorderColor: '#f8f9fa'
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    cutout: '75%',
                                    animation: { duration: 0 },
                                    plugins: {
                                        legend: {
                                            position: 'bottom',
                                            labels: { padding: 25, usePointStyle: true, pointStyle: 'rectRounded', font: { size: 14, family: 'Poppins', weight: '600' }, color: '#495057' }
                                        },
                                        tooltip: { enabled: true, backgroundColor: 'rgba(0,0,0,0.8)', titleColor: 'var(--rosa-principal)', bodyColor: '#ffffff', borderColor: 'var(--rosa-principal)', borderWidth: 1, padding: 12, cornerRadius: 8, callbacks: { label: c => ` ${c.label}: ${c.raw.toLocaleString('es-MX')} piezas` } }
                                    }
                                },
                                plugins: [{
                                    id: 'doughnut-center-text',
                                    beforeDraw: function (chart) {
                                        const { width, height, ctx } = chart;
                                        ctx.restore();
                                        const fontSize = (height / 110).toFixed(2);
                                        ctx.font = `700 ${fontSize}em Poppins`;
                                        ctx.textBaseline = "middle";
                                        const text = `${stats.avance}%`;
                                        const textX = Math.round((width - ctx.measureText(text).width) / 2);
                                        const textY = height / 2;
                                        ctx.fillStyle = '#343a40';
                                        ctx.fillText(text, textX, textY);
                                        ctx.save();
                                    }
                                }]
                            });
                        }
                    }
                });

            } catch (e) {
                console.error("Error al generar dashboard PRO:", e);
                Swal.fire({ icon: 'error', title: 'Error Inesperado', text: 'No se pudo generar el dashboard del archivo.' });
            }
        };
        /**
        * FUNCIÓN GENERATEPDFREPORT - VERSIÓN CORREGIDA Y OPTIMIZADA
        * Recibe 'manifest' (el objeto completo del manifiesto con .data y .createdAt) como argumento.
        */
        window.generatePdfReport = async function (manifest, folder, name) {
            try {
                const manifestoId = name; // El nombre del archivo es el ID del manifiesto

                // Validación crucial: asegura que manifest y manifest.data existan y sea un array
                if (!manifest || !manifest.data || !Array.isArray(manifest.data)) {
                    throw new Error("Datos del manifiesto no válidos para generar el PDF. Asegúrate de pasar el objeto 'manifest' completo.");
                }

                // Calcular estadísticas usando los datos recibidos. ¡ESTO SOLUCIONA EL ERROR DE FOREACH!
                const stats = calculateProStatistics(manifest.data); // Usamos manifest.data directamente

                // Función de ayuda para convertir los arrays de estadísticas al formato esperado
                const formatTopItems = (topArray, type) => {
                    if (!Array.isArray(topArray)) return [];
                    return topArray.map(([name, count]) => ({
                        [type === 'container' ? 'container' : 'section']: name,
                        missing: count, // Usando 'missing' como conteo general para faltantes/excedentes por consistencia
                        percentage: stats.totalSAP > 0 ? (count / stats.totalSAP) * 100 : 0
                    }));
                };

                const topMissingContainers = formatTopItems(stats.topContenedoresFaltantes, 'container');
                const allMissingSections = formatTopItems(stats.topSeccionesFaltantes, 'section');
                const topExcessContainers = formatTopItems(stats.topContenedoresExcedentes, 'container');

                // Calcular estadísticas por jefe
                const jefaturaStats = new Map();
                manifest.data.forEach(row => { // Aquí usamos manifest.data que ya está reconstruido
                    const seccion = String(row.SECCION || '').trim().toUpperCase();
                    // seccionToJefeMap ya está disponible globalmente y cargado
                    const jefe = seccionToJefeMap.get(seccion) || 'Sin Asignar'; // ¡Aquí se usa el mapa!
                    const sap = Number(row.SAP || 0);
                    const scan = Number(row.SCANNER || 0);
                    const diferencia = scan - sap;

                    if (!jefaturaStats.has(jefe)) {
                        jefaturaStats.set(jefe, {
                            totalSAP: 0,
                            totalSCAN: 0,
                            faltantes: 0,
                            excedentes: 0,
                            secciones: new Set()
                        });
                    }

                    const jefeData = jefaturaStats.get(jefe);
                    jefeData.totalSAP += sap;
                    jefeData.totalSCAN += scan;
                    if (diferencia < 0) jefeData.faltantes += Math.abs(diferencia);
                    if (diferencia > 0) jefeData.excedentes += diferencia;
                    jefeData.secciones.add(seccion);
                });

                // Obtener fecha y hora actual para el reporte
                const now = new Date();
                const fechaCompleta = now.toLocaleDateString('es-MX', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                const horaCompleta = now.toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // Crear el PDF usando pdfMake con diseño ULTRA PROFESIONAL SIN ICONOS
                const docDefinition = {
                    pageSize: 'A4',
                    pageMargins: [35, 85, 35, 85],
                    info: {
                        title: `Dashboard Ejecutivo Premium - ${name}`,
                        author: 'Sistema Integral de Gestión Liverpool',
                        subject: 'Dashboard Ejecutivo y Análisis Estratégico de Inventario',
                        keywords: 'dashboard, ejecutivo, manifiesto, inventario, análisis, liverpool, jefaturas, premium'
                    },

                    // Header Premium
                    header: function (currentPage, pageCount) {
                        return {
                            margin: [35, 15, 35, 0],
                            table: {
                                widths: ['*', 'auto'], // Cambiado a auto para la parte de la página/fecha
                                body: [
                                    [
                                        {
                                            width: '*',
                                            stack: [
                                                {
                                                    text: 'LIVERPOOL',
                                                    style: 'headerBrandMain',
                                                    margin: [0, 0, 0, 2]
                                                },
                                                {
                                                    text: 'DASHBOARD EJECUTIVO PREMIUM',
                                                    style: 'headerBrandSub'
                                                }
                                            ]
                                        },
                                        {
                                            width: 'auto',
                                            stack: [
                                                {
                                                    text: `Página ${currentPage} de ${pageCount}`,
                                                    style: 'pageNumber',
                                                    alignment: 'right'
                                                },
                                                {
                                                    text: fechaCompleta,
                                                    style: 'headerDate',
                                                    alignment: 'right'
                                                }
                                            ]
                                        }
                                    ],
                                ],
                            },
                            layout: { // Esto es para el layout del header, no de todo el doc
                                hLineWidth: function () { return 3; },
                                vLineWidth: function () { return 0; }, // No hay líneas verticales en el header
                                hLineColor: function () { return '#E6007E'; },
                                paddingLeft: function (i, node) { return (i === 0) ? 0 : 8; }, // Padding si es necesario
                                paddingRight: function (i, node) { return (i === node.table.widths.length - 1) ? 0 : 8; },
                                paddingTop: function (i, node) { return 8; },
                                paddingBottom: function (i, node) { return 8; },
                                // Border bottom for the entire header table
                                hLineProperties: function (i, node) {
                                    if (i === node.table.body.length) { // Si es la última línea
                                        return { lineWidth: 3, lineColor: '#E6007E' };
                                    }
                                    return {};
                                },
                            },
                        };
                    },

                    // Footer Premium
                    footer: function (currentPage, pageCount) {
                        return {
                            margin: [35, 0, 35, 15],
                            table: {
                                widths: ['*'],
                                body: [
                                    [
                                        {
                                            text: `Sistema Integral de Gestión Liverpool | Generado el ${fechaCompleta} a las ${horaCompleta} | Confidencial`,
                                            style: 'footerPremium',
                                            alignment: 'center',
                                            // Eliminamos el fillColor si el fondo ya es transparente o claro
                                            // fillColor: '#F8F9FA', // Puede causar bordes si el layout lo aplica a la celda
                                            margin: [10, 8, 10, 8]
                                        }
                                    ]
                                ]
                            },
                            layout: { // Esto es para el layout del footer, no de todo el doc
                                hLineWidth: function () { return 2; },
                                vLineWidth: function () { return 0; }, // No hay líneas verticales en el footer
                                hLineColor: function () { return '#E6007E'; },
                                paddingLeft: function (i, node) { return (i === 0) ? 0 : 8; },
                                paddingRight: function (i, node) { return (i === node.table.widths.length - 1) ? 0 : 8; },
                                paddingTop: function (i, node) { return 8; },
                                paddingBottom: function (i, node) { return 8; },
                                // Border top for the entire footer table
                                hLineProperties: function (i, node) {
                                    if (i === 0) { // Si es la primera línea (arriba del footer)
                                        return { lineWidth: 2, lineColor: '#E6007E' };
                                    }
                                    return {};
                                },
                            }
                        };
                    },

                    content: [
                        // === PORTADA ESPECTACULAR ===
                        {
                            table: {
                                widths: ['*'],
                                body: [
                                    [
                                        {
                                            stack: [
                                                {
                                                    text: 'DASHBOARD EJECUTIVO',
                                                    style: 'portadaTitle',
                                                    alignment: 'center',
                                                    margin: [0, 20, 0, 10]
                                                },
                                                {
                                                    text: 'ANÁLISIS ESTRATÉGICO DE INVENTARIO',
                                                    style: 'portadaSubtitle',
                                                    alignment: 'center',
                                                    margin: [0, 0, 0, 15]
                                                },
                                                {
                                                    table: {
                                                        widths: ['*'],
                                                        body: [
                                                            [
                                                                {
                                                                    text: `${name.replace(/\.xlsx$/i, '')}`,
                                                                    style: 'manifestoName',
                                                                    alignment: 'center',
                                                                    fillColor: '#E6007E',
                                                                    color: 'white',
                                                                    margin: [20, 15, 20, 15]
                                                                }
                                                            ]
                                                        ]
                                                    },
                                                    layout: 'noBorders',
                                                    margin: [50, 0, 50, 15]
                                                },
                                                {
                                                    text: `TIENDA: ${folder}`,
                                                    style: 'tiendaInfo',
                                                    alignment: 'center',
                                                    margin: [0, 0, 0, 20]
                                                }
                                            ],
                                            fillColor: '#FAFBFC',
                                            margin: [25, 25, 25, 25]
                                        }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: function () { return 4; },
                                vLineWidth: function () { return 4; },
                                hLineColor: function () { return '#E6007E'; },
                                vLineColor: function () { return '#E6007E'; }
                            },
                            margin: [0, 0, 0, 30]
                        },

                        // === MÉTRICAS PRINCIPALES ESPECTACULARES ===
                        {
                            text: 'MÉTRICAS PRINCIPALES',
                            style: 'sectionTitlePremium',
                            margin: [0, 0, 0, 20]
                        },
                        {
                            columns: [
                                {
                                    width: '23%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'TOTAL',
                                                            style: 'metricLabel',
                                                            color: '#2196F3',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 8]
                                                        },
                                                        {
                                                            text: stats.totalSKUs.toLocaleString(),
                                                            style: 'metricNumber',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: 'SKUs',
                                                            style: 'metricSubLabel',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#E3F2FD',
                                                    margin: [12, 18, 12, 18]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 3,
                                        vLineWidth: () => 3,
                                        hLineColor: () => '#2196F3',
                                        vLineColor: () => '#2196F3'
                                    }
                                },
                                { width: '2%', text: '' },
                                {
                                    width: '23%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'ESPERADO',
                                                            style: 'metricLabel',
                                                            color: '#9C27B0',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 8]
                                                        },
                                                        {
                                                            text: stats.totalSAP.toLocaleString(),
                                                            style: 'metricNumber',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: 'UNIDADES',
                                                            style: 'metricSubLabel',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#F3E5F5',
                                                    margin: [12, 18, 12, 18]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 3,
                                        vLineWidth: () => 3,
                                        hLineColor: () => '#9C27B0',
                                        vLineColor: () => '#9C27B0'
                                    }
                                },
                                { width: '2%', text: '' },
                                {
                                    width: '23%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'ESCANEADO',
                                                            style: 'metricLabel',
                                                            color: '#4CAF50',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 8]
                                                        },
                                                        {
                                                            text: stats.totalSCAN.toLocaleString(),
                                                            style: 'metricNumber',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: 'UNIDADES',
                                                            style: 'metricSubLabel',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#E8F5E8',
                                                    margin: [12, 18, 12, 18]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 3,
                                        vLineWidth: () => 3,
                                        hLineColor: () => '#4CAF50',
                                        vLineColor: () => '#4CAF50'
                                    }
                                },
                                { width: '2%', text: '' },
                                {
                                    width: '25%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'PROGRESO',
                                                            style: 'metricLabel',
                                                            color: '#FF9800',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 8]
                                                        },
                                                        {
                                                            text: `${stats.avance}%`,
                                                            style: 'metricNumber',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: 'COMPLETADO',
                                                            style: 'metricSubLabel',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#FFF3E0',
                                                    margin: [12, 18, 12, 18]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 3,
                                        vLineWidth: () => 3,
                                        hLineColor: () => '#FF9800',
                                        vLineColor: () => '#FF9800'
                                    }
                                }
                            ],
                            margin: [0, 0, 0, 30]
                        },

                        // === INDICADORES DE ESTADO ===
                        {
                            text: 'INDICADORES DE ESTADO',
                            style: 'sectionTitlePremium',
                            margin: [0, 0, 0, 20]
                        },
                        {
                            columns: [
                                {
                                    width: '48%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'FALTANTES',
                                                            style: 'indicatorTitle',
                                                            color: '#DC3545',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 10]
                                                        },
                                                        {
                                                            text: stats.faltantes.toLocaleString(),
                                                            style: 'indicatorNumber',
                                                            color: '#DC3545',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: `${((stats.faltantes / (stats.totalSAP || 1)) * 100).toFixed(2)}% del total`,
                                                            style: 'indicatorPercent',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#F8D7DA',
                                                    margin: [15, 20, 15, 20]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 2,
                                        vLineWidth: () => 2,
                                        hLineColor: () => '#DC3545',
                                        vLineColor: () => '#DC3545'
                                    }
                                },
                                { width: '4%', text: '' },
                                {
                                    width: '48%',
                                    table: {
                                        widths: ['*'],
                                        body: [
                                            [
                                                {
                                                    stack: [
                                                        {
                                                            text: 'EXCEDENTES',
                                                            style: 'indicatorTitle',
                                                            color: '#FFC107',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 10]
                                                        },
                                                        {
                                                            text: stats.excedentes.toLocaleString(),
                                                            style: 'indicatorNumber',
                                                            color: '#FFC107',
                                                            alignment: 'center',
                                                            margin: [0, 0, 0, 5]
                                                        },
                                                        {
                                                            text: `${((stats.excedentes / (stats.totalSAP || 1)) * 100).toFixed(2)}% del total`,
                                                            style: 'indicatorPercent',
                                                            alignment: 'center'
                                                        }
                                                    ],
                                                    fillColor: '#FFF3CD',
                                                    margin: [15, 20, 15, 20]
                                                }
                                            ]
                                        ]
                                    },
                                    layout: {
                                        hLineWidth: () => 2,
                                        vLineWidth: () => 2,
                                        hLineColor: () => '#FFC107',
                                        vLineColor: () => '#FFC107'
                                    }
                                }
                            ],
                            margin: [0, 0, 0, 30]
                        },

                        // === ANÁLISIS POR JEFATURAS PREMIUM ===
                        {
                            text: 'ANÁLISIS POR JEFATURAS',
                            style: 'sectionTitlePremium',
                            margin: [0, 0, 0, 20]
                        },
                        {
                            table: {
                                headerRows: 1,
                                widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
                                body: [
                                    [
                                        { text: 'JEFE', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' },
                                        { text: 'ESPERADO', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' },
                                        { text: 'ESCANEADO', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' },
                                        { text: 'FALTANTES', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' },
                                        { text: 'EXCEDENTES', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' },
                                        { text: 'SECCIONES', style: 'tableHeaderPremium', fillColor: '#E6007E', color: 'white' }
                                    ],
                                    ...Array.from(jefaturaStats.entries())
                                        .sort((a, b) => b[1].faltantes - a[1].faltantes)
                                        .map(([jefe, data], index) => [
                                            { text: jefe, style: 'tableCell', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: data.totalSAP.toLocaleString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: data.totalSCAN.toLocaleString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: data.faltantes.toLocaleString(), style: 'tableCellNumber', color: data.faltantes > 0 ? '#DC3545' : '#28A745', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: data.excedentes.toLocaleString(), style: 'tableCellNumber', color: data.excedentes > 0 ? '#FFC107' : '#28A745', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: data.secciones.size.toString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' }
                                        ])
                                ]
                            },
                            layout: {
                                hLineWidth: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? 2 : 1; },
                                vLineWidth: function () { return 1; },
                                hLineColor: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? '#E6007E' : '#DEE2E6'; },
                                vLineColor: function () { return '#DEE2E6'; }
                            },
                            margin: [0, 0, 0, 30]
                        },

                        // === TOP 15 CONTENEDORES FALTANTES ===
                        ...(topMissingContainers.length > 0 ? [
                            {
                                text: 'TOP 15 CONTENEDORES CON FALTANTES',
                                style: 'sectionTitlePremium',
                                margin: [0, 0, 0, 20]
                            },
                            {
                                table: {
                                    headerRows: 1,
                                    widths: ['auto', '*', 'auto', 'auto'],
                                    body: [
                                        [
                                            { text: 'No.', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'CONTENEDOR', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'FALTANTES', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'PORCENTAJE', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' }
                                        ],
                                        ...topMissingContainers.slice(0, 15).map((item, index) => [
                                            { text: (index + 1).toString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.container, style: 'tableCell', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.missing.toLocaleString(), style: 'tableCellNumber', color: '#DC3545', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: `${item.percentage.toFixed(2)}%`, style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' }
                                        ])
                                    ]
                                },
                                layout: {
                                    hLineWidth: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? 2 : 1; },
                                    vLineWidth: function () { return 1; },
                                    hLineColor: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? '#DC3545' : '#DEE2E6'; },
                                    vLineColor: function () { return '#DEE2E6'; }
                                },
                                margin: [0, 0, 0, 30]
                            }
                        ] : []),

                        // === TODAS LAS SECCIONES CON FALTANTES ===
                        ...(allMissingSections.length > 0 ? [
                            {
                                text: 'TODAS LAS SECCIONES CON FALTANTES',
                                style: 'sectionTitlePremium',
                                margin: [0, 0, 0, 20]
                            },
                            {
                                table: {
                                    headerRows: 1,
                                    widths: ['auto', '*', 'auto', 'auto'],
                                    body: [
                                        [
                                            { text: 'No.', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'SECCIÓN', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'FALTANTES', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' },
                                            { text: 'PORCENTAJE', style: 'tableHeaderPremium', fillColor: '#DC3545', color: 'white' }
                                        ],
                                        ...allMissingSections.map((item, index) => [
                                            { text: (index + 1).toString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.section, style: 'tableCell', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.missing.toLocaleString(), style: 'tableCellNumber', color: '#DC3545', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: `${item.percentage.toFixed(2)}%`, style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' }
                                        ])
                                    ]
                                },
                                layout: {
                                    hLineWidth: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? 2 : 1; },
                                    vLineWidth: function () { return 1; },
                                    hLineColor: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? '#DC3545' : '#DEE2E6'; },
                                    vLineColor: function () { return '#DEE2E6'; }
                                },
                                margin: [0, 0, 0, 30]
                            }
                        ] : []),

                        // === TOP 10 CONTENEDORES EXCEDENTES (si existen) ===
                        ...(topExcessContainers.length > 0 ? [
                            {
                                text: 'TOP 10 CONTENEDORES CON EXCEDENTES',
                                style: 'sectionTitlePremium',
                                margin: [0, 0, 0, 20]
                            },
                            {
                                table: {
                                    headerRows: 1,
                                    widths: ['auto', '*', 'auto', 'auto'],
                                    body: [
                                        [
                                            { text: 'No.', style: 'tableHeaderPremium', fillColor: '#FFC107', color: 'white' },
                                            { text: 'CONTENEDOR', style: 'tableHeaderPremium', fillColor: '#FFC107', color: 'white' },
                                            { text: 'EXCEDENTES', style: 'tableHeaderPremium', fillColor: '#FFC107', color: 'white' },
                                            { text: 'PORCENTAJE', style: 'tableHeaderPremium', fillColor: '#FFC107', color: 'white' }
                                        ],
                                        ...topExcessContainers.slice(0, 10).map((item, index) => [
                                            { text: (index + 1).toString(), style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.container, style: 'tableCell', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: item.missing.toLocaleString(), style: 'tableCellNumber', color: '#FFC107', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' },
                                            { text: `${item.percentage.toFixed(2)}%`, style: 'tableCellNumber', fillColor: index % 2 === 0 ? '#F8F9FA' : '#FFFFFF' }
                                        ])
                                    ]
                                },
                                layout: {
                                    hLineWidth: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? 2 : 1; },
                                    vLineWidth: function () { return 1; },
                                    hLineColor: function (i, node) { return i === 0 || i === 1 || i === node.table.body.length ? '#FFC107' : '#DEE2E6'; },
                                    vLineColor: function () { return '#DEE2E6'; }
                                },
                                margin: [0, 0, 0, 30]
                            }
                        ] : []),

                        // === RESUMEN ESTADÍSTICO DETALLADO ===
                        {
                            text: 'RESUMEN ESTADÍSTICO DETALLADO',
                            style: 'sectionTitlePremium',
                            margin: [0, 0, 0, 20]
                        },
                        {
                            table: {
                                widths: ['*', '*'],
                                body: [
                                    [
                                        {
                                            stack: [
                                                { text: 'ANÁLISIS DE PRECISIÓN DE INVENTARIO', style: 'summaryTitle', margin: [0, 0, 0, 10] },
                                                { text: `Precisión General: ${stats.avance}%`, style: 'summaryItem' },
                                                { text: `SKUs Procesados: ${stats.totalSKUs.toLocaleString()}`, style: 'summaryItem' },
                                                { text: `Unidades Esperadas: ${stats.totalSAP.toLocaleString()}`, style: 'summaryItem' },
                                                { text: `Unidades Escaneadas: ${stats.totalSCAN.toLocaleString()}`, style: 'summaryItem' },
                                                { text: `Diferencia Total: ${(stats.totalSCAN - stats.totalSAP).toLocaleString()}`, style: 'summaryItem' }
                                            ],
                                            fillColor: '#F8F9FA',
                                            margin: [15, 15, 15, 15]
                                        },
                                        {
                                            stack: [
                                                { text: 'DISTRIBUCIÓN DE DISCREPANCIAS', style: 'summaryTitle', margin: [0, 0, 0, 10] },
                                                { text: `Faltantes: ${stats.faltantes.toLocaleString()} (${((stats.faltantes / (stats.totalSAP || 1)) * 100).toFixed(2)}%)`, style: 'summaryItem', color: '#DC3545' },
                                                { text: `Excedentes: ${stats.excedentes.toLocaleString()} (${((stats.excedentes / (stats.totalSAP || 1)) * 100).toFixed(2)}%)`, style: 'summaryItem', color: '#FFC107' },
                                                { text: `Contenedores con Faltantes: ${topMissingContainers.length}`, style: 'summaryItem' },
                                                { text: `Secciones con Faltantes: ${allMissingSections.length}`, style: 'summaryItem' },
                                                { text: `Contenedores con Excedentes: ${topExcessContainers.length}`, style: 'summaryItem' }
                                            ],
                                            fillColor: '#F8F9FA',
                                            margin: [15, 15, 15, 15]
                                        }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: () => 2,
                                vLineWidth: () => 2,
                                hLineColor: () => '#E6007E',
                                vLineColor: () => '#E6007E'
                            },
                            margin: [0, 0, 0, 30]
                        },

                        // === CONCLUSIONES Y RECOMENDACIONES MEJORADAS ===
                        {
                            text: 'CONCLUSIONES EJECUTIVAS Y PLAN DE ACCIÓN',
                            style: 'sectionTitlePremium',
                            margin: [0, 0, 0, 20]
                        },
                        {
                            table: {
                                widths: ['*'],
                                body: [
                                    [
                                        {
                                            stack: [
                                                { text: 'ANÁLISIS EJECUTIVO', style: 'conclusionTitle', margin: [0, 0, 0, 15] },
                                                {
                                                    text: stats.avance >= 95 ?
                                                        'EXCELENTE: El inventario presenta una precisión excepcional. Se recomienda mantener los procesos actuales.' :
                                                        stats.avance >= 85 ?
                                                            'BUENO: El inventario muestra una precisión aceptable con oportunidades de mejora en áreas específicas.' :
                                                            stats.avance >= 70 ?
                                                                'REGULAR: Se requiere atención inmediata en las discrepancias identificadas para mejorar la precisión.' :
                                                                'CRÍTICO: Se necesita una revisión completa del proceso de inventario y acciones correctivas urgentes.',
                                                    style: 'conclusionText',
                                                    margin: [0, 0, 0, 15]
                                                },
                                                { text: 'RECOMENDACIONES ESTRATÉGICAS', style: 'conclusionTitle', margin: [0, 0, 0, 15] },
                                                {
                                                    ul: [
                                                        stats.faltantes > stats.excedentes ?
                                                            'Priorizar la búsqueda de productos faltantes en las secciones identificadas' :
                                                            'Revisar procesos de recepción para reducir excedentes',
                                                        'Implementar controles adicionales en los contenedores con mayor discrepancia',
                                                        'Capacitar al personal de las jefaturas con mayor número de faltantes',
                                                        'Establecer un programa de auditorías periódicas en las secciones críticas',
                                                        'Mejorar la comunicación entre jefaturas para optimizar la distribución de inventario'
                                                    ],
                                                    style: 'recommendationList'
                                                }
                                            ],
                                            fillColor: '#F0F8FF',
                                            margin: [20, 20, 20, 20]
                                        }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: () => 3,
                                vLineWidth: () => 3,
                                hLineColor: () => '#E6007E',
                                vLineColor: () => '#E6007E'
                            },
                            margin: [0, 0, 0, 20]
                        },

                        // === INFORMACIÓN DE GENERACIÓN ===
                        {
                            table: {
                                widths: ['*'],
                                body: [
                                    [
                                        {
                                            text: `Reporte generado automáticamente el ${fechaCompleta} a las ${horaCompleta} | Sistema Integral de Gestión Liverpool`,
                                            style: 'generationInfo',
                                            alignment: 'center',
                                            fillColor: '#F8F9FA',
                                            margin: [10, 10, 10, 10]
                                        }
                                    ]
                                ]
                            },
                            layout: {
                                hLineWidth: () => 1,
                                vLineWidth: () => 1,
                                hLineColor: () => '#DEE2E6',
                                vLineColor: () => '#DEE2E6'
                            }
                        }
                    ],

                    // === ESTILOS PREMIUM ULTRA PROFESIONALES ===
                    styles: {
                        // Headers y Branding
                        headerBrandMain: { fontSize: 16, bold: true, color: '#E6007E' },
                        headerBrandSub: { fontSize: 10, color: '#6C757D' },
                        pageNumber: { fontSize: 9, color: '#6C757D' },
                        headerDate: { fontSize: 8, color: '#6C757D' },
                        footerPremium: { fontSize: 8, color: '#6C757D', italics: true },

                        // Portada
                        portadaTitle: { fontSize: 28, bold: true, color: '#E6007E' },
                        portadaSubtitle: { fontSize: 16, color: '#6C757D' },
                        manifestoName: { fontSize: 18, bold: true },
                        tiendaInfo: { fontSize: 14, color: '#495057' },

                        // Títulos de Sección
                        sectionTitlePremium: { fontSize: 16, bold: true, color: '#E6007E', margin: [0, 20, 0, 10] },

                        // Métricas
                        metricLabel: { fontSize: 11, bold: true },
                        metricNumber: { fontSize: 24, bold: true, color: '#212529' },
                        metricSubLabel: { fontSize: 9, color: '#6C757D' },

                        // Indicadores
                        indicatorTitle: { fontSize: 14, bold: true },
                        indicatorNumber: { fontSize: 20, bold: true },
                        indicatorPercent: { fontSize: 10, color: '#6C757D' },

                        // Tablas
                        tableHeaderPremium: { fontSize: 11, bold: true, alignment: 'center' },
                        tableCell: { fontSize: 10, margin: [5, 5, 5, 5] },
                        tableCellNumber: { fontSize: 10, alignment: 'right', margin: [5, 5, 5, 5] },

                        // Resumen
                        summaryTitle: { fontSize: 12, bold: true, color: '#E6007E' },
                        summaryItem: { fontSize: 10, margin: [0, 2, 0, 2] },

                        // Conclusiones
                        conclusionTitle: { fontSize: 14, bold: true, color: '#E6007E' },
                        conclusionText: { fontSize: 11, lineHeight: 1.4 },
                        recommendationList: { fontSize: 10, lineHeight: 1.3 },

                        // Información de generación
                        generationInfo: { fontSize: 8, color: '#6C757D', italics: true }
                    }
                };

                // Generar y descargar el PDF
                const pdfDoc = pdfMake.createPdf(docDefinition);
                pdfDoc.download(`Dashboard_Ejecutivo_${name.replace(/\.xlsx$/i, '')}_${folder}_${now.toISOString().slice(0, 10)}.pdf`);

                console.log("PDF generado exitosamente");
                return true;

            } catch (error) {
                console.error("Error al generar el PDF:", error);
                alert("Error al generar el PDF: " + error.message);
                return false;
            }
        };
        async function loadSeccionToJefeMap() {
            try {
                const seccionesURL = await storage.ref('ExcelManifiestos/Secciones.xlsx').getDownloadURL();
                const seccionesBuffer = await (await fetch(seccionesURL)).arrayBuffer();
                const seccionesWB = XLSX.read(seccionesBuffer, { type: 'array' });

                const findSheetName = (workbook) => {
                    const possibleNames = ["jefatura sil", "jefaturaa", "secciones"]; // Se añadió "secciones" para mayor robustez
                    return workbook.SheetNames.find(sheet => possibleNames.includes(sheet.trim().toLowerCase())) || workbook.SheetNames[0];
                };
                const sheetName = findSheetName(seccionesWB);
                if (!sheetName) throw new Error(`No se encontró una hoja de cálculo en Secciones.xlsx.`);

                const worksheet = seccionesWB.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                if (data.length < 1) throw new Error(`La hoja "${sheetName}" está vacía.`);

                let headerRowIndex = -1, seccionIndex = -1, jefaturaIndex = -1;
                for (let i = 0; i < Math.min(5, data.length); i++) {
                    const headers = data[i].map(h => String(h || '').trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
                    const tempSeccionIndex = headers.indexOf('seccion');
                    const tempJefaturaIndex = headers.indexOf('jefatura');
                    if (tempSeccionIndex !== -1 && tempJefaturaIndex !== -1) {
                        headerRowIndex = i; seccionIndex = tempSeccionIndex; jefaturaIndex = tempJefaturaIndex;
                        break;
                    }
                }

                if (headerRowIndex === -1) throw new Error(`No se encontraron las columnas "Seccion" y "Jefatura" en Secciones.xlsx.`);

                for (let i = headerRowIndex + 1; i < data.length; i++) {
                    const row = data[i];
                    const seccion = String(row[seccionIndex] || '').trim().toUpperCase();
                    const jefe = String(row[jefaturaIndex] || 'Sin Asignar').trim();
                    if (seccion) seccionToJefeMap.set(seccion, jefe);
                }
                console.log("SeccionToJefeMap cargado:", seccionToJefeMap);
            } catch (error) {
                console.error("Error al cargar SeccionToJefeMap:", error);
                Swal.fire('Error de Carga', 'No se pudo cargar el archivo de secciones/jefaturas. Las funciones de reporte pueden no ser precisas.', 'error');
            }
        }
        /**
         * ✅ SOLUCIÓN FINAL (V.5.3) - ASUNTO CON FECHA DE SUBIDA
         * Integra el mensaje específico del usuario, un resumen claro y añade la fecha al asunto del correo.
         */
        // Versión optimizada: genera Excel, PDF, captura imagen y abre el correo (sin duplicados)
        // - Elimina doble llamada a generatePdfReport
        // - Abre el cliente de correo de forma más confiable
        // - Copia cuerpo completo al portapapeles si excede límites del mailto
        window.generarReportesYCorreo = async (folder, name) => {
            const startClickTime = Date.now();
            Swal.fire({
                title: 'Generando reportes...',
                html: 'Procesando manifiesto, por favor espera.',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                // 1. Reconstruir datos más recientes
                const manifest = await reconstructManifestDataFromFirebase(name);
                if (!manifest || !manifest.data) throw new Error('No se pudo reconstruir el manifiesto.');
                const stats = calculateProStatistics(manifest.data);

                // 2. Excel
                await window.downloadFile(folder, name);

                // 3. PDF (una sola vez)
                await window.generatePdfReport(manifest, folder, name);

                // 4. Abrir dashboard (para captura)
                await window.verDashboardArchivo(folder, name);
                // Esperar a que el DOM del dashboard se pinte
                await new Promise(r => setTimeout(r, 1200));

                const dashboardModal = document.querySelector('.swal2-popup.dashboard-modal');
                const contentToCapture = dashboardModal?.querySelector('.analisis-dashboard-pro');
                let imageURL = null;

                if (contentToCapture) {
                    // Forzar estilos simples para captura
                    const statCards = contentToCapture.querySelectorAll('.stat-card');
                    const original = [];
                    statCards.forEach(c => {
                        original.push({
                            card: c,
                            css: c.style.cssText,
                            val: c.querySelector('.stat-value')?.style.cssText || '',
                            ttl: c.querySelector('.stat-title')?.style.cssText || ''
                        });
                        c.style.animation = 'none';
                        c.style.transition = 'none';
                        c.style.boxShadow = 'none';
                        c.style.background = '#ffffff';
                    });
                    const canvas = await html2canvas(contentToCapture, {
                        scale: 2,
                        backgroundColor: '#FFFFFF',
                        useCORS: true,
                        logging: false
                    });
                    original.forEach(o => {
                        o.card.style.cssText = o.css;
                        const v = o.card.querySelector('.stat-value'); if (v) v.style.cssText = o.val;
                        const t = o.card.querySelector('.stat-title'); if (t) t.style.cssText = o.ttl;
                    });
                    imageURL = canvas.toDataURL('image/jpeg', 0.92);
                    // Descargar imagen
                    const aImg = document.createElement('a');
                    aImg.href = imageURL;
                    aImg.download = `Dashboard_${name.replace(/\.xlsx$/i, '')}.jpg`;
                    document.body.appendChild(aImg);
                    aImg.click();
                    aImg.remove();
                }

                // Cerrar dashboard antes de abrir correo
                Swal.close();

                // 5. Preparar correo
                const baseName = name.replace(/\.xlsx$/i, '');
                const ts = manifest.createdAt;
                let upDate;
                try {
                    if (ts && typeof ts.toDate === 'function') upDate = ts.toDate();
                    else if (ts instanceof Date) upDate = ts;
                    else upDate = new Date();
                } catch { upDate = new Date(); }

                const formattedDate = upDate.toLocaleDateString('es-MX', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric'
                });

                const correos = [
                    'bplopezr@liverpool.com.mx',
                    'eirojas@liverpool.com.mx',
                    'babanuelosr@liverpool.com.mx',
                    'amoralesp@liverpool.com.mx',
                    'agavila@liverpool.com.mx',
                    'jjmendozaa@liverpool.com.mx',
                    'jfdominguezb@liverpool.com.mx',
                    'yymatasm@liverpool.com.mx',
                    'mireyesb@liverpool.com.mx',
                    'lcastillor@liverpool.com.mx',
                    'oamuedanov@liverpool.com.mx',
                    'ecoronadoh@liverpool.com.mx',
                    'jgonzalezs14@liverpool.com.mx',
                    'edcastilloj@liverpool.com.mx',
                    'ygtiripitig@liverpool.com.mx',
                    'pgrochag@liverpool.com.mx',
                    'rlizcanoc@liverpool.com.mx',
                    'mavallesa@liverpool.com.mx',
                    'aaprietor@liverpool.com.mx',
                    'xespindolap@liverpool.com.mx',
                    'aklopezl@liverpool.com.mx',
                    'aevazquezn@liverpool.com.mx',
                    'ajramosh@liverpool.com.mx'
                ].join(',');

                // Mensaje estratégico
                let mensajeAvance;
                if (stats.avance >= 100) {
                    mensajeAvance = `100% alcanzado${stats.excedentes ? ' (con excedentes a validar)' : ''}. Proceder a validación final.`;
                } else if (stats.avance >= 95) mensajeAvance = `≥95%: remate final, enfocar ${stats.faltantes} faltantes.`;
                else if (stats.avance >= 85) mensajeAvance = `≥85%: consolidar avance, priorizar faltantes críticos.`;
                else if (stats.avance >= 70) mensajeAvance = `≥70%: buen ritmo, redistribuir a zonas rezagadas.`;
                else if (stats.avance >= 50) mensajeAvance = `≥50%: impulso necesario; vigilar disciplina de captura.`;
                else mensajeAvance = `<50%: reforzar supervisión y foco en alto volumen.`;

                const saludo = (() => {
                    const h = new Date().getHours();
                    if (h < 12) return 'Buenos días';
                    if (h < 19) return 'Buenas tardes';
                    return 'Buenas noches';
                })();

                const cuerpoCompleto =
                    `${saludo} equipo:

    Análisis actualizado del manifiesto: ${baseName} (${formattedDate})
    ${mensajeAvance}

    Resumen:
    - Avance: ${stats.avance}%
    - SAP: ${stats.totalSAP.toLocaleString('es-MX')}
    - Escaneado: ${stats.totalSCAN.toLocaleString('es-MX')}
    - Diferencia: ${(stats.totalSCAN - stats.totalSAP).toLocaleString('es-MX')}
    - Faltantes: ${stats.faltantes.toLocaleString('es-MX')}
    - Excedentes: ${stats.excedentes.toLocaleString('es-MX')}

    Acciones:
    ${stats.faltantes ? `• Recuperar ${stats.faltantes.toLocaleString('es-MX')} faltantes.\n` : '• Sin faltantes.\n'}${stats.excedentes ? `• Auditar ${stats.excedentes.toLocaleString('es-MX')} excedentes.\n` : '• Sin excedentes.\n'}• Validar contenedores críticos.
    • Asegurar evidencia en discrepancias.

    Adjuntar manualmente:
    1. Excel detalle
    2. PDF Ejecutivo
    3. Captura dashboard

    Atento a indicaciones.

    Sistema Integral de Gestión Liverpool`;

                const subject = `Manifiesto ${baseName} - ${formattedDate} (${stats.avance}% Avance)`;

                // mailto (acortado si es largo)
                let bodyParaMailto = cuerpoCompleto;
                const MAILTO_LIMIT = 1800;
                let cuerpoCopiado = false;
                if (bodyParaMailto.length > MAILTO_LIMIT) {
                    bodyParaMailto = cuerpoCompleto.slice(0, MAILTO_LIMIT - 120) + '\n[...] (Texto completo copiado al portapapeles)';
                    try {
                        await navigator.clipboard.writeText(cuerpoCompleto);
                        cuerpoCopiado = true;
                    } catch { cuerpoCopiado = false; }
                }

                const mailto = `mailto:${encodeURIComponent(correos)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyParaMailto)}`;

                // Pequeño delay para garantizar cierre de Swal
                await new Promise(r => setTimeout(r, 150));

                // Abrir correo (ancla invisible mejora compatibilidad)
                const a = document.createElement('a');
                a.href = mailto;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 1000);

                Swal.fire({
                    icon: 'success',
                    title: 'Reportes listos',
                    html: `Se generaron Excel, PDF y captura.<br>${cuerpoCopiado ? 'El cuerpo completo se copió al portapapeles.' : 'Si el cuerpo es muy largo y no aparece completo, pegar manualmente.'}`,
                    confirmButtonText: 'OK'
                });

            } catch (err) {
                console.error(err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: err.message || 'Fallo en la generación de reportes.'
                });
            }
        };
        /**
        * ✅ VERSIÓN FINAL (17.0) - ¡SOLUCIÓN FINAL Y ROBUSTA PARA CAMPOS VACÍOS!
        * Maneja DAÑO_CANTIDAD y DAÑO_FOTO_URL para que queden vacíos si no hay información.
        * - MANIFIESTO, SKU, EUROPEO, ENTREGADO_A: Numérico entero SIN separador de miles (formato Excel '0').
        * - CONTENEDOR: Siempre TEXTO (sin conversiones numéricas).
        * - SAP, SCANNER, DIFERENCIA: Numérico con separador de miles (formato Excel '#,##0').
        * - DAÑO_CANTIDAD: Numérico sin comas (formato '0'), o vacío si es 0/null/undefined/cadena vacía.
        * - DAÑO_FOTO_URL: Texto, o vacío si es null/undefined/cadena vacía.
        */
        window.downloadFile = async function (folder, name) {
            const manifestoId = name;
            if (!manifestoId) return Swal.fire('Error', 'No se ha seleccionado manifiesto.', 'error');

            // --- VERIFICACIÓN CRÍTICA: ¿xlsx-js-style está cargado? ---
            try {
                const test_wb = XLSX.utils.book_new();
                const test_ws = XLSX.utils.aoa_to_sheet([["Test"]]);
                const cell = test_ws['A1'];
                cell.s = { fill: { fgColor: { rgb: "FF0000" } } };
            } catch (e) {
                console.error("Error al verificar xlsx-js-style:", e);
                return Swal.fire(
                    'Error de Configuración',
                    'Parece que la librería "xlsx-js-style" no está cargada correctamente o en la versión adecuada. ' +
                    'Asegúrate de que `xlsx.full.min.js` se cargue primero y luego `xlsx.bundle.js` de "xlsx-js-style".',
                    'error'
                );
            }
            // --- FIN VERIFICACIÓN CRÍTICA ---

            Swal.fire({
                title: 'Generando Reporte Profesional...',
                html: 'Creando dashboard y hojas de análisis. Por favor, espera.',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                // --- Paso 1: Cargar y procesar el archivo de Jefaturas ---
                const seccionToJefeMap = new Map();
                try {
                    const seccionesURL = await storage.ref('ExcelManifiestos/Secciones.xlsx').getDownloadURL();
                    const seccionesBuffer = await (await fetch(seccionesURL)).arrayBuffer();
                    const seccionesWB = XLSX.read(seccionesBuffer, { type: 'array' });

                    const findSheetName = (workbook) => {
                        const possibleNames = ["jefatura sil", "jefaturaa"];
                        return workbook.SheetNames.find(sheet => possibleNames.includes(sheet.trim().toLowerCase())) || workbook.SheetNames[0];
                    };
                    const sheetName = findSheetName(seccionesWB);
                    if (!sheetName) throw new Error(`No se encontró una hoja de cálculo en Secciones.xlsx.`);

                    const worksheet = seccionesWB.Sheets[sheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    if (data.length < 1) throw new Error(`La hoja "${sheetName}" está vacía.`);

                    let headerRowIndex = -1, seccionIndex = -1, jefaturaIndex = -1;
                    for (let i = 0; i < Math.min(5, data.length); i++) {
                        const headers = data[i].map(h => String(h || '').trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
                        const tempSeccionIndex = headers.indexOf('seccion');
                        const tempJefaturaIndex = headers.indexOf('jefatura');
                        if (tempSeccionIndex !== -1 && tempJefaturaIndex !== -1) {
                            headerRowIndex = i; seccionIndex = tempSeccionIndex; jefaturaIndex = tempJefaturaIndex;
                            break;
                        }
                    }

                    if (headerRowIndex === -1) throw new Error(`No se encontraron las columnas "Seccion" y "Jefatura".`);

                    for (let i = headerRowIndex + 1; i < data.length; i++) {
                        const row = data[i];
                        const seccion = String(row[seccionIndex] || '').trim().toUpperCase();
                        const jefe = String(row[jefaturaIndex] || 'Sin Asignar').trim();
                        if (seccion) seccionToJefeMap.set(seccion, jefe);
                    }
                } catch (error) {
                    throw new Error("Error al leer Secciones.xlsx: " + error.message);
                }

                // --- Paso 2: Obtener y procesar datos del manifiesto ---
                const manifest = await reconstructManifestDataFromFirebase(manifestoId);

                // --- DEFINICIÓN CLAVE DE CÓMO SE PROCESAN Y CATEGORIZAN LAS COLUMNAS ---
                // Columnas que deben ser NUMEROS con separador de miles (ej. 1,234)
                const numericWithCommaFormatKeys = ['SAP', 'SCANNER', 'DIFERENCIA']; // Se añade DIFERENCIA aquí
                // Columnas que deben ser NUMEROS largos SIN separador de miles (ej. 5007636731).
                // Se incluyen aquí 'DAÑO_CANTIDAD' para tratarlo como número.
                const numericNoCommaFormatKeys = ['MANIFIESTO', 'SKU', 'EUROPEO', 'ENTREGADO_A', 'DAÑO_CANTIDAD'];
                // Columnas que SIEMPRE deben ser TEXTO (ej. Q0084429, URLs).
                // Se incluye aquí 'DAÑO_FOTO_URL'.
                const textFormatKeys = ['CONTENEDOR', 'SECCION', 'JEFATURA', 'DAÑO_FOTO_URL'];

                const augmentedData = manifest.data.map(row => {
                    const newRow = {};

                    // Mapear los nombres de las columnas a sus valores en el row, independientemente del casing
                    const findValueByKey = (obj, keyName) => {
                        const foundKey = Object.keys(obj).find(k => k.trim().toUpperCase() === keyName.toUpperCase());
                        return foundKey ? obj[foundKey] : undefined;
                    };

                    for (const originalKey in row) {
                        const upperKey = originalKey.trim().toUpperCase();
                        let value = row[originalKey];

                        // === LÓGICA PRINCIPAL PARA DEJAR CAMPOS VACÍOS ===
                        // Si el valor es null, undefined, o un string vacío/solo espacios
                        // O si es DAÑO_CANTIDAD y su valor es 0 (que se convertiría a 00/01/1900)
                        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ||
                            (upperKey === 'DAÑO_CANTIDAD' && (value === 0 || value === '0'))) { // Condición específica para DAÑO_CANTIDAD
                            newRow[originalKey] = null; // Establecer a null para que quede vacío en Excel
                            continue; // Saltar al siguiente campo
                        }
                        // === FIN LÓGICA PRINCIPAL PARA DEJAR CAMPOS VACÍOS ===


                        if (textFormatKeys.includes(upperKey)) {
                            newRow[originalKey] = String(value); // Asegurar que es string si tiene algún valor
                            continue;
                        }

                        if (typeof value === 'string') {
                            // Para columnas que deben ser números, limpiar y convertir
                            const cleanedValue = value.replace(/,/g, ''); // Eliminar todas las comas del string original
                            const numValue = Number(cleanedValue);

                            if (isNaN(numValue)) {
                                // Si después de limpiar comas, NO es un número válido, mantenerlo como string
                                newRow[originalKey] = String(value);
                            } else {
                                // Si es un número válido, convertirlo
                                newRow[originalKey] = numValue;
                            }
                        } else {
                            // Si ya es un número o cualquier otro tipo, mantenerlo
                            newRow[originalKey] = value;
                        }
                    }

                    // Añadir la jefatura como antes
                    const seccionKey = Object.keys(newRow).find(k => k.trim().toUpperCase() === 'SECCION');
                    const seccionValue = seccionKey ? newRow[seccionKey] : '';
                    const seccion = String(seccionValue || '').trim().toUpperCase();
                    const jefe = seccionToJefeMap.get(seccion) || 'Sin Jefe Asignar';
                    newRow.JEFATURA = jefe;

                    // Añadir la columna DIFERENCIA
                    const sapValue = Number(findValueByKey(newRow, 'SAP') || 0);
                    const scannerValue = Number(findValueByKey(newRow, 'SCANNER') || 0);
                    newRow.DIFERENCIA = scannerValue - sapValue;

                    return newRow;
                });

                // Asegurarse de que JEFATURA esté en la primera posición para la vista en Excel (esto es por el .sort)
                augmentedData.sort((a, b) => {
                    const jefaturaA = a.JEFATURA || ''; // Manejar si JEFATURA es null
                    const jefaturaB = b.JEFATURA || ''; // Manejar si JEFATURA es null
                    const skuA = String(a.SKU || ''); // Manejar si SKU es null
                    const skuB = String(b.SKU || ''); // Manejar si SKU es null
                    return jefaturaA.localeCompare(jefaturaB) || skuA.localeCompare(skuB);
                });


                // --- Paso 3: Crear el libro de Excel y definir estilos ---
                const wb = XLSX.utils.book_new();
                const commonBorderStyle = { style: "thin", color: { rgb: "C0C0C0" } }; // Borde gris claro

                const styles = {
                    mainHeader: {
                        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
                        fill: { fgColor: { rgb: "333333" } }, // Fondo gris oscuro
                        alignment: { horizontal: "center", vertical: "center" },
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    analysisHeader: {
                        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
                        fill: { fgColor: { rgb: "0056b3" } }, // Fondo azul
                        alignment: { horizontal: "center", vertical: "center" },
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    dataRowEven: {
                        fill: { fgColor: { rgb: "F0F0F0" } }, // Gris claro para filas pares
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    dataRowOdd: {
                        fill: { fgColor: { rgb: "FFFFFF" } }, // Blanco para filas impares
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    dashTitle: { font: { sz: 18, bold: true, color: { rgb: "E6007E" } } },
                    dashSubtitle: { font: { sz: 11, italic: true, color: { rgb: "6c757d" } } },
                    dashHeader: { font: { sz: 14, bold: true, color: { rgb: "000000" } } },
                    metricLabel: { font: { bold: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "right" } },
                    metricValue: { font: { sz: 12, bold: true }, alignment: { horizontal: "left" } },
                    metricPositive: { font: { sz: 12, bold: true, color: { rgb: "28a745" } }, alignment: { horizontal: "left" } },
                    metricNegative: { font: { sz: 12, bold: true, color: { rgb: "dc3545" } }, alignment: { horizontal: "left" } },

                    // Nuevos estilos para la columna DIFERENCIA en "Reporte por Jefatura"
                    diffOk: { // Verde para 0
                        font: { bold: true, color: { rgb: "28a745" } }, // Color verde
                        fill: { fgColor: { rgb: "D4EDDA" } }, // Fondo verde claro
                        alignment: { horizontal: "center", vertical: "center" },
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    diffNegative: { // Rojo para faltantes
                        font: { bold: true, color: { rgb: "DC3545" } }, // Color rojo
                        fill: { fgColor: { rgb: "F8D7DA" } }, // Fondo rojo claro
                        alignment: { horizontal: "center", vertical: "center" },
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    diffPositive: { // Amarillo para excedentes
                        font: { bold: true, color: { rgb: "856404" } }, // Color amarillo oscuro (para contraste)
                        fill: { fgColor: { rgb: "FFF3CD" } }, // Fondo amarillo claro
                        alignment: { horizontal: "center", vertical: "center" },
                        border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
                    },
                    dashDate: { font: { sz: 11, italic: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "center" } } // Style for the date
                };

                // --- Función de ayuda para aplicar estilos a una hoja ---
                const applyTableStyles = (ws, headerStyle, dataEvenStyle, dataOddStyle, numHeaderRows = 1) => {
                    if (!ws['!ref']) return;

                    const range = XLSX.utils.decode_range(ws['!ref']);
                    const numCols = range.e.c - range.s.c + 1;

                    // Aplicar estilos de encabezado
                    for (let r = 0; r < numHeaderRows; r++) {
                        for (let c = 0; c < numCols; c++) {
                            const cellRef = XLSX.utils.encode_cell({ c: c, r: r });
                            if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
                            ws[cellRef].s = headerStyle;
                        }
                    }

                    // Aplicar estilos de fila de datos (colores alternos y bordes)
                    for (let r = numHeaderRows; r <= range.e.r; r++) {
                        for (let c = 0; c < numCols; c++) {
                            const cellRef = XLSX.utils.encode_cell({ c: c, r: r });
                            // No crear celda si el valor es null para dejarla vacía
                            if (ws[cellRef] === undefined || ws[cellRef].v === null) {
                                continue; // Si el valor es null/undefined, la celda ya está vacía, no aplicar estilos
                            }

                            // Solo aplicar estilo de fila si no es una celda de diferencia con estilo especial
                            // We check if the cell already has one of our custom styles (diffOk, diffNegative, diffPositive)
                            const hasCustomDiffStyle = ws[cellRef].s && (ws[cellRef].s === styles.diffOk || ws[cellRef].s === styles.diffNegative || ws[cellRef].s === styles.diffPositive);

                            if (!ws[cellRef].s || (ws[cellRef].s !== headerStyle && !hasCustomDiffStyle)) {
                                ws[cellRef].s = (r % 2 === 0) ? dataEvenStyle : dataOddStyle;
                            } else if (!ws[cellRef].s && !hasCustomDiffStyle) { // Fallback if for some reason no style is present
                                ws[cellRef].s = (r % 2 === 0) ? dataEvenStyle : dataOddStyle;
                            }
                        }
                    }

                    // Autoajustar ancho de columnas
                    ws['!cols'] = [];
                    for (let C = 0; C < numCols; ++C) {
                        let max_width = 0;
                        for (let R = 0; R <= range.e.r; ++R) {
                            const cell = ws[XLSX.utils.encode_cell({ c: C, r: R })];
                            if (cell && cell.v != null) {
                                const cell_text = String(cell.v);
                                const lines = cell_text.split(/\r\n|\r|\n/);
                                const longest_line = lines.reduce((max, line) => Math.max(max, line.length), 0);
                                max_width = Math.max(max_width, longest_line);
                            }
                        }
                        ws['!cols'][C] = { wch: Math.min(60, Math.max(8, max_width + 2)) };
                    }

                    // Inmovilizar paneles (primera fila)
                    ws['!freeze'] = {
                        xSplit: "0",
                        ySplit: "1",
                        topLeftCell: "A2",
                        activePane: "bottomLeft",
                        state: "frozen"
                    };
                };

                // --- Hoja 4: Dashboard (moved to be processed first) ---
                const stats = calculateProStatistics(augmentedData);

                // Accessing manifest.createdAt for the upload date
                const uploadDateString = manifest.createdAt;
                let formattedUploadDate = 'Fecha no disponible';

                if (uploadDateString) {
                    try {
                        const m = uploadDateString.match(/(\d+) de (.+) de (\d{4}), (\d+):(\d+):(\d+) (a\.m\.|p\.m\.) UTC([+-]\d+)/i);
                        if (m) {
                            const [_, d, monthName, y, hh, mm, ss, ampm, utcOff] = m;
                            const months = { 'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5, 'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11 };
                            let H = parseInt(hh, 10);
                            if (ampm.toLowerCase() === 'p.m.' && H !== 12) H += 12;
                            if (ampm.toLowerCase() === 'a.m.' && H === 12) H = 0;

                            const offset = parseInt(utcOff, 10); // ej. -6
                            // El string está en UTC-6 => convertimos a UTC sumando 6 horas
                            const utcMillis = Date.UTC(
                                parseInt(y, 10),
                                months[monthName.toLowerCase()],
                                parseInt(d, 10),
                                H - offset,
                                parseInt(mm, 10),
                                parseInt(ss, 10)
                            );
                            const dateObj = new Date(utcMillis);

                            formattedUploadDate = dateObj.toLocaleString('es-ES', {
                                dateStyle: 'long',
                                timeStyle: 'medium',
                                hour12: true
                            });
                        } else {
                            const dateObj = new Date(uploadDateString);
                            if (!isNaN(dateObj)) {
                                formattedUploadDate = dateObj.toLocaleString('es-ES', {
                                    dateStyle: 'long',
                                    timeStyle: 'medium',
                                    hour12: true
                                });
                            }
                        }
                    } catch (error) {
                        console.warn("Could not parse upload date string:", uploadDateString, error);
                        formattedUploadDate = 'Fecha no disponible (Error al procesar)';
                    }
                }


                let dashboardData = [
                    [{ v: "⭐️ Dashboard de Manifiesto", s: styles.dashTitle }],
                    [{ v: `Archivo: ${manifestoId}`, s: styles.dashSubtitle }],
                    [{ v: `Fecha de Carga: ${formattedUploadDate}`, s: styles.dashDate }], // Added upload date
                    [], // Empty row for spacing
                    [{ v: "📊 MÉTRICAS GENERALES", s: styles.dashHeader }],
                    [{ v: "📥 Total Piezas (SAP):", s: styles.metricLabel }, { v: stats.totalSAP, s: styles.metricValue, z: '#,##0' }],
                    [{ v: "✅ Total Piezas Escaneadas:", s: styles.metricLabel }, { v: stats.totalSCAN, s: styles.metricValue, z: '#,##0' }],
                    [{ v: "⚠️ Diferencia Total:", s: styles.metricLabel }, { v: stats.totalSCAN - stats.totalSAP, s: (stats.totalSCAN - stats.totalSAP < 0 ? styles.metricNegative : styles.metricPositive), z: '#,##0' }],
                    [{ v: "🎯 Progreso General:", s: styles.metricLabel }, { v: stats.avance / 100, s: styles.metricPositive, z: '0.00%' }],
                    [], // Empty row for spacing
                    [{ v: "🚨 PUNTOS CRÍTICOS (FALTANTES)", s: styles.dashHeader }],
                    [{ v: "📦 Contenedores:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
                    ...stats.topContenedoresFaltantes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricNegative, t: 'n', z: '#,##0' }]),
                    [], // Empty row for spacing
                    [{ v: "📂 Secciones:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
                    ...stats.topSeccionesFaltantes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricNegative, t: 'n', z: '#,##0' }]),
                    [], // Empty row for spacing
                    [{ v: "📈 PUNTOS DE OPORTUNIDAD (EXCEDENTES)", s: styles.dashHeader }],
                    [{ v: "📦 Contenedores:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
                    ...stats.topContenedoresExcedentes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricPositive, t: 'n', z: '#,##0' }]),
                    [], // Empty row for spacing
                    [{ v: "📂 Secciones:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
                    ...stats.topSeccionesExcedentes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricPositive, t: 'n', z: '#,##0' }]),
                ];
                const wsDash = XLSX.utils.aoa_to_sheet(dashboardData);
                wsDash['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 15 }];
                // Update merges to account for the new date row and shifted content
                const baseRowShift = 1; // Due to adding one extra line (Fecha de Carga)
                // Después de: const wsDash = XLSX.utils.aoa_to_sheet(dashboardData);
                wsDash['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 15 }];

                // Merges dinámicos
                const merges = [];
                let r = 0;

                // 0: ⭐️ Dashboard de Manifiesto
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); r++;

                // 1: Archivo
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); r++;

                // 2: Fecha de Carga
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); r++;

                // 3: fila vacía
                r++;

                // 4: 📊 MÉTRICAS GENERALES  (merge a lo ancho)
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); r++;

                // 5..8: 4 filas de métricas (Total SAP, Total Scan, Diferencia, Progreso)
                r += 4;

                // 9: fila vacía
                r++;

                // 10: 🚨 PUNTOS CRÍTICOS (FALTANTES) (merge a lo ancho)
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); r++;

                // 11: cabecera "Contenedores / Piezas"
                r++;

                // 12..: filas de contenedores faltantes
                const lenCF = (stats.topContenedoresFaltantes || []).length;
                r += lenCF;

                // +1 fila vacía
                r++;

                // +1 cabecera "Secciones / Piezas"
                r++;

                // +N: filas de secciones faltantes
                const lenSF = (stats.topSeccionesFaltantes || []).length;
                r += lenSF;

                // +1 fila vacía
                r++;

                // Aquí viene: 📈 PUNTOS DE OPORTUNIDAD (EXCEDENTES) (merge a lo ancho)
                merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });

                // (Opcional) Si quieres también seguir bajando y hacer merges en otros headers,
                // puedes continuar sumando r con estas líneas:
                //
                // r++; // cabecera "Contenedores / Piezas" (excedentes)
                // r += (stats.topContenedoresExcedentes || []).length;
                // r++; // vacía
                // r++; // cabecera "Secciones / Piezas" (excedentes)
                // r += (stats.topSeccionesExcedentes || []).length;

                wsDash['!merges'] = merges;


                XLSX.utils.book_append_sheet(wb, wsDash, "Dashboard"); // Add dashboard first

                // --- Hoja 1: Reporte por Jefatura ---
                const wsMain = XLSX.utils.json_to_sheet(augmentedData);
                if (augmentedData.length > 0) {
                    // Asegúrate de que los encabezados se generen correctamente incluyendo 'DIFERENCIA'
                    const headers = Object.keys(augmentedData[0]);
                    XLSX.utils.sheet_add_aoa(wsMain, [headers], { origin: "A1" });

                    const headerKeysMain = headers; // Ya tenemos los encabezados en el orden correcto
                    const headerKeysUpper = headerKeysMain.map(key => key.toUpperCase());

                    const diffColIndex = headerKeysUpper.indexOf('DIFERENCIA'); // Obtener el índice de la columna DIFERENCIA

                    for (let r = 1; r <= augmentedData.length; r++) { // Empezar desde la fila 1 (después del encabezado)
                        // Aplicar formato para números con comas (SAP, SCANNER)
                        numericWithCommaFormatKeys.forEach(colName => {
                            if (colName === 'DIFERENCIA') return; // Se manejará aparte
                            const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                            if (colIndex !== -1) {
                                const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                                if (wsMain[cellRef] && wsMain[cellRef].t === 'n') {
                                    wsMain[cellRef].z = '#,##0'; // Formato con separador de miles
                                }
                            }
                        });

                        // Aplicar formato para números sin comas (MANIFIESTO, SKU, EUROPEO, ENTREGADO_A, DAÑO_CANTIDAD)
                        numericNoCommaFormatKeys.forEach(colName => {
                            const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                            if (colIndex !== -1) {
                                const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                                if (wsMain[cellRef] && wsMain[cellRef].t === 'n') { // Asegurarse de que es tipo número
                                    wsMain[cellRef].z = '0'; // Formato entero sin separador de miles
                                }
                            }
                        });

                        // Asegurar que las columnas de texto permanezcan como tal y sin formato numérico
                        textFormatKeys.forEach(colName => {
                            const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                            if (colIndex !== -1) {
                                const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                                if (wsMain[cellRef]) { // Solo si la celda existe (no es null/undefined)
                                    wsMain[cellRef].t = 's'; // Forzar tipo string
                                    delete wsMain[cellRef].z; // Eliminar cualquier formato numérico
                                }
                            }
                        });

                        // Lógica de color y texto para la columna DIFERENCIA
                        if (diffColIndex !== -1) {
                            const cellRef = XLSX.utils.encode_cell({ c: diffColIndex, r: r });
                            const cell = wsMain[cellRef];

                            if (cell && cell.t === 'n') { // Si es una celda numérica
                                const diffValue = cell.v;
                                if (diffValue === 0) {
                                    cell.s = styles.diffOk;
                                    cell.v = "OK"; // Cambiar valor a "OK"
                                    cell.t = 's'; // Cambiar tipo a string
                                    delete cell.z; // Eliminar formato numérico
                                } else if (diffValue < 0) {
                                    cell.s = styles.diffNegative;
                                    cell.v = `FALTANTE: ${Math.abs(diffValue)}`; // Cambiar valor a "FALTANTE: X"
                                    cell.t = 's'; // Cambiar tipo a string
                                    delete cell.z; // Eliminar formato numérico
                                } else { // diffValue > 0
                                    cell.s = styles.diffPositive;
                                    cell.v = `EXCEDENTE: ${diffValue}`; // Cambiar valor a "EXCEDENTE: X"
                                    cell.t = 's'; // Cambiar tipo a string
                                    delete cell.z; // Eliminar formato numérico
                                }
                            } else if (cell && (cell.v === null || cell.v === undefined || cell.v === '')) {
                                // If cell is empty or null, keep it without value and without specific diff style
                                // applyTableStyles will handle borders and alternating row color
                                continue;
                            }
                        }
                    }

                    applyTableStyles(wsMain, styles.mainHeader, styles.dataRowEven, styles.dataRowOdd);
                    wsMain['!autofilter'] = { ref: wsMain['!ref'] };
                }
                XLSX.utils.book_append_sheet(wb, wsMain, "Reporte por Jefatura");

                // --- Análisis por Contenedor y Sección ---
                const analysisHeadersCont = ["Contenedor", "Jefatura(s)", "Piezas SAP", "Piezas Escaneadas", "Diferencia"];
                const analysisHeadersSect = ["Sección", "Jefatura", "Piezas SAP", "Piezas Escaneadas", "Diferencia"];
                const containerAnalysis = {}, sectionAnalysis = {};
                augmentedData.forEach(row => {
                    const findKey = (obj, key) => Object.keys(obj).find(k => k.toUpperCase() === key.toUpperCase());
                    const cont = row[findKey(row, 'CONTENEDOR')];
                    const sect = row[findKey(row, 'SECCION')] || "N/A";
                    const sap = Number(row[findKey(row, 'SAP')] || 0);
                    const scanner = Number(row[findKey(row, 'SCANNER')] || 0);
                    const jefe = row.JEFATURA;
                    if (!containerAnalysis[cont]) containerAnalysis[cont] = { SAP: 0, SCANNER: 0, Jefes: new Set() };
                    containerAnalysis[cont].SAP += sap;
                    containerAnalysis[cont].SCANNER += scanner;
                    if (jefe !== 'Sin Jefe Asignado') containerAnalysis[cont].Jefes.add(jefe);
                    if (!sectionAnalysis[sect]) sectionAnalysis[sect] = { SAP: 0, SCANNER: 0 };
                    sectionAnalysis[sect].SAP += sap;
                    sectionAnalysis[sect].SCANNER += scanner;
                });

                // --- Hoja 2: Análisis por Contenedor ---
                const wsContData = Object.entries(containerAnalysis).map(([key, val]) => ({ "Contenedor": key, "Jefatura(s)": [...val.Jefes].join(', '), "Piezas SAP": val.SAP, "Piezas Escaneadas": val.SCANNER, "Diferencia": val.SCANNER - val.SAP }));
                const wsCont = XLSX.utils.json_to_sheet(wsContData, { header: analysisHeadersCont });
                const numColsCont = analysisHeadersCont.length;
                for (let r = 1; r <= wsContData.length; r++) {
                    // Formatear columnas numéricas con comas (Piezas SAP, Piezas Escaneadas, Diferencia)
                    const numericColsWithCommas_analysis = [2, 3, 4]; // Columnas Piezas SAP, Escaneadas, Diferencia
                    numericColsWithCommas_analysis.forEach(colIndex => {
                        if (numColsCont > colIndex) {
                            const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                            if (wsCont[cellRef] && wsCont[cellRef].t === 'n') {
                                wsCont[cellRef].z = '#,##0';
                            }
                        }
                    });
                    // Asegurar que 'Contenedor' sea texto
                    const contColIndex = analysisHeadersCont.indexOf('Contenedor');
                    if (contColIndex !== -1) {
                        const cellRef = XLSX.utils.encode_cell({ c: contColIndex, r: r });
                        if (wsCont[cellRef]) {
                            wsCont[cellRef].t = 's'; // Asegurar que sea texto
                            delete wsCont[cellRef].z; // Eliminar cualquier formato numérico
                        }
                    }
                }
                applyTableStyles(wsCont, styles.analysisHeader, styles.dataRowEven, styles.dataRowOdd);
                wsCont['!autofilter'] = { ref: wsCont['!ref'] };
                XLSX.utils.book_append_sheet(wb, wsCont, "Análisis por Cont.");

                // --- Hoja 3: Análisis por Sección ---
                const wsSectData = Object.entries(sectionAnalysis).map(([key, val]) => ({ "Sección": key, "Jefatura": seccionToJefeMap.get(key.toUpperCase()) || "Sin Jefe Asignado", "Piezas SAP": val.SAP, "Piezas Escaneadas": val.SCANNER, "Diferencia": val.SCANNER - val.SAP }));
                const wsSect = XLSX.utils.json_to_sheet(wsSectData, { header: analysisHeadersSect });
                const numColsSect = analysisHeadersSect.length;
                for (let r = 1; r <= wsSectData.length; r++) {
                    // Formatear columnas numéricas con comas
                    const numericColsWithCommas_analysis = [2, 3, 4]; // Piezas SAP, Piezas Escaneadas, Diferencia
                    numericColsWithCommas_analysis.forEach(colIndex => {
                        if (numColsSect > colIndex) {
                            const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                            if (wsSect[cellRef] && wsSect[cellRef].t === 'n') {
                                wsSect[cellRef].z = '#,##0';
                            }
                        }
                    });
                }
                applyTableStyles(wsSect, styles.analysisHeader, styles.dataRowEven, styles.dataRowOdd);
                wsSect['!autofilter'] = { ref: wsSect['!ref'] };
                XLSX.utils.book_append_sheet(wb, wsSect, "Análisis por Secc.");

                // --- Descargar el libro ---
                XLSX.writeFile(wb, `Reporte_Completo_${manifestoId}.xlsx`);
                Swal.close();

            } catch (error) {
                console.error("Error al generar reporte:", error);
                Swal.fire('Error Inesperado', error.message, 'error');
            }
        }
        function formatFecha(d) {
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yy = d.getFullYear();
            return `${dd}/${mm}/${yy}`;
        }
        /**
        * ✅ NUEVA FUNCIÓN CENTRALIZADA
        * Actualiza los metadatos 'lastUser' y 'updatedAt' en Firestore y en la UI.
        * @param {string} fileName - El ID del documento del manifiesto (nombre del archivo).
        * @param {string} userEmail - El email del usuario que realiza la acción.
        */
        async function updateManifestMetadata(fileName, userEmail) {
            try {
                const manifestRef = db.collection('manifiestos').doc(fileName);
                await manifestRef.set({
                    lastUser: userEmail,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // Actualiza también la información local para que la UI sea consistente
                if (excelDataGlobal[fileName]) {
                    excelDataGlobal[fileName].lastUser = userEmail;
                    const lastUserEl = document.getElementById("lastUserUpdate");
                    if (lastUserEl) {
                        lastUserEl.textContent = userEmail;
                    }
                }
            } catch (error) {
                console.error("Error al actualizar metadatos del manifiesto:", error);
            }
        }
        /* INICIO DE LAS NUEVAS FUNCIONES PARA LA PRESENCIA */
        /**
         * Registra al usuario actual como activo en un contenedor.
         * @param {string} manifestId - El ID del manifiesto (nombre del archivo).
         * @param {string} containerName - El nombre del contenedor.
         */
        async function setUserPresence(manifestId, containerName) {
            if (!currentUser) return;
            try {
                await db.collection('presence').doc(currentUser.uid).set({
                    userEmail: currentUser.email || 'Desconocido',
                    manifestId: manifestId,
                    containerName: containerName,
                    joinedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`Usuario ${currentUser.email} registrado en el contenedor ${containerName}.`);
            } catch (error) {
                console.error("Error al registrar presencia:", error);
            }
        }

        /**
         * Elimina el registro del usuario actual de la presencia.
         */
        async function removeUserPresence() {
            if (!currentUser) return;
            if (unsubscribeFromPresence) {
                unsubscribeFromPresence();
                unsubscribeFromPresence = null;
            }
            try {
                await db.collection('presence').doc(currentUser.uid).delete();
                console.log(`Usuario ${currentUser.email} eliminado de la presencia.`);
            } catch (error) {
                console.error("Error al eliminar presencia:", error);
            }
        }
        /* FIN DE LAS NUEVAS FUNCIONES PARA LA PRESENCIA */
        /* INICIO DEL CÓDIGO NUEVO PARA LA FUNCIÓN DEBOUNCED */

        /**
         * Usa un debounce para agrupar las actualizaciones a Firestore.
         * Esto evita una escritura por cada escaneo rápido.
         */
        function updateMetadataDebounced() {
            if (!currentFileName || !currentUser || !currentUser.email) return;
            clearTimeout(debouncedUpdateTimer);
            debouncedUpdateTimer = setTimeout(async () => {
                try {
                    await updateManifestMetadata(currentFileName, currentUser.email);
                    console.log("Metadatos del manifiesto actualizados en Firestore (debounced).");
                } catch (error) {
                    console.error("Error al actualizar metadatos con debounce:", error);
                }
            }, 2000); // Espera 2 segundos antes de enviar la actualización
        }

        /* FIN DEL CÓDIGO NUEVO PARA LA FUNCIÓN DEBOUNCED */

        // --- CÓDIGO RENOVADO / UX MEJORADA PARA CAMBIAR CONTENEDOR ---
        btnCambiarContenedor.removeEventListener?.("click", openChangeContainerModal);
        btnCambiarContenedor.addEventListener("click", openChangeContainerModal);

        // Atajo: Ctrl+Shift+C
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
                if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
                openChangeContainerModal();
            }
        });

        function openChangeContainerModal() {
            if (!currentContenedor || !currentFileName) return;

            const status = getContainerStatus(currentContainerRecords);
            const summaryHTML = getContainerSummaryGridHTML(currentContainerRecords);

            const manifest = excelDataGlobal[currentFileName];
            const allRecords = manifest?.data || [];
            const containerMap = new Map();

            allRecords.forEach(r => {
                const c = String(r.CONTENEDOR || '').trim().toUpperCase();
                if (!c) return;
                if (!containerMap.has(c)) containerMap.set(c, []);
                containerMap.get(c).push(r);
            });

            const otherContainers = [...containerMap.keys()].filter(c => c !== currentContenedor).sort();
            const totalOthers = otherContainers.length;
            const totalClosed = otherContainers.reduce((acc, c) => acc + (manifest.closedContainers?.[c] ? 1 : 0), 0);

            const containerCardsHTML = otherContainers.slice(0, 600).map(c => {
                const recs = containerMap.get(c);
                const st = getContainerStatus(recs);
                const closed = manifest.closedContainers?.[c];
                const sap = recs.reduce((a, b) => a + (Number(b.SAP) || 0), 0);
                const scan = recs.reduce((a, b) => a + (Number(b.SCANNER) || 0), 0);
                const avance = sap ? Math.min(100, Math.floor(Math.min(scan, sap) / sap * 100)) : (scan > 0 ? 100 : 0);
                return `
        <label class="cc-item" data-cont="${c}" tabindex="0" aria-label="Contenedor ${c}, estado ${st.text}">
          <input type="radio" name="targetContainer" value="${c}">
          <div class="cc-body">
            <div class="cc-head">
              <span class="cc-name">${c}</span>
              <span class="cc-badge ${st.colorClass}">
                <i class="bi ${st.icon}"></i>${st.text}${closed ? ' • CERRADO' : ''}
              </span>
            </div>
            <div class="cc-metrics">
              <div class="cc-metric">
                <span class="m-label">SKUs</span>
                <span class="m-val">${recs.length}</span>
              </div>
              <div class="cc-metric">
                <span class="m-label">SAP</span>
                <span class="m-val">${sap}</span>
              </div>
              <div class="cc-metric">
                <span class="m-label">AV.</span>
                <span class="m-val ${avance === 100 ? 'good' : avance >= 50 ? 'mid' : 'low'}">${avance}%</span>
              </div>
            </div>
            <div class="cc-bar-wrap">
              <div class="cc-bar">
                <div class="cc-bar-fill av-${avance >= 100 ? 'full' : avance >= 75 ? '75' : avance >= 50 ? '50' : avance >= 25 ? '25' : '0'}" style="width:${avance}%;"></div>
              </div>
            </div>
          </div>
        </label>`;
            }).join('') || `<div class="no-others">No hay otros contenedores en este manifiesto.</div>`;

            Swal.fire({
                customClass: { popup: 'swal-modal-pro cc-modal-responsive cc-theme' },
                width: 'min(1050px,96vw)',
                html: `
      <style>
        /* Ajustes específicos para la distribución y evitar que "Manifiesto" se corte */
        .cc-meta-block{
          background:#fff;
          border:1px solid var(--cc-border);
          border-radius:14px;
          padding:.85rem .9rem 1rem;
          display:flex;
          flex-direction:column;
          gap:.65rem;
        }
        .cc-meta-grid{
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
          gap:.6rem .75rem;
        }
        .cc-meta-item{
          display:flex;
          align-items:flex-start;
          gap:.45rem;
          background:var(--cc-soft);
          border:1px solid #e1e4e7;
          padding:.55rem .6rem .6rem;
          border-radius:10px;
          min-height:60px;
        }
        .cc-meta-item i{
          font-size:1.05rem;
          color:var(--cc-accent);
          margin-top:2px;
          flex-shrink:0;
        }
        .cc-meta-item .m-label{
          font-size:.58rem;
          font-weight:600;
          text-transform:uppercase;
          letter-spacing:.7px;
          color:#6b7580;
          white-space:nowrap;
          display:block;
          margin-bottom:2px;
        }
        .cc-meta-item .m-val{
          font-size:.68rem;
          font-weight:600;
          color:#1e2730;
          line-height:1.15;
          word-break:break-word;
          overflow-wrap:break-word;
        }
        /* Nombre del contenedor: evitar salto raro */
        .cc-current-name{
          word-break:break-word;
        }
      </style>
      <div class="cc-layout">
        <aside class="cc-side">
          <div class="cc-side-header">
            <div class="cc-current-title">
              <i class="material-icons">inventory_2</i>
              <span>Contenedor Actual</span>
            </div>
            <div class="cc-current-chip ${status.colorClass}">
              <i class="bi ${status.icon}"></i>${status.text}
            </div>
          </div>
          <div class="cc-current-name">${currentContenedor}</div>

          <div class="cc-summary-grid">${summaryHTML}</div>

          <div class="cc-meta-block">
            <div class="cc-meta-grid">
              <div class="cc-meta-item">
                <i class="bi bi-database-fill-gear"></i>
                <div>
                  <span class="m-label">Manifiesto</span>
                  <span class="m-val">${currentFileName}</span>
                </div>
              </div>
              <div class="cc-meta-item">
                <i class="bi bi-box-seam"></i>
                <div>
                  <span class="m-label">Otros</span>
                  <span class="m-val">${totalOthers}</span>
                </div>
              </div>
              <div class="cc-meta-item">
                <i class="bi bi-lock-fill"></i>
                <div>
                  <span class="m-label">Cerrados</span>
                  <span class="m-val">${totalClosed}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="cc-help">
            <h6>Ayuda Rápida</h6>
            <ul>
              <li><i class="bi bi-mouse2"></i> Click / Enter: Seleccionar</li>
              <li><i class="bi bi-arrow-up-down"></i> ↑ / ↓: Navegar</li>
              <li><i class="bi bi-slash-circle"></i> ESC: Cerrar</li>
            </ul>
          </div>
        </aside>

        <main class="cc-main cc-scroll-wrapper">
          <h2 class="modal-pro-title">
            <i class="material-icons">swap_horiz</i>
            Cambiar de Contenedor
          </h2>

          <div class="cc-filter-bar">
            <div class="cc-filter-group">
              <i class="bi bi-search"></i>
              <input id="ccFilter" type="text" class="form-control" placeholder="Filtrar por nombre...">
              <button id="ccClearFilter" class="btn-clear" type="button" title="Limpiar filtro"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="cc-filter-stats" id="ccFilterStats">
              <span class="badge-total">${totalOthers}</span> total
              <span class="sep">|</span>
              <span class="badge-closed">${totalClosed} cerrados</span>
            </div>
          </div>

          <div class="cc-list-wrap">
            <div class="cc-list" id="ccList" role="listbox" aria-label="Listado de contenedores">
              ${containerCardsHTML}
            </div>
          </div>

          <div id="ccPreview" class="cc-preview d-none" aria-live="polite">
            <div class="cc-preview-header">
              <h6 id="ccPreviewTitle"></h6>
              <button id="ccPreviewClose" class="btn-mini" type="button" title="Ocultar previsualización">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
            <div id="ccPreviewSummary" class="cc-preview-summary"></div>
          </div>

            <p class="modal-pro-question small mt-3 mb-2">
              Selecciona otro contenedor para abrirlo directamente o presiona "Salir a Búsqueda" para volver.
            </p>
        </main>
      </div>
    `,
                showCancelButton: true,
                confirmButtonText: 'Salir a Búsqueda',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#0d6efd',
                cancelButtonColor: '#6c757d',
                showLoaderOnConfirm: true,
                focusConfirm: false,
                didOpen: () => {
                    const popup = Swal.getPopup();
                    const listEl = popup.querySelector('#ccList');
                    const filterEl = popup.querySelector('#ccFilter');
                    const clearBtn = popup.querySelector('#ccClearFilter');
                    const previewWrap = popup.querySelector('#ccPreview');
                    const previewTitle = popup.querySelector('#ccPreviewTitle');
                    const previewSummary = popup.querySelector('#ccPreviewSummary');
                    const previewClose = popup.querySelector('#ccPreviewClose');
                    const confirmBtn = Swal.getConfirmButton();
                    const statsEl = popup.querySelector('#ccFilterStats');

                    const items = Array.from(listEl.querySelectorAll('.cc-item'));
                    let focusIndex = -1;

                    const updateConfirmText = () => {
                        const selected = listEl.querySelector('input[name="targetContainer"]:checked');
                        confirmBtn.textContent = selected ? 'Abrir Seleccionado' : 'Salir a Búsqueda';
                    };

                    const updateStats = () => {
                        const visible = items.filter(i => i.style.display !== 'none').length;
                        const closedVisible = items.filter(i => i.style.display !== 'none' && i.querySelector('.cc-badge')?.textContent.includes('CERRADO')).length;
                        statsEl.innerHTML = `<span class="badge-total">${visible}</span> mostrados <span class="sep">|</span> <span class="badge-closed">${closedVisible} cerrados</span>`;
                    };

                    const showPreview = (cont) => {
                        const recs = containerMap.get(cont) || [];
                        previewTitle.innerHTML = `Previsualización: <strong>${cont}</strong>`;
                        previewSummary.innerHTML = getContainerSummaryGridHTML(recs);
                        previewWrap.classList.remove('d-none');
                    };

                    const hidePreview = () => {
                        previewWrap.classList.add('d-none');
                    };

                    listEl.addEventListener('change', () => {
                        const selected = listEl.querySelector('input[name="targetContainer"]:checked');
                        if (selected) {
                            showPreview(selected.value);
                        } else {
                            hidePreview();
                        }
                        updateConfirmText();
                    });

                    filterEl.addEventListener('input', () => {
                        const term = filterEl.value.trim().toUpperCase();
                        items.forEach((item) => {
                            const cont = item.getAttribute('data-cont') || '';
                            const visible = cont.includes(term);
                            item.style.display = visible ? '' : 'none';
                            if (!visible && item.querySelector('input:checked')) {
                                item.querySelector('input').checked = false;
                                hidePreview();
                                updateConfirmText();
                            }
                        });
                        updateStats();
                    });

                    clearBtn.addEventListener('click', () => {
                        filterEl.value = '';
                        filterEl.dispatchEvent(new Event('input'));
                        filterEl.focus();
                    });

                    previewClose?.addEventListener('click', hidePreview);

                    listEl.addEventListener('keydown', (e) => {
                        if (!['ArrowDown', 'ArrowUp', ' ', 'Enter'].includes(e.key)) return;
                        e.preventDefault();
                        const visibleItems = items.filter(i => i.style.display !== 'none');
                        if (visibleItems.length === 0) return;
                        if (e.key === 'ArrowDown') {
                            focusIndex = (focusIndex + 1) % visibleItems.length;
                            visibleItems[focusIndex].focus();
                        } else if (e.key === 'ArrowUp') {
                            focusIndex = (focusIndex - 1 + visibleItems.length) % visibleItems.length;
                            visibleItems[focusIndex].focus();
                        } else {
                            const el = document.activeElement;
                            if (el && el.classList.contains('cc-item')) {
                                const radio = el.querySelector('input[type="radio"]');
                                if (radio) {
                                    radio.checked = true;
                                    radio.dispatchEvent(new Event('change'));
                                }
                            }
                        }
                    });

                    items.forEach((item, idx) => {
                        item.addEventListener('click', () => {
                            focusIndex = idx;
                        });
                    });

                    const actions = popup.querySelector('.swal2-actions');
                    const scrollWrapper = popup.querySelector('.cc-scroll-wrapper');
                    if (actions && scrollWrapper) {
                        const pad = actions.getBoundingClientRect().height + 20;
                        scrollWrapper.style.paddingBottom = pad + 'px';
                    }
                },
                preConfirm: async () => {
                    const selected = Swal.getPopup().querySelector('input[name="targetContainer"]:checked');
                    if (selected) return { action: 'open', container: selected.value };
                    return { action: 'exit' };
                },
                allowOutsideClick: () => !Swal.isLoading()
                /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR EL BLOQUE then() EN openChangeContainerModal */
                /* CÓDIGO NUEVO PARA EL BLOQUE then() EN openChangeContainerModal */
                /* INICIO DEL CÓDIGO NUEVO PARA EL BLOQUE then() EN openChangeContainerModal */
            }).then(async (res) => {
                if (!res.isConfirmed || !res.value) return;
                const { action, container } = res.value;

                window.unsubscribeFromContainerChanges();
                // ✅ LÓGICA DE PRESENCIA: Quitar el registro al salir del contenedor
                await removeUserPresence();

                if (currentFileName && currentUser?.email) {
                    await updateManifestMetadata(currentFileName, currentUser.email);
                }

                if (action === 'open' && container) {
                    Swal.fire({ title: 'Abriendo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    await realOpenFileManifiesto(currentFileName, container);
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: `Contenedor ${container} abierto`,
                        timer: 1600,
                        showConfirmButton: false
                    });
                    return;
                }

                currentContenedor = null;
                currentContainerRecords = [];
                selectedFileToWorkEl.textContent = "";

                containerResultsSection.style.display = 'none';
                scanEntrySection.style.display = 'none';
                uploadAndSearchSection.style.display = 'block';
                inputBusqueda.value = '';
                inputBusqueda.focus();

                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Listo para buscar un nuevo contenedor',
                    timer: 1800,
                    showConfirmButton: false
                });
            });
            /* FIN DEL CÓDIGO NUEVO PARA EL BLOQUE then() EN openChangeContainerModal */
        }

        // CSS dinámico (solo una vez)
        const ccStyleId = 'cc-modal-style-v2';
        if (!document.getElementById(ccStyleId)) {
            const st = document.createElement('style');
            st.id = ccStyleId;
            st.textContent = `
    .cc-theme{--cc-gap:1.1rem;--cc-radius:16px;--cc-border:#e3e6ea;--cc-bg:#ffffff;--cc-soft:#f6f7f9;--cc-accent:var(--rosa-principal,#E6007E);--cc-text:#29313a;font-family:'Poppins',system-ui,sans-serif;}
    .cc-modal-responsive.swal2-popup{padding:0!important;display:flex;flex-direction:column;max-height:100vh;width:min(1050px,96vw);box-sizing:border-box;border-radius:var(--cc-radius);}
    .cc-layout{display:grid;grid-template-columns:300px 1fr;min-height:65vh;max-height:calc(100vh - 140px);}
    @media(max-width:900px){.cc-layout{grid-template-columns:1fr;}.cc-side{order:2;}}
    .cc-side{background:linear-gradient(160deg,#fafbfc,#f0f2f5);border-right:1px solid var(--cc-border);padding:1.1rem;display:flex;flex-direction:column;gap:1rem;overflow:auto;}
    .cc-side-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;}
    .cc-current-title{display:flex;align-items:center;gap:.4rem;font-weight:600;font-size:.9rem;color:var(--cc-text);}
    .cc-current-title i{font-size:1.2rem;color:var(--cc-accent);}
    .cc-current-chip{font-size:.55rem;padding:4px 8px;border-radius:40px;display:inline-flex;align-items:center;gap:4px;font-weight:600;letter-spacing:.5px;color:#fff;text-transform:uppercase;}
    .cc-current-name{font-size:1.05rem;font-weight:700;color:var(--cc-text);letter-spacing:.5px;}
    .cc-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.5rem;font-size:.7rem;}
    .cc-meta-block{background:#fff;border:1px solid var(--cc-border);border-radius:12px;padding:.75rem .9rem;display:flex;flex-direction:column;gap:.55rem;}
    .cc-meta-line{display:flex;align-items:center;gap:.4rem;font-size:.7rem;color:#555;}
    .cc-meta-line i{color:var(--cc-accent);}
    .cc-help{background:var(--cc-soft);padding:.75rem .9rem;border-radius:12px;}
    .cc-help h6{margin:0 0 .4rem;font-size:.65rem;font-weight:700;letter-spacing:.5px;color:#555;}
    .cc-help ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4rem;}
    .cc-help li{display:flex;align-items:center;gap:.5rem;font-size:.62rem;color:#555;}
    .cc-help li i{color:var(--cc-accent);font-size:.75rem;}
    .cc-main{display:flex;flex-direction:column;overflow:hidden;padding:1.15rem 1.2rem 0;}
    .cc-main .modal-pro-title{display:flex;align-items:center;gap:.55rem;font-size:1.25rem;margin:0 0 .9rem;font-weight:700;color:var(--cc-text);}
    .cc-main .modal-pro-title i{color:var(--cc-accent);}
    .cc-filter-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.8rem;}
    .cc-filter-group{flex:1;display:flex;align-items:center;gap:.45rem;background:#fff;border:1px solid var(--cc-border);padding:.55rem .75rem;border-radius:50px;box-shadow:0 2px 4px rgba(0,0,0,.04);}
    .cc-filter-group i{color:#6c7580;font-size:1rem;}
    .cc-filter-group input{border:none;outline:none;font-size:.8rem;padding:0;width:100%;background:transparent;}
    .cc-filter-group .btn-clear{background:rgba(0,0,0,.05);border:none;border-radius:40px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#666;transition:.2s;}
    .cc-filter-group .btn-clear:hover{background:rgba(0,0,0,.1);}
    .cc-filter-stats{font-size:.65rem;font-weight:600;display:flex;align-items:center;gap:.5rem;color:#555;}
    .cc-filter-stats .badge-total,.cc-filter-stats .badge-closed{background:#fff;border:1px solid var(--cc-border);padding:4px 8px;border-radius:40px;font-size:.6rem;display:inline-block;font-weight:600;}
    .cc-filter-stats .sep{opacity:.4;}
    .cc-list-wrap{flex:1;overflow:auto;border:1px solid var(--cc-border);background:var(--cc-soft);border-radius:14px;padding:.7rem .65rem;position:relative;}
    .cc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.7rem;}
    @media(max-width:700px){.cc-list{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));}}
    .cc-item{position:relative;display:flex;cursor:pointer;border:1px solid #d9dde1;border-radius:13px;background:#fff;transition:.18s;outline:none;}
    .cc-item:focus-visible{box-shadow:0 0 0 3px #e6007e55;}
    .cc-item:hover{box-shadow:0 4px 14px rgba(0,0,0,.08);transform:translateY(-2px);}
    .cc-item input{position:absolute;opacity:0;pointer-events:none;}
    .cc-item input:checked + .cc-body{outline:2px solid var(--cc-accent);outline-offset:1px;background:linear-gradient(140deg,#fff,#ffe5f3);}
    .cc-body{flex:1;display:flex;flex-direction:column;gap:.55rem;padding:.65rem .7rem .75rem;}
    .cc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;}
    .cc-name{font-weight:600;font-size:.78rem;line-height:1.2;word-break:break-word;color:#1d252c;letter-spacing:.4px;}
    .cc-badge{font-size:.5rem;padding:4px 7px;border-radius:40px;display:inline-flex;align-items:center;gap:4px;font-weight:700;color:#fff;letter-spacing:.5px;text-transform:uppercase;line-height:1;}
    .cc-badge i{font-size:.75rem;}
    .cc-badge.status-green{background:#2ECC71;}
    .cc-badge.status-red{background:#E74C3C;}
    .cc-badge.status-yellow{background:#F1C40F;color:#222;}
    .cc-badge.status-gray{background:#95a5a6;}
    .cc-metrics{display:flex;justify-content:space-between;align-items:center;gap:.35rem;}
    .cc-metric{flex:1;display:flex;flex-direction:column;align-items:center;background:#f1f3f5;border-radius:10px;padding:4px 4px;}
    .cc-metric .m-label{font-size:.48rem;font-weight:600;opacity:.6;letter-spacing:.5px;}
    .cc-metric .m-val{font-size:.68rem;font-weight:700;line-height:1.1;}
    .cc-metric .m-val.good{color:#2ECC71;}
    .cc-metric .m-val.mid{color:#F39C12;}
    .cc-metric .m-val.low{color:#E74C3C;}
    .cc-bar-wrap{margin-top:.1rem;}
    .cc-bar{height:6px;width:100%;background:#ecf0f2;border-radius:20px;overflow:hidden;position:relative;}
    .cc-bar-fill{height:100%;background:linear-gradient(90deg,var(--cc-accent),#ff7bbd);box-shadow:0 0 0 1px #fff inset;}
    .cc-bar-fill.av-0{background:#e74c3c;}
    .cc-bar-fill.av-25{background:#fd9644;}
    .cc-bar-fill.av-50{background:#f1c40f;}
    .cc-bar-fill.av-75{background:#27ae60;}
    .cc-bar-fill.av-full{background:#16a085;}
    .cc-preview{margin-top:1rem;padding:.9rem .95rem 1rem;background:#fff;border:1px solid var(--cc-border);border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,.05);}
    .cc-preview-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.55rem;}
    .cc-preview-header h6{margin:0;font-size:.7rem;font-weight:700;letter-spacing:.6px;color:#555;text-transform:uppercase;}
    .cc-preview .cc-preview-summary{font-size:.65rem;}
    .btn-mini{border:none;background:#f1f3f5;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#555;transition:.2s;}
    .btn-mini:hover{background:#e2e6ea;}
    .no-others{padding:1.2rem;text-align:center;font-size:.7rem;color:#777;font-style:italic;background:#fff;border:1px dashed var(--cc-border);border-radius:12px;}
    .cc-scroll-wrapper{overflow-y:auto;flex:1 1 auto;min-height:0;-webkit-overflow-scrolling:touch;}
    .cc-scroll-wrapper::-webkit-scrollbar{width:10px;}
    .cc-scroll-wrapper::-webkit-scrollbar-track{background:transparent;}
    .cc-scroll-wrapper::-webkit-scrollbar-thumb{background:#cdd2d6;border-radius:30px;}
    .cc-scroll-wrapper::-webkit-scrollbar-thumb:hover{background:#b6bbc0;}
    .cc-modal-responsive .swal2-actions{position:sticky;bottom:0;left:0;right:0;background:#ffffff;padding:14px clamp(10px,2vw,20px);gap:.85rem;box-shadow:0 -4px 18px -6px rgba(0,0,0,.08);z-index:5;flex-wrap:wrap;}
    @supports(padding: max(0px)){.cc-modal-responsive .swal2-actions{padding-bottom:max(14px, env(safe-area-inset-bottom));}}
    .cc-modal-responsive .swal2-actions button{flex:1 1 200px;min-width:170px;font-weight:600;letter-spacing:.3px;}
    @media(max-width:540px){
      .cc-modal-responsive .swal2-actions button{flex:1 1 140px;min-width:140px;font-size:.7rem;padding:.6rem .5rem;}
      .cc-filter-group{padding:.45rem .65rem;}
      .cc-filter-group input{font-size:.7rem;}
      .cc-item{border-radius:11px;}
    }
    `;
            document.head.appendChild(st);
        }
        /* INICIO DEL CÓDIGO NUEVO PARA EL BLOQUE DE LÓGICA DEL BOTÓN CERRAR/REABRIR */
        (() => {
            let toggleBusy = false;

            async function toggleContainerState() {
                if (toggleBusy) return;
                if (!currentContenedor || !currentFileName) {
                    return Swal.fire('Atención', 'No hay un contenedor activo.', 'info');
                }

                const manifestData = excelDataGlobal[currentFileName];
                if (!manifestData) {
                    return Swal.fire('Error', 'No se encontró el manifiesto en memoria.', 'error');
                }

                const isClosed = !!manifestData.closedContainers?.[currentContenedor];
                const nextState = !isClosed;
                const actionTxt = isClosed ? 'Reabrir' : 'Cerrar';
                const icon = isClosed ? 'lock_open' : 'lock';
                const hdrColor = isClosed ? '#198754' : '#dc3545';
                const notePlaceholder = isClosed
                    ? 'Motivo (opcional) de reapertura...'
                    : 'Motivo (opcional) de cierre...';

                const status = getContainerStatus(currentContainerRecords || []);
                const summaryHTML = getContainerSummaryGridHTML(currentContainerRecords || []);

                const { isConfirmed, value } = await Swal.fire({
                    width: 'min(900px,96vw)',
                    customClass: { popup: 'swal-modal-pro toggle-container-modal epic-toggle-modal' },
                    html: `
                <div class="epic-toggle-wrapper">
                  <div class="epic-header" style="--hdr-color:${hdrColor}">
                    <div class="hdr-left">
                    <div class="icon-wrap">
                    <i class="material-icons">${icon}</i>
                    </div>
                    <div class="titles">
                    <h2>${actionTxt} Contenedor</h2>
                    <p>${currentFileName}</p>
                    </div>
                    </div>
                    <div class="hdr-right">
                    <div class="state-badge ${status.colorClass}">
                    <i class="bi ${status.icon}"></i><span>${status.text}</span>
                    </div>
                    <div class="cont-chip">
                    <i class="bi bi-box-seam"></i> ${currentContenedor}
                    </div>
                    </div>
                  </div>
                  <div class="epic-body-scroll">
                    <section class="panel panel-highlight">
                    <h3 class="panel-title">
                    <i class="bi bi-clipboard-data"></i> Resumen Rápido
                    </h3>
                    <div class="quick-grid">
                    ${summaryHTML}
                    </div>
                    </section>
                    <section class="panel">
                    <h3 class="panel-title">
                    <i class="bi bi-chat-dots"></i> Comentario (opcional)
                    </h3>
                    <textarea id="containerToggleNote" class="form-control epic-textarea" rows="2" placeholder="${notePlaceholder}"></textarea>
                    </section>
                    <section class="panel panel-warning">
                    <h3 class="panel-title">
                    <i class="bi bi-question-circle"></i> Confirmación
                    </h3>
                    <p class="confirm-text">
                    ${isClosed
                            ? 'Al reabrir podrás seguir registrando piezas en este contenedor.'
                            : 'Al cerrar ya no se podrán registrar más piezas (seguirá visible solo en modo lectura).'}
                    <br><strong>¿Confirmas la acción?</strong>
                    </p>
                    </section>
                  </div>
                  <div class="epic-footer-hint">
                    <i class="bi bi-info-circle-fill"></i> La acción queda registrada con usuario, fecha y nota.
                  </div>
                </div>
            <style>
              /* ... (el resto de los estilos aquí) ... */
              .epic-toggle-modal.swal2-popup{
                padding:0;
                overflow:hidden;
                background:#f5f7fa;
                border-radius:20px;
                box-shadow:0 15px 45px -10px rgba(0,0,0,.25);
              }
              .epic-toggle-wrapper{
                display:flex;
                flex-direction:column;
                max-height:78vh;
                position:relative;
              }
              .epic-header{
                display:flex;
                justify-content:space-between;
                gap:1rem;
                padding:1rem 1.4rem 1rem;
                background:linear-gradient(135deg,var(--hdr-color) 0%, #1f1f1f 150%);
                color:#fff;
              }
              .hdr-left{display:flex;align-items:center;gap:1rem;min-width:0;}
              .icon-wrap{
                width:62px;
                height:62px;
                border-radius:18px;
                background:rgba(255,255,255,.12);
                backdrop-filter:blur(4px);
                display:flex;
                align-items:center;
                justify-content:center;
                box-shadow:0 4px 14px -4px rgba(0,0,0,.5) inset,0 0 0 1px rgba(255,255,255,.18);
              }
              .icon-wrap i{font-size:2.2rem;}
              .titles h2{
                font-size:1.5rem;
                margin:0 0 .15rem;
                line-height:1.1;
                font-weight:700;
                letter-spacing:.5px;
                text-shadow:0 2px 8px rgba(0,0,0,.25);
              }
              .titles p{
                margin:0;
                font-size:.75rem;
                opacity:.9;
                letter-spacing:.5px;
                font-weight:500;
                word-break:break-all;
              }
              .hdr-right{
                display:flex;
                flex-direction:column;
                align-items:flex-end;
                gap:.55rem;
              }
              .state-badge{
                display:inline-flex;
                align-items:center;
                gap:.45rem;
                font-size:.65rem;
                letter-spacing:.5px;
                font-weight:700;
                padding:.45rem .75rem;
                border-radius:40px;
                background:#444;
                text-transform:uppercase;
                box-shadow:0 0 0 1px rgba(255,255,255,.2),0 4px 10px -2px rgba(0,0,0,.4);
              }
              .state-badge i{font-size:.9rem;}
              .state-badge.status-green{background:#28a745;}
              .state-badge.status-red{background:#dc3545;}
              .state-badge.status-yellow{background:#ffc107;color:#222;}
              .state-badge.status-gray{background:#6c757d;}
              .cont-chip{
                display:inline-flex;
                align-items:center;
                gap:.4rem;
                background:rgba(255,255,255,.12);
                padding:.4rem .75rem;
                border-radius:10px;
                font-size:.7rem;
                font-weight:600;
                letter-spacing:.5px;
                box-shadow:0 0 0 1px rgba(255,255,255,.18);
              }

              .epic-body-scroll{
                overflow:auto;
                padding:1rem 1.25rem 1.2rem;
                display:flex;
                flex-direction:column;
                gap:1rem;
              }
              .epic-body-scroll::-webkit-scrollbar{width:10px;}
              .epic-body-scroll::-webkit-scrollbar-track{background:transparent;}
              .epic-body-scroll::-webkit-scrollbar-thumb{
                background:#c7ccd1;
                border-radius:40px;
                border:2px solid #f5f7fa;
              }
              .epic-body-scroll::-webkit-scrollbar-thumb:hover{background:#b0b6bc;}

              .panel{
                background:#ffffff;
                border:1px solid #e1e5e9;
                border-radius:18px;
                padding:1.05rem 1.1rem 1.2rem;
                position:relative;
                box-shadow:0 4px 18px -8px rgba(0,0,0,.1);
              }
              .panel-highlight{
                border:1px solid var(--rosa-principal,#E6007E);
                box-shadow:0 4px 20px -6px rgba(230,0,126,.25);
              }
              .panel-warning{
                background:linear-gradient(135deg,#fff 0%,#fff7f7 100%);
                border:1px solid #f3d2d2;
              }
              .panel-title{
                margin:0 0 .85rem;
                font-size:.85rem;
                font-weight:700;
                letter-spacing:.75px;
                text-transform:uppercase;
                display:flex;
                align-items:center;
                gap:.4rem;
                color:#34404c;
              }
              .panel-title i{
                font-size:1rem;
                color:var(--rosa-principal,#E6007E);
              }

              .quick-grid{
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
                gap:.7rem;
                font-size:.65rem;
              }
              .summary-item-pro{
                display:flex;
                align-items:center;
                gap:.6rem;
                background:#f6f8fa;
                border:1px solid #e2e6ea;
                padding:.7rem .6rem;
                border-radius:12px;
                position:relative;
                overflow:hidden;
                min-height:60px;
              }
              .summary-item-pro i{
                font-size:1.4rem;
                color:var(--rosa-principal,#E6007E);
                flex-shrink:0;
              }
              .summary-item-pro .label{
                display:block;
                font-size:.55rem;
                font-weight:600;
                letter-spacing:.5px;
                text-transform:uppercase;
                margin:0 0 2px;
                color:#6c7680;
                white-space:nowrap;
              }
              .summary-item-pro .value{
                font-size:.95rem;
                font-weight:700;
                color:#222;
                letter-spacing:.5px;
                line-height:1.05;
              }
              .summary-item-pro .value.is-missing{color:#dc3545;}
              .summary-item-pro .value.is-excess{color:#ff9800;}

              .epic-textarea{
                border-radius:14px;
                background:#f8f9fb;
                border:1px solid #e1e5e9;
                font-size:.8rem;
                resize:vertical;
                min-height:70px;
                line-height:1.3;
              }
              .epic-textarea:focus{
                border-color:var(--rosa-principal,#E6007E);
                box-shadow:0 0 0 3px rgba(230,0,126,.25);
                outline:none;
              }

              .confirm-text{
                font-size:.8rem;
                margin:0;
                color:#444d55;
                line-height:1.35;
              }

              .epic-footer-hint{
                background:#fff;
                border-top:1px solid #e2e6ea;
                padding:.6rem .9rem;
                font-size:.65rem;
                color:#6d7680;
                display:flex;
                align-items:center;
                gap:.5rem;
                letter-spacing:.3px;
                font-weight:500;
              }
              .epic-footer-hint i{
                color:var(--rosa-principal,#E6007E);
                font-size:.9rem;
              }

              /* SweetAlert buttons area adjustments */
              .epic-toggle-modal .swal2-actions{
                padding: .9rem 1rem 1rem;
                gap:.75rem;
                flex-wrap:wrap;
                background:#fff;
                margin:0;
                border-top:1px solid #e3e6e9;
              }
              .epic-toggle-modal .swal2-actions button{
                border-radius:12px!important;
                font-weight:600!important;
                letter-spacing:.4px;
                font-size:.8rem!important;
                padding:.75rem 1.2rem!important;
                flex:1 1 180px;
              }
              .epic-toggle-modal .swal2-actions button:focus-visible{
                box-shadow:0 0 0 3px rgba(230,0,126,.35)!important;
                outline:none!important;
              }

              @media (max-width:700px){
                .epic-header{
                  flex-direction:column;
                  align-items:flex-start;
                  padding:1rem 1.05rem 1.1rem;
                  gap:.9rem;
                }
                .hdr-right{align-items:flex-start;}
                .icon-wrap{width:54px;height:54px;}
                .titles h2{font-size:1.25rem;}
                .panel{padding:.9rem .85rem 1rem;}
                .quick-grid{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.55rem;}
                .summary-item-pro{padding:.55rem .5rem;}
                .summary-item-pro .value{font-size:.8rem;}
              }
              @media (max-width:450px){
                .titles h2{font-size:1.15rem;}
                .cont-chip{font-size:.6rem;}
                .state-badge{font-size:.55rem;}
                .epic-toggle-modal .swal2-actions button{flex:1 1 120px;font-size:.7rem!important;padding:.6rem .7rem!important;}
              }
            </style>
          `,
                    showCancelButton: true,
                    focusConfirm: false,
                    confirmButtonText: `Sí, ${actionTxt}`,
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: isClosed ? '#198754' : '#dc3545',
                    cancelButtonColor: '#6c757d',
                    showLoaderOnConfirm: true,
                    preConfirm: async () => {
                        try {
                            toggleBusy = true;
                            const note = (document.getElementById('containerToggleNote')?.value || '').trim();

                            const logEntry = {
                                contenedor: currentContenedor,
                                cerrado: nextState,
                                note: note || null,
                                user: currentUser?.email || currentUser?.uid || 'desconocido',
                                ts: Date.now()
                            };

                            await db.collection('manifiestos').doc(currentFileName).update({
                                [`closedContainers.${currentContenedor}`]: nextState,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                toggleLog: firebase.firestore.FieldValue.arrayUnion(logEntry)
                            });

                            await updateManifestMetadata(currentFileName, currentUser.email || currentUser.uid);

                            return { newClosedState: nextState };
                        } catch (e) {
                            console.error(e);
                            Swal.showValidationMessage('No se pudo actualizar: ' + (e.message || e));
                            return false;
                        } finally {
                            toggleBusy = false;
                        }
                    },
                    allowOutsideClick: () => !Swal.isLoading(),
                    didOpen: () => {
                        setTimeout(() => {
                            const ta = document.getElementById('containerToggleNote');
                            ta && ta.focus();
                        }, 60);
                    }
                });

                if (!isConfirmed || !value) return;

                // La interfaz se actualizará automáticamente por el listener que configuramos en realOpenFileManifiesto.
                Swal.fire({
                    toast: true,
                    icon: 'success',
                    position: 'top-end',
                    title: `Contenedor ${value.newClosedState ? 'cerrado' : 'reabierto'}`,
                    timer: 2000,
                    showConfirmButton: false
                });
            }

            btnCerrarContenedor.addEventListener('click', toggleContainerState);

            window.unsubscribeFromContainerChanges = () => {
                if (unsubscribeFromScans) {
                    unsubscribeFromScans();
                    unsubscribeFromScans = null;
                }
                if (unsubscribeFromManifest) {
                    unsubscribeFromManifest();
                    unsubscribeFromManifest = null;
                }
            };
        })();
        /* FIN DEL CÓDIGO NUEVO PARA EL BLOQUE DE LÓGICA DEL BOTÓN CERRAR/REABRIR */
        async function actualizarMetadatosManifiesto(fileName) {
            if (!excelDataGlobal[fileName]) return;

            const datos = excelDataGlobal[fileName].data;
            if (!datos || datos.length === 0) return;

            let totalSAP = 0;
            let totalSCAN = 0;

            datos.forEach(r => {
                totalSAP += Number(r.SAP) || 0;
                totalSCAN += Number(r.SCANNER) || 0;
            });

            const avance = totalSAP > 0 ? Math.round((totalSCAN / totalSAP) * 100) : (totalSCAN > 0 ? 100 : 0);

            let estado = "Sin Iniciar";
            if (avance >= 100) {
                estado = (totalSCAN > totalSAP) ? "Completo con Excedentes" : "Completo";
            } else if (avance >= 50) {
                estado = "Avanzado";
            } else if (avance > 0) {
                estado = "En Progreso";
            } else if (totalSAP > 0 && avance === 0) {
                estado = "Faltantes Detectados";
            }
            const metadata = {
                progreso: {
                    totalSAP,
                    totalSCAN,
                    avance,
                    estado
                },
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                // ❌ no seteamos lastUser aquí
                lastUser: excelDataGlobal[fileName]?.lastUser || null // opcional: preservar si ya existe
            };

            await db.collection('manifiestos').doc(fileName).set(metadata, {
                merge: true
            });

        }

        let containersMapGlobal = {};
        let skuContainerMapGlobal = {};

        const motivationalPhrases = [
            "Analizando los datos...",
            "Buscando coincidencias...",
            "La eficiencia es clave. ¡Ya casi!",
            "Revisando cada rincón digital...",
            "El éxito es la suma de pequeños esfuerzos.",
            "Un momento, estamos en ello...",
            "Preparando la información para ti...",
            "Tu próxima gran jugada está a un segundo."
        ];
        let loadingIntervalId = null;

        function showNotFoundAlert(type) {
            Swal.fire({
                html: `
                            <div class="epic-not-found-container animate__animated animate__bounceIn">
                                <div class="epic-icon-wrapper">
                                    <i class="bi bi-search"></i>
                                    <span class="question-mark">?</span>
                                </div>
                                <h2 class="epic-title">¡Búsqueda sin Éxito!</h2>
                                <p class="epic-message">
                                    No hemos encontrado ninguna coincidencia para el <strong>${type}</strong> que buscas en los manifiestos activos.
                                </p>
                                <div class="epic-suggestions">
                                    <h4 class="suggestions-title">¿Qué puedes hacer ahora?</h4>
                                    <ul>
                                        <li><i class="bi bi-spellcheck"></i> <strong>Verifica el código:</strong> Un solo dígito puede hacer la diferencia. ¡Revisa que esté perfecto!</li>
                                        <li><i class="bi bi-cloud-arrow-up-fill"></i> <strong>¿Es un manifiesto nuevo?</strong> Si es así, asegúrate de haberlo cargado primero en la sección de subida.</li>
                                        <li><i class="bi bi-question-circle-fill"></i> <strong>Contacta a soporte:</strong> Si estás seguro de que el código es correcto, podría haber un problema mayor.</li>
                                    </ul>
                                </div>
                            </div>
                            <style>
                                .epic-not-found-container {
                                    font-family: 'Poppins', sans-serif;
                                    padding: 1.5rem;
                                    text-align: center;
                                }
                                .epic-icon-wrapper {
                                    position: relative;
                                    width: 100px;
                                    height: 100px;
                                    margin: 0 auto 1.5rem;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    background: linear-gradient(145deg, #f8f9fa, #e9ecef);
                                    border-radius: 50%;
                                    border: 4px solid #fff;
                                    box-shadow: 0 8px 25px rgba(0,0,0,0.1);
                                }
                                .epic-icon-wrapper .bi-search {
                                    font-size: 3.5rem;
                                    color: var(--rosa-principal);
                                    animation: pulse-search 2s infinite ease-in-out;
                                }
                                .epic-icon-wrapper .question-mark {
                                    position: absolute;
                                    top: 0px;
                                    right: 0px;
                                    width: 30px;
                                    height: 30px;
                                    background-color: #dc3545;
                                    color: white;
                                    border-radius: 50%;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 1.2rem;
                                    font-weight: 700;
                                    border: 2px solid white;
                                    transform: rotate(10deg);
                                    animation: bounce-qmark 1.5s infinite;
                                }
                                @keyframes pulse-search {
                                    0% { transform: scale(1); }
                                    50% { transform: scale(1.1); }
                                    100% { transform: scale(1); }
                                }
                                @keyframes bounce-qmark {
                                    0%, 20%, 50%, 80%, 100% { transform: translateY(0) rotate(10deg); }
                                    40% { transform: translateY(-10px) rotate(10deg); }
                                    60% { transform: translateY(-5px) rotate(10deg); }
                                }
                                .epic-title {
                                    font-size: 1.8rem;
                                    font-weight: 700;
                                    color: var(--texto-principal);
                                    margin-bottom: 0.5rem;
                                }
                                .epic-message {
                                    font-size: 1rem;
                                    color: #6c757d;
                                    margin-bottom: 2rem;
                                }
                                .epic-suggestions {
                                    text-align: left;
                                    background-color: #f8f9fa;
                                    border-radius: var(--ios-border-radius);
                                    padding: 1.5rem;
                                    border-top: 4px solid var(--rosa-principal);
                                }
                                .suggestions-title {
                                    font-size: 1.1rem;
                                    font-weight: 600;
                                    color: var(--texto-principal);
                                    margin-bottom: 1rem;
                                }
                                .epic-suggestions ul {
                                    list-style: none;
                                    padding: 0;
                                    margin: 0;
                                    display: flex;
                                    flex-direction: column;
                                    gap: 0.75rem;
                                }
                                .epic-suggestions li {
                                    display: flex;
                                    align-items: flex-start;
                                    gap: 0.75rem;
                                    font-size: 0.9rem;
                                    color: #495057;
                                }
                                .epic-suggestions .bi {
                                    font-size: 1.2rem;
                                    color: var(--rosa-principal);
                                    margin-top: 2px;
                                }
                            </style>
                        `,
                showConfirmButton: true,
                confirmButtonText: '<i class="bi bi-arrow-repeat"></i> Entendido, reintentar',
                confirmButtonColor: 'var(--rosa-principal)',
                customClass: {
                    popup: 'p-0 border-0 shadow-lg',
                    htmlContainer: 'm-0',
                    actions: 'm-0 p-3 border-top',
                    confirmButton: 'btn btn-primary-main'
                }
            });
        }

        function createContainerResultCard(containerName, file, isClosed, onclickAction) {
            return `
                    <div class="result-item-card">
                        <div class="item-info">
                            <div class="item-title">
                                <i class="material-icons text-primary">inventory_2</i>
                                ${containerName}
                                ${isClosed ? `<span class="status-badge is-closed">CERRADO</span>` : ''}
                            </div>
                            <div class="item-meta">
                                <strong>Archivo:</strong> ${file}
                            </div>
                        </div>
                        <button class="btn btn-primary btn-sm btn-choose" onclick="${onclickAction}">
                            <i class="material-icons">touch_app</i> Elegir
                        </button>
                    </div>`;
        }

        /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA buscarReferencia */

        async function buscarReferencia(ref) {
            const searchTerm = ref.trim().toUpperCase();
            if (!searchTerm) return;

            let candidates = await checkFileForReference(searchTerm);
            if (!candidates || candidates.length === 0) {
                Swal.close();
                return showNotFoundAlert("referencia");
            }

            const foundChoices = [];
            const uniqueCheck = new Set();
            candidates.forEach(candidate => {
                const fileName = candidate.fileName;
                candidate.matchedRecords.forEach(record => {
                    const containerName = String(record.CONTENEDOR || "").trim().toUpperCase();
                    if (!containerName) return;
                    const choiceKey = `${containerName}|${fileName}`;
                    if (!uniqueCheck.has(choiceKey)) {
                        const recordsForThisContainer = excelDataGlobal[fileName].data.filter(
                            rec => String(rec.CONTENEDOR || "").trim().toUpperCase() === containerName
                        );
                        const totalSKUs = recordsForThisContainer.length;
                        const totalSAP = recordsForThisContainer.reduce((sum, rec) => sum + (Number(rec.SAP) || 0), 0);
                        foundChoices.push({ containerName, fileName, totalSKUs, totalSAP });
                        uniqueCheck.add(choiceKey);
                    }
                });
            });

            if (foundChoices.length === 0) {
                Swal.close();
                return showNotFoundAlert("referencia en un contenedor válido");
            }

            if (foundChoices.length === 1) {
                Swal.close();
                const choice = foundChoices[0];
                realOpenFileManifiesto(choice.fileName, choice.containerName);
                return;
            }

            const choiceHTML = foundChoices.map(choice => {
                const isClosed = excelDataGlobal[choice.fileName]?.closedContainers?.[choice.containerName];
                return `
            <div class="result-item-card">
              <div class="item-info">
                <div class="item-title">
                  <i class="material-icons text-primary">inventory_2</i>
                  ${choice.containerName}
                  ${isClosed ? `<span class="status-badge is-closed">CERRADO</span>` : ''}
                </div>
                <div class="item-meta">
                  <span><strong>Archivo:</strong> ${choice.fileName}</span><br>
                  <span><strong>SKUs:</strong> ${choice.totalSKUs} | <strong>Piezas SAP:</strong> ${choice.totalSAP}</span>
                </div>
              </div>
              <button class="btn btn-primary btn-sm btn-choose" onclick="window.openContainerFromFile('${choice.containerName}', '${choice.fileName}')">
                <i class="material-icons">touch_app</i> Elegir
              </button>
            </div>`;
            }).join('');

            Swal.close();
            Swal.fire({
                title: "Múltiples Coincidencias Encontradas",
                html: `<p>Se encontró "<strong>${searchTerm}</strong>" en los siguientes contenedores. Elige el correcto:</p><div class="results-list-container">${choiceHTML}</div>`,
                showConfirmButton: false,
                width: "700px",
            });
        }
        window.openContainerFromFile = (containerName, fileName) => {
            Swal.close();
            realOpenFileManifiesto(fileName, containerName);
        };

        /* FIN DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA buscarReferencia */

        window.selectContainerV2 = function (cont) {
            const info = window.containersMapGlobal[cont];
            if (info) {
                Swal.close();
                openContainerDirect({
                    fileName: info.fileName,
                    matchedRecords: info.records
                }, 0);
            }
        };

        // BÚSQUEDA: muestra 1 modal y llama 1 sola vez a buscarReferencia
        const handleSearch = (value) => {
            const val = value.trim().toUpperCase();
            if (val.length < 5) return;

            let phrasesTimer = null;

            Swal.fire({
                html: `
      <div class="epic-loading-container">
        <div class="radar-scanner">
          <div class="radar-icon-wrapper">
            <i class="bi bi-binoculars-fill"></i>
          </div>
        </div>
        <h2 class="epic-loading-title">Iniciando Protocolo de Búsqueda...</h2>
        <p id="motivational-phrase" class="epic-loading-phrase"></p>
        <div class="progress-bar-simulation">
          <div class="progress-bar-inner"></div>
        </div>
      </div>
      <style>/* (mantén los estilos que ya tenías aquí) */</style>
    `,
                showConfirmButton: false,
                allowOutsideClick: false,
                customClass: { popup: 'p-0 border-0 shadow-lg rounded-3' },
                didOpen: () => {
                    const phraseElement = document.getElementById('motivational-phrase');
                    if (phraseElement) {
                        let idx = 0;
                        phraseElement.textContent = motivationalPhrases[idx];
                        phrasesTimer = setInterval(() => {
                            phraseElement.classList.add('fade-out');
                            setTimeout(() => {
                                idx = (idx + 1) % motivationalPhrases.length;
                                phraseElement.textContent = motivationalPhrases[idx];
                                phraseElement.classList.remove('fade-out');
                            }, 400);
                        }, 2500);
                    }
                },
                willClose: () => {
                    if (phrasesTimer) clearInterval(phrasesTimer);
                }
            });

            // Llamada única
            buscarReferencia(val);
        };

        // Listeners de búsqueda (Enter y paste)
        inputBusqueda.addEventListener("keyup", (event) => {
            if (event.key === 'Enter') handleSearch(inputBusqueda.value);
        });

        inputBusqueda.addEventListener("paste", (event) => {
            const pastedText = (event.clipboardData || window.clipboardData).getData('text');
            setTimeout(() => handleSearch(pastedText), 10);
        });


        window.selectContainer = function (cont) {
            Swal.close();
            const info = containersMap[cont];
            openContainerDirect({
                fileName: info[0].fileName,
                matchedRecords: info.map(i => i.record)
            }, 0);
        };

        window.selectSKUContainerV2 = function (cont) {
            const info = window.skuContainerMapGlobal[cont];
            if (info) {
                Swal.close();
                openContainerDirect({
                    fileName: info.fileName,
                    matchedRecords: info.records
                }, 0);
            }
        };

        async function processSingleFile(fileInfo) {
            const fileName = fileInfo.ref.name;
            if (excelDataGlobal[fileName]) {
                return;
            }
            await reconstructManifestDataFromFirebase(fileName);

            try {
                const url = await storage.ref(`Manifiestos/${fileInfo.folderName}/${fileName}`).getDownloadURL();
                const arrBuff = await (await fetch(url)).arrayBuffer();
                const wb = XLSX.read(arrBuff, {
                    type: "array",
                    cellDates: true
                });
                const sheet = wb.SheetNames[0];
                const dataJson = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);

                const docSnap = await db.collection("manifiestos").doc(fileName).get();

                let docData = docSnap.exists ? docSnap.data() : {};

                excelDataGlobal[fileName] = {
                    data: dataJson,
                    lastUser: docData.lastUser || "",
                    lastUserStore: docData.lastUserStore || "",
                    lastUserRole: docData.lastUserRole || "",
                    closedContainers: docData.closedContainers || {},
                    uploadedAt: docData.updatedAt ? docData.updatedAt.toDate() : null
                };
            } catch (error) {
                console.error(`Error procesando el archivo ${fileName}:`, error);
            }
        }

        /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA checkFileForReference */

        async function checkFileForReference(code) {
            const searchTerm = code.trim().toUpperCase();
            if (!searchTerm) return null;

            // Paso 1: Cargar la lista de todos los manifiestos si no está en caché.
            if (!allFilesList) {
                allFilesList = [];
                const storeFolder = currentUserStore === "ALL" ? "" : currentUserStore;
                if (storeFolder) {
                    const storeFiles = await storage.ref(`Manifiestos/${storeFolder}`).listAll();
                    storeFiles.items.forEach(itemRef => allFilesList.push({ folderName: storeFolder, ref: itemRef }));
                } else {
                    const root = await storage.ref("Manifiestos").listAll();
                    for (const folderRef of root.prefixes) {
                        const storeFiles = await folderRef.listAll();
                        storeFiles.items.forEach(itemRef => allFilesList.push({ folderName: folderRef.name, ref: itemRef }));
                    }
                }
            }

            // Paso 2: Usar Promise.all para procesar todos los manifiestos no cacheados.
            // Esto asegura que se espere a que todos se descarguen y reconstruyan.
            const filesToProcess = allFilesList.filter(f => !excelDataGlobal[f.ref.name]);
            if (filesToProcess.length > 0) {
                const phraseElement = document.getElementById('motivational-phrase');
                if (phraseElement) {
                    phraseElement.innerText = `Cargando ${filesToProcess.length} archivo(s) nuevos...`;
                }
                await Promise.all(filesToProcess.map(fileInfo => reconstructManifestDataFromFirebase(fileInfo.ref.name)));
            }

            const foundCandidates = [];
            const searchCode = searchTerm.replace(/^0+/, ''); // Normalizar código de búsqueda

            // Paso 3: Ahora que todos los datos están en excelDataGlobal, hacemos la búsqueda.
            for (const f of allFilesList) {
                const fileName = f.ref.name;
                const manifestData = excelDataGlobal[fileName];
                if (!manifestData) continue;

                const records = manifestData.data;

                const matched = records.filter(r => {
                    const cont = String(getPropCaseInsensitive(r, 'CONTENEDOR') || "").trim().toUpperCase();
                    const sku = String(getPropCaseInsensitive(r, 'SKU') || "").trim().toUpperCase();
                    const europeo = String(getPropCaseInsensitive(r, 'EUROPEO') || "").trim().toUpperCase();

                    // Lógica de comparación inteligente
                    const normalizedSku = sku.replace(/^0+/, '');
                    const normalizedEuropeo = europeo.replace(/^0+/, '');

                    return cont.includes(searchTerm) || normalizedSku === searchCode || normalizedEuropeo === searchCode;
                });

                if (matched.length > 0) {
                    foundCandidates.push({
                        folderName: f.folderName,
                        fileName,
                        matchedRecords: matched
                    });
                }
            }

            return foundCandidates.length > 0 ? foundCandidates : null;
        }

        /* FIN DEL CÓDIGO NUEVO PARA REEMPLAZAR LA FUNCIÓN COMPLETA checkFileForReference */

        function openContainerDirect(candidate, recordIndex = 0) {
            currentFileName = candidate.fileName;
            let cont = String(candidate.matchedRecords[recordIndex]?.CONTENEDOR || "").trim().toUpperCase();
            realOpenFileManifiesto(currentFileName, cont);
        }

        /* INICIO DE LA FUNCIÓN realOpenFileManifiesto CON PRESENCIA EN TIEMPO REAL */
        let unsubscribeFromScans = null;
        let unsubscribeFromManifest = null;

        async function realOpenFileManifiesto(fileName, cont) {
            Swal.fire({
                title: 'Abriendo contenedor...',
                html: `Sincronizando todos los escaneos para <strong>${fileName}</strong>.`,
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                if (unsubscribeFromScans) unsubscribeFromScans();
                if (unsubscribeFromManifest) unsubscribeFromManifest();
                if (unsubscribeFromPresence) unsubscribeFromPresence(); // <- Limpiar listener anterior

                lastKnownClosedState = {};

                const manifest = await reconstructManifestDataFromFirebase(fileName);
                if (!manifest || !manifest.data) {
                    throw new Error("No se pudieron reconstruir los datos del manifiesto.");
                }

                currentContainerRecords = manifest.data.filter(r =>
                    String(getPropCaseInsensitive(r, 'CONTENEDOR') || "").trim().toUpperCase() === cont.toUpperCase()
                );

                currentContenedor = cont;
                currentFileName = fileName;

                // ✅ LÓGICA DE PRESENCIA: Registrar al usuario al entrar
                await setUserPresence(fileName, cont);

                // Suscribirse a los cambios en el documento del manifiesto (estado de cierre)
                unsubscribeFromManifest = db.collection('manifiestos').doc(fileName)
                    .onSnapshot(async (docSnapshot) => {
                        const docData = docSnapshot.data();
                        if (!docData) return;

                        const newClosedContainers = docData.closedContainers || {};
                        excelDataGlobal[fileName].closedContainers = newClosedContainers;
                        const isClosed = !!newClosedContainers[cont];
                        const hasStateChanged = lastKnownClosedState[cont] !== isClosed;

                        const btnCerrar = document.getElementById("btnCerrarContenedor");
                        btnCerrar.querySelector('span').textContent = isClosed ? 'Reabrir' : 'Cerrar';
                        btnCerrar.querySelector('i.material-icons').textContent = isClosed ? 'lock_open' : 'lock';

                        const inputScan = document.getElementById("inputScanCode");
                        inputScan.disabled = isClosed;

                        mostrarDetallesContenedor(currentContainerRecords, isClosed);

                        const isLocalChange = docSnapshot.metadata.hasPendingWrites;
                        if (hasStateChanged && !isLocalChange) {
                            if (isClosed) {
                                Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `¡Contenedor cerrado por otro usuario!`, timer: 3000, showConfirmButton: false });
                            } else {
                                Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `¡Contenedor reabierto por otro usuario!`, timer: 3000, showConfirmButton: false });
                            }
                        }
                        lastKnownClosedState[cont] = isClosed;
                    }, (error) => {
                        console.error("Error al escuchar cambios en el manifiesto:", error);
                    });

                // Suscribirse a los cambios en tiempo real para la subcolección 'scans'
                unsubscribeFromScans = db.collection('manifiestos').doc(fileName).collection('scans')
                    .orderBy('scannedAt')
                    .onSnapshot(async (snapshot) => {
                        if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) {
                            return;
                        }
                        const updatedManifest = await reconstructManifestDataFromFirebase(fileName);
                        currentContainerRecords = updatedManifest.data.filter(r =>
                            String(getPropCaseInsensitive(r, 'CONTENEDOR') || "").trim().toUpperCase() === cont.toUpperCase()
                        );
                        const isClosed = excelDataGlobal[fileName].closedContainers?.[cont] || false;
                        mostrarDetallesContenedor(currentContainerRecords, isClosed);
                        let lastUserFromUpdate = "Sin movimientos registrados";
                        let latestDateFromUpdate = null;
                        currentContainerRecords.forEach(record => {
                            const scanDateValue = getPropCaseInsensitive(record, 'FECHA_ESCANEO');
                            if (scanDateValue) {
                                const recordDate = new Date(scanDateValue);
                                if (!isNaN(recordDate.getTime())) {
                                    if (!latestDateFromUpdate || recordDate > latestDateFromUpdate) {
                                        latestDateFromUpdate = recordDate;
                                        lastUserFromUpdate = getPropCaseInsensitive(record, 'LAST_SCANNED_BY') || "Desconocido";
                                    }
                                }
                            }
                        });
                        document.getElementById("containerLastUserUpdate").textContent = lastUserFromUpdate;
                    }, (error) => {
                        console.error("Error al escuchar cambios en 'scans':", error);
                        Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Error de Sincronización', text: 'No se pudieron recibir actualizaciones de escaneos.', timer: 3000, showConfirmButton: false });
                    });

                // ✅ LÓGICA DE PRESENCIA: Escuchar quién más está en este contenedor
                unsubscribeFromPresence = db.collection('presence')
                    .where('manifestId', '==', fileName)
                    .where('containerName', '==', cont)
                    .onSnapshot(querySnapshot => {
                        const users = [];
                        querySnapshot.forEach(doc => {
                            if (doc.id !== currentUser.uid) { // Ignorar al usuario actual
                                users.push(doc.data().userEmail.split('@')[0]); // Mostrar solo el nombre de usuario
                            }
                        });
                        const userListElement = document.getElementById('otherUsersInContainer');
                        if (users.length > 0) {
                            userListElement.innerHTML = `⚠️ También está(n) en este contenedor: <strong>${users.join(', ')}</strong>`;
                            userListElement.style.display = 'block';
                        } else {
                            userListElement.style.display = 'none';
                        }
                    });

                const dataObj = excelDataGlobal[fileName];
                const isClosed = dataObj.closedContainers?.[cont] || false;

                lastKnownClosedState[cont] = isClosed;

                let lastUserInContainer = "Sin movimientos registrados";
                let latestDate = null;
                currentContainerRecords.forEach(record => {
                    const scanDateValue = getPropCaseInsensitive(record, 'FECHA_ESCANEO');
                    if (scanDateValue) {
                        const recordDate = new Date(scanDateValue);
                        if (!isNaN(recordDate.getTime()) && (!latestDate || recordDate > latestDate)) {
                            latestDate = recordDate;
                            lastUserInContainer = getPropCaseInsensitive(record, 'LAST_SCANNED_BY') || "Desconocido";
                        }
                    }
                });

                document.getElementById("uploadAndSearchSection").style.display = "none";
                document.getElementById("containerResultsSection").style.display = "block";
                document.getElementById("scanEntrySection").style.display = "block";
                document.getElementById("selectedFileToWork").textContent = fileName;
                document.getElementById("lastUserUpdate").textContent = dataObj.lastUser || 'N/A';
                document.getElementById("containerHeader").querySelector('span').textContent = `Detalles de ${cont}`;
                document.getElementById("containerLastUserUpdate").textContent = lastUserInContainer;

                const btnCerrar = document.getElementById("btnCerrarContenedor");
                btnCerrar.querySelector('span').textContent = isClosed ? 'Reabrir' : 'Cerrar';
                btnCerrar.querySelector('i.material-icons').textContent = isClosed ? 'lock_open' : 'lock';

                const inputScan = document.getElementById("inputScanCode");
                inputScan.disabled = isClosed;
                inputScan.focus();

                Swal.close();

            } catch (error) {
                console.error("Error abriendo el manifiesto:", error);
                // ✅ También eliminar presencia si falla la carga
                await removeUserPresence();
                Swal.fire({ icon: 'error', title: 'Error de Carga', text: `No se pudo cargar la información para el contenedor. ${error.message}` });
            }
        }
        /* FIN DE LA FUNCIÓN realOpenFileManifiesto (COMPLETA Y MEJORADA) */
        function showScanSuccessToast(sku, newCount) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `+1 ${sku} (Total: ${newCount})`,
                showConfirmButton: false,
                timer: 1500,
                customClass: {
                    popup: 'scan-success-toast'
                }
            });
        }

        function showScanErrorToast(title, text) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'error',
                title: title,
                text: text,
                showConfirmButton: false,
                timer: 2500,
                customClass: {
                    popup: 'scan-error-toast'
                }
            });
        }
        // ——— Helpers para limpiar metadatos cuando SCAN llega a 0 ———
        function clearRowScanMetadata(row) {
            row.FECHA_ESCANEO = "";
            row.LAST_SCANNED_BY = "";
            row.ENTREGADO_A = "";
        }

        function containerHasAnyScan(records) {
            return records.some(r => (Number(r.SCANNER) || 0) > 0);
        }

        function showAddItemConfirmation(code) {
            return Swal.fire({
                html: `
                            <div class="modal-header-status status-reopen" style="background-color: #9C27B0;">
                                <i class="material-icons">add_shopping_cart</i>
                                <h3>Artículo No Encontrado</h3>
                            </div>
                            <div class="confirmation-modal-content">
                                <p class="main-text">El artículo <strong>${code}</strong> no existe en este contenedor.</p>
                                <p>¿Deseas añadirlo como un nuevo registro con Cantidad SAP = 0?</p>
                            </div>
                        `,
                showCancelButton: true,
                confirmButtonText: 'Sí, Añadir',
                cancelButtonText: 'Cancelar',
                width: "550px",
                padding: 0,
                customClass: {
                    confirmButton: 'btn-confirm-custom',
                    cancelButton: 'btn-cancel-custom'
                }
            });
        }

        function showMultipleMatchesModal(code, matchingRows) {
            const html = matchingRows.map((row, idx) => `
                        <div class="result-item-card">
                            <div class="item-info">
                                <div class="item-title">
                                    <i class="material-icons text-primary">sell</i>
                                    ${row.SKU || 'SKU no definido'}
                                </div>
                                <div class="item-meta">
                                    <strong>Descripción:</strong> ${row.DESCRIPCION || '(sin descripción)'}
                                </div>
                            </div>
                            <button class="btn btn-primary btn-sm btn-choose" onclick="window.chooseRow(${idx})">
                                <i class="material-icons">touch_app</i> Seleccionar
                            </button>
                        </div>
                    `).join('');

            Swal.fire({
                title: "Múltiples Coincidencias",
                html: `<p>Se encontraron varios registros para el código <strong>${code}</strong>. Por favor, selecciona el correcto:</p>
                               <div class="results-list-container">${html}</div>`,
                showConfirmButton: false,
                width: "650px"
            });
        }


        async function incrementRowAndNotify(row, code) {
            row.SCANNER = (Number(row.SCANNER) || 0) + 1;
            row.FECHA_ESCANEO = new Date();
            row.LAST_SCANNED_BY = currentUser.email || currentUser.uid;

            showScanSuccessToast(row.SKU || code, row.SCANNER);

            mostrarDetallesContenedor(currentContainerRecords);

            await reuploadFileWithScannerChanges(selectedFileToWorkEl.textContent);
        }
        // --- COMIENZO DE LA FUNCIÓN ACTUALIZADA: handleScanCode (CON LÓGICA INTELIGENTE) ---
        async function handleScanCode(code) {
            if (!currentEmployeeNumber) {
                showScanErrorToast('Falta # de Empleado');
                inputScanCode.value = "";
                inputScanCode.focus();
                return;
            }
            if (!currentContenedor) {
                showScanErrorToast('Sin Contenedor');
                inputScanCode.value = "";
                inputScanCode.focus();
                return;
            }

            const fn = currentFileName;
            const dataObj = excelDataGlobal[fn];

            if (!dataObj || dataObj.closedContainers?.[currentContenedor]) {
                showScanErrorToast('Contenedor cerrado');
                inputScanCode.value = "";
                inputScanCode.focus();
                return;
            }

            const codeUpper = code.trim().toUpperCase();
            let targetRow = null;



            // 1. Se busca una coincidencia en el contenedor actual
            const matchingRows = currentContainerRecords.filter(r => {
                const skuValue = String(getPropCaseInsensitive(r, 'SKU') || '').toUpperCase();
                const europeoValue = String(getPropCaseInsensitive(r, 'EUROPEO') || '').toUpperCase();

                // Primero, se busca una coincidencia exacta con el SKU (esto no cambia)
                if (skuValue === codeUpper) {
                    return true;
                }

                // --- INICIO DEL CAMBIO INTELIGENTE ---
                // Si hay un código europeo en el registro, procedemos con la comparación inteligente
                if (europeoValue) {
                    // Normalizamos ambos códigos: quitamos cualquier cero que tengan al principio.
                    // Ejemplo: '0123' se convierte en '123'
                    const normalizedScannedCode = codeUpper.replace(/^0+/, '');
                    const normalizedEuropeoValue = europeoValue.replace(/^0+/, '');

                    // Comparamos las versiones normalizadas.
                    if (normalizedEuropeoValue === normalizedScannedCode) {
                        return true;
                    }
                }
                // --- FIN DEL CAMBIO INTELIGENTE ---

                return false;
            });

            // El resto de la función (a partir de aquí) permanece exactamente igual que antes.
            if (matchingRows.length > 0) {
                targetRow = matchingRows.find(r => (Number(r.SCANNER) || 0) < (Number(r.SAP) || 0));
                if (!targetRow) {
                    targetRow = matchingRows[0];
                }
                targetRow.SCANNER = (Number(targetRow.SCANNER) || 0) + 1;

            } else {
                const {
                    isConfirmed
                } = await showAddItemConfirmation(codeUpper);
                if (!isConfirmed) {
                    inputScanCode.value = "";
                    inputScanCode.focus();
                    return;
                }

                let sectionForNewItem = "ARTICULO NUEVO";
                const validSectionsInContainer = new Set();
                currentContainerRecords.forEach(r => {
                    const sec = String(getPropCaseInsensitive(r, 'SECCION') || "").trim().toUpperCase();
                    if (sec && !["ARTICULO NUEVO", "N/A", "147"].includes(sec)) {
                        validSectionsInContainer.add(sec);
                    }
                });

                if (validSectionsInContainer.size > 0) {
                    sectionForNewItem = validSectionsInContainer.values().next().value;
                }

                const refForManifiesto = currentContainerRecords[0] || (excelDataGlobal[fn]?.data?.length > 0 ? excelDataGlobal[fn].data[0] : {});

                targetRow = {
                    FECHA: new Date(),
                    SECCION: sectionForNewItem,
                    MANIFIESTO: String(getPropCaseInsensitive(refForManifiesto, 'MANIFIESTO') || "N/A"),
                    CONTENEDOR: currentContenedor,
                    DESCRIPCION: "ARTÍCULO NUEVO (Añadido por escaneo)",
                    SKU: codeUpper,
                    EUROPEO: "",
                    SAP: 0,
                    SCANNER: 1,
                    ENTREGADO_A: currentEmployeeNumber
                };
                dataObj.data.push(targetRow);
                currentContainerRecords.push(targetRow);
                Swal.fire('¡Agregado!', `El artículo ${targetRow.SKU} se añadió al contenedor con sección ${targetRow.SECCION}.`, 'success');
            }

            Object.assign(targetRow, {
                LAST_SCANNED_BY: currentUser.email,
                FECHA_ESCANEO: new Date(),
                ENTREGADO_A: currentEmployeeNumber
            });

            const isContainerClosed = excelDataGlobal[fn]?.closedContainers?.[currentContenedor] || false;
            mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
            showScanSuccessToast(targetRow.SKU || codeUpper, targetRow.SCANNER);

            inputScanCode.value = "";
            inputScanCode.focus();

            /* INICIO DEL CÓDIGO NUEVO PARA REEMPLAZAR EL BLOQUE try...catch EN handleScanCode */
            try {
                await db.collection('manifiestos').doc(fn).collection('scans').add({
                    sku: targetRow.SKU,
                    type: 'add',
                    quantity: 1,
                    scannedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    employee: currentEmployeeNumber,
                    user: currentUser.email,
                    container: currentContenedor,
                    description: targetRow.DESCRIPCION,
                    section: targetRow.SECCION
                });

                // ✅ Reemplazamos la llamada directa con la función debounced
                updateMetadataDebounced();

            } catch (error) {
                console.error("Error guardando escaneo en Firestore:", error);
                showScanErrorToast('Error de Red', 'El escaneo no se guardó. Reinténtalo.');
                targetRow.SCANNER = (Number(targetRow.SCANNER) || 0) - 1;
                if (targetRow.SCANNER === 0 && targetRow.SAP === 0) {
                    currentContainerRecords = currentContainerRecords.filter(r => r !== targetRow);
                    dataObj.data = dataObj.data.filter(r => r !== targetRow);
                }
                const isContainerClosed = excelDataGlobal[fn]?.closedContainers?.[currentContenedor] || false;
                mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
            }
            /* FIN DEL CÓDIGO NUEVO PARA REEMPLAZAR EL BLOQUE try...catch EN handleScanCode */
        }
        function scanInputHandler() {
            let val = inputScanCode.value.replace(/\s|-/g, '').trim().toUpperCase();
            if (val.length >= 5) {
                handleScanCode(val);
                inputScanCode.value = "";
            }
        }

        // Evitar listeners duplicados para Enter
        inputScanCode.removeEventListener?.('keypress', inputScanCode.__enterHandler);
        inputScanCode.__enterHandler = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                scanInputHandler();
            }
        };
        inputScanCode.addEventListener("keypress", inputScanCode.__enterHandler);

        // Paste
        inputScanCode.addEventListener("paste", (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            inputScanCode.value = pastedText;
            scanInputHandler();
        });


        function incrementRow(rowObj, code) {
            const now = new Date();

            rowObj.SCANNER = (rowObj.SCANNER || 0) + 1;
            rowObj.LAST_SCANNED_BY = currentUser.email || currentUser.uid;
            rowObj.FECHA_ESCANEO = now;

            const dataObj = excelDataGlobal[currentFileName];
            dataObj.lastUser = rowObj.LAST_SCANNED_BY;
            excelDataGlobal[currentFileName] = dataObj;

            currentContainerRecords = dataObj.data.filter(x =>
                String(x.CONTENEDOR || "").trim().toUpperCase() === currentContenedor
            );

            // Obtener el estado correcto del contenedor
            const isContainerClosed = dataObj?.closedContainers?.[currentContenedor] || false;
            mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);

            Swal.fire({
                toast: true,
                position: "top-end",
                icon: "success",
                title: `+1 para ${code}`,
                showConfirmButton: false,
                timer: 1500,
                timerProgressBar: true
            });
        }

        function mostrarDetallesContenedor(registros, isClosed = false) {
            if (!registros) {
                containerDetailsEl.innerHTML = "";
                return;
            }

            // Copia ordenada (no mutar el arreglo original)
            const list = [...registros].sort(
                (a, b) => (a.SAP === 0) - (b.SAP === 0) || String(a.SKU || "").localeCompare(String(b.SKU || ""))
            );

            const cardsHTML = `<div class="details-list-container">
    ${list.map(r => {
                const sku = String(r.SKU || "").toUpperCase();
                const europeo = String(r.EUROPEO || "");
                const SAP = Number(r.SAP) || 0;
                const SCANNER = Number(r.SCANNER) || 0;
                const esNuevo = SAP === 0;
                let statusClass = '', diffText = '';

                if (SCANNER === SAP) { statusClass = 'is-ok'; diffText = 'OK'; }
                else if (SCANNER < SAP) { statusClass = 'is-missing'; diffText = `FALTA ${SAP - SCANNER}`; }
                else { statusClass = 'is-excess'; diffText = `SOBRA ${SCANNER - SAP}`; }

                let cardStatusClass = esNuevo ? 'is-new' : `status-${statusClass.substring(3)}`;
                const disabledAttr = isClosed ? 'disabled' : '';

                return `<div class="item-card ${cardStatusClass}" id="row-${sku}">
        <div class="item-card-main">
          <div class="sku-container">
            <i class="bi bi-upc-scan sku-icon"></i>
            <div>
              <span class="sku">${sku}</span>
              ${europeo ? `<span class="europeo-code"><i class="bi bi-globe-europe-africa"></i> ${europeo}</span>` : ''}
            </div>
          </div>
          <span class="descripcion">${r.DESCRIPCION || "Sin descripción"}</span>
        </div>
        <div class="item-card-stats">
          <div class="stat-item"><div class="label">SAP</div><div class="value">${SAP}</div></div>
          <div class="stat-item"><div class="label">SCAN</div><div id="scanner-cell-${sku}" class="value">${SCANNER}</div></div>
          <div class="stat-item"><div class="label">DIF.</div><div id="diff-cell-${sku}"><span class="diff-badge ${statusClass}">${diffText}</span></div></div>
        </div>
        <div class="item-card-actions">
          <button class="btn-action btn-danio" data-sku="${sku}" title="Reportar daño" ${disabledAttr}><i class="bi bi-cone-striped"></i></button>
          ${r.DANIO_FOTO_URL ? `<button class="btn-action btn-foto" data-url="${r.DANIO_FOTO_URL}" title="Ver foto"><i class="bi bi-image-fill"></i></button>` : ''}
          ${r.DANIO_FOTO_URL ? `<button class="btn-action btn-eliminar-foto" data-sku="${sku}" data-url="${r.DANIO_FOTO_URL}" title="Eliminar foto de daño" ${disabledAttr}><i class="bi bi-trash2-fill"></i></button>` : ''}
          <button class="btn-action btn-restar" data-sku="${sku}" title="Restar 1 pieza" ${disabledAttr}><i class="bi bi-dash-circle-fill"></i></button>
          ${esNuevo ? `<button class="btn-action btn-eliminar" data-sku="${sku}" title="Eliminar artículo añadido" ${disabledAttr}><i class="bi bi-x-octagon-fill"></i></button>` : ''}
        </div>
        <div class="item-card-details">
          <div class="detail-item" title="Sección"><i class="bi bi-folder2-open" style="color: #6f42c1;"></i><span>${r.SECCION || 'N/A'}</span></div>
          <div class="detail-item" title="Manifiesto"><i class="bi bi-file-earmark-text" style="color: #fd7e14;"></i><span>${r.MANIFIESTO || 'N/A'}</span></div>
<div class="detail-item" title="Fecha de Último Escaneo"><i class="bi bi-calendar-check" style="color: #0d6efd;"></i><span>${SCANNER > 0 && r.FECHA_ESCANEO ? formatFecha(r.FECHA_ESCANEO) : 'Sin escanear'}</span></div>
<div class="detail-item" title="Último escaneo por"><i class="bi bi-person-check-fill" style="color: #198754;"></i><span>${SCANNER > 0 ? (r.LAST_SCANNED_BY || 'N/A') : 'N/A'}</span></div>
<div class="detail-item" title="Entregado a empleado"><i class="bi bi-person-vcard" style="color: #E6007E;"></i><span>${SCANNER > 0 ? (r.ENTREGADO_A || 'N/A') : 'N/A'}</span></div>

          <div class="detail-item" title="Piezas con condición"><i class="bi bi-tools" style="color: #ffc107;"></i><span>${r.DANIO_CANTIDAD || '0'}</span></div>
        </div>
      </div>`;
            }).join('')}
  </div>
  <style>
    /* (mantén tus estilos; si quieres, copia los que ya tenías) */
  </style>`;

            containerDetailsEl.innerHTML = cardsHTML;

            // Evitar duplicar listeners
            if (containerDetailsEl.eventHandler) {
                containerDetailsEl.removeEventListener('click', containerDetailsEl.eventHandler);
            }

            // Reemplaza por completo la constante eventHandler que está dentro de mostrarDetallesContenedor

            const eventHandler = async (event) => {
                const target = event.target.closest('button');
                if (!target) return;

                const sku = target.dataset.sku || '';
                const fn = currentFileName;

                const clearRowScanMeta = (row) => {
                    row.FECHA_ESCANEO = "";
                    row.LAST_SCANNED_BY = "";
                    row.ENTREGADO_A = "";
                };

                const isContainerClosed = !!(excelDataGlobal[fn]?.closedContainers?.[currentContenedor]);

                if (target.classList.contains('btn-restar')) {
                    const rowObj = currentContainerRecords.find(r => String(getPropCaseInsensitive(r, 'SKU') || "").toUpperCase() === sku);

                    // ✅ AQUÍ ESTABA EL ERROR: Se cambió 'r' por 'rowObj' para usar el objeto correcto.
                    if (!rowObj || (Number(getPropCaseInsensitive(rowObj, 'SCANNER')) || 0) <= 0) return;

                    const prev = { SCANNER: Number(rowObj.SCANNER) || 0, FECHA_ESCANEO: rowObj.FECHA_ESCANEO, LAST_SCANNED_BY: rowObj.LAST_SCANNED_BY, ENTREGADO_A: rowObj.ENTREGADO_A };
                    rowObj.SCANNER = prev.SCANNER - 1;
                    if (rowObj.SCANNER <= 0) {
                        rowObj.SCANNER = 0;
                        clearRowScanMeta(rowObj);
                    }
                    mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
                    try {
                        await db.collection('manifiestos').doc(fn).collection('scans').add({ sku: rowObj.SKU, type: 'subtract', scannedAt: firebase.firestore.FieldValue.serverTimestamp(), employee: currentEmployeeNumber, user: currentUser.email, container: currentContenedor });
                        await updateManifestMetadata(fn, currentUser.email);
                    } catch (error) {
                        showScanErrorToast('Error de Red', 'No se pudo guardar la resta.');
                        rowObj.SCANNER = prev.SCANNER;
                        rowObj.FECHA_ESCANEO = prev.FECHA_ESCANEO;
                        rowObj.LAST_SCANNED_BY = prev.LAST_SCANNED_BY;
                        rowObj.ENTREGADO_A = prev.ENTREGADO_A;
                        mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
                    }
                } else if (target.classList.contains('btn-eliminar')) {
                    const { isConfirmed } = await Swal.fire({ title: '¿Estás seguro?', html: `Se eliminará permanentemente el artículo <strong>${sku}</strong> de este contenedor.`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonText: 'Cancelar', confirmButtonText: 'Sí, ¡Eliminar!' });
                    if (isConfirmed) {
                        const rowToRemove = currentContainerRecords.find(r => String(getPropCaseInsensitive(r, 'SKU') || "").toUpperCase() === sku && (Number(getPropCaseInsensitive(r, 'SAP')) || 0) === 0);
                        if (!rowToRemove) return;
                        const originalGlobalData = [...excelDataGlobal[fn].data];
                        const originalContainerRecords = [...currentContainerRecords];
                        currentContainerRecords = currentContainerRecords.filter(r => r !== rowToRemove);
                        excelDataGlobal[fn].data = excelDataGlobal[fn].data.filter(r => r !== rowToRemove);
                        mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
                        try {
                            await db.collection('manifiestos').doc(fn).collection('scans').add({ sku: sku, type: 'delete', scannedAt: firebase.firestore.FieldValue.serverTimestamp(), employee: currentEmployeeNumber, user: currentUser.email, container: currentContenedor });
                            await updateManifestMetadata(fn, currentUser.email);
                            Swal.fire('¡Eliminado!', `El artículo ${sku} ha sido marcado para eliminación.`, 'success');
                        } catch (error) {
                            console.error("Error al eliminar en Firestore:", error);
                            showScanErrorToast('Error de Red', 'No se pudo eliminar. Se restauró el artículo.');
                            excelDataGlobal[fn].data = originalGlobalData;
                            currentContainerRecords = originalContainerRecords;
                            mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
                        }
                    }
                } else if (target.classList.contains('btn-danio')) {
                    currentDanioSKU = sku;
                    danioCantidadInput.value = "1";
                    danioFotoInput.value = "";
                    modalDanios.show();
                } else if (target.classList.contains('btn-foto')) {
                    window.open(target.dataset.url, "_blank");
                } else if (target.classList.contains('btn-eliminar-foto')) {
                    const photoUrl = target.dataset.url;
                    const { isConfirmed } = await Swal.fire({ title: '¿Eliminar Foto?', text: "Esta acción eliminará la foto de la nube permanentemente.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc3545', confirmButtonText: 'Sí, eliminarla', cancelButtonText: 'Cancelar' });
                    if (isConfirmed) {
                        Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                        try {
                            const photoRef = storage.refFromURL(photoUrl);
                            await photoRef.delete();
                            const rowObj = currentContainerRecords.find(r => String(getPropCaseInsensitive(r, 'SKU') || "").toUpperCase() === sku);
                            if (rowObj) {
                                rowObj.DANIO_FOTO_URL = "";
                                await db.collection('manifiestos').doc(fn).collection('scans').add({ sku: sku, type: 'delete_photo', scannedAt: firebase.firestore.FieldValue.serverTimestamp(), user: currentUser.email, container: currentContenedor });
                                await updateManifestMetadata(fn, currentUser.email);
                            }
                            mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);
                            Swal.fire('¡Eliminada!', 'La foto ha sido eliminada con éxito.', 'success');
                        } catch (error) {
                            console.error("Error al eliminar la foto:", error);
                            Swal.fire('Error', 'No se pudo eliminar la foto. Es posible que ya no exista o haya un problema de red.', 'error');
                        }
                    }
                }
            };
            // Evitar listeners duplicados
            if (containerDetailsEl.eventHandler) {
                containerDetailsEl.removeEventListener('click', containerDetailsEl.eventHandler);
            }
            containerDetailsEl.eventHandler = eventHandler;
            containerDetailsEl.addEventListener('click', containerDetailsEl.eventHandler);
        }
        // === HASTA AQUÍ ===
        /***********************************************************
         * MODAL DE CONDICIONES DE LA MCIA
         ***********************************************************/
        btnGuardarDanio.addEventListener("click", async () => {
            let cant = parseInt(danioCantidadInput.value) || 0;
            if (!cant || cant < 1) {
                return Swal.fire({ icon: "info", title: "Cantidad inválida", html: `<i class="material-icons" style="color:#2196F3;">info</i> Ingrese una cantidad válida.` });
            }
            if (!currentDanioSKU) {
                return Swal.fire({ icon: "info", title: "Error interno", html: `<i class="material-icons" style="color:#2196F3;">info</i> No se puede guardar condiciones sin SKU.` });
            }
            let fn = currentFileName;
            let rowObj = currentContainerRecords.find(r => String(r.SKU || "").toUpperCase() === currentDanioSKU);
            if (!rowObj) {
                return Swal.fire({ icon: "info", title: "No encontrado", text: "No se encontró el SKU en el contenedor." });
            }

            Swal.fire({ title: "Procesando...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            let fotoUrl = rowObj.DANIO_FOTO_URL || "";
            const file = danioFotoInput.files[0];
            if (file) {
                const safeSKU = currentDanioSKU.replace(/[^a-zA-Z0-9]/g, '_');
                const ts = Date.now();
                const filePath = `Evidencias/${fn}/${currentContenedor}/${safeSKU}_${ts}.jpg`;
                const ref = storage.ref(filePath);
                const snap = await ref.put(file);
                fotoUrl = await snap.ref.getDownloadURL();
            }

            rowObj.DANIO_CANTIDAD = (rowObj.DANIO_CANTIDAD || 0) + cant;
            rowObj.DANIO_FOTO_URL = fotoUrl;

            try {
                await db.collection('manifiestos').doc(fn).collection('scans').add({
                    sku: currentDanioSKU,
                    type: 'damage',
                    quantity: cant,
                    photoURL: fotoUrl,
                    scannedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    user: currentUser.email,
                    container: currentContenedor
                });

                await updateManifestMetadata(fn, currentUser.email); // ✅ CORRECCIÓN

                const isContainerClosed = excelDataGlobal[fn]?.closedContainers?.[currentContenedor] || false;
                mostrarDetallesContenedor(currentContainerRecords, isContainerClosed);

                Swal.fire({ icon: "success", title: "Condiciones registradas", text: "Se guardó la información." });
                modalDanios.hide();
            } catch (e) {
                console.error(e);
                rowObj.DANIO_CANTIDAD -= cant; // Revertir si falla
                Swal.fire({ icon: "error", title: "Error", text: "No se pudo guardar la información de condiciones." });
            }
        });


        function getContainerAnalysis(records, closedContainers) {
            let groups = {};
            records.forEach(r => {
                let c = String(r.CONTENEDOR || "").trim().toUpperCase() || "SIN CONTENEDOR";
                if (!groups[c]) groups[c] = [];
                groups[c].push(r);
            });
            let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:15px;">`;
            for (let c in groups) {
                let closed = closedContainers && closedContainers[c] ? true : false;
                html += `<div class="analysis-box" style="padding:10px;border-radius:8px;${closed ? "border:2px solid red;background:rgba(255,0,0,0.1);" : "border:1px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.1);"}">
                                    <h5 style="margin-bottom:8px;">
                                      <i class="material-icons" style="vertical-align:middle; font-size:1.3rem; ${closed ? "color:red;" : ""}">inventory_2</i>
                                      Contenedor: ${c} ${closed ? '<span style="color:red;font-weight:bold;">(CERRADO)</span>' : ''}
                                    </h5>
                                    ${getContainerSummaryDetailed(groups[c])}
                                  </div>`;
            }
            html += "</div>";
            return html;
        }

        function getContainerSummaryDetailed(recs) {
            let totalRecords = recs.length;
            let workers = new Set();
            let sapSum = 0,
                scannedCorrectlySum = 0,
                excessSum = 0,
                missingSum = 0;

            recs.forEach(r => {
                const sap = Number(r.SAP) || 0;
                const scanner = Number(r.SCANNER) || 0;
                sapSum += sap;

                if (scanner >= sap) {
                    scannedCorrectlySum += sap;
                    excessSum += (scanner - sap);
                } else { // scanner < sap
                    scannedCorrectlySum += scanner;
                    missingSum += (sap - scanner);
                }

                if (r.LAST_SCANNED_BY) workers.add(r.LAST_SCANNED_BY);
            });

            let status = "INCOMPLETO";
            let statusColor = "#E74C3C"; // Rojo para incompleto
            let statusIcon = "bi-exclamation-triangle-fill";

            if (missingSum === 0) {
                if (excessSum > 0) {
                    status = "COMPLETO CON EXCEDENTES";
                    statusColor = "#F1C40F"; // Amarillo para excedentes
                    statusIcon = "bi-plus-circle-dotted";
                } else {
                    status = "COMPLETO";
                    statusColor = "#2ECC71"; // Verde para completo
                    statusIcon = "bi-check-circle-fill";
                }
            }

            return `
                        <style>
                            .summary-grid {
                                display: grid;
                                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                                gap: 1rem;
                                padding: 1rem;
                                background-color: #f8f9fa;
                                border-radius: 12px;
                            }
                            .summary-item {
                                display: flex;
                                align-items: center;
                                gap: 0.8rem;
                                background-color: #fff;
                                padding: 1rem;
                                border-radius: 8px;
                                border-left: 5px solid var(--rosa-principal);
                                box-shadow: 0 4px 12px rgba(0,0,0,0.07);
                                transition: transform 0.2s ease-in-out;
                            }
                            .summary-item:hover {
                                transform: translateY(-3px);
                            }
                            .summary-item.full-width {
                                grid-column: 1 / -1;
                            }
                            .summary-item i {
                                font-size: 2rem;
                                color: var(--rosa-principal);
                                opacity: 0.8;
                                flex-shrink: 0;
                            }
                            .summary-item .label {
                                font-size: 0.85rem;
                                color: #6c757d;
                                display: block;
                                font-weight: 500;
                                margin-bottom: 0.1rem;
                            }
                            .summary-item .value {
                                font-size: 1.4rem;
                                font-weight: 700;
                                color: var(--texto-principal);
                                line-height: 1.2;
                            }
                            .summary-item .value-badge {
                                font-size: 1rem;
                                font-weight: 600;
                                color: #fff;
                                padding: 0.4rem 1rem;
                                border-radius: 50px;
                                display: inline-block;
                            }
                            .status-item {
                                grid-column: 1 / -1;
                                justify-content: center;
                                border-color: ${statusColor};
                            }
                            .status-item i {
                                color: ${statusColor};
                                font-size: 2.2rem;
                            }
                        </style>
                        <div class="summary-grid">
                            <div class="summary-item status-item">
                                <i class="bi ${statusIcon}"></i>
                                <div>
                                    <span class="label">Estado del Contenedor</span>
                                    <span class="value-badge" style="background-color: ${statusColor};">${status}</span>
                                </div>
                            </div>
                            <div class="summary-item">
                                <i class="bi bi-tags-fill"></i>
                                <div>
                                    <span class="label">Total SKUs</span>
                                    <span class="value">${totalRecords.toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                            <div class="summary-item">
                                <i class="bi bi-box-seam"></i>
                                <div>
                                    <span class="label">Piezas Esperadas</span>
                                    <span class="value">${sapSum.toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                            <div class="summary-item">
                                <i class="bi bi-check-all"></i>
                                <div>
                                    <span class="label">Escaneado Correcto</span>
                                    <span class="value" style="color: #2ECC71;">${scannedCorrectlySum.toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                            <div class="summary-item">
                                <i class="bi bi-exclamation-triangle"></i>
                                <div>
                                    <span class="label">Piezas Faltantes</span>
                                    <span class="value" style="color: #E74C3C;">${missingSum.toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                             <div class="summary-item">
                                <i class="bi bi-plus-circle-dotted"></i>
                                <div>
                                    <span class="label">Piezas Excedentes</span>
                                    <span class="value" style="color: #F1C40F;">${excessSum.toLocaleString('es-MX')}</span>
                                </div>
                            </div>
                            <div class="summary-item full-width">
                                <i class="bi bi-people-fill"></i>
                                <div>
                                    <span class="label">Trabajado por</span>
                                    <span class="value" style="font-size: 1rem;">${Array.from(workers).join(", ") || "N/A"}</span>
                                </div>
                            </div>
                        </div>
                    `;
        }

        function getContainerStateFromRecords(records) {
            let totalMissing = 0,
                totalExtra = 0,
                completeCount = 0;
            let totalRecords = records.length;
            records.forEach(r => {
                let sap = Number(r.SAP) || 0;
                let sc = Number(r.SCANNER) || 0;
                if (sc >= sap) {
                    completeCount++;
                    if (sc > sap) totalExtra += (sc - sap);
                } else {
                    totalMissing += (sap - sc);
                }
            });
            if (totalMissing === 0 && totalExtra > 0) {
                return "COMPLETO CON MERCANCÍA DE MÁS";
            } else if (completeCount === totalRecords && totalExtra === 0) {
                return "COMPLETO";
            }
            return "INCOMPLETO";
        }

        // Úsala cuando solo quieras dd/mm/aaaa de un Date válido
        function formatFechaCorta(d) {
            if (!(d instanceof Date) || isNaN(d)) return '';
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yy = d.getFullYear();
            return `${dd}/${mm}/${yy}`;
        }

        // Única robusta para Date | string | número (Excel)
        function formatFecha(fecha) {
            if (fecha instanceof Date && !isNaN(fecha.getTime())) {
                return formatFechaCorta(fecha);
            }
            if (typeof fecha === "string") {
                const d = new Date(fecha);
                if (!isNaN(d.getTime())) return formatFechaCorta(d);
                return fecha;
            }
            if (typeof fecha === "number") {
                // Excel serial -> JS Date (UTC)
                const d = new Date(Math.round((fecha - 25569) * 86400 * 1000));
                if (!isNaN(d.getTime())) return formatFechaCorta(d);
            }
            return "";
        }


        async function reuploadFileWithScannerChanges(fileName) {
            let dataObj = excelDataGlobal[fileName];
            let arr = dataObj.data;
            let ws = XLSX.utils.json_to_sheet(arr);
            let wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
            let wbout = XLSX.write(wb, {
                bookType: "xlsx",
                type: "array"
            });
            let blob = new Blob([wbout], {
                type: "application/octet-stream"
            });

            // ***** INICIO DE LA CORRECCIÓN IMPORTANTE *****
            // Paso 1: Obtener la tienda original del manifiesto desde Firestore
            const manifestDocRef = db.collection('manifiestos').doc(fileName);
            const manifestDocSnap = await manifestDocRef.get();

            let originalManifestStore = '0042'; // Valor por defecto seguro

            if (manifestDocSnap.exists && manifestDocSnap.data().store) {
                originalManifestStore = manifestDocSnap.data().store;
            }

            // Paso 2: Usar la tienda original del manifiesto para la ruta de Storage
            let storageRef = storage.ref(`Manifiestos/${originalManifestStore}/${fileName}`);
            // ***** FIN DE LA CORRECCIÓN IMPORTANTE *****

            await storageRef.put(blob); // Sube el archivo a la carpeta correcta

            // También asegúrate de que el documento en Firestore se actualice con la tienda correcta
            // (la original), no con "ALL" si es un admin.
            await db.collection('manifiestos')
                .doc(fileName)
                .set({
                    fileName,
                    store: originalManifestStore, // <--- Importante: Guarda la tienda original del manifiesto aquí también
                    lastUser: dataObj.lastUser,
                    lastUserStore: (dataObj.lastUserStore !== undefined) ? dataObj.lastUserStore : null,
                    lastUserRole: (dataObj.lastUserRole !== undefined) ? dataObj.lastUserRole : null,
                    closedContainers: dataObj.closedContainers || {},
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, {
                    merge: true
                });
        }
    });
})();