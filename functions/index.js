const functions = require('firebase-functions');
const admin = require('firebase-admin');
const XLSX = require('xlsx'); // Asegúrate de tener esta librería instalada en tu carpeta 'functions'

admin.initializeApp();

// Configura el bucket de Storage (asegúrate de que este sea tu bucket real)
const bucketName = 'loginliverpool.appspot.com'; // Este es tu bucket de Storage por defecto
const storage = admin.storage();

// !!! CONFIGURACIÓN PARA LA FUNCIÓN getJefeBodega !!!
// RUTA Y NOMBRE DEL ARCHIVO EXCEL DE BODEGAS EN STORAGE
// Ajusta esto para que coincida exactamente con tu archivo en Firebase Storage
const EXCEL_FILE_PATH_BODEGAS = 'BodegasRelacion/RelacionBodegas.xlsx'; 
// NOMBRE DE LA HOJA DENTRO DE TU ARCHIVO EXCEL DE BODEGAS
const EXCEL_SHEET_NAME_BODEGAS = 'Bodegas'; // Por ejemplo, 'Hoja1', 'Relacion', 'MaestroBodegas', etc.
// NOMBRE EXACTO DE LA COLUMNA CON EL CÓDIGO DE BODEGA EN TU EXCEL
const BODEGA_COLUMN_NAME_EXCEL = 'Bodega'; // Por ejemplo, 'CodigoBodega', 'ID_Bodega'
// NOMBRE EXACTO DE LA COLUMNA CON EL EMAIL DEL JEFE EN TU EXCEL
const JEFATURA_COLUMN_NAME_EXCEL = 'Jefatura'; // Por ejemplo, 'EmailJefe', 'Responsable'

// =======================================================================
// TU FUNCIÓN EXISTENTE: getUserByEmail
// =======================================================================
exports.getUserByEmail = functions.https.onCall(async (data, context) => {
    // Verificar que el usuario que llama esté autenticado
    if (!context.auth) {
        throw new new functions.https.HttpsError('unauthenticated', 'El usuario debe estar autenticado.');
    }

    // Verificar que el usuario que llama sea admin
    // NOTA: Si 'admins' es una colección en Firestore, asegúrate de que el UID del admin esté como ID de documento.
    // Si tus admins tienen un campo 'role: admin' en la colección 'users' (como hemos manejado los roles 'user' y 'jefe'),
    // la verificación sería diferente. Aquí asumo que tienes una colección 'admins' con UIDs.
    const requester = await admin.firestore().collection('admins').doc(context.auth.uid).get();
    if (!requester.exists) {
        throw new functions.https.HttpsError('permission-denied', 'No tienes permisos para realizar esta acción.');
    }

    const email = data.email;
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Email no proporcionado.');
    }

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        return { uid: userRecord.uid, email: userRecord.email };
    } catch (error) {
        console.error('Error al obtener el usuario por email:', error);
        throw new functions.https.HttpsError('not-found', 'Usuario no encontrado.');
    }
});

// =======================================================================
// NUEVA FUNCIÓN: getJefeBodega (para leer el Excel de bodegas)
// =======================================================================
exports.getJefeBodega = functions.https.onCall(async (data, context) => {
    // 1. Autenticación: Solo usuarios autenticados pueden llamar a esta función
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'La función requiere autenticación.');
    }

    const bodegaCode = data.bodegaCode; // El código de bodega enviado desde el cliente

    if (!bodegaCode) {
        throw new functions.https.HttpsError('invalid-argument', 'El código de bodega es requerido.');
    }

    try {
        // 2. Descargar el archivo Excel desde Firebase Storage
        const file = storage.bucket(bucketName).file(EXCEL_FILE_PATH_BODEGAS);
        const [fileBuffer] = await file.download();

        // 3. Parsear el archivo Excel
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[EXCEL_SHEET_NAME_BODEGAS];

        if (!sheet) {
            throw new functions.https.HttpsError('not-found', `La hoja '${EXCEL_SHEET_NAME_BODEGAS}' no fue encontrada en el archivo Excel de bodegas.`);
        }

        const jsonData = XLSX.utils.sheet_to_json(sheet);

        // 4. Buscar el código de bodega y extraer el jefe
        const foundBodega = jsonData.find(row => {
            // Asegúrate de que el nombre de la columna coincida exactamente con tu Excel
            return row[BODEGA_COLUMN_NAME_EXCEL] && String(row[BODEGA_COLUMN_NAME_EXCEL]).trim().toUpperCase() === bodegaCode.trim().toUpperCase();
        });

        if (foundBodega) {
            const jefaturaEmail = foundBodega[JEFATURA_COLUMN_NAME_EXCEL];
            if (jefaturaEmail) {
                return {
                    success: true,
                    bodegaExists: true,
                    jefatura_email: String(jefaturaEmail).trim()
                };
            } else {
                throw new functions.https.HttpsError('not-found', `No se encontró el email de jefatura para la bodega ${bodegaCode} en el Excel.`);
            }
        } else {
            return {
                success: false,
                bodegaExists: false,
                message: `El código de bodega '${bodegaCode}' no fue encontrado en el archivo Excel de bodegas.`
            };
        }

    } catch (error) {
        console.error("Error en Cloud Function getJefeBodega:", error);
        // Manejo específico para errores de Firebase Storage, etc.
        if (error.code === 'storage/object-not-found') {
             throw new functions.https.HttpsError('not-found', 'El archivo de relación de bodegas no fue encontrado en Storage. Verifica la ruta.', error.message);
        }
        if (error instanceof functions.https.HttpsError) {
            throw error; // Re-lanza errores HttpsError ya definidos
        }
        throw new functions.https.HttpsError('internal', 'Ocurrió un error interno al procesar la solicitud de bodega.', error.message);
    }
});