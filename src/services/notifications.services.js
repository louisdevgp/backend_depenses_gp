const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const { sendNotificationEmail } = require("./mailer.services");
const realtime = require("../realtime");

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

function mergeMeta(meta, extra) {
  if (!extra) return meta ?? null;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return { ...meta, ...extra };
  return { ...extra, ...(meta != null ? { _previousMeta: meta } : {}) };
}

function hasOwn(obj, key) {
  return obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Crée une notification en DB (canal email par défaut).
 * ✅ tx optionnel: si tu es dans une transaction, passe tx pour éviter les FK errors.
 * ✅ demande_id OU demande_uuid
 */
async function createNotification(
  {
    user_id,
    type,
    message,
    demande_id = null,
    demande_uuid = null,
    channel = "email",
    meta = null,
    sendEmailNow = false,
  },
  tx = null
) {
  if (!user_id) throw new Error("user_id requis");
  if (!type) throw new Error("type requis");
  if (!message) throw new Error("message requis");

  const client = tx || prisma;

  let demandeIdFinal = null;
  let demandeUuidResolved = null;

  // 1) demande_id (int)
  if (demande_id !== null && demande_id !== undefined && demande_id !== "") {
    if (!isNumericId(demande_id)) {
      // si quelqu’un a envoyé un uuid par erreur dans demande_id
      throw new Error("demande_id doit être un ID numérique (int). Utilise demande_uuid sinon.");
    }
    demandeIdFinal = Number(demande_id);
  }

  // 2) demande_uuid -> resolve en id
  if (!demandeIdFinal && demande_uuid) {
    const d = await client.demandes_paiement.findFirst({
      where: { uuid: String(demande_uuid), deleted_at: null },
      select: { id: true, uuid: true },
    });
    if (d?.id) {
      demandeIdFinal = d.id;
      demandeUuidResolved = d.uuid || String(demande_uuid);
    }
  }

  // 3) si on a un demandeIdFinal, on vérifie qu’il existe (évite FK violation)
  if (demandeIdFinal) {
    const exists = await client.demandes_paiement.findUnique({
      where: { id: Number(demandeIdFinal) },
      select: { id: true, uuid: true },
    });

    if (!exists) {
      // ✅ OPTION A: on ignore le lien demande (pas de FK) et on crée la notif quand même
      demandeIdFinal = null;

      // ❌ OPTION B (si tu préfères bloquer): dé-commente
      // const err = new Error("demande_id invalide: demande introuvable");
      // err.statusCode = 400;
      // throw err;
    }

    if (!demandeUuidResolved && exists?.uuid) {
      demandeUuidResolved = exists.uuid;
    }
  }

  // enrich meta with demandeUuid when possible (for email deep links)
  let metaFinal = meta;
  if (demandeUuidResolved) {
    const current = metaFinal && typeof metaFinal === "object" && !Array.isArray(metaFinal) ? metaFinal : {};
    if (!hasOwn(current, "demandeUuid")) {
      metaFinal = mergeMeta(current, { demandeUuid: demandeUuidResolved });
    }
  }

  const created = await client.notifications.create({
    data: {
      uuid: uuidv4(),
      user_id: Number(user_id),
      type,
      demande_id: demandeIdFinal ? Number(demandeIdFinal) : null,
      message,
      channel,
      meta: metaFinal,
      sent_by_email: false,
      sent_by_whatsapp: false,
    },
  });

  try {
    realtime.emitToUser(user_id, "notification:new", { notification: created });
    const typeLower = String(type || "").toLowerCase();
    if (typeLower === "validation_pending") {
      await realtime.emitPendingStatus(user_id);
    }
    if (
      ["paiement_pending", "paiement_effectue", "paiement_updated", "paiement_deleted"].includes(typeLower)
    ) {
      await realtime.emitPaiementPendingStatus(user_id);
    }
    if (
      [
        "reception_creee",
        "reception_updated",
        "reception_deleted",
        "reception_reminder",
        "reception_visa_pending",
        "reception_visa_directeur",
        "reception_visa_daf",
      ].includes(typeLower)
    ) {
      await realtime.emitReceptionPendingStatus(user_id);
    }
  } catch {
    // ignore realtime errors
  }

  // Best practice: do not send email inside a DB transaction callback.
  // If called with `tx`, we only persist the notification and mark it as queued.
  if (sendEmailNow && tx) {
    const queuedMeta = mergeMeta(created.meta, { emailQueued: true });
    return client.notifications.update({
      where: { id: created.id },
      data: { meta: queuedMeta },
    });
  }

  if (!sendEmailNow || String(channel).toLowerCase() !== "email") return created;

  try {
    const user = await prisma.users.findUnique({
      where: { id: Number(user_id) },
      select: { email: true },
    });

    if (!user?.email) return created;

    const mailRes = await sendNotificationEmail({
      to: user.email,
      type,
      message,
      meta: created.meta,
    });

    if (mailRes?.skipped) {
      try {
        await prisma.notifications.update({
          where: { id: created.id },
          data: { meta: mergeMeta(created.meta, { emailSkipped: String(mailRes.reason || "skipped") }) },
        });
      } catch {
        // ignore meta update errors
      }
      // eslint-disable-next-line no-console
      console.warn("[notifications] email skipped:", String(mailRes.reason || "skipped"));
      return created;
    }

    return prisma.notifications.update({
      where: { id: created.id },
      data: { sent_by_email: true, email_sent_at: new Date() },
    });
  } catch (err) {
    const errMsg = err?.message ? String(err.message) : "email_send_failed";
    // eslint-disable-next-line no-console
    console.warn("[notifications] email failed:", errMsg);
    try {
      await prisma.notifications.update({
        where: { id: created.id },
        data: { meta: mergeMeta(created.meta, { emailError: errMsg }) },
      });
    } catch {
      // ignore meta update errors
    }
    return created;
  }
}

async function listMyNotifications(userId, { unreadOnly } = {}) {
  const where = { user_id: Number(userId) };
  if (String(unreadOnly) === "1") where.read_at = null;

  return prisma.notifications.findMany({
    where,
    orderBy: { id: "desc" },
  });
}

async function markAsRead(userId, notifId) {
  const n = await prisma.notifications.findFirst({
    where: { id: Number(notifId), user_id: Number(userId) },
  });
  if (!n) throw new Error("Notification introuvable");

  const updated = await prisma.notifications.update({
    where: { id: n.id },
    data: { read_at: new Date() },
  });

  try {
    realtime.emitToUser(userId, "notification:read", { id: updated.id, read_at: updated.read_at });
  } catch {
    // ignore realtime errors
  }

  return updated;
}

module.exports = {
  createNotification,
  listMyNotifications,
  markAsRead,
};
