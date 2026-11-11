/* Control de acceso comun para todos los modulos. */
(function () {
    const SPECIAL_EMAILS = [
        'fernandosilva130501@gmail.com',
        'imailin14022002@gmail.com',
        'mireyesb@liverpool.com.mx',
        'agavila@liverpool.com.mx'
    ];

    window.isAllowedSystemEmail = function (email) {
        const normalized = String(email || '').trim().toLowerCase();
        return normalized.endsWith('@liverpool.com.mx') || SPECIAL_EMAILS.includes(normalized);
    };

    window.SYSTEM_SPECIAL_EMAILS = SPECIAL_EMAILS.slice();

    window.isSystemAdmin = async function (user, db) {
        if (!user || !db) return false;
        return SPECIAL_EMAILS.includes(String(user.email || '').trim().toLowerCase());
    };
})();
