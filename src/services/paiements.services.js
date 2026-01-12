const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");

async function findUserIdByAgentId(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { users: { select: { id: true } } },
  });
  return a?.users?.id || null;
}

async function assertDemandePayable(demandeId) {
  const demande = await prisma.demandes_paiement.findFirst({
    where: { id: Number(demandeId), deleted_at: null },
    select: { id: true },
  });

  if (!demande) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const pending = await prisma.validation_steps.count({
    where: {
      demande_id: Number(demandeId),
      status: { in: ["en_attente", "bloque", "rejete"] },
    },
  });

  if (pending > 0) {
    const err = new Error("Demande non payable : validations incomplètes ou rejetée");
    err.statusCode = 400;
    throw err;
  }

  return true;
}

async function createPaiement(payload, comptableAgentId) {
  const {
    demande_id,
    type_paiement,
    montant,
    date_paiement,
    moyen_paiement,
    reference_piece,
    compte_debite,
    commentaire,
    documents = [],
  } = payload;

  await assertDemandePayable(demande_id);

  const result = await prisma.$transaction(async (tx) => {
    const paiement = await tx.paiements.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande_id),
        type_paiement,
        montant: Number(montant),
        date_paiement: date_paiement ? new Date(date_paiement) : new Date(),
        moyen_paiement,
        reference_piece: reference_piece || null,
        compte_debite: compte_debite || null,
        commentaire: commentaire || null,
        comptable_id: Number(comptableAgentId),
        documents: documents?.length
          ? {
              create: documents.map((d) => ({
                uuid: uuidv4(),
                type_document: d.type_document,
                url: d.url,
                nom_fichier: d.nom_fichier || "document",
                format: d.format || null,
                taille: d.taille ? BigInt(d.taille) : null,
                upload_by_id: Number(comptableAgentId),
                created_at: new Date(),
              })),
            }
          : undefined,
      },
      include: {
        documents: true,
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    const hasReception = await tx.receptions.count({ where: { demande_id: Number(demande_id) } });
    const nextStatut = hasReception > 0 ? "cloture" : "paye";

    await tx.demandes_paiement.update({
      where: { id: Number(demande_id) },
      data: { statut: nextStatut, updated_at: new Date() },
    });

    return paiement;
  });

  // notif demandeur after commit (safe for email)
  try {
    const demandeurUser = result.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;
    if (demandeurUser?.id) {
      const hasReception = await prisma.receptions.count({ where: { demande_id: Number(demande_id) } });
      const nextStatut = hasReception > 0 ? "cloture" : "paye";

      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_effectue",
        demande_id: Number(demande_id),
        message: `Votre demande a été payée. Montant: ${montant}. Moyen: ${moyen_paiement}. Statut: ${nextStatut}.`,
        meta: { paiementId: result.id, paiementUuid: result.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  return result;
}

async function listPaiements({ demande_id, from, to, moyen_paiement }) {
  return prisma.paiements.findMany({
    where: {
      ...(demande_id ? { demande_id: Number(demande_id) } : {}),
      ...(moyen_paiement ? { moyen_paiement } : {}),
      ...(from || to
        ? { date_paiement: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function getPaiementById(id) {
  const paiement = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function getPaiementByUuid(uuid) {
  const paiement = await prisma.paiements.findFirst({
    where: { uuid },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function listByDemande(demandeId) {
  return prisma.paiements.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function updatePaiement(id, payload, actorAgentId) {
  const existing = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: {
      demandes_paiement: {
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      },
    },
  });

  if (!existing) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }

  const updated = await prisma.paiements.update({
    where: { id: Number(id) },
    data: {
      type_paiement: payload.type_paiement ?? undefined,
      montant: payload.montant != null ? Number(payload.montant) : undefined,
      date_paiement: payload.date_paiement ? new Date(payload.date_paiement) : undefined,
      moyen_paiement: payload.moyen_paiement ?? undefined,
      reference_piece: payload.reference_piece ?? undefined,
      compte_debite: payload.compte_debite ?? undefined,
      commentaire: payload.commentaire ?? undefined,
    },
    include: { documents: true },
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUser = existing.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;

    if (demandeurUser?.id && Number(demandeurUser.id) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_updated",
        demande_id: Number(existing.demande_id),
        message: "Un paiement lié à votre demande a été modifié.",
        meta: {
          paiementId: updated.id,
          paiementUuid: updated.uuid,
          changes: {
            type_paiement: payload.type_paiement ?? undefined,
            montant: payload.montant != null ? Number(payload.montant) : undefined,
            date_paiement: payload.date_paiement ? new Date(payload.date_paiement).toISOString() : undefined,
            moyen_paiement: payload.moyen_paiement ?? undefined,
            reference_piece: payload.reference_piece ?? undefined,
            compte_debite: payload.compte_debite ?? undefined,
            commentaire: payload.commentaire ?? undefined,
          },
        },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  return updated;
}

async function deletePaiement(id, actorAgentId) {
  const snapshot = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: {
      demandes_paiement: {
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      },
    },
  });

  if (!snapshot) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.documents.deleteMany({ where: { paiement_id: Number(id) } });
    await tx.paiements.delete({ where: { id: Number(id) } });
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUser = snapshot.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;

    if (demandeurUser?.id && Number(demandeurUser.id) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_deleted",
        demande_id: Number(snapshot.demande_id),
        message: "Un paiement lié à votre demande a été supprimé.",
        meta: { paiementId: snapshot.id, paiementUuid: snapshot.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  return true;
}

module.exports = {
  createPaiement,
  listPaiements,
  getPaiementById,
  getPaiementByUuid,
  listByDemande,
  updatePaiement,
  deletePaiement,
};
