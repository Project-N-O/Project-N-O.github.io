const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const TIMEZONE = "Atlantic/Canary";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
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
  const providedSecret = req.query.secret || req.headers["x-secret"];
  if (providedSecret !== process.env.REMINDER_SECRET) {
    return res.status(403).send("Forbidden");
  }

  try {
    const app = getAdminApp();
    const db = getFirestore(app);
    const messaging = getMessaging(app);

    const now = new Date();

    // Formateadores manuales más seguros que evitan fallos de entorno en Node
    const localTime = now.toLocaleTimeString("es-ES", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });
    const localDate = now.toLocaleDateString("sv-SE", { timeZone: TIMEZONE }); // sv-SE siempre devuelve YYYY-MM-DD

    // CAMBIO: Buscamos tareas de HOY, que ya debieron empezar (<= localTime) y NO notificadas
    const snapshot = await db
      .collection("tasks")
      .where("date", "==", localDate)
      .where("start", "<=", localTime) 
      .where("notify", "==", true)
      .get();

    // Filtrar manualmente en memoria las que ya tienen notifiedAt (Firestore no permite múltiples desigualdades fácilmente)
    const tareasPendientes = snapshot.docs.filter(doc => !doc.data().notifiedAt);

    if (tareasPendientes.length === 0) {
      return res.status(200).send(`OK — Sin tareas pendientes de notificar para las ${localTime}`);
    }

    // Traer tokens
    const tokensSnap = await db.collection("fcmTokens").get();
    const tokens = tokensSnap.docs.map((d) => d.id).filter(Boolean);

    if (tokens.length === 0) {
      return res.status(200).send("OK — Hay tareas pero no hay tokens registrados");
    }

    let notified = 0;

    for (const docSnap of tareasPendientes) {
      const task = docSnap.data();

      // NOTA: Idealmente aquí deberías filtrar los `tokens` para enviar SOLO al dueño de la tarea.
      // Si mandas multicast a todos, este objeto message es correcto:
      const message = {
        notification: {
          title: task.title || "Recordatorio de tarea",
          body: task.description || `Hora de inicio: ${task.start}`
        },
        data: {
          taskId: docSnap.id,
          date: task.date || ""
        },
        tokens: tokens 
      };

      try {
        const response = await messaging.sendEachForMulticast(message);
        notified++;

        // Limpieza de tokens inválidos
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

        // Marcar inmediatamente como notificado para que el próximo Cron no la duplique
        await docSnap.ref.update({ notifiedAt: now.toISOString() });
      } catch (err) {
        console.error("Error enviando notificación individual:", err);
      }
    }

    res.status(200).send(`OK — ${notified} tarea(s) procesada(s)`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + (err.message || String(err)));
  }
};
