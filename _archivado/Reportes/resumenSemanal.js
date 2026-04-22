// === FIREBASE CONFIGURATION ===
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

// === GLOBAL VARIABLES FOR SUMMARY ===
const ADMIN_UID = "8NfEfPSyusZdNUFgXWPtvi3p6Ns1";
let currentUser = null;
let currentUserStore = null;
let currentUserRole = null;
let excelDataGlobal = {}; // Cache for manifest data
const SUPER_ADMINS = ["wz4A81Vp8tQIjzVXMANmOHUlsNH2", "8NfEfPSyusZdNUFgXWPtvi3p6Ns1"];



// === STATE VARIABLES FOR DASHBOARD FILTERS AND CHARTS ===
let currentStatusFilterManifiestos = 'Todos';
let currentManifestIdSelected = null;
let currentJefaturaFilterManifiestosDetalle = 'Todos';
let currentContenedorFilterManifiestosDetalle = 'Todos';
let currentJefaturaFilterExcedentes = 'Todos';
let excedentesChartInstance = null;
let report = {}; // Object that will contain all aggregated report data
let seccionesMap = new Map(); // Map of sections to jefaturas, global for access
let jefaturasConDatosEnPeriodo = new Set(); // Set of jefaturas with activity in the period



// Helper to get object properties regardless of case
const getProp = (obj, key) => {
    if (!obj) return undefined;
    const lowerKey = String(key).toLowerCase();
    const objKey = Object.keys(obj).find(k => k.toLowerCase() === lowerKey);
    return objKey ? obj[objKey] : undefined;
};

// Formats a date to dd/mm/yyyy string
function formatFecha(d) {
    if (d instanceof Date && !isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yy = d.getFullYear();
        return `${dd}/${mm}/${yy}`;
    }
    if (typeof d === "string") {
        let dateObj = new Date(d);
        if (!isNaN(dateObj.getTime())) {
            let correctedDate = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000);
            return `${String(correctedDate.getDate()).padStart(2, "0")}/${String(correctedDate.getMonth() + 1).padStart(2, "0")}/${correctedDate.getFullYear()}`;
        }
        return d;
    }
    if (typeof d === "number") {
        let dateObj = new Date(Math.round((d - 25569) * 86400 * 1000));
        let correctedDate = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000);
        return `${String(correctedDate.getDate()).padStart(2, "0")}/${String(correctedDate.getMonth() + 1).padStart(2, "0")}/${correctedDate.getFullYear()}`;
    }
    return "";
}

// ✅ UNIQUE AND DEFINITIVE DATA ENGINE (CORRECTED VERSION)
async function reconstructManifestDataFromFirebase(manifestoId) {
    try {
        const manifestDoc = await db.collection('manifiestos').doc(manifestoId).get();
        if (!manifestDoc.exists) {
            console.warn(`[reconstruct] Document for ${manifestoId} does not exist in Firestore. Skipping.`);
            return null; // Returning null is crucial for other functions to handle it
        }

        const manifestData = manifestDoc.data();
        const { store: folder, fileName } = manifestData;
        if (!folder || !fileName) {
            console.warn(`[reconstruct] Manifest ${manifestoId} without store/file data. Skipping.`);
            return null;
        }

        const url = await storage.ref(`Manifiestos/${folder}/${fileName}`).getDownloadURL();
        const buffer = await (await fetch(url)).arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const baseData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const dataMap = new Map();
        baseData.forEach(row => {
            const sku = String(getProp(row, 'SKU') || '').toUpperCase();
            const container = String(getProp(row, 'CONTENEDOR') || '').trim().toUpperCase();
            if (!sku || !container) return;

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
            if (!skuUpper || !containerUpper) return;

            const key = `${skuUpper}|${containerUpper}`;
            let record = dataMap.get(key);

            if (scan.type === 'delete') {
                dataMap.delete(key);
                return;
            }

            if (!record && scan.type === 'add') {
                // --- SECTION INHERITANCE LOGIC FOR NEW ITEMS ---
                let determinedSection = String(scan.section || "ARTICULO NUEVO").trim().toUpperCase();
                const problematicSections = ["ARTICULO NUEVO", "N/A", "147"];

                let foundGoodSection = false;
                for (const existingRecord of dataMap.values()) {
                    if (String(getProp(existingRecord, 'CONTENEDOR') || '').trim().toUpperCase() === containerUpper) {
                        const existingSection = String(getProp(existingRecord, 'SECCION') || '').trim().toUpperCase();
                        if (existingSection && !problematicSections.includes(existingSection)) {
                            determinedSection = existingSection;
                            foundGoodSection = true;
                            break;
                        }
                    }
                }
                // If no reference section is found, it remains "ARTICULO NUEVO".
                // --- END OF INHERITANCE LOGIC ---

                const refBaseRow = baseData.length > 0 ? baseData[0] : {};
                record = {
                    'MANIFIESTO': getProp(refBaseRow, 'MANIFIESTO') || 'N/A',
                    'SKU': skuUpper,
                    'CONTENEDOR': containerUpper,
                    'DESCRIPCION': scan.description || "ARTÍCULO NUEVO (Añadido)",
                    'SECCION': determinedSection, // Assign the correct/inherited section
                    'SAP': 0,
                    'SCANNER': 0,
                    'DANIO_CANTIDAD': 0,
                    'DANIO_FOTO_URL': "",
                    'LAST_SCANNED_BY': "",
                    'ENTREGADO_A': "",
                    'FECHA_ESCANEO': null
                };
                dataMap.set(key, record);
            }

            if (record) {
                switch (scan.type) {
                    case 'add': record.SCANNER = (Number(record.SCANNER) || 0) + (Number(scan.quantity) || 1); break;
                    case 'subtract': record.SCANNER = (record.SCANNER || 0) - (Number(scan.quantity) || 1); break;
                    case 'damage':
                        record.DANIO_CANTIDAD = (record.DANIO_CANTIDAD || 0) + (Number(scan.quantity) || 1);
                        if (scan.photoURL) record.DANIO_FOTO_URL = scan.photoURL;
                        break;
                    case 'delete_photo': record.DANIO_FOTO_URL = ""; break;
                }

                record.LAST_SCANNED_BY = scan.user || "Desconocido";
                record.ENTREGADO_A = scan.employee || record.ENTREGADO_A || "";
                if (scan.scannedAt) record.FECHA_ESCANEO = scan.scannedAt.toDate();
            }
        });

        const finalData = Array.from(dataMap.values()).filter(r => (Number(r.SAP) || 0) > 0 || (Number(r.SCANNER) || 0) > 0);
        excelDataGlobal[manifestoId] = { data: finalData, ...manifestData };
        return { data: finalData, ...manifestData };

    } catch (error) {
        console.error(`Critical error reconstructing data for manifest ${manifestoId}:`, error);
        throw error;
    }
}

// Calculates statistics for the PRO dashboard
const calculateProStatistics = (data) => {
    let tSAP = 0;
    let tSCAN_for_expected = 0;
    let exc = 0;

    const faltantesPorSeccion = {};
    const excedentesPorSeccion = {};

    data.forEach(r => {
        const sap = Number(getProp(r, 'SAP')) || 0;
        const scan = Number(getProp(r, 'SCANNER')) || 0;
        const cont = String(getProp(r, 'CONTENEDOR') || 'SIN NOMBRE').toUpperCase().trim();
        const sec = String(getProp(r, 'SECCION') || 'Sin sección').toString().trim();

        tSAP += sap;

        const diferencia = scan - sap;

        // Count found items that were expected
        if (sap > 0) {
            tSCAN_for_expected += Math.min(scan, sap);
        }

        // Count missing items
        if (diferencia < 0) {
            const missing_amount = -diferencia;
            if (!faltantesPorSeccion[sec]) {
                faltantesPorSeccion[sec] = { total: 0, contenedores: {} };
            }
            faltantesPorSeccion[sec].total += missing_amount;
            faltantesPorSeccion[sec].contenedores[cont] = (faltantesPorSeccion[sec].contenedores[cont] || 0) + missing_amount;
        }

        // Count excess items
        if (diferencia > 0) {
            exc += diferencia;
            if (!excedentesPorSeccion[sec]) {
                excedentesPorSeccion[sec] = { total: 0, contenedores: {} };
            }
            excedentesPorSeccion[sec].total += diferencia;
            excedentesPorSeccion[sec].contenedores[cont] = (excedentesPorSeccion[sec].contenedores[cont] || 0) + diferencia;
        }
    });

    const falt = tSAP - tSCAN_for_expected;
    const av = tSAP > 0 ? Math.round((tSCAN_for_expected / tSAP) * 100) : 0;

    // Helper function to sort breakdowns
    const sortDetailedBreakdown = (obj) => {
        const sortedSections = Object.entries(obj).sort(([, a], [, b]) => b.total - a.total);
        sortedSections.forEach(([, sectionData]) => {
            sectionData.contenedores = Object.entries(sectionData.contenedores).sort(([, a], [, b]) => b - a);
        });
        return sortedSections;
    };

    return {
        totalSAP: tSAP,
        totalSCAN: tSCAN_for_expected + exc, // Actual total scanned
        piezasEsperadasEncontradas: tSCAN_for_expected,
        faltantes: falt,
        excedentes: exc,
        avance: av,
        totalSKUs: data.length,
        // --- CORRECTED Properties that PDF and Excel need ---
        faltantesDetallado: sortDetailedBreakdown(faltantesPorSeccion),
        excedentesDetallado: sortDetailedBreakdown(excedentesPorSeccion),
        // Properties for the Excel Dashboard (already correct)
        topContenedoresFaltantes: Object.entries(faltantesPorSeccion).flatMap(([sec, d]) => Object.entries(d.contenedores).map(([cont, qty]) => ([`${cont} (${sec})`, qty]))).sort(([, a], [, b]) => b - a).slice(0, 5),
        topSeccionesFaltantes: Object.entries(faltantesPorSeccion).map(([sec, d]) => ([sec, d.total])).sort(([, a], [, b]) => b - a).slice(0, 5),
        topContenedoresExcedentes: Object.entries(excedentesPorSeccion).flatMap(([sec, d]) => Object.entries(d.contenedores).map(([cont, qty]) => ([`${cont} (${sec})`, qty]))).sort(([, a], [, b]) => b - a).slice(0, 5),
        topSeccionesExcedentes: Object.entries(excedentesPorSeccion).map(([sec, d]) => ([sec, d.total])).sort(([, a], [, b]) => b - a).slice(0, 5),
    };
};

// Generates an Excel report for the selected manifest
window.downloadFile = async function (folder, name) {
    const manifestoId = name;
    if (!manifestoId) return Swal.fire('Error', 'No se ha seleccionado manifiesto.', 'error');

    try {
        // Simple test for xlsx-js-style. This might not be strictly necessary
        // if you are certain the library is loaded correctly, but it acts as a safeguard.
        const test_wb = XLSX.utils.book_new();
        const test_ws = XLSX.utils.aoa_to_sheet([["Test"]]);
        const cell = test_ws['A1'];
        cell.s = { fill: { fgColor: { rgb: "FF0000" } } };
    } catch (e) {
        console.error("Error verifying xlsx-js-style:", e);
        return Swal.fire(
            'Error de Configuración',
            'Parece que la librería "xlsx-js-style" no está cargada correctamente o en la versión adecuada. ' +
            'Asegúrate de que `xlsx.full.min.js` se cargue primero y luego `xlsx.bundle.js` de "xlsx-js-style".',
            'error'
        );
    }

    Swal.fire({
        title: 'Generando Reporte Profesional...',
        html: 'Creando dashboard y hojas de análisis. Por favor, espera.',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
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

            if (headerRowIndex === -1) throw new Error(`No se encontraron las columnas "Seccion" y "Jefatura" en Secciones.xlsx.`);

            for (let i = headerRowIndex + 1; i < data.length; i++) {
                const row = data[i];
                const seccion = String(row[seccionIndex] || '').trim().toUpperCase();
                const jefe = String(row[jefaturaIndex] || 'Sin Asignar').trim();
                if (seccion) seccionToJefeMap.set(seccion, jefe);
            }
        } catch (error) {
            throw new Error("Error al leer Secciones.xlsx: " + error.message);
        }

        const manifest = await reconstructManifestDataFromFirebase(manifestoId);

        const numericWithCommaFormatKeys = ['SAP', 'SCANNER', 'DIFERENCIA'];
        const numericNoCommaFormatKeys = ['MANIFIESTO', 'SKU', 'EUROPEO', 'ENTREGADO_A', 'DAÑO_CANTIDAD'];
        const textFormatKeys = ['CONTENEDOR', 'SECCION', 'JEFATURA', 'DESCRIPCION', 'LAST_SCANNED_BY', 'DANIO_FOTO_URL'];

        const augmentedData = manifest.data.map(row => {
            const newRow = {};

            const findValueByKey = (obj, keyName) => {
                const foundKey = Object.keys(obj).find(k => k.trim().toUpperCase() === keyName.toUpperCase());
                return foundKey ? obj[foundKey] : undefined;
            };

            for (const originalKey in row) {
                const upperKey = originalKey.trim().toUpperCase();
                let value = row[originalKey];

                if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ||
                    (upperKey === 'DAÑO_CANTIDAD' && (value === 0 || value === '0'))) {
                    newRow[originalKey] = null;
                    continue;
                }

                if (textFormatKeys.includes(upperKey)) {
                    newRow[originalKey] = String(value);
                    continue;
                }

                if (upperKey === 'FECHA_ESCANEO') {
                    if (value instanceof Date) {
                        newRow[originalKey] = formatFecha(value);
                    } else if (typeof value === 'string' && value.trim() !== '') {
                        const parsedDate = new Date(value);
                        if (!isNaN(parsedDate.getTime())) {
                            newRow[originalKey] = formatFecha(parsedDate);
                        } else {
                            newRow[originalKey] = String(value);
                        }
                    } else {
                        newRow[originalKey] = null;
                    }
                    continue;
                }

                if (typeof value === 'string') {
                    const cleanedValue = value.replace(/,/g, '');
                    const numValue = Number(cleanedValue);

                    if (isNaN(numValue)) {
                        newRow[originalKey] = String(value);
                    } else {
                        newRow[originalKey] = numValue;
                    }
                } else {
                    newRow[originalKey] = value;
                }
            }

            const seccionKey = Object.keys(newRow).find(k => k.trim().toUpperCase() === 'SECCION');
            const seccionValue = seccionKey ? newRow[seccionKey] : '';
            const seccion = String(seccionValue || '').trim().toUpperCase();
            const jefe = seccionToJefeMap.get(seccion) || 'Sin Jefe Asignado';
            newRow.JEFATURA = jefe;

            const sapValue = Number(findValueByKey(newRow, 'SAP') || 0);
            const scannerValue = Number(findValueByKey(newRow, 'SCANNER') || 0);
            newRow.DIFERENCIA = scannerValue - sapValue;

            return newRow;
        });

        augmentedData.sort((a, b) => {
            const jefaturaA = a.JEFATURA || '';
            const jefaturaB = b.JEFATURA || '';
            const skuA = String(a.SKU || '');
            const skuB = String(b.SKU || '');
            return jefaturaA.localeCompare(jefaturaB) || skuA.localeCompare(skuB);
        });

        const wb = XLSX.utils.book_new();
        const commonBorderStyle = { style: "thin", color: { rgb: "C0C0C0" } };

        const styles = {
            mainHeader: {
                font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
                fill: { fgColor: { rgb: "333333" } },
                alignment: { horizontal: "center", vertical: "center" },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            analysisHeader: {
                font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
                fill: { fgColor: { rgb: "0056b3" } },
                alignment: { horizontal: "center", vertical: "center" },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            dataRowEven: {
                fill: { fgColor: { rgb: "F0F0F0" } },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            dataRowOdd: {
                fill: { fgColor: { rgb: "FFFFFF" } },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            dashTitle: { font: { sz: 18, bold: true, color: { rgb: "E6007E" } } },
            dashSubtitle: { font: { sz: 11, italic: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "center" } },
            dashHeader: { font: { sz: 14, bold: true, color: { rgb: "000000" } } },
            metricLabel: { font: { bold: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "right" } },
            metricValue: { font: { sz: 12, bold: true }, alignment: { horizontal: "left" } },
            metricPositive: { font: { sz: 12, bold: true, color: { rgb: "28a745" } }, alignment: { horizontal: "left" } },
            metricNegative: { font: { sz: 12, bold: true, color: { rgb: "dc3545" } }, alignment: { horizontal: "left" } },

            diffOk: {
                font: { bold: true, color: { rgb: "28a745" } },
                fill: { fgColor: { rgb: "D4EDDA" } },
                alignment: { horizontal: "center", vertical: "center" },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            diffNegative: {
                font: { bold: true, color: { rgb: "DC3545" } },
                fill: { fgColor: { rgb: "F8D7DA" } },
                alignment: { horizontal: "center", vertical: "center" },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            diffPositive: {
                font: { bold: true, color: { rgb: "856404" } },
                fill: { fgColor: { rgb: "FFF3CD" } },
                alignment: { horizontal: "center", vertical: "center" },
                border: { top: commonBorderStyle, bottom: commonBorderStyle, left: commonBorderStyle, right: commonBorderStyle }
            },
            dashDate: { font: { sz: 11, italic: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "center" } }
        };

        const applyTableStyles = (ws, headerStyle, dataEvenStyle, dataOddStyle, numHeaderRows = 1) => {
            if (!ws['!ref']) return;

            const range = XLSX.utils.decode_range(ws['!ref']);
            const numCols = range.e.c - range.s.c + 1;

            for (let r = 0; r < numHeaderRows; r++) {
                for (let c = 0; c < numCols; c++) {
                    const cellRef = XLSX.utils.encode_cell({ c: c, r: r });
                    if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
                    ws[cellRef].s = headerStyle;
                }
            }

            for (let r = numHeaderRows; r <= range.e.r; r++) {
                for (let c = 0; c < numCols; c++) {
                    const cellRef = XLSX.utils.encode_cell({ c: c, r: r });
                    if (ws[cellRef] === undefined || ws[cellRef].v === null) {
                        continue;
                    }

                    const hasCustomDiffStyle = ws[cellRef].s && (ws[cellRef].s === styles.diffOk || ws[cellRef].s === styles.diffNegative || ws[cellRef].s === styles.diffPositive);

                    if (!ws[cellRef].s || (ws[cellRef].s !== headerStyle && !hasCustomDiffStyle)) {
                        ws[cellRef].s = (r % 2 === 0) ? dataEvenStyle : dataOddStyle;
                    } else if (!ws[cellRef].s && !hasCustomDiffStyle) {
                        ws[cellRef].s = (r % 2 === 0) ? dataEvenStyle : dataOddStyle;
                    }
                }
            }

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

            ws['!freeze'] = {
                xSplit: "0",
                ySplit: "1",
                topLeftCell: "A2",
                activePane: "bottomLeft",
                state: "frozen"
            };
        };

        const stats = calculateProStatistics(augmentedData);

        const uploadDateString = manifest.createdAt ? manifest.createdAt.toLocaleDateString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: true
        }) : 'Fecha no disponible';

        let dashboardData = [
            [{ v: "⭐️ Dashboard de Manifiesto", s: styles.dashTitle }],
            [{ v: `Archivo: ${manifestoId}`, s: styles.dashSubtitle }],
            [{ v: `Fecha de Carga: ${uploadDateString}`, s: styles.dashDate }],
            [],
            [{ v: "📊 MÉTRICAS GENERALES", s: styles.dashHeader }],
            [{ v: "📥 Total Piezas (SAP):", s: styles.metricLabel }, { v: stats.totalSAP, s: styles.metricValue, z: '#,##0' }],
            [{ v: "✅ Total Piezas Escaneadas:", s: styles.metricLabel }, { v: stats.totalSCAN, s: styles.metricValue, z: '#,##0' }],
            [{ v: "⚠️ Diferencia Total:", s: styles.metricLabel }, { v: stats.totalSCAN - stats.totalSAP, s: (stats.totalSCAN - stats.totalSAP < 0 ? styles.metricNegative : styles.metricPositive), z: '#,##0' }],
            [{ v: "🎯 Progreso General:", s: styles.metricLabel }, { v: stats.avance / 100, s: styles.metricPositive, z: '0.00%' }],
            [],
            [{ v: "🚨 PUNTOS CRÍTICOS (FALTANTES)", s: styles.dashHeader }],
            [{ v: "📦 Contenedores:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
            ...stats.topContenedoresFaltantes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricNegative, t: 'n', z: '#,##0' }]),
            [],
            [{ v: "📂 Secciones:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
            ...stats.topSeccionesFaltantes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricNegative, t: 'n', z: '#,##0' }]),
            [],
            [{ v: "📈 PUNTOS DE OPORTUNIDAD (EXCEDENTES)", s: styles.dashHeader }],
            [{ v: "📦 Contenedores:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
            ...stats.topContenedoresExcedentes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricPositive, t: 'n', z: '#,##0' }]),
            [],
            [{ v: "📂 Secciones:", s: styles.metricLabel }, { v: "Piezas", s: styles.metricLabel }],
            ...stats.topSeccionesExcedentes.map(item => [null, { v: `${item[0]}:`, s: { alignment: { horizontal: "right" } } }, { v: item[1], s: styles.metricPositive, t: 'n', z: '#,##0' }]),
        ];
        const wsDash = XLSX.utils.aoa_to_sheet(dashboardData);
        wsDash['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 15 }];
        const baseRowShift = 1;
        wsDash['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
            { s: { r: 3 + baseRowShift, c: 0 }, e: { r: 3 + baseRowShift, c: 2 } },
            { s: { r: 9 + baseRowShift, c: 0 }, e: { r: 9 + baseRowShift, c: 2 } },
            { s: { r: 9 + stats.topContenedoresFaltantes.length + 2 + baseRowShift, c: 0 }, e: { r: 9 + stats.topContenedoresFaltantes.length + 2 + baseRowShift, c: 2 } },
            { s: { r: 9 + stats.topContenedoresFaltantes.length + 2 + stats.topSeccionesFaltantes.length + 2 + baseRowShift, c: 0 }, e: { r: 9 + stats.topContenedoresFaltantes.length + 2 + stats.topSeccionesFaltantes.length + 2 + baseRowShift, c: 2 } }
        ];

        XLSX.utils.book_append_sheet(wb, wsDash, "Dashboard");

        const wsMain = XLSX.utils.json_to_sheet(augmentedData);
        if (augmentedData.length > 0) {
            const headers = Object.keys(augmentedData[0]);
            XLSX.utils.sheet_add_aoa(wsMain, [headers], { origin: "A1" });

            const headerKeysUpper = headers.map(key => key.toUpperCase());
            const diffColIndex = headerKeysUpper.indexOf('DIFERENCIA');

            for (let r = 1; r <= augmentedData.length; r++) {
                numericWithCommaFormatKeys.forEach(colName => {
                    if (colName === 'DIFERENCIA') return;
                    const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                    if (colIndex !== -1) {
                        const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                        if (wsMain[cellRef] && wsMain[cellRef].t === 'n') {
                            wsMain[cellRef].z = '#,##0';
                        }
                    }
                });

                numericNoCommaFormatKeys.forEach(colName => {
                    const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                    if (colIndex !== -1) {
                        const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                        if (wsMain[cellRef] && wsMain[cellRef].t === 'n') {
                            wsMain[cellRef].z = '0';
                        }
                    }
                });

                textFormatKeys.forEach(colName => {
                    const colIndex = headerKeysUpper.indexOf(colName.toUpperCase());
                    if (colIndex !== -1) {
                        const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                        if (wsMain[cellRef]) {
                            wsMain[cellRef].t = 's';
                            delete wsMain[cellRef].z;
                        }
                    }
                });

                if (diffColIndex !== -1) {
                    const cellRef = XLSX.utils.encode_cell({ c: diffColIndex, r: r });
                    const cell = wsMain[cellRef];

                    if (cell && cell.t === 'n') {
                        const diffValue = cell.v;
                        if (diffValue === 0) {
                            cell.s = styles.diffOk;
                            cell.v = "OK";
                            cell.t = 's';
                            delete cell.z;
                        } else if (diffValue < 0) {
                            cell.s = styles.diffNegative;
                            cell.v = `FALTANTE: ${Math.abs(diffValue)}`;
                            cell.t = 's';
                            delete cell.z;
                        } else {
                            cell.s = styles.diffPositive;
                            cell.v = `EXCEDENTE: ${diffValue}`;
                            cell.t = 's';
                            delete cell.z;
                        }
                    } else if (cell && (cell.v === null || cell.v === undefined || cell.v === '')) {
                        continue;
                    }
                }
            }

            applyTableStyles(wsMain, styles.mainHeader, styles.dataRowEven, styles.dataRowOdd);
            wsMain['!autofilter'] = { ref: wsMain['!ref'] };
        }
        XLSX.utils.book_append_sheet(wb, wsMain, "Reporte por Jefatura");

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

        const wsContData = Object.entries(containerAnalysis).map(([key, val]) => ({ "Contenedor": key, "Jefatura(s)": [...val.Jefes].join(', '), "Piezas SAP": val.SAP, "Piezas Escaneadas": val.SCANNER, "Diferencia": val.SCANNER - val.SAP }));
        const wsCont = XLSX.utils.json_to_sheet(wsContData, { header: analysisHeadersCont });
        const numColsCont = analysisHeadersCont.length;
        for (let r = 1; r <= wsContData.length; r++) {
            const numericColsWithCommas_analysis = [2, 3, 4];
            numericColsWithCommas_analysis.forEach(colIndex => {
                if (numColsCont > colIndex) {
                    const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: r });
                    if (wsCont[cellRef] && wsCont[cellRef].t === 'n') {
                        wsCont[cellRef].z = '#,##0';
                    }
                }
            });
            const contColIndex = analysisHeadersCont.indexOf('Contenedor');
            if (contColIndex !== -1) {
                const cellRef = XLSX.utils.encode_cell({ c: contColIndex, r: r });
                if (wsCont[cellRef]) {
                    wsCont[cellRef].t = 's';
                    delete wsCont[cellRef].z;
                }
            }
        }
        applyTableStyles(wsCont, styles.analysisHeader, styles.dataRowEven, styles.dataRowOdd);
        wsCont['!autofilter'] = { ref: wsCont['!ref'] };
        XLSX.utils.book_append_sheet(wb, wsCont, "Análisis por Cont.");

        const wsSectData = Object.entries(sectionAnalysis).map(([key, val]) => ({ "Sección": key, "Jefatura": seccionToJefeMap.get(key.toUpperCase()) || "Sin Jefe Asignado", "Piezas SAP": val.SAP, "Piezas Escaneadas": val.SCANNER, "Diferencia": val.SCANNER - val.SAP }));
        const wsSect = XLSX.utils.json_to_sheet(wsSectData, { header: analysisHeadersSect });
        const numColsSect = analysisHeadersSect.length;
        for (let r = 1; r <= wsSectData.length; r++) {
            const numericColsWithCommas_analysis = [2, 3, 4];
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

        XLSX.writeFile(wb, `Reporte_Completo_${manifestoId}.xlsx`);
        Swal.close();

    } catch (error) {
        console.error("Error al generar reporte:", error);
        Swal.fire('Error Inesperado', error.message, 'error');
    }
};

// ==============================================================================
// === DASHBOARD TAB RENDERING FUNCTIONS ===
// ==============================================================================

const renderJefaturaFilter = () => {
    const container = document.getElementById('seccion-jefatura-filter');
    if (!container) return;

    let filtersHTML = '<button class="filter-btn active" data-jefe="Todos">Todos</button>';
    // `jefaturasConDatosEnPeriodo` is a global variable filled in `generateWeeklySummary`.
    filtersHTML += Array.from(jefaturasConDatosEnPeriodo).sort().map(jefe => `<button class="filter-btn" data-jefe="${jefe}">${String(jefe || 'N/A').trim()}</button>`).join('');
    container.innerHTML = filtersHTML;

    container.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            container.querySelector('.active')?.classList.remove('active');
            e.currentTarget.classList.add('active');
            renderSecciones(e.currentTarget.dataset.jefe);
        });
    });
};
const renderJefaturas = () => {
    const grid = document.getElementById('jefaturas-grid');
    const chartContainer = document.getElementById('jefaturas-comparativa-container');

    if (!grid || !chartContainer) return;

    const jefesOrdenados = Object.entries(report.jefaturas)
        .filter(([_, data]) => data.sap > 0 || data.scan > 0)
        .sort((a, b) => {
            const avanceA = a[1].sap > 0 ? (a[1].piezasEncontradas / a[1].sap) * 100 : 100;
            const avanceB = b[1].sap > 0 ? (b[1].piezasEncontradas / b[1].sap) * 100 : 100;
            return avanceB - avanceA;
        });

    const renderJefaturasComparativaChart = (jefes) => {
        chartContainer.innerHTML = '<canvas id="jefaturasComparativaChart"></canvas>';
        const ctx = document.getElementById('jefaturasComparativaChart').getContext('2d');

        const labels = jefes.map(([nombre, _]) => nombre);
        const dataPoints = jefes.map(([_, data]) => data.sap > 0 ? (data.piezasEncontradas / data.sap) * 100 : 100);

        const backgroundColors = dataPoints.map(avance => {
            if (avance < 50) return 'rgba(227, 0, 0, 0.7)';
            if (avance < 75) return 'rgba(245, 130, 32, 0.7)';
            if (avance < 100) return 'rgba(254, 225, 1, 0.7)';
            return 'rgba(149, 193, 31, 0.7)';
        });

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avance de Escaneo',
                    data: dataPoints,
                    backgroundColor: backgroundColors,
                    borderColor: backgroundColors.map(color => color.replace('0.7', '1')),
                    borderWidth: 1,
                    borderRadius: 5,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function (value) {
                                return value + "%"
                            }
                        }
                    },
                    y: {
                        ticks: {
                            autoSkip: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `Avance: ${context.raw.toFixed(2)}%`;
                            }
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'end',
                        formatter: (value) => value.toFixed(1) + '%',
                        color: '#414141',
                        font: {
                            weight: 'bold'
                        }
                    }
                }
            },
            plugins: [ChartDataLabels],
        });
    };

    if (jefesOrdenados.length === 0) {
        chartContainer.innerHTML = '';
        grid.innerHTML = '<p class="text-center text-muted col-12 mt-5">No se encontraron datos de jefaturas con actividad en este periodo.</p>';
        return;
    }

    renderJefaturasComparativaChart(jefesOrdenados);

    grid.innerHTML = jefesOrdenados.map(([nombreJefe, data]) => {
        const chartId = `chart-jefe-${String(nombreJefe || '').replace(/[^a-zA-Z0-9]/g, '')}`;
        const avanceTotalJefatura = data.sap > 0 ? (data.piezasEncontradas / data.sap) * 100 : 100;

        const seccionesHTML = data.secciones.sort((a, b) => b.avance - a.avance).map(s => {
            const avance = s.avance;
            const avanceRedondeado = Math.round(avance);

            const isCompleted = s.faltantes === 0 && s.sap > 0;
            const colorAvance = isCompleted ? 'var(--liverpool-green)' : (avanceRedondeado < 50 ? '#E30000' : (avanceRedondeado < 75 ? '#F58220' : '#FEE101'));
            const progressColorClass = isCompleted ? 'progress-green' : (avanceRedondeado < 50 ? 'progress-red' : (avanceRedondeado < 75 ? 'progress-orange' : 'progress-yellow'));

            const showButton = s.faltantes > 0;

            const porcentajeTexto = isCompleted ? '100%' : `${Math.floor(avance)}%`;

            const sanitizedJefe = String(nombreJefe || 'N/A').trim();
            const sanitizedSeccion = String(s.nombre || 'N/A').trim();
            const sanitizedDescripcion = String(s.descripcion || s.nombre).trim();

            const detailButtonHTML = showButton ? `
        <button 
            class="btn-view-details" 
            onclick="mostrarDetalleFaltantes('${sanitizedJefe}', '${sanitizedSeccion}')" 
            title="Ver detalle de faltantes para la sección ${sanitizedSeccion}">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
            </svg>
        </button>
    ` : `<div class="btn-placeholder"></div>`;

            return `
        <li class="jefatura-secciones-list-item">
            <div class="section-content-wrapper">
                <div class="section-details">
                    <span class="section-name" title="${sanitizedDescripcion}">${sanitizedSeccion}</span>
                    <span class="section-stats">${s.piezasEncontradas.toLocaleString('es-MX')} / ${s.sap.toLocaleString('es-MX')} pzs</span>
                </div>
                <div class="section-progress-container">
                    <div class="custom-progress-bar">
                        <div class="custom-progress-fill ${progressColorClass}" style="width: ${avance.toFixed(0)}%;"></div>
                    </div>
                    <span class="progress-text" style="color: ${colorAvance};">${porcentajeTexto}</span>
                </div>
            </div>
            ${detailButtonHTML}
        </li>
    `;
        }).join('');

        const avanceRedondeadoTotal = Math.round(avanceTotalJefatura);
        const isJefaturaCompleted = data.faltantes === 0 && data.sap > 0;
        const colorAvance = isJefaturaCompleted ? 'var(--liverpool-green)' : (avanceRedondeadoTotal < 50 ? '#E30000' : (avanceRedondeadoTotal < 75 ? '#F58220' : '#FEE101'));

        const totalPiezasJefatura = (data.piezasEncontradas || 0) + (data.excedentes || 0);
        const kpiColorClassFaltantes = data.faltantes > 0 ? 'text-danger' : 'text-success';
        const kpiColorClassExcedentes = data.excedentes > 0 ? 'text-warning' : 'text-muted';

        const numManifestos = data.manifiestosConSecciones?.size || 0;
        const numSecciones = data.secciones?.length || 0;

        return `
            <div class="jefatura-card" style="--progress-color: ${colorAvance};">
            <div class="jefatura-header">
                <div class="jefatura-chart-container">
                <canvas id="${chartId}"></canvas>
                </div>
                <div class="jefatura-title">
                <h5>${String(nombreJefe || 'N/A').trim()}</h5>
                <div class="stats-summary">
                    <span><i class="bi bi-journal-text me-1"></i> ${numManifestos} Manifiesto(s)</span>
                    <span class="ms-3"><i class="bi bi-diagram-3-fill me-1"></i> ${numSecciones} Sección(es)</span>
                </div>
                </div>
            </div>

            <div class="jefatura-kpi-list">
                <div class="kpi-item">
                <span class="kpi-label"><i class="bi bi-box-seam me-2"></i>Piezas SAP</span>
                <span class="kpi-value">${(data.sap || 0).toLocaleString('es-MX')}</span>
                </div>
                <div class="kpi-item">
                <span class="kpi-label"><i class="bi bi-exclamation-triangle-fill me-2 text-danger"></i>Faltantes</span>
                <span class="kpi-value ${kpiColorClassFaltantes}">${(data.faltantes || 0).toLocaleString('es-MX')}</span>
                </div>
                <div class="kpi-item">
                <span class="kpi-label"><i class="bi bi-plus-circle-dotted me-2 text-warning"></i>Excedentes</span>
                <span class="kpi-value ${kpiColorClassExcedentes}">${(data.excedentes || 0).toLocaleString('es-MX')}</span>
                </div>
            </div>

            <details class="jefatura-details-wrapper">
                <summary class="jefatura-summary">
                <span>Ver Desglose de Secciones</span>
                <i class="bi bi-chevron-down"></i>
                </summary>
                <ul class="jefatura-secciones-list mt-2">${seccionesHTML}</ul>
            </details>
            </div>`;
    }).join('');

    setTimeout(() => {
        jefesOrdenados.forEach(([nombreJefe, data]) => {
            const doughnutCtx = document.getElementById(`chart-jefe-${String(nombreJefe || '').replace(/[^a-zA-Z0-9]/g, '')}`)?.getContext('2d');
            if (doughnutCtx) {
                const avance = data.sap > 0 ? (data.piezasEncontradas / data.sap) * 100 : 100;
                const avanceRedondeado = Math.round(avance);
                const isCompleted = data.faltantes === 0 && data.sap > 0;
                const colorAvance = isCompleted ? 'var(--liverpool-green)' : (avanceRedondeado < 50 ? '#E30000' : (avanceRedondeado < 75 ? '#F58220' : '#FEE101'));
                new Chart(doughnutCtx, {
                    type: 'doughnut',
                    data: {
                        datasets: [{
                            data: [avance, 100 - avance],
                            backgroundColor: [colorAvance, '#f1f3f5'],
                            borderWidth: 0,
                            cutout: '75%'
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: false }
                        }
                    },
                    plugins: [{
                        id: `gaugeText-jefe-${nombreJefe}`,
                        beforeDraw: chart => {
                            const { ctx, width, height } = chart;
                            ctx.restore();
                            ctx.font = `700 ${(height / 4).toFixed(0)}px Poppins`;
                            ctx.fillStyle = colorAvance;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(isCompleted ? '100%' : `${Math.floor(avance)}%`, width / 2, height / 2);
                            ctx.save();
                        }
                    }]
                });
            }
        });
    }, 100);
};
const renderSecciones = (filtroJefe = 'Todos') => {
    const grid = document.getElementById('secciones-grid-container');
    if (!grid) return;

    const seccionesFiltradas = Object.entries(report.secciones)
        .filter(([_, data]) => (filtroJefe === 'Todos' || data.jefatura === filtroJefe) && (data.sap > 0 || data.scan > 0));

    if (seccionesFiltradas.length === 0) {
        grid.innerHTML = '<div class="col-12"><p class="text-center text-muted mt-4">No hay secciones que coincidan con el filtro o con actividad en este periodo.</p></div>';
        return;
    }

    grid.innerHTML = seccionesFiltradas.sort((a, b) => b[1].sap - a[1].sap).map(([nombre, data]) => {
        const avance = data.sap > 0 ? (data.scan / data.sap * 100) : 100;
        const progressColorClass = avance < 50 ? 'progress-red' : (avance < 75 ? 'progress-orange' : (avance < 100 ? 'progress-yellow' : 'progress-green'));
        return `<div class="col">
            <div class="section-card-compact">
                <div class="section-name" title="${String(data.descripcion || 'Sin Descripción').trim()}">${String(nombre || 'N/A').trim()}</div>
                <div class="section-jefe">${String(data.jefatura || 'N/A').trim()}</div>
                <div class="custom-progress">
                    <div class="custom-progress-bar ${progressColorClass}" style="width: ${avance}%;">${avance.toFixed(0)}%</div>
                </div>
                <div class="section-counts">${(data.scan || 0).toLocaleString('es-MX')} / ${(data.sap || 0).toLocaleString('es-MX')} pzs</div>
            </div>
        </div>`;
    }).join('');
};

const renderManifiestosList = () => {
    const listContainer = document.getElementById('manifiestos-list-container');
    if (!listContainer) return;

    const statusFilterContainer = document.getElementById('manifiestos-status-filter');
    if (statusFilterContainer) {
        statusFilterContainer.querySelectorAll('.filter-btn').forEach(button => {
            const newListener = (e) => {
                statusFilterContainer.querySelector('.active')?.classList.remove('active');
                e.currentTarget.classList.add('active');
                currentStatusFilterManifiestos = e.currentTarget.dataset.statusFilter;
                renderManifiestosList();
            };
            button.removeEventListener('click', button._eventListener || (() => { }));
            button.addEventListener('click', newListener);
            button._eventListener = newListener;
        });
    }

    let filteredManifests = Object.values(report.manifiestos);

    if (currentStatusFilterManifiestos !== 'Todos') {
        filteredManifests = filteredManifests.filter(man => {
            const totalSapMan = Object.values(man.seccionesResumen).reduce((sum, s) => sum + (s.totalSap || 0), 0);
            const totalScanMan = Object.values(man.seccionesResumen).reduce((sum, s) => sum + (s.totalScan || 0), 0);
            const avanceMan = totalSapMan > 0 ? (totalScanMan / totalSapMan) * 100 : 100;

            if (totalSapMan === 0 && totalScanMan === 0) return false;

            switch (currentStatusFilterManifiestos) {
                case 'Completado': return avanceMan === 100;
                case 'Diferencias': return avanceMan > 0 && avanceMan < 100;
                case 'Sin Escanear': return avanceMan === 0 && totalSapMan > 0;
                default: return true;
            }
        });
    }

    const sortedManifests = filteredManifests.sort((a, b) => {
        const numA = parseInt(String(a.numero || '0').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b.numero || '0').replace(/\D/g, ''), 10) || 0;
        if (numA !== numB) return numA - numB;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    if (sortedManifests.length === 0) {
        listContainer.innerHTML = '<li class="list-group-item text-center text-muted py-3">No hay manifiestos que coincidan con los filtros aplicados.</li>';
        document.getElementById('manifest-detail-view').innerHTML = '<p class="text-muted text-center mt-4">Selecciona un manifiesto de la lista para ver su detalle.</p>';
        return;
    }

    listContainer.innerHTML = sortedManifests.map((m) => {
        const totalSapMan = Object.values(m.seccionesResumen).reduce((sum, s) => sum + (s.totalSap || 0), 0);
        const totalScanMan = Object.values(m.seccionesResumen).reduce((sum, s) => sum + (s.totalScan || 0), 0);
        const avanceMan = totalSapMan > 0 ? (totalScanMan / totalSapMan) * 100 : 100;

        let statusClass = '';
        if (totalSapMan === 0 && totalScanMan === 0) {
            statusClass = '';
        } else if (avanceMan === 100) {
            statusClass = 'manifest-status-completed';
        } else if (avanceMan > 0 && avanceMan < 100) {
            statusClass = 'manifest-status-diff';
        } else if (avanceMan === 0 && totalSapMan > 0) {
            statusClass = 'manifest-status-zero';
        }

        return `
            <li class="list-group-item d-flex justify-content-between align-items-center manifiesto-list-item ${currentManifestIdSelected === m.id ? 'active' : ''} ${statusClass}" data-manifest-id="${String(m.id || 'N/A').trim()}">
                <i class="bi bi-file-earmark-text me-2" style="color:var(--liverpool-pink);"></i>
                <div>
                    <strong>${String(m.numero || 'N/A').trim()}</strong> <br>
                    <span class="text-muted small">${String(m.id || 'N/A').substring(0, 8)}...</span> </div>
                <span class="badge bg-secondary ms-2">${(m.contenedores || []).length} Cont.</span>
            </li>
        `;
    }).join('');

    listContainer.querySelectorAll('.manifiesto-list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            listContainer.querySelectorAll('.manifiesto-list-item').forEach(li => li.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentManifestIdSelected = e.currentTarget.dataset.manifestId;
            currentJefaturaFilterManifiestosDetalle = 'Todos';
            currentContenedorFilterManifiestosDetalle = 'Todos';
            renderManifestDetail(currentManifestIdSelected);
        });
    });

    if (!currentManifestIdSelected || !filteredManifests.some(m => m.id === currentManifestIdSelected)) {
        if (sortedManifests.length > 0) {
            currentManifestIdSelected = sortedManifests[0].id;
            listContainer.querySelector(`[data-manifest-id="${currentManifestIdSelected}"]`)?.classList.add('active');
            renderManifestDetail(currentManifestIdSelected);
        } else {
            document.getElementById('manifest-detail-view').innerHTML = '<p class="text-muted text-center mt-4">Selecciona un manifiesto de la lista para ver su detalle.</p>';
        }
    } else {
        renderManifestDetail(currentManifestIdSelected);
    }
};

const renderManifestDetail = (manifestId) => {
    const detailContainer = document.getElementById('manifest-detail-view');
    if (!detailContainer) return;

    const manifest = report.manifiestos[manifestId];
    if (!manifest) {
        detailContainer.innerHTML = '<p class="text-muted text-center mt-4">Manifiesto no encontrado o no se pudo procesar.</p>';
        return;
    }

    const manifestTotalSAP = Object.values(manifest.seccionesResumen).reduce((sum, s) => sum + (s.totalSap || 0), 0);
    const manifestTotalSCAN = Object.values(manifest.seccionesResumen).reduce((sum, s) => sum + (s.totalScan || 0), 0);
    const manifestAvanceOverall = manifestTotalSAP > 0 ? (manifestTotalSCAN / manifestTotalSAP) * 100 : 100;
    const colorManifestAvance = manifestAvanceOverall < 50 ? '#E30000' : (manifestAvanceOverall < 75 ? '#F58220' : (manifestAvanceOverall < 100 ? '#FEE101' : 'var(--liverpool-green)'));

    const jefaturasEnEsteManifiesto = new Set();
    for (const seccionKey in manifest.seccionesResumen) {
        const seccionData = manifest.seccionesResumen[seccionKey];
        if (seccionData.totalSap > 0 || seccionData.totalScan > 0 ||
            Object.values(seccionData.byContenedor || {}).some(c => c.faltantes > 0 || c.excedentes > 0)) {
            jefaturasEnEsteManifiesto.add(seccionData.jefatura);
        }
    }
    const sortedJefaturasManifiesto = Array.from(jefaturasEnEsteManifiesto).sort();

    const jefaturaFilterHTML = sortedJefaturasManifiesto.map(jefe =>
        `<button class="filter-btn ${currentJefaturaFilterManifiestosDetalle === jefe ? 'active' : ''}" data-jefe-detail="${jefe}">${String(jefe || 'N/A').trim()}</button>`
    ).join('');

    detailContainer.innerHTML = `
<div class="row g-4 mb-4">
    <div class="col-md-4">
        <div class="stat-card-main h-100 d-flex flex-column justify-content-center">
            <i class="bi bi-tag-fill icon" style="color: var(--liverpool-dark);"></i>
            <div class="value">${String(manifest.numero || 'N/A').trim()}</div>
            <div class="label">Manifiesto</div>
        </div>
    </div>
    <div class="col-md-4">
        <div class="stat-card-main h-100 d-flex flex-column justify-content-center">
            <i class="bi bi-box-seam icon" style="color: var(--liverpool-dark);"></i>
            <div class="value">${manifestTotalSAP.toLocaleString('es-MX')}</div>
            <div class="label">Pzs. SAP Manifiesto</div>
        </div>
    </div>
    <div class="col-md-4">
        <div class="stat-card-main h-100 d-flex flex-column justify-content-center">
            <i class="bi bi-check-circle-fill icon" style="color: var(--liverpool-green);"></i>
            <div class="value">${manifestTotalSCAN.toLocaleString('es-MX')}</div>
            <div class="label">Pzs. Escaneadas Manifiesto</div>
        </div>
    </div>
                                <div class="col-12 d-flex justify-content-center align-items-center">
                                    <div style="width: 150px; height: 150px; position: relative;">
                                        <canvas id="manifestOverallGauge"></canvas>
                                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                                            <span style="font-size: 1.2rem; font-weight: 700; color: ${colorManifestAvance};">${manifestAvanceOverall.toFixed(0)}%</span><br>
                                            <span style="font-size: 0.8rem; color: #6c757d;">Avance Total</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <h5 class="mt-4 mb-3" style="color: var(--liverpool-dark); border-bottom: 1px solid var(--liverpool-border-gray); padding-bottom: 0.5rem;"><i class="bi bi-filter-circle me-2"></i>Filtrar Desglose</h5>
                            <div class="filter-pills mb-3 d-flex flex-wrap gap-2">
                                <h6 class="card-title text-muted me-2 mt-1">Jefatura:</h6>
                                <button class="filter-btn ${currentJefaturaFilterManifiestosDetalle === 'Todos' ? 'active' : ''}" data-jefe-detail="Todos">Todos</button>
                                ${jefaturaFilterHTML}
                            </div>
                            <div id="contenedor-filter-per-manifest" class="filter-pills mb-4 d-flex flex-wrap gap-2">
                                <h6 class="card-title text-muted me-2 mt-1">Contenedor:</h6>
                                <button class="filter-btn active" data-contenedor-detail="Todos">Todos</button>
                                </div>

                            <h5 class="mt-4 mb-3" style="color: var(--liverpool-dark); border-bottom: 1px solid var(--liverpool-border-gray); padding-bottom: 0.5rem;"><i class="bi bi-bar-chart-fill me-2"></i>Desglose por Sección</h5>
                            <div id="secciones-detail-grid" class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
                                </div>
                    `;

    const manifestGaugeCtx = document.getElementById('manifestOverallGauge')?.getContext('2d');
    if (manifestGaugeCtx) {
        new Chart(manifestGaugeCtx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [manifestAvanceOverall, 100 - manifestAvanceOverall],
                    backgroundColor: [colorManifestAvance, '#e9ecef'],
                    borderWidth: 0,
                    cutout: '75%'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    title: {
                        display: false,
                        text: 'Avance de Escaneo del Manifiesto',
                        color: 'var(--liverpool-dark)',
                        font: { size: 14, weight: 'bold' },
                        position: 'bottom'
                    }
                }
            }
        });
    }

    detailContainer.querySelectorAll('.filter-pills button[data-jefe-detail]').forEach(button => {
        button.addEventListener('click', (e) => {
            detailContainer.querySelectorAll('.filter-pills button[data-jefe-detail]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentJefaturaFilterManifiestosDetalle = e.currentTarget.dataset.jefeDetail;
            currentContenedorFilterManifiestosDetalle = 'Todos';
            renderSeccionesInManifestDetail(manifestId);
        });
    });

    renderSeccionesInManifestDetail(manifestId);
};
const renderSeccionesInManifestDetail = (manifestId) => {
    const manifest = report.manifiestos[manifestId];
    if (!manifest) return;

    const seccionesGrid = document.getElementById('secciones-detail-grid');
    const contenedorFilterContainer = document.getElementById('contenedor-filter-per-manifest');
    if (!seccionesGrid || !contenedorFilterContainer) return;

    const filteredSectionsByJefatura = Object.entries(manifest.seccionesResumen).filter(([seccionNombre, data]) => {
        const isRelevantToJefatura = (currentJefaturaFilterManifiestosDetalle === 'Todos' || data.jefatura === currentJefaturaFilterManifiestosDetalle);
        const hasAnyRelevantData = (data.totalSap > 0 || data.totalScan > 0 || Object.values(data.byContenedor || {}).some(c => c.faltantes > 0 || c.excedentes > 0));
        return isRelevantToJefatura && hasAnyRelevantData;
    });

    const contenedoresRelevantes = new Set();
    filteredSectionsByJefatura.forEach(([seccionNombre, data]) => {
        if (data.byContenedor && Object.keys(data.byContenedor).length > 0) {
            for (const cont in data.byContenedor) {
                if (data.byContenedor[cont].sap > 0 || data.byContenedor[cont].scan > 0 || data.byContenedor[cont].faltantes > 0 || data.byContenedor[cont].excedentes > 0) {
                    contenedoresRelevantes.add(cont);
                }
            }
        } else {
            contenedoresRelevantes.add('N/A (Sin Cont.)');
        }
    });
    const sortedContenedoresRelevantes = Array.from(contenedoresRelevantes).sort();

    let contenedorButtonsHTML = `<button class="filter-btn ${currentContenedorFilterManifiestosDetalle === 'Todos' ? 'active' : ''}" data-contenedor-detail="Todos">Todos</button>`;
    contenedorButtonsHTML += sortedContenedoresRelevantes.map(cont =>
        `<button class="filter-btn ${currentContenedorFilterManifiestosDetalle === cont ? 'active' : ''}" data-contenedor-detail="${String(cont || 'N/A').trim()}">${String(cont || 'N/A').trim()}</button>`
    ).join('');
    const existingContenedorH6 = contenedorFilterContainer.querySelector('h6');
    contenedorFilterContainer.innerHTML = '';
    if (existingContenedorH6) contenedorFilterContainer.appendChild(existingContenedorH6);
    contenedorFilterContainer.insertAdjacentHTML('beforeend', contenedorButtonsHTML);

    contenedorFilterContainer.querySelectorAll('button[data-contenedor-detail]').forEach(button => {
        const clonedButton = button.cloneNode(true);
        button.parentNode.replaceChild(clonedButton, button);
        clonedButton.addEventListener('click', (e) => {
            contenedorFilterContainer.querySelectorAll('button[data-contenedor-detail]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentContenedorFilterManifiestosDetalle = e.currentTarget.dataset.contenedorDetail;
            renderSeccionesInManifestDetail(manifestId);
        });
    });

    const sortedSectionsToDisplay = filteredSectionsByJefatura.filter(([seccionNombre, data]) => {
        const containerData = data.byContenedor?.[currentContenedorFilterManifiestosDetalle];

        if (currentContenedorFilterManifiestosDetalle === 'Todos') {
            return (data.totalSap > 0 || data.totalScan > 0 || Object.values(data.byContenedor || {}).some(c => c.faltantes > 0 || c.excedentes > 0));
        } else if (currentContenedorFilterManifiestosDetalle === 'N/A (Sin Cont.)') {
            return (!data.byContenedor || Object.keys(data.byContenedor).length === 0) && (data.totalSap > 0 || data.totalScan > 0 || Object.values(data.byContenedor || {}).some(c => c.faltantes > 0 || c.excedentes > 0));
        } else {
            return (containerData && (containerData.sap > 0 || containerData.scan > 0 || containerData.faltantes > 0 || containerData.excedentes > 0));
        }
    }).sort((a, b) => {
        const sapA = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (a[1].totalSap || 0) : (a[1].byContenedor[currentContenedorFilterManifiestosDetalle]?.sap || 0));
        const scanA = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (a[1].totalScan || 0) : (a[1].byContenedor[currentContenedorFilterManifiestosDetalle]?.scan || 0));
        const avanceA = sapA > 0 ? (scanA / sapA) : 1;

        const sapB = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (b[1].totalSap || 0) : (b[1].byContenedor[currentContenedorFilterManifiestosDetalle]?.sap || 0));
        const scanB = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (b[1].totalScan || 0) : (b[1].byContenedor[currentContenedorFilterManifiestosDetalle]?.scan || 0));
        const avanceB = sapB > 0 ? (scanB / sapB) : 1;

        return avanceB - avanceA;
    });

    if (sortedSectionsToDisplay.length > 0) {
        seccionesGrid.innerHTML = sortedSectionsToDisplay.map(([seccionNombre, data]) => {
            const seccionInfo = seccionesMap.get(seccionNombre.toUpperCase()) || {
                jefatura: 'Sin Asignar',
                descripcion: 'Descripción no encontrada',
                asistente: 'N/A'
            };
            const currentSap = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (data.totalSap || 0) : (data.byContenedor[currentContenedorFilterManifiestosDetalle]?.sap || 0));
            const currentScan = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (data.totalScan || 0) : (data.byContenedor[currentContenedorFilterManifiestosDetalle]?.scan || 0));
            const currentFaltantes = (currentSap - currentScan) > 0 ? (currentSap - currentScan) : 0;
            const currentExcedentes = (currentScan - currentSap) > 0 ? (currentScan - currentSap) : 0;

            const avanceSeccion = currentSap > 0 ? (currentScan / currentSap) * 100 : 100;
            const colorAvanceSeccion = avanceSeccion < 50 ? '#E30000' : (avanceSeccion < 75 ? '#F58220' : (avanceSeccion < 100 ? '#FEE101' : 'var(--liverpool-green)'));
            const chartId = `chart-manifest-${String(manifest.id || '').replace(/[^a-zA-Z0-9]/g, '')}-seccion-${String(seccionNombre || '').replace(/[^a-zA-Z0-9]/g, '')}-${String(currentContenedorFilterManifiestosDetalle || '').replace(/[^a-zA-Z0-9]/g, '')}`;

            return `
                <div class="col-md-6 col-lg-4">
                    <div class="section-card-compact">
                        <div class="section-name" title="${String(seccionInfo.descripcion || 'Sin Descripción').trim()}">${String(seccionNombre || 'N/A').trim()}</div>
                        <div class="section-jefe">${String(seccionInfo.jefatura || 'N/A').trim()}</div>
                        <div class="mb-2" style="width: 100px; height: 100px; margin: 0 auto;">
                            <canvas id="${chartId}"></canvas>
                        </div>
                        <div class="section-counts">
                            ${(currentScan || 0).toLocaleString('es-MX')} / ${(currentSap || 0).toLocaleString('es-MX')} pzs
                            ${currentFaltantes > 0 ? `<br><span style="color: #E30000;">Faltantes: ${currentFaltantes.toLocaleString('es-MX')}</span>` : ''}
                            ${currentExcedentes > 0 ? `<br><span style="color: #F58220;">Excedentes: ${currentExcedentes.toLocaleString('es-MX')}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        seccionesGrid.innerHTML = '<div class="col-12"><p class="text-center text-muted mt-4">No hay secciones con piezas para este manifiesto que coincidan con los filtros de contenedor y jefatura.</p></div>';
    }

    setTimeout(() => {
        sortedSectionsToDisplay.forEach(([seccionNombre, data]) => {
            const chartId = `chart-manifest-${String(manifest.id || '').replace(/[^a-zA-Z0-9]/g, '')}-seccion-${String(seccionNombre || '').replace(/[^a-zA-Z0-9]/g, '')}-${String(currentContenedorFilterManifiestosDetalle || '').replace(/[^a-zA-Z0-9]/g, '')}`;
            const doughnutCtx = document.getElementById(chartId)?.getContext('2d');
            if (doughnutCtx) {
                const currentSap = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (data.totalSap || 0) : (data.byContenedor[currentContenedorFilterManifiestosDetalle]?.sap || 0));
                const currentScan = (currentContenedorFilterManifiestosDetalle === 'Todos' ? (data.totalScan || 0) : (data.byContenedor[currentContenedorFilterManifiestosDetalle]?.scan || 0));

                const avanceSeccion = currentSap > 0 ? (currentScan / currentSap) * 100 : 100;
                const colorAvanceSeccion = avanceSeccion < 50 ? '#E30000' : (avanceSeccion < 75 ? '#F58220' : (avanceSeccion < 100 ? '#FEE101' : 'var(--liverpool-green)'));
                new Chart(doughnutCtx, {
                    type: 'doughnut',
                    data: {
                        datasets: [{
                            data: [avanceSeccion, 100 - avanceSeccion],
                            backgroundColor: [colorAvanceSeccion, '#f1f3f5'],
                            borderWidth: 0,
                            cutout: '75%'
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: false }
                        }
                    },
                    plugins: [{
                        id: `gaugeText-manifest-seccion-${seccionNombre}-${currentContenedorFilterManifiestosDetalle}`,
                        beforeDraw: chart => {
                            const { ctx, width, height } = chart;
                            ctx.restore();
                            ctx.font = `700 ${(height / 5).toFixed(0)}px Poppins`;
                            ctx.fillStyle = colorAvanceSeccion;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(`${avanceSeccion.toFixed(0)}%`, width / 2, height / 2);
                            ctx.save();
                        }
                    }]
                });
            }
        });
    }, 100);
};
const renderExcedentesDetail = () => {
    const container = document.getElementById('excedentes-list-container');
    const jefaturaFilterContainer = document.getElementById('excedentes-jefatura-filter');
    const excedentesChartCanvas = document.getElementById('excedentesChart');
    if (!container || !jefaturaFilterContainer || !excedentesChartCanvas) return;

    const jefaturasConExcedentes = new Set();
    report.skusConExcedentes.forEach(item => {
        if (Number(item.excedente || 0) > 0) {
            jefaturasConExcedentes.add(item.jefatura);
        }
    });
    const sortedJefaturasExcedentes = Array.from(jefaturasConExcedentes).sort();

    let filterHTML = `<button class="filter-btn ${currentJefaturaFilterExcedentes === 'Todos' ? 'active' : ''}" data-jefe-excedente="Todos">Todos</button>`;
    filterHTML += sortedJefaturasExcedentes.map(jefe =>
        `<button class="filter-btn ${currentJefaturaFilterExcedentes === jefe ? 'active' : ''}" data-jefe-excedente="${jefe}">${String(jefe || 'N/A').trim()}</button>`
    ).join('');
    jefaturaFilterContainer.innerHTML = filterHTML;

    jefaturaFilterContainer.querySelectorAll('button[data-jefe-excedente]').forEach(button => {
        const newListener = (e) => {
            jefaturaFilterContainer.querySelectorAll('button[data-jefe-excedente]').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentJefaturaFilterExcedentes = e.currentTarget.dataset.jefeExcedente;
            renderExcedentesDetail();
        };
        button.removeEventListener('click', button._eventListener || (() => { }));
        button.addEventListener('click', newListener);
        button._eventListener = newListener;
    });


    const filteredExcedentes = report.skusConExcedentes.filter(item => {
        return (currentJefaturaFilterExcedentes === 'Todos' || item.jefatura === currentJefaturaFilterExcedentes) && (Number(item.excedente || 0) > 0);
    });

    if (filteredExcedentes.length === 0) {
        container.innerHTML = '<li class="list-group-item text-center text-success fs-5 p-4">¡Genial! No se encontraron artículos con excedentes que coincidan con los filtros.</li>';
    } else {
        container.innerHTML = filteredExcedentes.map(item => `
            <li class="list-group-item d-flex justify-content-between align-items-center flex-wrap">
                <div>
                    <strong style="color:#f0ad4e;">${String(item.sku || 'N/A').trim()}</strong> - ${String(item.desc || 'Sin Descripción').trim()}<br>
                    <small class="text-muted">Manifiesto: ${String(item.manifiesto.numero || 'N/A').trim()} (ID: ${String(item.manifiesto.id || 'N/A').trim()})</small><br>
                    <small class="text-muted">Contenedor: ${String(item.contenedor || 'N/A').trim()} | Sección: ${String(item.seccion || 'N/A').trim()} | Jefatura: ${String(item.jefatura || 'N/A').trim()}</small>
                </div>
                <span class="badge rounded-pill" style="background-color: #f0ad4e;">+${(Number(item.excedente) || 0)} pz.</span>
            </li>
        `).join('');
    }

    let chartLabels = [];
    let chartData = [];
    let backgroundColors = [];

    if (currentJefaturaFilterExcedentes === 'Todos') {
        const excedentesPorJefatura = {};
        report.skusConExcedentes.forEach(item => {
            if (Number(item.excedente || 0) > 0) {
                excedentesPorJefatura[item.jefatura] = (excedentesPorJefatura[item.jefatura] || 0) + (Number(item.excedente) || 0);
            }
        });
        chartLabels = Object.keys(excedentesPorJefatura).sort();
        chartData = chartLabels.map(jefe => excedentesPorJefatura[jefe]);
        backgroundColors = chartLabels.map((_, i) => `hsl(${i * 60}, 70%, 50%)`);
    } else {
        const excedentesPorSeccion = {};
        filteredExcedentes.forEach(item => {
            if (Number(item.excedente || 0) > 0) {
                excedentesPorSeccion[item.seccion] = (excedentesPorSeccion[item.seccion] || 0) + (Number(item.excedente) || 0);
            }
        });
        chartLabels = Object.keys(excedentesPorSeccion).sort();
        chartData = chartLabels.map(seccion => excedentesPorSeccion[seccion]);
        backgroundColors = chartLabels.map((_, i) => `hsl(${i * 45 + 30}, 60%, 60%)`);
    }

    if (excedentesChartInstance) {
        excedentesChartInstance.destroy();
    }

    if (chartData.some(val => val > 0)) {
        excedentesChartInstance = new Chart(excedentesChartCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: backgroundColors,
                    borderWidth: 1,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'right',
                        labels: {
                            color: 'var(--liverpool-dark)'
                        }
                    },
                    title: {
                        display: true,
                        text: currentJefaturaFilterExcedentes === 'Todos' ? 'Excedentes por Jefatura' : `Excedentes en ${currentJefaturaFilterExcedentes} por Sección`,
                        color: 'var(--liverpool-dark)',
                        font: { size: 14, weight: 'bold' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed) {
                                    label += context.parsed.toLocaleString('es-MX') + ' pzs';
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    } else {
        excedentesChartCanvas.getContext('2d').clearRect(0, 0, excedentesChartCanvas.width, excedentesChartCanvas.height);
    }
};

async function generarResumenSemanal() {
    // 1. Date selection modal
    const { value: dateRange } = await Swal.fire({
        title: '<i class="bi bi-calendar2-range" style="color:#E10098;"></i> Periodo de Análisis',
        html: `
            <p class="text-muted mt-2 mb-4">Selecciona el rango de fechas para generar el reporte de rendimiento.</p>
            <input type="text" id="date-range-picker" class="form-control text-center" placeholder="Seleccionar fechas...">
        `,
        width: 480,
        padding: '2rem',
        confirmButtonText: 'Generar Dashboard <i class="bi bi-arrow-right-circle-fill ms-1"></i>',
        customClass: {
            popup: 'animate__animated animate__fadeInDown border-0 shadow-lg',
            confirmButton: 'btn btn-primary btn-lg',
        },
        didOpen: () => {
            flatpickr.localize(flatpickr.l10ns.es);
            const fp = flatpickr("#date-range-picker", {
                mode: "range",
                dateFormat: "Y-m-d",
                locale: {
                    ...flatpickr.l10ns.es,
                    rangeSeparator: ' a '
                },
                maxDate: "today"
            });
            setTimeout(() => fp.open(), 100);
        },
        preConfirm: (value) => {
            const range = document.getElementById('date-range-picker').value;
            const separator = range.includes(' a ') ? ' a ' : 'a';

            if (!range || (range.split(separator).length < 2)) {
                Swal.showValidationMessage('Debes seleccionar un rango de fechas válido.');
                return false;
            }
            return range.split(separator);
        }
    });

    if (!dateRange || dateRange.length < 2) {
        document.getElementById('resumenContent').innerHTML = `
            <div class="text-center p-5">
                <i class="bi bi-calendar-x-fill text-muted" style="font-size: 4rem;"></i>
                <h4 class="mt-3">Selección de Fechas Cancelada o Incompleta</h4>
                <p class="text-muted">Por favor, selecciona un rango de fechas para generar el resumen semanal.</p>
                <button class="btn btn-primary mt-3" onclick="generarResumenSemanal()">Seleccionar Fechas Ahora</button>
            </div>
        `;
        return;
    }

    const [startDateStr, endDateStr] = dateRange;

    // **AÑADE ESTAS DOS LÍNEAS**
    report.startDate = startDateStr;
    report.endDate = endDateStr;

    // 2. Show loading SweetAlert while data is processed
    Swal.fire({
        title: '<span style="font-weight:700;color:#E10098;">Analizando Datos...</span>',
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1.2rem;"><div class="liverpool-loader"></div><div id="loading-message" style="color:#6c757d;">Cargando inteligencia de secciones y procesando manifiestos...<br>Por favor, espera.</div></div><style>.liverpool-loader{width:60px;height:60px;border-radius:50%;background:conic-gradient(from 180deg at 50% 50%,#E10098,#414141,#95C11F,#E10098);animation:spin 1.2s linear infinite;-webkit-mask:radial-gradient(farthest-side,#0000 calc(100% - 8px),#000 0);mask: radial-gradient(farthest-side, #0000 calc(100% - 8px), #000 0);}@keyframes spin{to{transform:rotate(1turn);}}</style>`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    try {
        // 3. Load Secciones.xlsx data
        seccionesMap = new Map();
        try {
            const seccionesURL = await storage.ref('ExcelManifiestos/Secciones.xlsx').getDownloadURL();
            const seccionesBuffer = await (await fetch(seccionesURL)).arrayBuffer();
            const seccionesWB = XLSX.read(seccionesBuffer, { type: 'array' });
            const seccionesData = XLSX.utils.sheet_to_json(seccionesWB.Sheets['Jefatura']);
            seccionesData.forEach(row => {
                const seccionKey = String(getProp(row, 'Seccion') || '').trim();
                if (seccionKey) {
                    seccionesMap.set(seccionKey.toUpperCase(), {
                        descripcion: String(getProp(row, 'Descripcion') || 'Sin Descripción').trim(),
                        jefatura: String(getProp(row, 'Jefatura') || 'Sin Asignar').trim(),
                        asistente: String(getProp(row, 'Asistente de Operaciones') || 'N/A').trim()
                    });
                }
            });
        } catch (error) {
            console.error("Critical error loading 'ExcelManifiestos/Secciones.xlsx':", error);
            Swal.fire('Error de Archivo', "No se pudo cargar el archivo <b>ExcelManifiestos/Secciones.xlsx</b>. Revisa la consola para más detalles.", 'error');
            return;
        }

        // 4. Define date range for Firebase query
        const [startY, startM, startD] = startDateStr.split('-').map(Number);
        const startDate = new Date(startY, startM - 1, startD, 0, 0, 0, 0);
        const [endY, endM, endD] = endDateStr.split('-').map(Number);
        const endDate = new Date(endY, endM - 1, endD, 23, 59, 59, 999);

        // 5. Query manifests in Firebase
        let query = db.collection('manifiestos').where('createdAt', '>=', startDate).where('createdAt', '<=', endDate);
        if (currentUserStore !== 'ALL' && !SUPER_ADMINS.includes(currentUser.uid)) {
            query = query.where('store', '==', currentUserStore);
        }
        const snapshot = await query.get();

        if (snapshot.empty) {
            Swal.fire('Sin Datos', 'No se encontraron manifiestos en el rango de fechas seleccionado.', 'info');
            document.getElementById('resumenContent').innerHTML = '<p class="text-center text-muted fs-5 mt-5">No se encontraron manifiestos para el periodo seleccionado.</p>';
            return;
        }

        // 6. Initialize the `report` object to store aggregated data
        report = {
            totalSAP: 0,
            totalSCAN: 0,
            piezasEncontradasTotales: 0,
            manifiestos: {},
            usuarios: {},
            secciones: {},
            skusSinEscanear: [],
            skusConExcedentes: [],
            failedManifests: []
        };

        // 7. Process each manifest concurrently
        const totalManifestsInSnapshot = snapshot.docs.length;
        document.getElementById('loading-message').innerHTML = `Cargando inteligencia de secciones y procesando manifiestos...<br>Procesando 0 de ${totalManifestsInSnapshot} manifiestos...<br>Por favor, espera.`;

        const manifestPromises = snapshot.docs.map(async (doc, index) => {
            try {
                document.getElementById('loading-message').innerHTML = `Cargando inteligencia de secciones y procesando manifiestos...<br>Procesando ${index + 1} de ${totalManifestsInSnapshot} manifiestos...<br>Por favor, espera.`;

                const reconstructed = await reconstructManifestDataFromFirebase(doc.id);
                if (!reconstructed) {
                    console.warn(`[generarResumenSemanal] Skipping manifest ${doc.id} due to reconstruction failure.`);
                    return null;
                }
                const manifestData = reconstructed.data;

                const contenedoresUnicos = new Set();
                manifestData.forEach(row => {
                    const contenedor = String(getProp(row, 'CONTENEDOR') || 'N/A').trim();
                    contenedoresUnicos.add(contenedor);
                });

                const manifestInfo = {
                    id: doc.id,
                    numero: String(getProp(manifestData[0], 'MANIFIESTO') || 'N/A').trim(),
                    data: manifestData,
                    seccionesResumen: {},
                    contenedores: Array.from(contenedoresUnicos).sort()
                };

                manifestData.forEach(row => {
                    const seccionKey = String(getProp(row, 'SECCION') || 'Sin Sección').trim();
                    const sap = Number(getProp(row, 'SAP')) || 0;
                    const scan = Number(getProp(row, 'SCANNER')) || 0;
                    const user = String(getProp(row, 'LAST_SCANNED_BY') || 'N/A').trim();
                    const contenedor = String(getProp(row, 'CONTENEDOR') || 'N/A').trim();
                    const sku = String(getProp(row, 'SKU') || 'N/A').trim();
                    const desc = String(getProp(row, 'DESCRIPCION') || 'Sin Descripción').trim();

                    const seccionInfo = seccionesMap.get(seccionKey.toUpperCase()) || {
                        jefatura: 'Sin Asignar',
                        descripcion: 'Sin Descripción',
                        asistente: 'N/A'
                    };
                    const jefatura = seccionInfo.jefatura;

                    // Lógica de agregación para el reporte global
                    if (!report.secciones[seccionKey]) {
                        report.secciones[seccionKey] = {
                            sap: 0, scan: 0, piezasEncontradas: 0, faltantes: 0, excedentes: 0,
                            jefatura: jefatura, descripcion: seccionInfo.descripcion, asistente: seccionInfo.asistente
                        };
                    }
                    report.secciones[seccionKey].sap += sap;
                    report.secciones[seccionKey].scan += scan;
                    report.secciones[seccionKey].piezasEncontradas += Math.min(sap, scan);
                    report.secciones[seccionKey].faltantes += Math.max(0, sap - scan);
                    report.secciones[seccionKey].excedentes += Math.max(0, scan - sap);

                    // Lógica de agregación por manifiesto
                    if (!manifestInfo.seccionesResumen[seccionKey]) {
                        manifestInfo.seccionesResumen[seccionKey] = {
                            totalSap: 0, totalScan: 0, byContenedor: {}, jefatura: jefatura
                        };
                    }
                    if (!manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor]) {
                        manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor] = {
                            sap: 0, scan: 0, faltantes: 0, excedentes: 0
                        };
                    }
                    manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor].sap += sap;
                    manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor].scan += scan;
                    manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor].faltantes += Math.max(0, sap - scan);
                    manifestInfo.seccionesResumen[seccionKey].byContenedor[contenedor].excedentes += Math.max(0, scan - sap);
                    manifestInfo.seccionesResumen[seccionKey].totalSap += sap;
                    manifestInfo.seccionesResumen[seccionKey].totalScan += scan;

                    report.totalSAP += sap;
                    report.totalSCAN += scan;
                    report.piezasEncontradasTotales += Math.min(sap, scan);

                    const diferencia = scan - sap;

                    if (diferencia < 0) {
                        report.skusSinEscanear.push({
                            sku: sku,
                            desc: desc,
                            sap: sap,
                            faltante: Math.abs(diferencia),
                            manifiesto: { id: manifestInfo.id, numero: manifestInfo.numero },
                            contenedor: contenedor,
                            seccion: seccionKey,
                            jefatura: jefatura
                        });
                    } else if (diferencia > 0) {
                        report.skusConExcedentes.push({
                            sku: sku,
                            desc: desc,
                            excedente: diferencia,
                            manifiesto: { id: manifestInfo.id, numero: manifestInfo.numero },
                            contenedor: contenedor,
                            seccion: seccionKey,
                            jefatura: jefatura
                        });
                    }

                    if (user !== 'N/A' && scan > 0) {
                        if (!report.usuarios[user]) report.usuarios[user] = { scans: 0, manifests: new Map() };
                        report.usuarios[user].scans += scan;
                        if (!report.usuarios[user].manifests.has(manifestInfo.id)) report.usuarios[user].manifests.set(manifestInfo.id, { scans: 0, numero: manifestInfo.numero });
                        report.usuarios[user].manifests.get(manifestInfo.id).scans += scan;
                    }
                });
                return manifestInfo;
            } catch (innerError) {
                console.error(`Error processing manifest ${doc.id}:`, innerError);
                return { id: doc.id, error: innerError.message || 'Unknown error processing' };
            }
        });

        const results = await Promise.allSettled(manifestPromises);

        report.failedManifests = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && r.value.error)).map(r => r.reason || r.value);
        results.filter(r => r.status === 'fulfilled' && r.value !== null && !r.value.error)
            .map(r => r.value)
            .forEach(man => { report.manifiestos[man.id] = man; });

        report.jefaturas = {};
        jefaturasConDatosEnPeriodo.clear();
        for (const [seccionNombre, seccionData] of Object.entries(report.secciones)) {
            const jefe = seccionData.jefatura;
            if (jefe === 'Sin Asignar') continue;

            if (!report.jefaturas[jefe]) {
                report.jefaturas[jefe] = {
                    sap: 0,
                    scan: 0,
                    piezasEncontradas: 0,
                    faltantes: 0,
                    excedentes: 0,
                    skus: 0,
                    secciones: [],
                    manifiestosConSecciones: new Set()
                };
            }
            report.jefaturas[jefe].sap += seccionData.sap;
            report.jefaturas[jefe].scan += seccionData.scan;
            report.jefaturas[jefe].piezasEncontradas += seccionData.piezasEncontradas;
            report.jefaturas[jefe].faltantes += seccionData.faltantes;
            report.jefaturas[jefe].excedentes += seccionData.excedentes;
            report.jefaturas[jefe].skus++;

            // LÓGICA DE CÁLCULO DE AVANCE CORREGIDA Y ROBUSTA
            let avanceSeccionCalculado = 0;
            if (seccionData.sap > 0) {
                // Si hay faltantes, el avance NUNCA es 100%
                if (seccionData.faltantes > 0) {
                    avanceSeccionCalculado = (seccionData.piezasEncontradas / seccionData.sap) * 100;
                } else {
                    // Si no hay faltantes, el avance es 100%
                    avanceSeccionCalculado = 100;
                }
            } else {
                avanceSeccionCalculado = 100;
            }

            report.jefaturas[jefe].secciones.push({
                nombre: seccionNombre,
                descripcion: seccionData.descripcion,
                sap: seccionData.sap,
                scan: seccionData.scan,
                piezasEncontradas: seccionData.piezasEncontradas,
                faltantes: seccionData.faltantes,
                excedentes: seccionData.excedentes,
                avance: avanceSeccionCalculado
            });
            Object.values(report.manifiestos).forEach(man => {
                const seccionResumenManifiesto = man.seccionesResumen[seccionNombre];
                if (seccionResumenManifiesto && (seccionResumenManifiesto.totalSap > 0 || seccionResumenManifiesto.totalScan > 0 || Object.values(seccionResumenManifiesto.byContenedor || {}).some(c => c.faltantes > 0 || c.excedentes > 0))) {
                    if (seccionResumenManifiesto.jefatura === jefe) {
                        report.jefaturas[jefe].manifiestosConSecciones.add(man.id);
                    }
                }
            });
            if (seccionData.sap > 0 || seccionData.scan > 0) {
                jefaturasConDatosEnPeriodo.add(jefe);
            }
        }

        const avanceGeneral = report.totalSAP > 0 ? (report.piezasEncontradasTotales / report.totalSAP) * 100 : 0;
        const totalFaltantes = Object.values(report.secciones).reduce((acc, seccion) => acc + (seccion.faltantes || 0), 0);
        const totalExcedentes = Object.values(report.secciones).reduce((acc, seccion) => acc + (seccion.excedentes || 0), 0);
        const topScanners = Object.entries(report.usuarios).sort((a, b) => b[1].scans - a[1].scans);
        const jefaturasUnicas = Array.from(jefaturasConDatosEnPeriodo).sort();

        // 8. Generates the main HTML for the weekly summary dashboard
        const mainHTML = `
            <style>
                :root {
                    --liverpool-pink: #E10098;
                    --liverpool-green: #95C11F;
                    --liverpool-dark: #414141;
                    --liverpool-light-gray: #f4f7fa;
                    --liverpool-border-gray: #dee2e6;
                }
                .swal2-popup.swal2-modal { border-radius: 1.5rem !important; }
                .epic-summary-container{display:flex;min-height:85vh;width:100%;font-family:'Poppins',sans-serif;background:var(--liverpool-light-gray);border-radius:1.5rem;overflow:hidden;}
                .epic-sidebar{width:280px;min-width:280px;background:#ffffff;color:var(--liverpool-dark);padding:2rem 1.5rem;display:flex;flex-direction:column;align-items:flex-start;border-right: 1px solid var(--liverpool-border-gray);}
                .epic-sidebar h3{font-weight:700;font-size:1.5rem;margin-bottom:0.25rem;color:var(--liverpool-pink);}
                .epic-sidebar .date-range {font-size:0.9rem; color:#6c757d; margin-bottom: 2rem;}
                .sidebar-nav{list-style:none;padding:0;margin:0;width:100%;}
                .sidebar-nav li button{width:100%;text-align:left;padding:0.8rem 1rem;background:transparent;border:none;color:#495057;border-radius:10px;font-weight:500;display:flex;align-items:center;gap:0.8rem;transition:all 0.2s ease;margin-bottom:0.5rem;}
                .sidebar-nav li button:hover{background:#e9ecef;color:var(--liverpool-pink);}
                .sidebar-nav li button.active{background:var(--liverpool-pink);color:#fff;font-weight:600;}
                .epic-content{flex-grow:1;padding:2rem 2.5rem;overflow-y:auto;}
                .epic-tab-pane{display:none;animation:fadeIn 0.5s;} .epic-tab-pane.active{display:block;}
                .epic-content h4{font-weight:600;color:var(--liverpool-dark);margin-bottom:1.5rem;border-bottom:1px solid var(--liverpool-border-gray);padding-bottom:0.8rem;display:flex;align-items:center;justify-content:space-between;}
                
                .stat-card-main{background:#fff;border-radius:1rem;padding:1.5rem;text-align:center;border:1px solid var(--liverpool-border-gray); transition:all 0.3s ease;}
                .stat-card-main:hover{transform:translateY(-5px);box-shadow:0 8px 25px rgba(0,0,0,0.08);}
                .stat-card-main .icon{font-size:2rem;margin-bottom:0.0rem;line-height:1;}
                .stat-card-main .value{font-size:2.2rem;font-weight:700;line-height:1.1; color: var(--liverpool-dark);}
                .stat-card-main .label{color:#6c757d;font-weight:500;font-size:0.9rem;}
                .stat-card-main.sap .icon { color: var(--liverpool-dark); }
                .stat-card-main.scan .icon { color: var(--liverpool-green); }
                .stat-card-main.missing .icon { color: var(--liverpool-pink); }
                .stat-card-main.excess .icon { color: #f0ad4e; }
                
                .filter-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; }
                .filter-pills button { background-color: #e9ecef; border: none; border-radius: 2rem; padding: 0.4rem 1rem; font-size: 0.9rem; font-weight: 500; transition: all 0.2s ease; cursor: pointer; }
                .filter-pills button.active { background-color: var(--liverpool-pink); color: white; box-shadow: 0 4px 10px rgba(225, 0, 152, 0.3); }

                .jefatura-card { background-color: #fff; border-radius: 1rem; padding: 1.5rem; border: 1px solid var(--liverpool-border-gray); margin-bottom: 1.5rem; }
                .jefatura-header { display: flex; align-items: center; gap: 1.5rem; padding-bottom:1rem; margin-bottom:1rem; border-bottom: 1px solid #f1f3f5; }
                .jefatura-chart-container { width: 80px; height: 80px; position: relative; flex-shrink: 0; }
                .jefatura-title h5 { font-weight: 700; margin-bottom: 0.1rem; color: var(--liverpool-dark); }
                .jefatura-title .stats-summary { font-size: 0.9rem; color: #6c757d; }
                .jefatura-secciones-list { list-style: none; padding: 0; margin: 0; }
                .jefatura-secciones-list li { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.2rem; font-size: 0.95rem; border-bottom: 1px solid #f8f9fa; }
                .jefatura-secciones-list li:last-child { border-bottom: none; }
                .jefatura-secciones-list .section-name { font-weight: 500; }
                
                .section-card-compact { background: #fff; border: 1px solid var(--liverpool-border-gray); border-radius: 0.75rem; padding: 1rem; text-align: center; transition: all 0.2s ease-in-out; display: flex; flex-direction: column; height: 100%;}
                .section-card-compact:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.1); z-index: 10; position:relative; }
                .section-card-compact .section-name { font-weight: 600; font-size: 0.95rem; color: var(--liverpool-dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .section-card-compact .section-jefe { font-size: 0.8rem; color: #6c757d; margin-bottom: 0.75rem; }
                .section-card-compact .section-counts { font-size: 0.8rem; color: #6c757d; margin-top: 0.5rem; }
                
                .custom-progress { background-color: #e9ecef; border-radius: 2rem; height: 1.25rem; overflow: hidden; }
                .custom-progress-bar { display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-weight: 600; font-size: 0.75rem; transition: width 0.4s ease; }
                .progress-green { background: linear-gradient(45deg, #84ac1c, #95C11F); }
                .progress-yellow { background: linear-gradient(45deg, #ddc304, #FEE101); }
                .progress-orange { background: linear-gradient(45deg, #d8721c, #F58220); }
                .progress-red { background: linear-gradient(45deg, #cc0000, #E30000); }

                .leaderboard-item { display: flex; align-items: center; gap: 1rem; padding: 1rem; border-radius: 1rem; background: #fff; margin-bottom: 0.75rem; border: 1px solid var(--liverpool-border-gray); }
                .leaderboard-rank { font-size: 1.2rem; font-weight: 700; color: var(--liverpool-pink); width: 2.5rem; text-align: center; flex-shrink: 0; }
                .leaderboard-info { flex-grow: 1; }
                .leaderboard-name { font-weight: 600; color: var(--liverpool-dark); }
                .leaderboard-details { font-size: 0.85rem; color: #6c757d; }
                .leaderboard-stats { font-size: 1.2rem; font-weight: 700; color: var(--liverpool-dark); text-align: right; }

                .manifiesto-list-item {
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                .manifiesto-list-item:hover {
                    background-color: #f8f9fa;
                }
                .manifiesto-list-item.active {
                    background-color: var(--liverpool-pink) !important;
                    color: white;
                    border-color: var(--liverpool-pink);
                }
                .manifiesto-list-item.active i {
                    color: white !important;
                }
                .manifiesto-list-item.active .text-muted {
                    color: rgba(255,255,255,0.7) !important;
                }
                .manifiesto-list-item.active .badge {
                    background-color: #fff !important;
                    color: var(--liverpool-dark) !important;
                }
                .manifest-status-completed { border-left: 5px solid var(--liverpool-green); }
                .manifest-status-diff { border-left: 5px solid #f0ad4e; }
                .manifest-status-zero { border-left: 5px solid var(--liverpool-pink); }

                #manifest-detail-view .stat-card-main .value {
                    font-size: 1.8rem;
                }
                #manifest-detail-view .stat-card-main .label {
                    font-size: 0.8rem;
                }
                /* Responsive improvements */
                @media (max-width: 991px) {
                    .epic-summary-container { flex-direction: column; }
                    .epic-sidebar { width: 100%; min-width: unset; border-right: none; border-bottom: 1px solid var(--liverpool-border-gray); flex-direction: row; align-items: center; padding: 1rem 1rem; }
                    .epic-sidebar h3 { font-size: 1.1rem; margin-bottom: 0; }
                    .epic-sidebar .date-range { margin-bottom: 0; }
                    .sidebar-nav { flex-direction: row; display: flex; gap: 0.5rem; width: auto; }
                    .sidebar-nav li button { padding: 0.5rem 0.7rem; font-size: 0.9rem; margin-bottom: 0; }
                    .epic-content { padding: 1rem 0.5rem; }
                }
                @media (max-width: 600px) {
                    .epic-sidebar { flex-wrap: wrap; }
                    .sidebar-nav { flex-wrap: wrap; }
                    .sidebar-nav li button { font-size: 0.8rem; }
                }
    .jefatura-secciones-list-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        background-color: #f8f9fa;
        border-radius: 12px;
        margin-bottom: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        transition: all 0.3s ease;
    }
    .jefatura-secciones-list-item:hover {
        background-color: #f1f3f5;
        box-shadow: 0 6px 18px rgba(0,0,0,0.1);
    }
    .section-content-wrapper {
        display: flex;
        align-items: center;
        flex-grow: 1;
    }
    .section-details {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        margin-left: 1rem;
    }
    .section-name {
        font-weight: 600;
        font-size: 1.1rem;
        color: var(--liverpool-dark);
    }
    .section-stats {
        font-size: 0.9rem;
        color: #6c757d;
    }
    .section-progress-container {
        display: flex;
        align-items: center;
        width: 150px; /* Ajusta el ancho según tu preferencia */
        margin-left: auto;
    }
    .custom-progress-bar {
        height: 12px;
        flex-grow: 1;
        background-color: #e9ecef;
        border-radius: 6px;
        overflow: hidden;
    }
    .custom-progress-fill {
        height: 100%;
        transition: width 0.4s ease;
        border-radius: 6px;
    }
    .progress-text {
        font-weight: 700;
        font-size: 1rem;
        width: 50px; /* Ancho fijo para el texto */
        text-align: right;
        margin-left: 0.5rem;
    }
    .btn-view-details {
        background: none;
        border: none;
        padding: 0;
        margin-left: 1rem;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        color: #dc3545; /* Rojo de alerta */
        background-color: #fff;
    }
    .btn-view-details:hover {
        background-color: #dc3545;
        color: white;
    }
    .btn-view-details svg {
        width: 20px;
        height: 20px;
        transition: fill 0.2s ease;
    }
    .btn-placeholder {
        width: 32px;
        height: 32px;
        margin-left: 1rem;
    }
            </style>
            <div class="epic-summary-container">
                <div class="epic-sidebar">
                    <h3><i class="bi bi-robot me-2"></i>Resumen AI</h3>
                    <p class="date-range">${startDate.toLocaleDateString('es-ES')} - ${endDate.toLocaleDateString('es-ES')}</p>
                    <ul class="sidebar-nav">
                        <li><button class="nav-btn active" data-target="dashboard"><i class="bi bi-grid-1x2-fill"></i>Dashboard</button></li>
                        <li><button class="nav-btn" data-target="jefaturas"><i class="bi bi-person-badge-fill"></i>Por Jefatura</button></li>
                        <li><button class="nav-btn" data-target="secciones"><i class="bi bi-pie-chart-fill"></i>Por Sección</button></li>
                        <li><button class="nav-btn" data-target="manifiestos-detail"><i class="bi bi-journal-check"></i>Por Manifiesto</button></li>
                        <li><button class="nav-btn" data-target="excedentes-detail"><i class="bi bi-box-arrow-in-up-right"></i>Excedentes <span class="badge rounded-pill" style="background-color: #f0ad4e;">${report.skusConExcedentes.length}</span></button></li>
                        <li><button class="nav-btn" data-target="usuarios"><i class="bi bi-trophy-fill"></i>Ranking</button></li>
                        <li><button class="nav-btn" data-target="evidencia"><i class="bi bi-exclamation-diamond-fill"></i>Alertas <span class="badge rounded-pill" style="background-color: var(--liverpool-pink);">${report.skusSinEscanear.length}</span></button></li>
                    </ul>
                    <div class="mt-auto w-100"><button id="btnDescargarResumenExcel" class="btn btn-outline-success w-100"><i class="bi bi-file-earmarked-excel-fill me-2"></i>Descargar Excel</button></div>
                    ${report.failedManifests.length > 0 ? `<div class="mt-3 alert alert-danger p-2 small" role="alert"><i class="bi bi-exclamation-circle-fill me-1"></i> ${report.failedManifests.length} Manifiesto(s) con errores. Revisa la consola o descarga el Excel.</div>` : ''}
                </div>
                <div class="epic-content">
                    <div id="dashboard" class="epic-tab-pane active">
                        <h4><i class="bi bi-speedometer2"></i>Resumen General</h4>
                        <div class="row g-4 mb-5">
                            <div class="col-lg-7">
                                <div class="row g-3">
                                    <div class="col-6"><div class="stat-card-main sap"><i class="bi bi-box-seam icon"></i><div class="value">${report.totalSAP.toLocaleString('es-MX')}</div><div class="label">Piezas SAP</div></div></div>
                                    <div class="col-6"><div class="stat-card-main scan"><i class="bi bi-check-circle-fill icon"></i><div class="value">${report.totalSCAN.toLocaleString('es-MX')}</div><div class="label">Escaneadas</div></div></div>
                                    <div class="col-6"><div class="stat-card-main missing"><i class="bi bi-exclamation-triangle-fill icon"></i><div class="value">${totalFaltantes.toLocaleString('es-MX')}</div><div class="label">Faltantes</div></div></div>
                                    <div class="col-6"><div class="stat-card-main excess"><i class="bi bi-plus-circle-dotted icon"></i><div class="value">${totalExcedentes.toLocaleString('es-MX')}</div><div class="label">Excedentes</div></div></div>
                                </div>
                            </div>
                            <div class="col-lg-5 d-flex align-items-center justify-content-center"><canvas id="gaugeChart"></canvas></div>
                        </div>
                        <h4><i class="bi bi-archive-fill me-2"></i>Manifiestos Incluidos</h4>
                        <ul class="list-group list-group-flush">${Object.values(report.manifiestos).map(m => `<li class="list-group-item d-flex justify-content-between align-items-center"><i class="bi bi-file-earmark-text me-2" style="color:var(--liverpool-pink);"></i><div><strong>${m.id}</strong> <br><span class="text-muted small">N° Manif: ${m.numero}</span></div><span class="badge bg-secondary ms-2">${(m.contenedores || []).length} Cont.</span></li>`).join('')}</ul>
                    </div>
                    <div id="jefaturas" class="epic-tab-pane">
                        <h4><i class="bi bi-person-badge-fill me-2"></i>Rendimiento por Jefatura</h4>
                        <div class="accordion" id="jefaturasAccordion">
                            <div class="accordion-item border-0 shadow-sm mb-3" style="border-radius: 1rem;">
                                <h2 class="accordion-header" id="headingComparativa">
                                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseComparativa" aria-expanded="true" aria-controls="collapseComparativa" style="border-radius: 1rem;">
                                        <i class="bi bi-bar-chart-line-fill me-2"></i>
                                        <span style="color: var(--liverpool-dark); font-weight: 600;">Comparativa de Rendimiento</span>
                                    </button>
                                </h2>
                                <div id="collapseComparativa" class="accordion-collapse collapse show" aria-labelledby="headingComparativa" data-bs-parent="#jefaturasAccordion">
                                    <div class="accordion-body">
                                        <div id="jefaturas-comparativa-container" style="min-height: 250px; max-height: 400px; position: relative;">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="accordion-item border-0 shadow-sm" style="border-radius: 1rem;">
                                <h2 class="accordion-header" id="headingDesglose">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseDesglose" aria-expanded="false" aria-controls="collapseDesglose" style="border-radius: 1rem;">
                                        <i class="bi bi-card-list me-2"></i>
                                        <span style="color: var(--liverpool-dark); font-weight: 600;">Desglose Detallado por Jefe</span>
                                    </button>
                                </h2>
                                <div id="collapseDesglose" class="accordion-collapse collapse" aria-labelledby="headingDesglose" data-bs-parent="#jefaturasAccordion">
                                    <div class="accordion-body">
                                        <div id="jefaturas-grid" style="max-height: 70vh; overflow-y: auto; padding-right: 0.5rem;">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="secciones" class="epic-tab-pane">
                        <h4><i class="bi bi-pie-chart-fill me-2"></i>Rendimiento por Sección</h4>
                        <div id="seccion-jefatura-filter" class="filter-pills mb-4"></div>
                        <div id="secciones-grid-container" class="row row-cols-2 row-cols-md-3 row-cols-xl-4 g-3"></div>
                    </div>
                    <div id="manifiestos-detail" class="epic-tab-pane">
                        <h4><i class="bi bi-journal-check me-2"></i>Análisis Detallado por Manifiesto</h4>
                        <div class="row mb-4">
                            <div class="col-lg-4">
                                <div class="card p-3 shadow-sm border-0 h-100">
                                    <h6 class="card-title text-muted mb-3"><i class="bi bi-list-check me-1"></i> Seleccionar Manifiesto</h6>
                                    <div id="manifiestos-status-filter" class="filter-pills mb-3 d-flex flex-wrap gap-2">
                                        <button class="filter-btn active" data-status-filter="Todos">Todos</button>
                                        <button class="filter-btn" data-status-filter="Completado">Completados</button>
                                        <button class="filter-btn" data-status-filter="Diferencias">Con Diferencias</button>
                                        <button class="filter-btn" data-status-filter="Sin Escanear">Sin Escanear</button>
                                    </div>
                                    <div id="manifiestos-list-container" class="list-group list-group-flush" style="max-height: 50vh; overflow-y: auto; border: 1px solid var(--liverpool-border-gray); border-radius: 0.5rem;">
                                        <li class="list-group-item text-center text-muted py-3">Cargando manifiestos...</li>
                                    </div>
                                    <p class="small text-muted mt-3">💡 <b>Consejo para Auditoría:</b> Enfócate en manifiestos con alta desviación (muchas piezas faltantes/excedentes) para identificar problemas de raíz. Revisa la sección de "Alertas" para SKUs específicos no escaneados.</p>
                                </div>
                            </div>
                            <div class="col-lg-8">
                                <div id="manifest-detail-view" class="card p-4 shadow-sm border-0 h-100">
                                    <p class="text-muted text-center mt-4">Selecciona un manifiesto de la lista para ver su detalle y desglose por jefatura, contenedor y sección.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="excedentes-detail" class="epic-tab-pane">
                        <h4 style="color: #f0ad4e;"><i class="bi bi-box-arrow-in-up-right me-2"></i>Artículos con Excedentes</h4>
                        <div class="row mb-4">
                            <div class="col-lg-4">
                                <div class="card p-3 shadow-sm border-0 h-100">
                                    <h6 class="card-title text-muted mb-3"><i class="bi bi-filter-circle me-1"></i> Filtrar Excedentes por Jefatura</h6>
                                    <div id="excedentes-jefatura-filter" class="filter-pills mb-3 d-flex flex-wrap gap-2">
                                    </div>
                                    <p class="small text-muted mt-3">Utiliza este filtro para ver los excedentes por la jefatura responsable de la sección.</p>
                                </div>
                            </div>
                            <div class="col-lg-8">
                                <div class="card p-4 shadow-sm border-0 h-100 d-flex flex-column align-items-center justify-content-center">
                                    <h5 class="mt-4 mb-3" style="color: var(--liverpool-dark); border-bottom: 1px solid var(--liverpool-border-gray); padding-bottom: 0.5rem; width: 100%; text-align: center;"><i class="bi bi-pie-chart-fill me-2"></i>Distribución de Excedentes</h5>
                                    <div style="width: 200px; height: 200px; position: relative;">
                                        <canvas id="excedentesChart"></canvas>
                                    </div>
                                    <div class="mt-4 w-100" style="max-height: 250px; overflow-y: auto;">
                                        <ul class="list-group list-group-flush" id="excedentes-list-container">
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="usuarios" class="epic-tab-pane">
                        <h4><i class="bi bi-trophy-fill me-2"></i>Ranking de Operadores</h4>
                        <div style="max-height: 75vh; overflow-y: auto; padding-right:10px;">
                            ${topScanners.length > 0 ? topScanners.map(([email, data], i) => `
                                <div class="leaderboard-item">
                                    <div class="leaderboard-rank">${['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</div>
                                    <div class="leaderboard-info">
                                        <div class="leaderboard-name">${String(email || 'N/A').trim()}</div>
                                        <div class="leaderboard-details">En ${data.manifests.size} manifiesto(s)</div>
                                    </div>
                                    <div class="leaderboard-stats">${(data.scans || 0).toLocaleString('es-MX')} <span class="small text-muted">pzs</span></div>
                                </div>`).join('') : '<p class="text-muted text-center mt-4">No hay datos de rendimiento de usuarios.</p>'}
                        </div>
                    </div>
                    <div id="evidencia" class="epic-tab-pane">
                        <h4><i class="bi bi-exclamation-diamond-fill me-2"></i>Artículos con Cero Escaneos</h4>
                        <div style="max-height: 75vh; overflow-y: auto; padding-right:10px;"><ul class="list-group list-group-flush">${report.skusSinEscanear.length > 0 ? report.skusSinEscanear.map(item => `<li class="list-group-item d-flex justify-content-between align-items-center"><div><strong style="color:var(--liverpool-dark);">${String(item.sku || 'N/A').trim()}</strong> - ${String(item.desc || 'Sin Descripción').trim()}<br><small class="text-muted">Manifiesto: ${String(item.manifiesto.id || 'N/A').trim()} (N° ${String(item.manifiesto.numero || 'N/A').trim()})</small></div><span class="badge rounded-pill" style="background-color: var(--liverpool-pink);">${(item.sap || 0)} pz.</span></li>`).join('') : '<li class="list-group-item text-center text-success fs-5 p-4">¡Felicidades! Todos los artículos fueron escaneados.</li>'}</ul></div>
                    </div>
                </div>
            </div>`;

        // 9. Add HTML to the main page div (`resumenContent`)
        const resumenContentDiv = document.getElementById('resumenContent');
        if (resumenContentDiv) {
            resumenContentDiv.innerHTML = mainHTML;
        } else {
            console.error("Could not find div #resumenContent to render the summary.");
            Swal.fire('Error', 'Could not load the summary interface.', 'error');
            return;
        }

        // 10. Set up listeners for navigation tabs and download buttons
        const navButtons = document.querySelectorAll('.sidebar-nav li button');
        const tabPanes = document.querySelectorAll('.epic-tab-pane');
        document.getElementById('btnDescargarResumenExcel').addEventListener('click', descargarResumenExcel);

        navButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                navButtons.forEach(b => b.classList.remove('active'));
                tabPanes.forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.target).classList.add('active');

                // Call the corresponding rendering functions when clicking tabs
                if (btn.dataset.target === 'jefaturas') {
                    renderJefaturas();
                } else if (btn.dataset.target === 'secciones') {
                    renderSecciones();
                } else if (btn.dataset.target === 'manifiestos-detail') {
                    renderManifiestosList();
                } else if (btn.dataset.target === 'excedentes-detail') {
                    renderExcedentesDetail();
                }
            });
        });

        // 11. Initial rendering of sections and charts when the dashboard loads
        renderJefaturaFilter();
        renderJefaturas();
        renderSecciones();
        renderManifiestosList();
        renderExcedentesDetail();

        // 12. Restore/Draw the main dashboard chart "General Scan Progress"
        const gaugeCtx = document.getElementById('gaugeChart')?.getContext('2d');
        if (gaugeCtx) {
            new Chart(gaugeCtx, {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data: [avanceGeneral, 100 - avanceGeneral],
                        backgroundColor: ['var(--liverpool-pink)', '#e9ecef'],
                        borderWidth: 0,
                        cutout: '80%',
                        circumference: 180,
                        rotation: 270
                    }]
                },
                options: {
                    responsive: true,
                    aspectRatio: 2,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                        title: {
                            display: true,
                            text: 'Avance General de Escaneo',
                            color: 'var(--liverpool-dark)',
                            font: { size: 16, weight: 'bold' },
                            position: 'top'
                        }
                    }
                },
                plugins: [{
                    id: 'gaugeText-main',
                    beforeDraw: chart => {
                        const { ctx, width, height } = chart;
                        ctx.restore();
                        ctx.font = `800 ${(height / 8).toFixed(0)}px Poppins`;
                        ctx.fillStyle = 'var(--liverpool-pink)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`${avanceGeneral.toFixed(1)}%`, width / 2, height - (height * 0.1));
                        ctx.save();
                    }
                }]
            });
        }
        // 13. Close the "Analyzing Data..." SweetAlert
        Swal.close();

    } catch (error) {
        console.error("Error generating weekly summary:", error);
        Swal.fire('Unexpected Error', 'Operation could not be completed. Please check the console for more details.', 'error');
        document.getElementById('resumenContent').innerHTML = '<p class="text-center text-danger fs-5 mt-5">Error al cargar el resumen. Por favor, intenta de nuevo más tarde o contacta a soporte.</p>';
    }
}
const descargarResumenExcel = () => {
    Swal.fire({
        title: 'Creando Reporte Profesional',
        html: 'Aplicando formato de tabla y generando análisis detallados...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });

    // Se crea una copia del objeto de reporte para evitar modificar los datos originales.
    const reportParaExcel = JSON.parse(JSON.stringify(report));

    // Esta sección recalcula la estructura de jefaturas del reporte,
    // basándose en los datos ya procesados y sin la lógica de reasignación manual.
    reportParaExcel.jefaturas = {};
    for (const [seccionNombre, seccionData] of Object.entries(reportParaExcel.secciones)) {
        const jefe = seccionData.jefatura;
        if (jefe === 'Sin Asignar') continue;

        if (!reportParaExcel.jefaturas[jefe]) {
            reportParaExcel.jefaturas[jefe] = {
                sap: 0, scan: 0, faltantes: 0, excedentes: 0, skus: 0, secciones: [],
                manifiestosConSecciones: []
            };
        }
        reportParaExcel.jefaturas[jefe].sap += seccionData.sap;
        reportParaExcel.jefaturas[jefe].scan += seccionData.scan;
        reportParaExcel.jefaturas[jefe].faltantes += seccionData.faltantes;
        reportParaExcel.jefaturas[jefe].excedentes += seccionData.excedentes;
        reportParaExcel.jefaturas[jefe].skus += seccionData.skus;
        reportParaExcel.jefaturas[jefe].secciones.push({
            nombre: seccionNombre,
            sap: seccionData.sap,
            scan: seccionData.scan,
            avance: seccionData.sap > 0 ? (seccionData.scan / seccionData.sap) * 100 : 100
        });
    }

    const borderAll = { top: { style: "thin", color: { rgb: "D9D9D9" } }, bottom: { style: "thin", color: { rgb: "D9D9D9" } }, left: { style: "thin", color: { rgb: "D9D9D9" } }, right: { style: "thin", color: { rgb: "D9D9D9" } } };
    const styles = {
        title: { font: { sz: 24, bold: true, color: { rgb: "E10098" } }, alignment: { vertical: "center" } },
        subtitle: { font: { sz: 11, italic: true, color: { rgb: "6c757d" } } },
        header: { font: { sz: 16, bold: true, color: { rgb: "414141" } }, border: { bottom: { style: "medium", color: { rgb: "E10098" } } } },
        tableHeader: { font: { sz: 12, bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "000000" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: borderAll },
        manifestHeader: { font: { sz: 14, bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "E10098" } }, border: borderAll },
        jefeHeader: { font: { sz: 13, bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "414141" } }, alignment: { horizontal: "left" }, border: borderAll },
        kpiValueRed: { font: { sz: 28, bold: true, color: { rgb: "C00000" } }, alignment: { horizontal: "center" } },
        kpiValueYellow: { font: { sz: 28, bold: true, color: { rgb: "b4830a" } }, alignment: { horizontal: "center" } },
        kpiValueGreen: { font: { sz: 28, bold: true, color: { rgb: "548235" } }, alignment: { horizontal: "center" } },
        kpiValue: { font: { sz: 28, bold: true, color: { rgb: "000000" } }, alignment: { horizontal: "center" } },
        kpiLabel: { font: { sz: 11, bold: true, color: { rgb: "6c757d" } }, alignment: { horizontal: "center" } },
        dataRowEven: { fill: { fgColor: { rgb: "F8F9FA" } }, border: borderAll },
        dataRowOdd: { fill: { fgColor: { rgb: "FFFFFF" } }, border: borderAll },
        cellRed: { font: { bold: true, color: { rgb: "C00000" } } },
        cellYellow: { font: { bold: true, color: { rgb: "b4830a" } } },
        cellGreen: { font: { bold: true, color: { rgb: "155724" } } },
        avanceGood: { font: { bold: true, color: { rgb: "155724" } }, fill: { fgColor: { rgb: "D4EDDA" } } },
        avanceWarning: { font: { bold: true, color: { rgb: "856404" } }, fill: { fgColor: { rgb: "FFF3CD" } } },
        avanceDanger: { font: { bold: true, color: { rgb: "721c24" } }, fill: { fgColor: { rgb: "F8D7DA" } } },
        statusCritico: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "C00000" } } },
        statusAlerta: { font: { bold: true, color: { rgb: "000000" } }, fill: { fgColor: { rgb: "FFC700" } } },
        statusInfo: { font: { bold: true, color: { rgb: "000000" } }, fill: { fgColor: { rgb: "DAE3F3" } } },
        statusOk: { font: { bold: true, color: { rgb: "155724" } }, fill: { fgColor: { rgb: "D4EDDA" } } },
    };

    const wb = XLSX.utils.book_new();
    const hoy = new Date();
    const fechaReporte = hoy.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const formatSheet = (ws, colWidths = [], numRows, numCols) => {
        if (!ws || !ws['!ref']) return;
        ws['!cols'] = colWidths.map(wch => ({ wch }));
        ws['!autofilter'] = { ref: ws['!ref'] };
        ws['!freeze'] = { ySplit: 1 };

        for (let R = 0; R < numRows; R++) {
            const rowStyle = R === 0 ? styles.tableHeader : (R % 2 !== 0 ? styles.dataRowEven : styles.dataRowOdd);
            for (let C = 0; C < numCols; C++) {
                const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
                if (ws[cellRef]) {
                    if (!ws[cellRef].s || (ws[cellRef].s.font === undefined && ws[cellRef].s.fill === undefined && ws[cellRef].s.border === undefined)) {
                        ws[cellRef].s = rowStyle;
                    }
                }
            }
        }
    };

    const totalFaltantesPeriodo = Object.values(reportParaExcel.secciones).reduce((sum, sec) => sum + (sec.faltantes || 0), 0);
    const totalExcedentesPeriodo = Object.values(reportParaExcel.secciones).reduce((sum, sec) => sum + (sec.excedentes || 0), 0);
    const piezasEsperadas = reportParaExcel.totalSAP;
    const piezasEncontradas = piezasEsperadas - totalFaltantesPeriodo;
    const avanceGeneral = piezasEsperadas > 0 ? piezasEncontradas / piezasEsperadas : 1;

    const initialDashData = [
        [{ v: "📊 Dashboard Ejecutivo de Rendimiento", s: styles.title }],
        [{ v: `Periodo: ${reportParaExcel.startDate} a ${reportParaExcel.endDate} | Generado: ${fechaReporte}`, s: styles.subtitle }],
        [],
        [{ v: "📈 INDICADORES CLAVE DE RENDIMIENTO (KPIs)", s: styles.header }],
        [],
        ["AVANCE GENERAL", "PIEZAS ENCONTRADAS (DE SAP)", "FALTANTES", "EXCEDENTES", "MANIFIESTOS PROCESADOS"],
        [
            { v: avanceGeneral, t: 'n', z: '0.0%', s: avanceGeneral >= 0.95 ? styles.kpiValueGreen : avanceGeneral >= 0.85 ? styles.kpiValueYellow : avanceGeneral >= 0.5 ? styles.kpiValueYellow : styles.kpiValueRed },
            { v: piezasEncontradas, t: 'n', z: '#,##0', s: styles.kpiValueGreen },
            { v: totalFaltantesPeriodo, t: 'n', z: '#,##0', s: styles.kpiValueRed },
            { v: totalExcedentesPeriodo, t: 'n', z: '#,##0', s: styles.kpiValueYellow },
            { v: Object.keys(reportParaExcel.manifiestos).length, t: 'n', z: '#,##0', s: styles.kpiValue }
        ],
        [],
        [{ v: "🚨 ÁREAS CRÍTICAS (JEFATURAS CON MÁS FALTANTES)", s: styles.header }],
    ];
    const wsDash = XLSX.utils.aoa_to_sheet(initialDashData, { cellStyles: true });

    ['A6', 'B6', 'C6', 'D6', 'E6'].forEach(cellRef => {
        if (wsDash[cellRef]) wsDash[cellRef].s = styles.kpiLabel;
    });

    const jefaturasPorFaltantes = Object.entries(reportParaExcel.jefaturas).sort(([, a], [, b]) => b.faltantes - a.faltantes).slice(0, 5);

    XLSX.utils.sheet_add_aoa(wsDash, [["Jefatura", "Piezas Faltantes", "% Avance"]], { origin: "A10" });

    ['A10', 'B10', 'C10'].forEach(cellRef => {
        if (wsDash[cellRef]) wsDash[cellRef].s = styles.tableHeader;
    });

    const topJefaturasData = jefaturasPorFaltantes.map(([jefe, data]) => {
        const avance = data.sap > 0 ? (data.sap - data.faltantes) / data.sap : 1;
        return [{ v: jefe, s: { font: { bold: true } } }, { v: data.faltantes, t: 'n', z: '#,##0', s: styles.cellRed }, { v: avance, t: 'n', z: '0.0%', s: (avance > 0.95 ? styles.cellGreen : avance > 0.85 ? styles.cellYellow : styles.cellRed) }];
    });
    XLSX.utils.sheet_add_aoa(wsDash, topJefaturasData, { origin: "A11", cellStyles: true });

    wsDash['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
        { s: { r: 8, c: 0 }, e: { r: 8, c: 4 } }
    ];
    wsDash['!cols'] = [{ wch: 25 }, { wch: 28 }, { wch: 25 }, { wch: 25 }, { wch: 30 }];

    const startRowManifestsSection = 11 + topJefaturasData.length + 2;

    const includedManifests = Object.values(reportParaExcel.manifiestos).map(m => ([
        `${m.numero || 'N/A'} (ID: ${String(m.id || 'N/A').substring(0, 8)}...)`,
        `${(m.contenedores || []).length} Cont.`
    ]));

    XLSX.utils.sheet_add_aoa(wsDash, [
        [],
        [{ v: "🧾 MANIFIESTOS INCLUIDOS EN EL REPORTE", s: styles.header }],
        ["Número de Manifiesto", "Contenedores"],
        ...includedManifests
    ], { origin: `A${startRowManifestsSection}`, cellStyles: true });

    const headerRowForManifests = startRowManifestsSection + 1;
    if (wsDash[`A${headerRowForManifests}`]) wsDash[`A${headerRowForManifests}`].s = styles.tableHeader;
    if (wsDash[`B${headerRowForManifests}`]) wsDash[`B${headerRowForManifests}`].s = styles.tableHeader;

    const titleRowForManifests = startRowManifestsSection;
    wsDash['!merges'].push({ s: { r: titleRowForManifests, c: 0 }, e: { r: titleRowForManifests, c: 4 } });

    XLSX.utils.book_append_sheet(wb, wsDash, "Dashboard Ejecutivo");

    const analisisManifiestoData = [];
    const manifiestosOrdenados = Object.values(reportParaExcel.manifiestos).sort((a, b) => (a.numero || "").localeCompare(b.numero || ""));
    manifiestosOrdenados.forEach(man => {
        analisisManifiestoData.push([]);
        analisisManifiestoData.push([]);
        analisisManifiestoData.push([{ v: `ANÁLISIS DETALLADO DEL MANIFIESTO: ${man.numero || man.id}`, s: styles.manifestHeader, z: '@' }]);
        analisisManifiestoData.push(["ID Manifiesto", "Número de Manifiesto", "Piezas SAP Total", "Piezas Escaneadas Total", "Contenedores Únicos"]);

        const manTotalSAP = Object.values(man.seccionesResumen).reduce((sum, s) => sum + (s.totalSap || 0), 0);
        const manTotalSCAN = Object.values(man.seccionesResumen).reduce((sum, s) => sum + (s.totalScan || 0), 0);

        analisisManifiestoData.push([
            { v: man.id, s: styles.dataRowEven, z: '@' },
            { v: man.numero, s: styles.dataRowEven, z: '@' },
            { v: manTotalSAP, t: 'n', z: '#,##0', s: styles.dataRowEven },
            { v: manTotalSCAN, t: 'n', z: '#,##0', s: styles.dataRowEven },
            { v: (man.contenedores || []).length, t: 'n', z: '0', s: styles.dataRowEven }
        ]);
        analisisManifiestoData.push([]);

        const jefesEnManifiesto = {};
        Object.entries(man.seccionesResumen).forEach(([nombreSeccion, dataSeccion]) => {
            const jefe = dataSeccion.jefatura;
            if (!jefesEnManifiesto[jefe]) { jefesEnManifiesto[jefe] = { sap: 0, scan: 0, faltantes: 0, excedentes: 0, secciones: [] }; }
            const secTotals = { sap: dataSeccion.totalSap, scan: dataSeccion.totalScan, faltantes: 0, excedentes: 0 };
            Object.values(dataSeccion.byContenedor).forEach(cont => { secTotals.faltantes += cont.faltantes; secTotals.excedentes += cont.excedentes; });

            jefesEnManifiesto[jefe].sap += secTotals.sap;
            jefesEnManifiesto[jefe].scan += secTotals.scan;
            jefesEnManifiesto[jefe].faltantes += secTotals.faltantes;
            jefesEnManifiesto[jefe].excedentes += secTotals.excedentes;
            jefesEnManifiesto[jefe].secciones.push({ nombre: nombreSeccion, ...secTotals });
        });

        Object.entries(jefesEnManifiesto).forEach(([jefe, dataJefe]) => {
            analisisManifiestoData.push([{ v: `   Jefatura: ${jefe}`, s: styles.jefeHeader }]);
            analisisManifiestoData.push(["   Sección", "Piezas SAP", "Piezas Escaneadas", "Faltantes", "Excedentes", "Avance (%)", "Contenedores con Desviación"]);
            dataJefe.secciones.sort((a, b) => b.faltantes - a.faltantes).forEach(sec => {
                const secAvance = sec.sap > 0 ? (sec.sap - sec.faltantes) / sec.sap : 1;

                const containersWithDeviation = Object.entries(man.seccionesResumen[sec.nombre]?.byContenedor || {})
                    .filter(([, cData]) => cData.faltantes > 0 || cData.excedentes > 0)
                    .map(([cName, cData]) => {
                        let dev = [];
                        if (cData.faltantes > 0) dev.push(`F:${cData.faltantes}`);
                        if (cData.excedentes > 0) dev.push(`E:${cData.excedentes}`);
                        return `${cName} (${dev.join(', ')})`;
                    })
                    .join('; ') || 'N/A';

                analisisManifiestoData.push([
                    `   ${sec.nombre}`,
                    { t: 'n', v: sec.sap, z: '#,##0' },
                    { t: 'n', v: sec.scan, z: '#,##0' },
                    { t: 'n', v: sec.faltantes, z: '#,##0', s: styles.cellRed },
                    { t: 'n', v: sec.excedentes, z: '#,##0', s: styles.cellYellow },
                    { t: 'n', v: secAvance, z: '0.00%', s: (secAvance >= 0.995) ? styles.avanceGood : styles.avanceDanger },
                    containersWithDeviation
                ]);
            });
        });
    });

    const wsAnalisisManifiesto = XLSX.utils.aoa_to_sheet(analisisManifiestoData, { cellStyles: true });
    const mergesAnalisis = [];
    let currentRowForStyleAnalysis = 0;
    analisisManifiestoData.forEach((row, index) => {
        if (row.length === 1 && row[0].v && (row[0].v.startsWith("ANÁLISIS DETALLADO") || row[0].v.startsWith("    Jefatura:"))) {
            mergesAnalisis.push({ s: { r: index, c: 0 }, e: { r: index, c: 6 } });
            if (row[0].v.startsWith("ANÁLISIS DETALLADO")) {
                for (let C = 0; C < 7; C++) { const cellRef = XLSX.utils.encode_cell({ c: C, r: index }); if (wsAnalisisManifiesto[cellRef]) wsAnalisisManifiesto[cellRef].s = styles.manifestHeader; }
            } else if (row[0].v.startsWith("    Jefatura:")) {
                for (let C = 0; C < 7; C++) { const cellRef = XLSX.utils.encode_cell({ c: C, r: index }); if (wsAnalisisManifiesto[cellRef]) wsAnalisisManifiesto[cellRef].s = styles.jefeHeader; }
            }
            currentRowForStyleAnalysis = 0;
        }
        else if (row.length > 1 && (row[0].toString().trim() === "ID Manifiesto" || row[0].toString().trim() === "Sección")) {
            const numColsToStyle = (row[0].toString().trim() === "ID Manifiesto") ? 5 : 7;
            for (let C = 0; C < numColsToStyle; C++) { const cellRef = XLSX.utils.encode_cell({ c: C, r: index }); if (wsAnalisisManifiesto[cellRef]) wsAnalisisManifiesto[cellRef].s = styles.tableHeader; }
        }
        else if (row.length > 1 && row[0].v !== undefined && row[0].v !== null && row[0].v !== "") { // Data rows
            const rowStyle = (currentRowForStyleAnalysis++ % 2 === 0) ? styles.dataRowEven : styles.dataRowOdd;
            const numColsToStyle = 7;
            for (let C = 0; C < numColsToStyle; C++) {
                const cellRef = XLSX.utils.encode_cell({ c: C, r: index });
                if (wsAnalisisManifiesto[cellRef]) {
                    wsAnalisisManifiesto[cellRef].s = wsAnalisisManifiesto[cellRef].s ? { ...rowStyle, ...wsAnalisisManifiesto[cellRef].s } : rowStyle;
                }
            }
        }
        else {
        }
    });
    wsAnalisisManifiesto['!merges'] = mergesAnalisis;
    wsAnalisisManifiesto['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsAnalisisManifiesto, "Análisis por Manifiesto");

    const desgloseData = [["Jefatura / Sección", "Piezas SAP", "Piezas Escaneadas", "Faltantes", "Excedentes", "Avance (%)"]];
    const jefaturasOrdenadas = Object.entries(reportParaExcel.jefaturas).sort(([, a], [, b]) => b.faltantes - a.faltantes);
    jefaturasOrdenadas.forEach(([nombreJefe, dataJefe]) => {
        if (dataJefe.sap === 0 && dataJefe.scan === 0) return;
        const avanceJefe = dataJefe.sap > 0 ? (dataJefe.sap - dataJefe.faltantes) / dataJefe.sap : 1;
        desgloseData.push([{ v: nombreJefe, s: styles.jefeHeader }, { v: dataJefe.sap, t: 'n', z: '#,##0', s: styles.jefeHeader }, { v: dataJefe.scan, t: 'n', z: '#,##0', s: styles.jefeHeader }, { v: dataJefe.faltantes, t: 'n', z: '#,##0', s: styles.jefeHeader }, { v: dataJefe.excedentes, t: 'n', z: '#,##0', s: styles.jefeHeader }, { v: avanceJefe, t: 'n', z: '0.00%', s: styles.jefeHeader }]);
        const seccionesDelJefe = Object.entries(reportParaExcel.secciones).filter(([, data]) => data.jefatura === nombreJefe && (data.sap > 0 || data.scan > 0)).sort(([, a], [, b]) => b.faltantes - a.faltantes);
        seccionesDelJefe.forEach(([nombreSeccion, dataSeccion], index) => {
            const avanceSeccion = dataSeccion.sap > 0 ? (dataSeccion.sap - dataSeccion.faltantes) / dataSeccion.sap : 1;
            const rowStyle = index % 2 === 0 ? styles.dataRowEven : styles.dataRowOdd;
            desgloseData.push([{ v: `    ${nombreSeccion}`, s: rowStyle }, { t: 'n', v: dataSeccion.sap, z: '#,##0', s: rowStyle }, { t: 'n', v: dataSeccion.scan, z: '#,##0', s: rowStyle }, { t: 'n', v: dataSeccion.faltantes, z: '#,##0', s: { ...rowStyle, ...styles.cellRed } }, { t: 'n', v: dataSeccion.excedentes, z: '#,##0', s: { ...rowStyle, ...styles.cellYellow } }, { t: 'n', v: avanceSeccion, z: '0.00%', s: (avanceSeccion >= 0.995) ? { ...rowStyle, ...styles.avanceGood } : (avanceSeccion >= 0.90) ? { ...rowStyle, ...styles.avanceWarning } : { ...rowStyle, ...styles.avanceDanger } }]);
        });
    });
    const wsJefaturas = XLSX.utils.aoa_to_sheet(desgloseData, { cellStyles: true });
    wsJefaturas["A1"].s = styles.tableHeader;
    wsJefaturas['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    wsJefaturas['!autofilter'] = { ref: `A1:F${desgloseData.length}` };
    wsJefaturas['!freeze'] = { ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, wsJefaturas, "Resumen por Jefatura");

    const desgloseDetalladoSheetData = [];
    Object.keys(reportParaExcel.jefaturas).sort().forEach(jefe => {
        if (jefe === "Sin Asignar") return;
        let itemsConDiferencia = [];
        Object.values(reportParaExcel.manifiestos).forEach(man => {
            man.data.forEach(row => {
                const seccion = String(getProp(row, 'SECCION') || 'N/A');
                let jefaturaActual = (seccionesMap.get(seccion.toUpperCase()) || {}).jefatura || 'Sin Asignar';
                // La lógica de reasignación ha sido eliminada.
                // Ahora, jefaturaActual contendrá el valor directamente del mapa.

                if (jefaturaActual === jefe) {
                    const sap = Number(getProp(row, 'SAP')) || 0;
                    const scan = Number(getProp(row, 'SCANNER')) || 0;
                    if (sap !== scan) {
                        itemsConDiferencia.push({ seccion, manifiesto: man.numero, contenedor: getProp(row, 'CONTENEDOR'), sku: getProp(row, 'SKU'), descripcion: getProp(row, 'DESCRIPCION'), faltante: Math.max(0, sap - scan), excedente: Math.max(0, scan - sap) });
                    }
                }
            });
        });
        if (itemsConDiferencia.length > 0) {
            desgloseDetalladoSheetData.push([{ v: `Jefatura: ${jefe}`, s: styles.jefeHeader }]);
            desgloseDetalladoSheetData.push(["Sección", "Manifiesto", "Contenedor", "SKU", "Descripción", "Faltantes", "Excedentes"]);
            itemsConDiferencia.sort((a, b) => a.seccion.localeCompare(b.seccion) || b.faltante - a.faltante);
            itemsConDiferencia.forEach(item => { desgloseDetalladoSheetData.push([item.seccion, item.manifiesto, item.contenedor, item.sku, item.descripcion, { t: 'n', v: item.faltante, z: '#,##0', s: styles.cellRed }, { t: 'n', v: item.excedente, z: '#,##0', s: styles.cellYellow }]); });
            desgloseDetalladoSheetData.push([]);
        }
    });

    const wsDesgloseDetallado = XLSX.utils.aoa_to_sheet(desgloseDetalladoSheetData, { cellStyles: true });
    const mergesDetalle = [];
    let currentRowForStyleDetail = 0;
    desgloseDetalladoSheetData.forEach((row, index) => {
        if (row.length === 1 && row[0].v && row[0].v.startsWith("Jefatura:")) {
            mergesDetalle.push({ s: { r: index, c: 0 }, e: { r: index, c: 6 } });
            for (let C = 0; C < 7; C++) { const cellRef = XLSX.utils.encode_cell({ c: C, r: index + 1 }); if (wsDesgloseDetallado[cellRef]) wsDesgloseDetallado[cellRef].s = styles.tableHeader; }
        } else if (row.length > 1) {
            const rowStyle = (currentRowForStyleDetail++ % 2 === 0) ? styles.dataRowEven : styles.dataRowOdd;
            const numColsToStyle = 7;
            for (let C = 0; C < numColsToStyle; C++) { const cellRef = XLSX.utils.encode_cell({ c: C, r: index }); if (wsDesgloseDetallado[cellRef]) wsDesgloseDetallado[cellRef].s = wsDesgloseDetallado[cellRef].s ? { ...rowStyle, ...wsDesgloseDetallado[cellRef].s } : rowStyle; }
        } else { currentRowForStyleDetail = 0; }
    });
    wsDesgloseDetallado['!merges'] = mergesDetalle;
    wsDesgloseDetallado['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 45 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsDesgloseDetallado, "Desglose Detallado por Jefe");

    const desviaciones = [];
    Object.values(reportParaExcel.manifiestos).forEach(man => {
        const contenedoresEnManifiesto = {};
        Object.entries(man.seccionesResumen).forEach(([nombreSeccion, seccion]) => {
            Object.entries(seccion.byContenedor).forEach(([nombreContenedor, dataContenedor]) => {
                if (!contenedoresEnManifiesto[nombreContenedor]) { contenedoresEnManifiesto[nombreContenedor] = { sap: 0, scan: 0, faltantes: 0, excedentes: 0, jefaturas: new Set() }; }
                const c = contenedoresEnManifiesto[nombreContenedor];
                c.sap += dataContenedor.sap; c.scan += dataContenedor.scan; c.faltantes += dataContenedor.faltantes; c.excedentes += dataContenedor.excedentes;
                if (seccion.jefatura && seccion.jefatura !== 'Sin Asignar') { c.jefaturas.add(seccion.jefatura); }
            });
        });
        Object.entries(contenedoresEnManifiesto).forEach(([contenedor, data]) => {
            let estado = 'COMPLETO', priority = 5;
            if (data.sap > 0 && data.scan === 0) { estado = 'NO ESCANEADO'; priority = 1; }
            else if (data.faltantes > 0 && data.excedentes > 0) { estado = 'MIXTO (FALTANTES Y EXCEDENTES)'; priority = 2; }
            else if (data.faltantes > 0) { estado = 'CON FALTANTES'; priority = 3; }
            else if (data.excedentes > 0) { estado = 'CON EXCEDENTES'; priority = 4; }
            desviaciones.push({ manifiesto: man.numero, contenedor, estado, sap: data.sap, scan: data.scan, faltantes: data.faltantes, excedentes: data.excedentes, jefaturas: Array.from(data.jefaturas).join(', '), priority });
        });
    });
    desviaciones.sort((a, b) => a.priority - b.priority || b.faltantes - a.faltantes);
    const desviacionesSheetData = desviaciones.map(d => [d.manifiesto, d.contenedor, { v: d.estado, s: d.estado === 'COMPLETO' ? styles.statusOk : d.estado === 'NO ESCANEADO' ? styles.statusCritico : d.estado.includes('FALTANTES') ? styles.statusAlerta : styles.statusInfo }, { t: 'n', v: d.sap, z: '#,##0' }, { t: 'n', v: d.scan, z: '#,##0' }, { t: 'n', v: d.faltantes, z: '#,##0', s: styles.cellRed }, { t: 'n', v: d.excedentes, z: '#,##0', s: styles.cellYellow }, d.jefaturas]);
    const wsDesviaciones = XLSX.utils.aoa_to_sheet([["Manifiesto", "Contenedor", "Estado", "Piezas SAP", "Piezas Escaneadas", "Faltantes", "Excedentes", "Jefatura(s) Responsable(s)"], ...desviacionesSheetData], { cellStyles: true });
    formatSheet(wsDesviaciones, [20, 25, 30, 15, 18, 15, 15, 40], desviaciones.length + 1, 8);
    XLSX.utils.book_append_sheet(wb, wsDesviaciones, "Reporte de Desviaciones");

    reportParaExcel.skusConExcedentes.sort((a, b) => b.excedente - a.excedente);
    const excedentesSheetData = reportParaExcel.skusConExcedentes.map(item => [item.jefatura, item.seccion, item.manifiesto.numero, item.contenedor, item.sku, item.desc, { t: 'n', v: item.excedente, z: '#,##0', s: styles.cellYellow }]);
    const wsExcedentes = XLSX.utils.aoa_to_sheet([["Jefatura", "Sección", "Manifiesto", "Contenedor", "SKU", "Descripción", "Cantidad Excedente"], ...excedentesSheetData], { cellStyles: true });
    formatSheet(wsExcedentes, [30, 30, 25, 25, 20, 45, 20], reportParaExcel.skusConExcedentes.length + 1, 7);
    XLSX.utils.book_append_sheet(wb, wsExcedentes, "Oportunidades (Excedentes)");

    const operadoresSorted = Object.entries(reportParaExcel.usuarios).sort(([, a], [, b]) => b.scans - a.scans);
    const totalScansOverall = Object.values(reportParaExcel.usuarios).reduce((sum, user) => sum + user.scans, 0);

    const operadoresSheetData = operadoresSorted.map(([email, data], index) => {
        const participationPercentage = totalScansOverall > 0 ? (data.scans / totalScansOverall) : 0;
        return [
            index + 1,
            email,
            { t: 'n', v: data.scans, z: '#,##0' },
            { t: 'n', v: participationPercentage, z: '0.00%' },
            data.manifests.size
        ];
    });
    const wsOperadores = XLSX.utils.aoa_to_sheet([["Ranking", "Operador", "Piezas Escaneadas", "Participación (%)", "Manifiestos Trabajados"], ...operadoresSheetData], { cellStyles: true });
    formatSheet(wsOperadores, [10, 40, 25, 20, 25], operadoresSorted.length + 1, 5);
    XLSX.utils.book_append_sheet(wb, wsOperadores, "Ranking Operadores");

    if (reportParaExcel.failedManifests && reportParaExcel.failedManifests.length > 0) {
        const erroresSheetData = reportParaExcel.failedManifests.map(error => [error.id || 'Desconocido', error.error || 'Sin detalle']);
        const wsErrores = XLSX.utils.aoa_to_sheet([["ID Manifiesto con Error", "Detalle del Error"], ...erroresSheetData]);
        formatSheet(wsErrores, [40, 80], reportParaExcel.failedManifests.length + 1, 2);
        XLSX.utils.book_append_sheet(wb, wsErrores, "Errores de Proceso");
    }

    XLSX.writeFile(wb, `Reporte_Ejecutivo_Rendimiento_${reportParaExcel.startDate}_a_${reportParaExcel.endDate}.xlsx`);
    Swal.close();
};
// ==============================================================================
// === Logic to check authentication and run summary on page load ===
// ==============================================================================
// Función para mostrar el detalle de faltantes de una sección en un modal.
window.mostrarDetalleFaltantes = (nombreJefe, nombreSeccion) => {
    const faltantesDeSeccion = report.skusSinEscanear.filter(item =>
        String(item.seccion || 'N/A').trim() === nombreSeccion && String(item.jefatura || 'N/A').trim() === nombreJefe
    );

    const seccionDataResumen = report.secciones[nombreSeccion] || {};
    const totalFaltantes = seccionDataResumen.faltantes || 0;
    const totalExcedentes = seccionDataResumen.excedentes || 0;

    if (faltantesDeSeccion.length === 0) {
        Swal.fire({
            icon: 'success',
            title: '¡Sin Faltantes!',
            text: `La sección ${nombreSeccion} (Jefatura: ${nombreJefe}) no tiene artículos faltantes en este periodo.`,
            confirmButtonText: '¡Excelente!',
        });
        return;
    }

    const faltantesAgrupados = {};
    faltantesDeSeccion.forEach(item => {
        const key = `${item.sku}-${item.manifiesto.numero}-${item.contenedor}`;
        if (!faltantesAgrupados[key]) {
            faltantesAgrupados[key] = { ...item };
        }
    });
    const itemsParaMostrar = Object.values(faltantesAgrupados).sort((a, b) => b.faltante - a.faltante);

    const renderItems = (items) => {
        if (items.length === 0) {
            return `<li class="faltantes-item-empty">No se encontraron artículos que coincidan con la búsqueda.</li>`;
        }
        return items.map(item => `
            <li class="faltantes-item">
                <div class="faltantes-item-header">
                    <span class="faltantes-item-sku">SKU: ${String(item.sku).trim()}</span>
                    <span class="faltantes-item-cantidad">Faltan: ${item.faltante}</span>
                </div>
                <div class="faltantes-item-body">
                    <p class="faltantes-item-desc">${String(item.desc || 'Sin descripción').trim()}</p>
                    <div class="faltantes-item-meta">
                        <span><i class="bi bi-file-earmark-text"></i> ${String(item.manifiesto.numero || 'N/A').trim()}</span>
                        <span><i class="bi bi-box-seam"></i> ${String(item.contenedor || 'N/A').trim()}</span>
                    </div>
                </div>
            </li>`).join('');
    };

    const modalHTML = `
        <style>
            .swal2-popup .swal2-html-container { margin: 0 !important; }
            .faltantes-container { text-align: left; padding: 0 1rem; }
            .faltantes-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
            .summary-card { padding: 1rem; border-radius: 0.75rem; text-align: center; }
            .summary-card.faltantes { background-color: #f8d7da; color: #721c24; }
            .summary-card.excedentes { background-color: #fff3cd; color: #856404; }
            .summary-card .label { font-weight: 600; display: block; font-size: 0.9rem; }
            .summary-card .value { font-weight: 700; font-size: 1.75rem; }
            .faltantes-search-wrapper { position: relative; margin-bottom: 1rem; }
            .faltantes-search-wrapper .bi-search { position: absolute; top: 50%; left: 1rem; transform: translateY(-50%); color: #6c757d; }
            #faltantes-search-input { width: 100%; padding: 0.75rem 1rem 0.75rem 2.5rem; border-radius: 2rem; border: 1px solid #ced4da; font-size: 1rem; }
            .faltantes-list { list-style: none; padding: 0; margin: 0; max-height: 45vh; overflow-y: auto; }
            .faltantes-item { background-color: #f8f9fa; border-radius: 0.5rem; padding: 1rem; margin-bottom: 0.75rem; border-left: 4px solid #dc3545; }
            .faltantes-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
            .faltantes-item-sku { font-weight: 600; color: var(--liverpool-dark); }
            .faltantes-item-cantidad { font-weight: 700; color: #dc3545; background-color: #f8d7da; padding: 0.2rem 0.5rem; border-radius: 0.25rem; }
            .faltantes-item-body .faltantes-item-desc { color: #495057; margin: 0 0 0.5rem 0; font-size: 0.9rem; }
            .faltantes-item-meta { display: flex; gap: 1rem; font-size: 0.85rem; color: #6c757d; }
            .faltantes-item-meta i { color: var(--liverpool-pink); }
            .faltantes-item-empty { text-align: center; padding: 2rem; color: #6c757d; }
        </style>
        <div class="faltantes-container">
            <div class="faltantes-summary">
                <div class="summary-card faltantes">
                    <span class="label">Total Faltantes</span>
                    <span class="value">${totalFaltantes.toLocaleString('es-MX')}</span>
                </div>
                <div class="summary-card excedentes">
                    <span class="label">Total Excedentes</span>
                    <span class="value">${totalExcedentes.toLocaleString('es-MX')}</span>
                </div>
            </div>
            <div class="faltantes-search-wrapper">
                <i class="bi bi-search"></i>
                <input type="text" id="faltantes-search-input" placeholder="Buscar por SKU, Manifiesto o Contenedor...">
            </div>
            <ul class="faltantes-list" id="faltantes-list-ul">${renderItems(itemsParaMostrar)}</ul>
        </div>`;

    Swal.fire({
        title: `<i class="bi bi-exclamation-triangle-fill text-danger me-2"></i>Reporte de Faltantes`,
        html: modalHTML,
        width: 'clamp(350px, 90vw, 700px)',
        confirmButtonText: 'Cerrar',
        footer: `<div class="text-center w-100"><strong>Sección:</strong> ${nombreSeccion} | <strong>Jefatura:</strong> ${nombreJefe}</div>`,
        didOpen: () => {
            const searchInput = document.getElementById('faltantes-search-input');
            const listUl = document.getElementById('faltantes-list-ul');
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase().trim();
                const filteredItems = itemsParaMostrar.filter(item =>
                    String(item.sku).toLowerCase().includes(searchTerm) ||
                    String(item.manifiesto.numero).toLowerCase().includes(searchTerm) ||
                    String(item.contenedor).toLowerCase().includes(searchTerm)
                );
                listUl.innerHTML = renderItems(filteredItems);
            });
            searchInput.focus();
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "../Login/login.html"; // Redirect if not authenticated
            return;
        }
        currentUser = user;
        try {
            const docSnap = await db.collection("usuarios").doc(user.uid).get();
            const isAdmin = user.uid === ADMIN_UID;

            if (isAdmin || (docSnap.exists && docSnap.data().status === "aprobado")) {
                const data = docSnap.data() || {};
                currentUserStore = isAdmin ? "ALL" : (data.store || "");
                currentUserRole = isAdmin ? "admin" : (data.role || "vendedor");

                // Start the summary generation process.
                await generarResumenSemanal();

                const logoutBtn = document.getElementById("logout-btn");
                if (logoutBtn) {
                    logoutBtn.addEventListener("click", () => {
                        auth.signOut().then(() => window.location.href = "../Login/login.html")
                            .catch(e => console.error(e));
                    });
                }
            } else {
                Swal.fire({
                    icon: 'info',
                    title: 'Acceso Denegado',
                    text: 'Tu cuenta no está aprobada. Contacta al administrador.'
                }).then(() => auth.signOut());
            }
        } catch (error) {
            console.error("Authentication error or error getting user data:", error);
            auth.signOut();
        }
    });
});