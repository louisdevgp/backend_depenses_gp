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

async function resolveDemandeurUserIdByDemandeId(demandeId) {
  if (!demandeId) return null;
  const d = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } },
      uuid: true,
    },
  });
  return d?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null;
}

async function resolveRoleUserId(roleName) {
  const role = await prisma.roles.findFirst({ where: { name: String(roleName).toUpperCase(), is_active: true } });
  if (!role) return null;
  const agent = await prisma.agents.findFirst({
    where: { role_id: role.id, deleted_at: null },
    select: { users: { select: { id: true } } },
    orderBy: { id: "asc" },
  });
  return agent?.users?.id || null;
}

async function createReception(payload, userAgentId) {
  const {
    paiement_id,
    demande_id,
    date_reception,
    conforme,
    bon_commande_id,
    description,
    reference_facture,
    montant,
    observations,
  } = payload;

  if (!paiement_id && !demande_id) {
    const err = new Error("paiement_id ou demande_id obligatoire");
    err.statusCode = 400;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    let demande;
    let paiement = null;

    if (paiement_id) {
      paiement = await tx.paiements.findUnique({
        where: { id: Number(paiement_id) },
        include: {
          demandes_paiement: {
            include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
          },
        },
      });

      if (!paiement) {
        const err = new Error("Paiement introuvable");
        err.statusCode = 404;
        throw err;
      }

      demande = paiement.demandes_paiement;
    } else {
      demande = await tx.demandes_paiement.findUnique({
        where: { id: Number(demande_id) },
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      });

      if (!demande) {
        const err = new Error("Demande introuvable");
        err.statusCode = 404;
        throw err;
      }
    }

    // ✅ règle métier: 1 seule réception par demande
    const existingReception = await tx.receptions.findFirst({
      where: { demande_id: Number(demande.id) },
      select: { id: true, uuid: true },
    });

    if (existingReception) {
      const err = new Error("Réception déjà créée pour cette demande");
      err.statusCode = 409;
      throw err;
    }

    const reception = await tx.receptions.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande.id),
        date_reception: date_reception ? new Date(date_reception) : new Date(),
        conforme: conforme != null ? Boolean(conforme) : true,
        recu_par_id: Number(userAgentId),
        created_at: new Date(),
        bon_commande_id: bon_commande_id ? Number(bon_commande_id) : null,
        description: description ? String(description) : "",
        fournisseur: demande?.beneficiaire || "N/A",
        reference_facture: reference_facture ? String(reference_facture) : null,
        montant: montant != null && String(montant).trim() !== "" ? Number(montant) : null,
        observations: observations ? String(observations) : null,
      },
      include: { demandes_paiement: true },
    });

    // ✅ statut demande:
    // - si déjà payée -> cloture
    // - sinon -> receptionnee
    const hasPaiement = await tx.paiements.count({ where: { demande_id: Number(demande.id) } });
    const nextStatut = hasPaiement > 0 ? "cloture" : "receptionnee";

    await tx.demandes_paiement.update({
      where: { id: Number(demande.id) },
      data: { statut: nextStatut, updated_at: new Date() },
    });

    const demandeurUser = demande?.agents_demandes_paiement_demandeur_idToagents?.users;
    return {
      reception,
      demandeurUserId: demandeurUser?.id || null,
      demandeId: Number(demande.id),
      nextStatut,
      paiementId: paiement ? paiement.id : null,
    };
  });

  try {
    if (result?.demandeurUserId) {
      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "reception_creee",
        demande_id: result.demandeId,
        message: `Réception créée pour votre demande. Statut: ${result.nextStatut}.`,
        meta: {
          receptionId: result.reception.id,
          receptionUuid: result.reception.uuid,
          ...(result.paiementId ? { paiementId: result.paiementId } : {}),
        },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  return result.reception;
}

async function listReceptions(query = {}) {
  const where = {};

  if (query.demande_id) where.demande_id = Number(query.demande_id);
  if (query.bon_commande_id) where.bon_commande_id = Number(query.bon_commande_id);
  if (query.conforme != null) where.conforme = query.conforme === "true";

  if (query.date_debut || query.date_fin) {
    where.date_reception = {};
    if (query.date_debut) where.date_reception.gte = new Date(query.date_debut);
    if (query.date_fin) where.date_reception.lte = new Date(query.date_fin);
  }

  return prisma.receptions.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: { documents: true, bons_commande: true, demandes_paiement: true },
  });
}

async function getReceptionById(id) {
  return prisma.receptions.findUnique({
    where: { id: Number(id) },
    include: { documents: true, bons_commande: true, demandes_paiement: true },
  });
}

async function getReceptionByUuid(uuid) {
  return prisma.receptions.findUnique({
    where: { uuid },
    include: { documents: true, bons_commande: true, demandes_paiement: true },
  });
}

async function updateReception(id, payload, actorAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) return null;
  if (existing.visa_daf_id) throw new Error("Reception already approved by DAF");

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["COMPTABLE", "DAF", "ADMIN"]);
  const isOwner = Number(existing.recu_par_id) === Number(actorAgentId);
  if (!isOwner && !privileged.has(role)) throw new Error("Modification non autorisée");

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      fournisseur: payload.fournisseur ?? undefined,
      description: payload.description ?? undefined,
      reference_facture: payload.reference_facture ?? undefined,
      montant: payload.montant ?? undefined,
      date_reception: payload.date_reception ? new Date(payload.date_reception) : undefined,
      conforme: payload.conforme != null ? Boolean(payload.conforme) : undefined,
      observations: payload.observations ?? undefined,
      updated_at: new Date(),
    },
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_updated",
        demande_id: existing.demande_id,
        message: "Une réception liée à votre demande a été modifiée.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  return updated;
}

async function visaDirecteur(id, { signature_directeur_url }, directeurAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (existing.visa_directeur_id) throw new Error("Réception déjà visée par le Directeur");

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_directeur_id: Number(directeurAgentId),
      signature_directeur_url: signature_directeur_url || null,
      updated_at: new Date(),
    },
  });

  // Notifications after commit (emails non-bloquants)
  try {
    const actorUserId = await findUserIdByAgentId(directeurAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);
    const dafUserId = await resolveRoleUserId("DAF");

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_visa_directeur",
        demande_id: existing.demande_id,
        message: "La réception a été visée par le Directeur.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }

    if (dafUserId && Number(dafUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: dafUserId,
        type: "reception_visa_pending",
        demande_id: existing.demande_id,
        message: "Une réception attend votre Visa DAF.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  return updated;
}

async function visaDaf(id, { signature_daf_url }, dafAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (!existing.visa_directeur_id) throw new Error("Visa Directeur requis avant le Visa DAF");
  if (existing.visa_daf_id) throw new Error("Réception déjà visée par le DAF");

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_daf_id: Number(dafAgentId),
      signature_daf_url: signature_daf_url || null,
      updated_at: new Date(),
    },
  });

  try {
    const actorUserId = await findUserIdByAgentId(dafAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_visa_daf",
        demande_id: existing.demande_id,
        message: "La réception a été visée par le DAF.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  return updated;
}

async function deleteReception(id, actorAgentId) {
  const existing = await prisma.receptions.findUnique({
    where: { id: Number(id) },
    select: { id: true, uuid: true, demande_id: true, recu_par_id: true },
  });
  if (!existing) {
    const err = new Error("Reception introuvable");
    err.statusCode = 404;
    throw err;
  }

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["COMPTABLE", "DAF", "ADMIN"]);
  const isOwner = Number(existing.recu_par_id) === Number(actorAgentId);
  if (!isOwner && !privileged.has(role)) {
    const err = new Error("Suppression non autorisée");
    err.statusCode = 403;
    throw err;
  }

  await prisma.receptions.delete({ where: { id: Number(id) } });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_deleted",
        demande_id: existing.demande_id,
        message: "Une réception liée à votre demande a été supprimée.",
        meta: { receptionId: existing.id, receptionUuid: existing.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  return true;
}

module.exports = {
  createReception,
  listReceptions,
  getReceptionById,
  getReceptionByUuid,
  updateReception,
  visaDirecteur,
  visaDaf,
  deleteReception,
};
