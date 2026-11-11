/* Control de acceso comun para todos los modulos. */
(function () {
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
