"use strict";

// =================================================================
// ARCHIVO: configuracion.js
// LÓGICA PARA LA PÁGINA DE CONFIGURACIÓN DE USUARIO
// =================================================================

// ========== CONFIGURACIÓN DE FIREBASE ==========
const firebaseConfig = {
    apiKey: "AIzaSyA_4H46I7TCVLnFjet8fQPZ006latm-mRE",
    authDomain: "loginliverpool.firebaseapp.com",
    projectId: "loginliverpool",
    storageBucket: "loginliverpool.appspot.com",
    messagingSenderId: "704223815941",
    appId: "1:704223815941:web:c871525230fb61caf96f6c",
    measurementId: "G-QFEPQ4TSPY"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();


// ========== MANEJO DE AUTENTICACIÓN ==========

/**
 * Se ejecuta cuando cambia el estado de autenticación.
 * @param {firebase.User} user - El objeto de usuario de Firebase, o null si no está logueado.
 */
function handleAuthStateChange(user) {
    if (user) {
        // Si el usuario está logueado, muestra su información.
        displayUserInfo(user);
    } else {
        // Si no hay usuario, muestra un error y redirige a la página de login.
        Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            text: 'Debes iniciar sesión para ver esta página.',
            confirmButtonText: 'Ir a Login'
        }).then(() => {
            window.location.href = "../Login/login.html";
        });
    }
}

/**
 * Muestra la información del usuario en las tarjetas de la página.
 * @param {firebase.User} user - El objeto del usuario autenticado.
 */
function displayUserInfo(user) {
    const container = document.getElementById('user-info-cards');
    if (!container) return;

    // Genera el HTML para las tarjetas con la información del usuario.
    container.innerHTML = `
        <div class="info-card" data-aos="fade-up" data-aos-delay="100">
            <i class="bi bi-person-fill"></i>
            <div>
                <span class="info-label">Nombre</span>
                <span class="info-value">${user.displayName || "No especificado"}</span>
            </div>
        </div>
        <div class="info-card" data-aos="fade-up" data-aos-delay="200">
            <i class="bi bi-envelope-fill"></i>
            <div>
                <span class="info-label">Email</span>
                <span class="info-value">${user.email}</span>
            </div>
        </div>
        <div class="info-card" data-aos="fade-up" data-aos-delay="300">
            <i class="bi bi-key-fill"></i>
            <div>
                <span class="info-label">ID de Usuario</span>
                <span class="info-value">${user.uid}</span>
            </div>
        </div>
    `;
    
    // Refrescar AOS para que las animaciones de las nuevas tarjetas se activen
    AOS.refresh();
}

/**
 * Cierra la sesión del usuario y lo redirige.
 */
function logout() {
    auth.signOut().then(() => {
        window.location.href = "../Login/login.html";
    }).catch(error => {
        console.error("Error al cerrar sesión:", error);
        Swal.fire('Error', 'No se pudo cerrar la sesión.', 'error');
    });
}

// ========== INICIALIZACIÓN DE EVENTOS ==========

document.addEventListener('DOMContentLoaded', () => {
    // Iniciar la librería de animaciones
    AOS.init();

    // Escuchar cambios en la autenticación para saber si hay un usuario logueado
    auth.onAuthStateChanged(handleAuthStateChange);

    // Asignar el evento al botón de logout
    const logoutButton = document.getElementById('logout-btn');
    if (logoutButton) {
        logoutButton.addEventListener('click', logout);
    }
});