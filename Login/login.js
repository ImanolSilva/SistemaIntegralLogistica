"use strict";

document.addEventListener('DOMContentLoaded', () => {
    const firebaseConfig = {
        apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
        authDomain: "sistemaintegrall.firebaseapp.com",
        projectId: "sistemaintegrall",
        storageBucket: "sistemaintegrall.firebasestorage.app",
        messagingSenderId: "302291844621",
        appId: "1:302291844621:web:6ebf1845790bdeabfc1f44",
        measurementId: "G-E5BT7GXRZN"
    };
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleBtnText = document.getElementById('googleBtnText');
    const helpBtn = document.getElementById('helpBtn');
    const retryGoogleBtn = document.getElementById('retryGoogleBtn');
    const roleSelect = document.getElementById('roleSelect');
    const storeInput = document.getElementById('storeInput');
    const bossSelectContainer = document.getElementById('bossSelectContainer');
    const bossSelect = document.getElementById('bossSelect');
    const saveRegistrationBtn = document.getElementById('saveRegistrationBtn');
    const helpModal = new bootstrap.Modal(document.getElementById('helpModal'));
    const registrationModal = new bootstrap.Modal(document.getElementById('registrationModal'));
    let isSigningIn = false;
    let allBosses = [];
    let pendingUser = null;
    const swalBase = { background: 'rgba(18,18,40,0.97)', color: '#fff', confirmButtonColor: '#E6007E', customClass: { popup: 'rounded-4' } };
    const allowed = email => typeof window.isAllowedSystemEmail === 'function' && window.isAllowedSystemEmail(email);

    auth.onAuthStateChanged(async user => {
        if (!user) return;
        try {
            if (!allowed(user.email)) {
                await auth.signOut();
                Swal.fire({ ...swalBase, icon: 'warning', title: 'Cuenta no autorizada', text: 'Usa tu cuenta corporativa @liverpool.com.mx para entrar al sistema.', confirmButtonText: 'Entendido' });
                return;
            }
            const userRef = db.collection('usuarios').doc(user.uid);
            const userDoc = await userRef.get();
            if (!userDoc.exists) {
                pendingUser = user;
                await loadBosses();
                registrationModal.show();
                return;
            }
            const data = userDoc.data() || {};
            if (data.status !== 'aprobado') await userRef.set({ status: 'aprobado', accessUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            window.location.href = '../index.html';
        } catch (err) {
            console.error('onAuthStateChanged error:', err);
            await auth.signOut();
            Swal.fire({ ...swalBase, icon: 'error', title: 'No se pudo verificar la cuenta', text: 'Verifica tu conexion e intentalo de nuevo.', confirmButtonText: 'Reintentar' });
        }
    });

    async function signInWithGoogle() {
        if (isSigningIn) return;
        isSigningIn = true;
        setGoogleBtnLoading(true);
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try { await auth.signInWithPopup(provider); }
        catch (err) {
            isSigningIn = false;
            setGoogleBtnLoading(false);
            if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
            Swal.fire({ ...swalBase, icon: err.code === 'auth/popup-blocked' ? 'warning' : 'error', title: err.code === 'auth/popup-blocked' ? 'Pop-up bloqueado' : 'Error al iniciar sesion', text: err.code === 'auth/popup-blocked' ? 'Permite pop-ups para este sitio e intentalo de nuevo.' : 'No se pudo conectar con Google.', confirmButtonText: 'Entendido' });
        }
    }

    function setGoogleBtnLoading(loading) {
        googleSignInBtn.disabled = loading;
        googleBtnText.innerHTML = loading ? '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Conectando...' : 'Continuar con Google';
    }

    async function loadBosses() {
        bossSelect.innerHTML = '<option value="">Cargando...</option>';
        try {
            const snap = await db.collection('usuarios').where('role', '==', 'jefe').where('status', '==', 'aprobado').get();
            allBosses = snap.docs.map(doc => { const d = doc.data(); return { uid: doc.id, name: d.displayName || d.nombre || d.email }; });
            bossSelect.innerHTML = allBosses.length ? '<option value="">Selecciona tu jefe</option>' + allBosses.map(b => `<option value="${b.uid}">${b.name}</option>`).join('') : '<option value="">No hay jefes registrados</option>';
        } catch (err) { console.error('loadBosses error:', err); bossSelect.innerHTML = '<option value="">No se pudo cargar</option>'; }
    }

    roleSelect.addEventListener('change', () => {
        const needsBoss = ['vendedor', 'bodeguero'].includes(roleSelect.value);
        bossSelectContainer.style.display = needsBoss ? 'block' : 'none';
        if (!needsBoss) bossSelect.value = '';
    });

    saveRegistrationBtn.addEventListener('click', async () => {
        const user = pendingUser || auth.currentUser;
        const role = roleSelect.value.trim();
        const store = storeInput.value.trim();
        if (!role || !store) return Swal.fire({ ...swalBase, icon: 'warning', title: 'Completa tu perfil', text: 'Selecciona tu rol e indica tu numero de tienda.' });
        if (!user || !allowed(user.email)) return Swal.fire({ ...swalBase, icon: 'error', title: 'Sesion no autorizada', text: 'Usa una cuenta corporativa autorizada.' });
        const needsBoss = ['vendedor', 'bodeguero'].includes(role);
        const jefeAsignado = needsBoss ? bossSelect.value : null;
        if (needsBoss && !jefeAsignado) return Swal.fire({ ...swalBase, icon: 'warning', title: 'Selecciona tu jefe', text: 'Este rol requiere una jefatura.' });
        saveRegistrationBtn.disabled = true;
        saveRegistrationBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Activando...';
        try {
            await db.collection('usuarios').doc(user.uid).set({ email: user.email, displayName: user.displayName || '', photoURL: user.photoURL || '', role, store, jefeAsignado: jefeAsignado || null, status: 'aprobado', accessUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(), createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            registrationModal.hide();
            Swal.fire({ ...swalBase, icon: 'success', title: 'Acceso activado', text: 'Tu perfil quedo listo.', showConfirmButton: false, timer: 1400 }).then(() => { window.location.href = '../index.html'; });
        } catch (err) {
            console.error('saveRegistration error:', err);
            Swal.fire({ ...swalBase, icon: 'error', title: 'No se pudo guardar', text: 'Revisa tu conexion e intentalo de nuevo.' });
        } finally {
            saveRegistrationBtn.disabled = false;
            saveRegistrationBtn.innerHTML = '<i class="fas fa-check-circle me-2"></i>Activar mi acceso';
        }
    });

    googleSignInBtn.addEventListener('click', signInWithGoogle);
    helpBtn.addEventListener('click', () => helpModal.show());
    retryGoogleBtn.addEventListener('click', () => { helpModal.hide(); setTimeout(signInWithGoogle, 400); });
});
