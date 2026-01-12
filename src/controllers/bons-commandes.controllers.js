const bonCommandesService = require("../services/bons-commandes.services");
const prisma = require("../config/prisma"); // adapte selon ton projet
const pdfService = require("../services/pdf.services");
const notifications = require("../services/notifications.services");

async function notifyDemandeurForBcEvent({ demandeId, type, message, meta = {}, excludeUserId = null }) {
  if (!demandeId) return;
  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      id: true,
      uuid: true,
      agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } },
    },
  });
  const demandeurUserId = demande?.agents_demandes_paiement_demandeur_idToagents?.users?.id;
  if (!demandeurUserId) return;
  if (excludeUserId && Number(demandeurUserId) === Number(excludeUserId)) return;

  await notifications.createNotification({
    user_id: demandeurUserId,
    type,
    demande_id: Number(demandeId),
    message,
    meta: { ...meta, demandeUuid: demande?.uuid },
    sendEmailNow: true,
  });
}

exports.create = async (req, res) => {
  try {
    // req.user vient de ton auth.middleware (payload jwt)
    // il nous faut l'agent_id -> soit tu le mets dans le token, soit tu le retrouves via user_id
    // ici je suppose que tu as req.user.userId et qu'un user a 1 agent principal.
    const userId = req.user.userId;

    const agent = await prisma.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      select: { id: true, roles: { select: { name: true } } },
    });
    if (!agent) return res.status(400).json({ success: false, message: "Agent introuvable pour ce user" });

    const bc = await bonCommandesService.createBonCommande(prisma, req.body, {
      id: agent.id,
      roleName: agent?.roles?.name || null,
    });

    // Notifications after commit (emails non-bloquants)
    try {
      const actorUserId = req.user?.userId ? Number(req.user.userId) : null;
      await notifyDemandeurForBcEvent({
        demandeId: bc?.demande_id,
        type: "bc_created",
        message: `Un bon de commande a été créé (${bc?.numero || "-"}).`,
        meta: { bonCommandeId: bc?.id, bonCommandeUuid: bc?.uuid, numero: bc?.numero },
        excludeUserId: actorUserId,
      });
    } catch {
      // ignore
    }

    return res.status(201).json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const data = await bonCommandesService.listBonCommandes(prisma, req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const bc = await bonCommandesService.getBonCommandeById(prisma, req.params.id);
    if (!bc) return res.status(404).json({ success: false, message: "Bon de commande introuvable" });
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getByUuid = async (req, res) => {
  try {
    const bc = await bonCommandesService.getBonCommandeByUuid(prisma, req.params.uuid);
    if (!bc) return res.status(404).json({ success: false, message: "Bon de commande introuvable" });
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.pdf = async (req, res) => {
  try {
    await pdfService.streamBonCommandePdf(res, req.params.idOrUuid);
  } catch (e) {
    return res.status(404).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const bc = await bonCommandesService.updateBonCommande(prisma, req.params.id, req.body);

    try {
      const actorUserId = req.user?.userId ? Number(req.user.userId) : null;
      await notifyDemandeurForBcEvent({
        demandeId: bc?.demande_id,
        type: "bc_updated",
        message: `Le bon de commande ${bc?.numero || ""} a été modifié.`,
        meta: { bonCommandeId: bc?.id, bonCommandeUuid: bc?.uuid, numero: bc?.numero },
        excludeUserId: actorUserId,
      });
    } catch {
      // ignore
    }

    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const bc = await bonCommandesService.cancelBonCommande(prisma, req.params.id);

    try {
      const actorUserId = req.user?.userId ? Number(req.user.userId) : null;
      await notifyDemandeurForBcEvent({
        demandeId: bc?.demande_id,
        type: "bc_cancelled",
        message: `Le bon de commande ${bc?.numero || ""} a été annulé.`,
        meta: { bonCommandeId: bc?.id, bonCommandeUuid: bc?.uuid, numero: bc?.numero },
        excludeUserId: actorUserId,
      });
    } catch {
      // ignore
    }

    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await bonCommandesService.getBonCommandeById(prisma, req.params.id);
    const bc = await bonCommandesService.deleteBonCommande(prisma, req.params.id);

    try {
      const actorUserId = req.user?.userId ? Number(req.user.userId) : null;
      await notifyDemandeurForBcEvent({
        demandeId: existing?.demande_id,
        type: "bc_deleted",
        message: `Un bon de commande a été supprimé (${existing?.numero || ""}).`,
        meta: { bonCommandeId: existing?.id, bonCommandeUuid: existing?.uuid, numero: existing?.numero },
        excludeUserId: actorUserId,
      });
    } catch {
      // ignore
    }

    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
