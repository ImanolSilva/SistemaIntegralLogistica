/* Control de acceso comun para todos los modulos. */
(function () {
    const SPECIAL_EMAILS = [
        'fernandosilva130501@gmail.com',
        'imailin14022002@gmail.com'
    ];

    window.isAllowedSystemEmail = function (email) {
        const normalized = String(email || '').trim().toLowerCase();
        return normalized.endsWith('@liverpool.com.mx') || SPECIAL_EMAILS.includes(normalized);
    };

    window.SYSTEM_SPECIAL_EMAILS = SPECIAL_EMAILS.slice();

    window.isSystemAdmin = async function (user, db) {
        if (!user || !db) return false;
        if (user.getIdTokenResult) {
            const token = await user.getIdTokenResult();
            if (token.claims && token.claims.admin === true) return true;
        }
        const doc = await db.collection('admins').doc(user.uid).get();
        return doc.exists;
    };
})();
