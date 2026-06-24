// api/check-reminders.js
//
// Función serverless para Vercel (plan Hobby gratuito, SIN tarjeta de crédito).
// GitHub Actions llama a esta URL cada minuto. Esta función:
//   1. Mira qué hora es ahora (zona horaria configurable abajo).
//   2. Busca en Firestore las tareas que empiezan justo ahora y tienen notify=true.
//   3. Manda un push real vía FCM a todos los tokens guardados en "fcmTokens".
//
// No usa Firebase Cloud Functions en ningún momento — solo usa el paquete
// "firebase-admin" como librería normal de Node, hablando directamente con
// Firestore y FCM por API. Eso es gratuito sin necesidad del plan Blaze.

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const TIMEZONE = "Atlantic/Canary";

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  // Las credenciales vienen de variables de entorno configuradas en Vercel
  // (Project Settings → Environment Variables). Ver GUIA_VERCEL.md.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

module.exports = async function handler(req, res) {
  // Protección: solo responde si la clave secreta coincide.
  const providedSecret = req.query.secret || req.headers["x-secret"];
  if (providedSecret !== process.env.REMINDER_SECRET) {
    res.status(403).send("Forbidden");
    return;
  }

  try {
    const app = getAdminApp();
    const db = getFirestore(app);
    const messaging = getMessaging(app);

    const now = new Date();

    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now); // ej. "09:00"

    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now); // ej. "2026-06-24"

    const snapshot = await db
      .collection("tasks")
      .where("date", "==", localDate)
      .where("start", "==", localTime)
      .where("notify", "==", true)
      .get();

    if (snapshot.empty) {
      res.status(200).send(`OK — sin tareas a las ${localTime} del ${localDate}`);
      return;
    }

    const tokensSnap = await db.collection("fcmTokens").get();
    const tokens = tokensSnap.docs.map((d) => d.id).filter(Boolean);

    if (tokens.length === 0) {
      res.status(200).send("OK — hay tareas pero no hay tokens FCM registrados");
      return;
    }

    let notified = 0;

    for (const docSnap of snapshot.docs) {
      const task = docSnap.data();
      if (task.notifiedAt) continue; // ya se notificó, evita duplicados

      const message = {
        notification: {
          title: task.title || "Tienes una tarea ahora",
          body: task.end
            ? `De ${task.start} a ${task.end}${task.description ? " — " + task.description : ""}`
            : (task.description || "Es la hora de empezar.")
        },
        data: {
          taskId: docSnap.id,
          date: task.date || ""
        },
        tokens
      };

      try {
        const response = await messaging.sendEachForMulticast(message);
        notified++;

        response.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error?.code || "";
            if (
              code === "messaging/invalid-registration-token" ||
              code === "messaging/registration-token-not-registered"
            ) {
              db.collection("fcmTokens").doc(tokens[i]).delete().catch(() => {});
            }
          }
        });

        await docSnap.ref.update({ notifiedAt: now.toISOString() });
      } catch (err) {
        console.error("Error enviando notificación:", err);
      }
    }

    res.status(200).send(`OK — ${notified} tarea(s) notificada(s) a las ${localTime}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + (err.message || String(err)));
  }
};
