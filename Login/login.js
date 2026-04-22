"use strict";

document.addEventListener('DOMContentLoaded', () => {

    // ── Firebase ──────────────────────────────────────────────────────────────
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
    const db   = firebase.firestore();

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const googleSignInBtn     = document.getElementById('googleSignInBtn');
    const googleBtnText       = document.getElementById('googleBtnText');
    const helpBtn             = document.getElementById('helpBtn');
    const retryGoogleBtn      = document.getElementById('retryGoogleBtn');
    const roleSelect          = document.getElementById('roleSelect');
    const storeInput          = document.getElementById('storeInput');
    const bossSelectContainer = document.getElementById('bossSelectContainer');
    const bossSelect          = document.getElementById('bossSelect');
    const saveRegistrationBtn = document.getElementById('saveRegistrationBtn');

    const helpModal         = new bootstrap.Modal(document.getElementById('helpModal'));
    const registrationModal = new bootstrap.Modal(document.getElementById('registrationModal'));

    // ── State ─────────────────────────────────────────────────────────────────
    let isSigningIn  = false;
    let allBosses    = [];
    let pendingUser  = null; // user object waiting for registration

    // ── Swal defaults ─────────────────────────────────────────────────────────
    const swalBase = {
        background: 'rgba(18,18,40,0.97)',
        color: '#fff',
        confirmButtonColor: '#E6007E',
        customClass: { popup: 'rounded-4' }
    };

    // ── Auth state ────────────────────────────────────────────────────────────
    // Only redirect automatically if user is already signed in and approved.
    // New users are held here to complete registration.
    auth.onAuthStateChanged(async (user) => {
        if (!user) return;

        try {
            const userDoc = await db.collection('usuarios').doc(user.uid).get();

            if (!userDoc.exists) {
                // Brand new user — show registration modal
                pendingUser = user;
                await loadBosses();
                registrationModal.show();
                return;
            }

            const data = userDoc.data();

            if (data.status === 'aprobado') {
                // Already approved — go straight to app
                window.location.href = '../index.html';
                return;
            }

            if (data.status === 'pendiente') {
                // Registered but not yet approved
                await auth.signOut();
                Swal.fire({
                    ...swalBase,
                    icon: 'info',
                    title: 'Acceso Pendiente',
                    html: 'Tu solicitud está siendo revisada por un administrador.<br><br>Recibirás acceso cuando sea aprobada.',
                    confirmButtonText: 'Entendido'
                });
                return;
            }

            // Rejected or unknown status
            await auth.signOut();
            Swal.fire({
                ...swalBase,
                icon: 'error',
                title: 'Acceso Denegado',
                text: 'Tu cuenta no tiene acceso al sistema. Contacta a tu administrador.',
                confirmButtonText: 'Entendido'
            });

        } catch (err) {
            console.error('onAuthStateChanged error:', err);
            await auth.signOut();
            Swal.fire({
                ...swalBase,
                icon: 'error',
                title: 'Error de Conexión',
                text: 'No se pudo verificar tu cuenta. Verifica tu conexión e inténtalo de nuevo.',
                confirmButtonText: 'Reintentar'
            });
        }
    });

    // ── Google Sign-In ────────────────────────────────────────────────────────
    async function signInWithGoogle() {
        if (isSigningIn) return;
        isSigningIn = true;
        setGoogleBtnLoading(true);

        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        try {
            await auth.signInWithPopup(provider);
            // onAuthStateChanged handles everything from here
        } catch (err) {
            isSigningIn = false;
            setGoogleBtnLoading(false);

            if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
                return; // User dismissed — no error needed
            }
            if (err.code === 'auth/popup-blocked') {
                Swal.fire({
                    ...swalBase,
                    icon: 'warning',
                    title: 'Pop-up Bloqueado',
                    html: 'Tu navegador bloqueó la ventana de Google.<br>Permite pop-ups para este sitio en la barra de direcciones e inténtalo de nuevo.',
                    confirmButtonText: 'Entendido'
                });
                return;
            }
            console.error('signInWithPopup error:', err);
            Swal.fire({
                ...swalBase,
                icon: 'error',
                title: 'Error al Iniciar Sesión',
                text: 'No se pudo conectar con Google. Verifica tu conexión e inténtalo de nuevo.',
                confirmButtonText: 'Reintentar'
            });
        }
    }

    function setGoogleBtnLoading(loading) {
        if (loading) {
            googleSignInBtn.disabled = true;
            googleBtnText.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Conectando...';
        } else {
            googleSignInBtn.disabled = false;
            googleBtnText.textContent = 'Continuar con Google';
        }
    }

    // ── Load bosses for registration ──────────────────────────────────────────
    async function loadBosses() {
        bossSelect.innerHTML = '<option value="">— Cargando... —</option>';
        try {
            const snap = await db.collection('usuarios')
                .where('role', '==', 'jefe')
                .where('status', '==', 'aprobado')
                .get();

            allBosses = snap.docs.map(doc => {
                const d = doc.data();
                return { uid: doc.id, name: d.displayName || d.nombre || d.email };
            });

            if (allBosses.length === 0) {
                bossSelect.innerHTML = '<option value="">— No hay jefes registrados —</option>';
            } else {
                bossSelect.innerHTML = '<option value="">— Selecciona tu Jefe —</option>';
                allBosses.forEach(({ uid, name }) => {
                    const opt = document.createElement('option');
                    opt.value = uid;
                    opt.textContent = name;
                    bossSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('loadBosses error:', err);
            bossSelect.innerHTML = '<option value="">— Error al cargar —</option>';
        }
    }

    // ── Toggle boss selector ──────────────────────────────────────────────────
    roleSelect.addEventListener('change', () => {
        const needsBoss = ['vendedor', 'bodeguero'].includes(roleSelect.value);
        bossSelectContainer.style.display = needsBoss ? 'block' : 'none';
        if (!needsBoss) bossSelect.value = '';
    });

    // ── Save registration ─────────────────────────────────────────────────────
    saveRegistrationBtn.addEventListener('click', async () => {
        const user  = pendingUser || auth.currentUser;
        const role  = roleSelect.value.trim();
        const store = storeInput.value.trim();

        if (!role || !store) {
            Swal.fire({ ...swalBase, icon: 'warning', title: 'Campos Requeridos',
                text: 'Por favor selecciona tu rol e ingresa el número de tienda.' });
            return;
        }

        const needsBoss = ['vendedor', 'bodeguero'].includes(role);
        const jefeAsignado = needsBoss ? bossSelect.value : null;

        if (needsBoss && !jefeAsignado) {
            Swal.fire({ ...swalBase, icon: 'warning', title: 'Selecciona tu Jefe',
                text: 'Debes seleccionar al jefe de recibos que te supervisa.' });
            return;
        }

        if (!user) {
            Swal.fire({ ...swalBase, icon: 'error', title: 'Sesión Expirada',
                text: 'Tu sesión expiró. Por favor inicia sesión de nuevo.' });
            registrationModal.hide();
            return;
        }

        saveRegistrationBtn.disabled = true;
        saveRegistrationBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Enviando...';

        const isLiverpoolEmail = user.email.toLowerCase().endsWith('@liverpool.com.mx');
        const status = isLiverpoolEmail ? 'aprobado' : 'pendiente';

        try {
            await db.collection('usuarios').doc(user.uid).set({
                email:        user.email,
                displayName:  user.displayName || '',
                photoURL:     user.photoURL || '',
                role,
                store,
                jefeAsignado: jefeAsignado || null,
                status,
                createdAt:    firebase.firestore.FieldValue.serverTimestamp()
            });

            registrationModal.hide();

            if (isLiverpoolEmail) {
                // Correo corporativo — acceso inmediato
                Swal.fire({
                    ...swalBase,
                    icon: 'success',
                    title: '¡Bienvenido!',
                    html: 'Tu cuenta fue verificada automáticamente.<br>Serás redirigido al sistema.',
                    showConfirmButton: false,
                    timer: 2000,
                    timerProgressBar: true
                }).then(() => { window.location.href = '../index.html'; });
                return;
            }

            // Correo externo — queda pendiente
            await auth.signOut();

            Swal.fire({
                ...swalBase,
                icon: 'info',
                title: 'Solicitud Enviada',
                html: 'Tu perfil fue registrado.<br><br>Un administrador revisará tu solicitud. Una vez aprobado podrás iniciar sesión.',
                confirmButtonText: 'Entendido'
            });

        } catch (err) {
            console.error('saveRegistration error:', err);
            Swal.fire({ ...swalBase, icon: 'error', title: 'Error al Guardar',
                text: 'No se pudo guardar tu información. Inténtalo de nuevo.' });
        } finally {
            saveRegistrationBtn.disabled = false;
            saveRegistrationBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Enviar Solicitud';
        }
    });

    // ── Event listeners ───────────────────────────────────────────────────────
    googleSignInBtn.addEventListener('click', signInWithGoogle);

    helpBtn.addEventListener('click', () => helpModal.show());

    retryGoogleBtn.addEventListener('click', () => {
        helpModal.hide();
        setTimeout(signInWithGoogle, 400);
    });
});
