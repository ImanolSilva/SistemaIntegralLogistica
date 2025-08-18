"use strict";

document.addEventListener('DOMContentLoaded', () => {

    // ========== CONFIGURACIÓN DE FIREBASE ==========
    // Asegúrate de que esta configuración coincida con tu proyecto 'sistemaintegrall'
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

    // Referencias a elementos del DOM
    const UIElements = {
        googleSignInBtn: document.getElementById('googleSignInBtn'),
        forgotPasswordModal: new bootstrap.Modal(document.getElementById('forgotPasswordModal')),
        forgotEmailInput: document.getElementById('forgotEmail'),
        sendResetEmailBtn: document.getElementById('sendResetEmailBtn'),
        registrationModal: new bootstrap.Modal(document.getElementById('registrationModal')),
        roleSelect: document.getElementById('roleSelect'),
        storeInput: document.getElementById('storeInput'),
        bossSelectContainer: document.getElementById('bossSelectContainer'),
        bossSelect: document.getElementById('bossSelect'),
        saveRegistrationBtn: document.getElementById('saveRegistrationBtn')
    };

    let allBosses = []; // Para almacenar la lista de jefes disponibles

    // ========== MANEJO DE AUTENTICACIÓN ==========
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            const userDocRef = db.collection('usuarios').doc(user.uid);
            const userDoc = await userDocRef.get();

            if (userDoc.exists) {
                // Usuario ya registrado, redirigir a la página principal
                window.location.href = '../index.html';
            } else {
                // Nuevo usuario, mostrar modal de registro
                await loadBossesForRegistration(); // Cargar jefes antes de mostrar el modal
                UIElements.registrationModal.show();
            }
        }
    });

    // ========== EVENT LISTENERS ==========
    if (UIElements.googleSignInBtn) {
        UIElements.googleSignInBtn.addEventListener('click', signInWithGoogle);
    }

    if (UIElements.sendResetEmailBtn) {
        UIElements.sendResetEmailBtn.addEventListener('click', sendPasswordReset);
    }

    if (UIElements.saveRegistrationBtn) {
        UIElements.saveRegistrationBtn.addEventListener('click', saveRegistrationData);
    }

    if (UIElements.roleSelect) {
        UIElements.roleSelect.addEventListener('change', toggleBossSelectVisibility);
    }

    // ========== FUNCIONES DE AUTENTICACIÓN Y REGISTRO ==========

    async function signInWithGoogle() {
        Swal.fire({
            title: 'Iniciando sesión...',
            text: 'Conectando con Google.',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            },
            customClass: {
                popup: 'animate__animated animate__fadeInDown'
            }
        });

        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
            Swal.close(); // Cerrar el SweetAlert de "Iniciando sesión..."
            // onAuthStateChanged manejará la redirección o el modal de registro
        } catch (error) {
            Swal.close(); // Asegurarse de cerrar si hay un error
            console.error("Error al iniciar sesión con Google:", error);
            Swal.fire({
                icon: 'error',
                title: '¡Error de Autenticación!',
                html: 'No se pudo iniciar sesión con Google. <br>Por favor, verifica tu conexión a internet e inténtalo de nuevo.',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
        }
    }

    async function sendPasswordReset() {
        const email = UIElements.forgotEmailInput.value.trim();
        if (!email) {
            Swal.fire({
                icon: 'warning',
                title: 'Correo Requerido',
                text: 'Por favor, ingresa tu dirección de correo electrónico.',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
            return;
        }

        Swal.fire({
            title: 'Enviando correo...',
            text: 'Un momento por favor.',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            },
            customClass: {
                popup: 'animate__animated animate__fadeInDown'
            }
        });

        try {
            await auth.sendPasswordResetEmail(email);
            UIElements.forgotPasswordModal.hide();
            Swal.fire({
                icon: 'success',
                title: '¡Correo Enviado!',
                html: 'Se ha enviado un enlace para restablecer tu contraseña a <strong>' + email + '</strong>.<br>Por favor, revisa tu bandeja de entrada y la carpeta de spam.',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__bounceIn'
                }
            });
        } catch (error) {
            Swal.close();
            console.error("Error al enviar correo de restablecimiento:", error);
            Swal.fire({
                icon: 'error',
                title: 'Error al Enviar Correo',
                text: 'No se pudo enviar el correo de restablecimiento. Asegúrate de que la dirección sea válida y exista.',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
        }
    }

    async function loadBossesForRegistration() {
        try {
            const snapshot = await db.collection("usuarios").where("role", "==", "jefe").get();
            allBosses = snapshot.docs.map(doc => {
                const data = doc.data();
                const bossName = data.displayName || data.name || data.nombre || data.email;
                return { uid: doc.id, name: bossName };
            });

            UIElements.bossSelect.innerHTML = '<option value="">-- Selecciona a tu Jefe --</option>';
            allBosses.forEach(boss => {
                const option = document.createElement('option');
                option.value = boss.uid;
                option.textContent = boss.name;
                UIElements.bossSelect.appendChild(option);
            });
        } catch (error) {
            console.error("Error al cargar jefes para registro:", error);
            UIElements.bossSelect.innerHTML = '<option value="">-- Error al cargar jefes --</option>';
            Swal.fire({
                icon: 'error',
                title: 'Error de Carga',
                html: 'No se pudo cargar la lista de jefes. <br>Por favor, inténtalo de nuevo más tarde o contacta a soporte.',
                confirmButtonText: 'Reintentar',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    loadBossesForRegistration(); // Intentar cargar de nuevo
                }
            });
        }
    }

    function toggleBossSelectVisibility() {
        const selectedRole = UIElements.roleSelect.value;
        if (selectedRole === 'vendedor' || selectedRole === 'bodeguero') {
            UIElements.bossSelectContainer.style.display = 'block';
        } else {
            UIElements.bossSelectContainer.style.display = 'none';
            UIElements.bossSelect.value = ''; // Limpiar selección si se oculta
        }
    }

    async function saveRegistrationData() {
        const user = auth.currentUser;
        if (!user) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'No hay usuario autenticado. Intenta iniciar sesión de nuevo.',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
            return;
        }

        const role = UIElements.roleSelect.value;
        const store = UIElements.storeInput.value.trim();
        let jefeAsignado = null;

        if (role === 'vendedor' || role === 'bodeguero') {
            jefeAsignado = UIElements.bossSelect.value;
            if (!jefeAsignado) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Campo Requerido',
                    text: 'Por favor, selecciona a tu jefe.',
                    confirmButtonColor: '#E6007E',
                    customClass: {
                        popup: 'animate__animated animate__shakeX'
                    }
                });
                return;
            }
        }

        if (!role || !store) {
            Swal.fire({
                icon: 'warning',
                title: 'Campos Requeridos',
                text: 'Por favor, selecciona tu rol e ingresa el número de tienda.',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
            return;
        }

        Swal.fire({
            title: 'Guardando...',
            html: '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Cargando...</span></div><p class="mt-3">Estamos registrando tu información. Por favor, espera.</p>',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            },
            customClass: {
                popup: 'animate__animated animate__fadeInDown'
            }
        });

        try {
            await db.collection('usuarios').doc(user.uid).set({
                email: user.email,
                displayName: user.displayName,
                role: role,
                store: store,
                jefeAsignado: jefeAsignado,
                status: 'pendiente', // Estado inicial
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            Swal.fire({
                icon: 'success',
                title: '¡Registro Completo!',
                html: 'Tu perfil ha sido guardado. Un administrador revisará tu solicitud de acceso. <br>Serás redirigido a la página principal.',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
                customClass: {
                    popup: 'animate__animated animate__bounceIn'
                }
            }).then(() => {
                window.location.href = '../index.html';
            });

        } catch (error) {
            console.error("Error al guardar datos de registro:", error);
            Swal.fire({
                icon: 'error',
                title: 'Error al Registrar',
                text: 'No se pudo completar tu registro. Inténtalo de nuevo o contacta a soporte.',
                confirmButtonColor: '#E6007E',
                customClass: {
                    popup: 'animate__animated animate__shakeX'
                }
            });
        }
    }
});