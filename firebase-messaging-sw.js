// firebase-messaging-sw.js
// Este archivo debe estar en la RAÍZ del sitio (mismo nivel que index.html),
// nunca dentro de una subcarpeta, o el navegador no podrá registrar su scope
// correctamente para recibir notificaciones en segundo plano.

importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

// Debe coincidir EXACTAMENTE con el firebaseConfig de index.html
firebase.initializeApp({
  apiKey: "AIzaSyDspWfT37vtvjSaQWVUT_hjE9alL2iDyT4",
  authDomain: "nos-9c448.firebaseapp.com",
  projectId: "nos-9c448",
  storageBucket: "nos-9c448.firebasestorage.app",
  messagingSenderId: "588123283452",
  appId: "1:588123283452:web:5368f0beb255a1864f1c79"
});

const messaging = firebase.messaging();

// Se dispara cuando llega un push y la pestaña NO está en primer plano
// (app cerrada, en otra pestaña, móvil bloqueado, etc.)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Project NOS';
  const options = {
    body: payload.notification?.body || '',
    icon: '/Images/ds.png',
    badge: '/Images/ds.png',
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

// Si el usuario toca la notificación, abrimos/enfocamos la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
