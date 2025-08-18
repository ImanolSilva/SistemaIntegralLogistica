// firebase-messaging-sw.js
// Importa y configura el SDK de Firebase.
// Es importante que estas rutas sean correctas para tu proyecto.
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

// Tu misma configuración de Firebase (DEBE SER LA MISMA QUE EN TU index.html)
const firebaseConfig = {
    apiKey: "AIzaSyA_4H46I7TCVLnFjet8fQPZ006latm-mRE",
    authDomain: "loginliverpool.firebaseapp.com",
    projectId: "loginliverpool",
    storageBucket: "loginliverpool.appspot.com",
    messagingSenderId: "704223815941",
    appId: "1:704223815941:web:c871525230fb61caf96f6c",
    measurementId: "G-QFEPQ4TSPY"
};

// Inicializa Firebase si no ha sido inicializado ya.
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Lógica para manejar mensajes de notificación cuando la aplicación NO está en primer plano.
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Mensaje recibido en segundo plano:', payload);

    const notificationTitle = payload.notification.title || 'Nueva Actualización del Sistema';
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/images/firebase-logo.png', // <--- IMPORTANTE: Asegúrate de tener un ícono en esta ruta (ej. Sistema Integral de Gestión Liverpool/images/firebase-logo.png)
        data: payload.data // Datos adicionales que puedes enviar con la notificación
    };

    // Muestra la notificación al usuario
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Opcional: Manejar el clic en la notificación (cuando el usuario hace clic en la notificación del sistema)
self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // Cierra la notificación

    // Abre una nueva ventana o pestaña cuando se hace clic en la notificación.
    // Puedes personalizar la URL a la que redirigir según los datos de la notificación.
    const urlToOpen = event.notification.data?.url || '/index.html'; // Redirige a la URL especificada o a la página de inicio.
    event.waitUntil(clients.openWindow(urlToOpen));
});