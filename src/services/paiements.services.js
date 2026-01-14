const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function amountsEqual(a, b, tolerance = 0.01) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= tolerance;
}

function deriveModeFromConditions(conds) {
  const list = Array.isArray(conds) ? conds : [];
  const pcts = list.map((c) => Number(c?.pourcentage)).filter((n) => Number.isFinite(n));
  if (pcts.length === 1 && amountsEqual(pcts[0], 100, 0.01)) return "100/100";
  if (pcts.length === 2) {
    const a = round2(pcts[0]);
    const b = round2(pcts[1]);
    if (amountsEqual(a, 70, 0.01) && amountsEqual(b, 30, 0.01)) return "70/30";
    if (amountsEqual(a, 50, 0.01) && amountsEqual(b, 50, 0.01)) return "50/50";
  }
  return null;
}

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

async function ensureConditionsForDemande(tx, demandeId) {
  const conds = await tx.conditions_paiement.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { id: "asc" },
  });

  if (conds.length > 0) return conds;

  // Compat: anciennes demandes sans échéancier -> créer 100/100
  const d = await tx.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: { id: true, montant: true },
  });
  if (!d) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  await tx.conditions_paiement.create({
    data: {
      uuid: uuidv4(),
      demande_id: Number(demandeId),
      label: "Tranche 1",
      type_echeance: "pourcentage",
      pourcentage: 100,
      montant_prevu: round2(d.montant),
      date_echeance: null,
      condition_texte: "100/100",
      statut: "prevu",
      paiement_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return tx.conditions_paiement.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { id: "asc" },
  });
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
    const demande = await tx.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      select: { id: true, uuid: true, montant: true },
    });
    if (!demande) {
      const err = new Error("Demande introuvable");
      err.statusCode = 404;
      throw err;
    }

    const conditions = await ensureConditionsForDemande(tx, demande.id);
    const mode = deriveModeFromConditions(conditions) || "100/100";

    const unpaid = conditions.filter((c) => !c.paiement_id && String(c.statut || "").toLowerCase() !== "paye");
    if (unpaid.length === 0) {
      const err = new Error("Demande déjà payée");
      err.statusCode = 409;
      throw err;
    }

    const montantNum = Number(montant);
    if (!Number.isFinite(montantNum) || montantNum <= 0) {
      const err = new Error("Montant paiement invalide");
      err.statusCode = 400;
      throw err;
    }

    const remainingTotal = round2(unpaid.reduce((acc, c) => acc + Number(c.montant_prevu || 0), 0));

    if (String(type_paiement).toLowerCase() === "partiel") {
      if (mode === "100/100") {
        const err = new Error("Condition 100/100 : paiement en une seule fois (type total)");
        err.statusCode = 400;
        throw err;
      }

      // Règle: une seule fois par tranche, et ordre imposé (tranche 1 puis tranche 2)
      const nextTranche = unpaid[0];
      if (!nextTranche) {
        const err = new Error("Aucune tranche à payer");
        err.statusCode = 400;
        throw err;
      }

      if (!amountsEqual(montantNum, nextTranche.montant_prevu)) {
        const err = new Error(`Paiement partiel invalide : montant attendu = ${nextTranche.montant_prevu}`);
        err.statusCode = 400;
        throw err;
      }
    } else {
      // type total
      if (!amountsEqual(montantNum, remainingTotal)) {
        const err = new Error(`Paiement total invalide : montant attendu = ${remainingTotal}`);
        err.statusCode = 400;
        throw err;
      }
    }

    const paiement = await tx.paiements.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande_id),
        type_paiement,
        montant: montantNum,
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

    // Appliquer paiement -> conditions
    const unpaidAfterCreate = await tx.conditions_paiement.findMany({
      where: { demande_id: Number(demande_id), paiement_id: null },
      orderBy: { id: "asc" },
    });
    const remainingAfterCreate = unpaidAfterCreate;

    if (String(type_paiement).toLowerCase() === "partiel") {
      const nextTranche = remainingAfterCreate[0];
      if (!nextTranche) {
        const err = new Error("Aucune tranche à payer");
        err.statusCode = 400;
        throw err;
      }

      await tx.conditions_paiement.update({
        where: { id: Number(nextTranche.id) },
        data: { paiement_id: paiement.id, statut: "paye", updated_at: new Date() },
      });
    } else {
      // total: marque toutes les tranches restantes comme payées par ce paiement
      await tx.conditions_paiement.updateMany({
        where: { demande_id: Number(demande_id), paiement_id: null },
        data: { paiement_id: paiement.id, statut: "paye", updated_at: new Date() },
      });
    }

    const stillUnpaid = await tx.conditions_paiement.count({
      where: { demande_id: Number(demande_id), paiement_id: null },
    });
    const fullyPaid = stillUnpaid === 0;
    const hasReception = await tx.receptions.count({ where: { demande_id: Number(demande_id) } });

    // Règle: un paiement partiel ne doit jamais "bloquer" la capacité à payer.
    // Donc tant que ce n'est pas totalement payé => en_attente_paiement (même si réception existe).
    const nextStatut = fullyPaid
      ? (hasReception > 0 ? "cloture" : "paye")
      : "en_attente_paiement";

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
      const stillUnpaid = await prisma.conditions_paiement.count({ where: { demande_id: Number(demande_id), paiement_id: null } });
      const fullyPaid = stillUnpaid === 0;
      const hasReception = await prisma.receptions.count({ where: { demande_id: Number(demande_id) } });
      const nextStatut = fullyPaid
        ? (hasReception > 0 ? "cloture" : "paye")
        : "en_attente_paiement";

      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_effectue",
        demande_id: Number(demande_id),
        message: fullyPaid
          ? `Votre demande a été payée. Montant: ${montant}. Moyen: ${moyen_paiement}. Statut: ${nextStatut}.`
          : `Un paiement partiel a été enregistré. Montant: ${montant}. Moyen: ${moyen_paiement}. Statut: ${nextStatut}.`,
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
    // 1) Détacher les tranches liées à ce paiement
    await tx.conditions_paiement.updateMany({
      where: { paiement_id: Number(id) },
      data: { paiement_id: null, statut: "prevu", updated_at: new Date() },
    });

    // 2) Supprimer documents + paiement
    await tx.documents.deleteMany({ where: { paiement_id: Number(id) } });
    await tx.paiements.delete({ where: { id: Number(id) } });

    // 3) Recalcul statut demande
    const demandeId = Number(snapshot.demande_id);
    const stillUnpaid = await tx.conditions_paiement.count({ where: { demande_id: demandeId, paiement_id: null } });
    const fullyPaid = stillUnpaid === 0;
    const hasReception = await tx.receptions.count({ where: { demande_id: demandeId } });
    const hasAnyPaiement = await tx.paiements.count({ where: { demande_id: demandeId } });

    const nextStatut = fullyPaid
      ? (hasReception > 0 ? "cloture" : "paye")
      : (hasAnyPaiement > 0 ? "en_attente_paiement" : "approuvee");

    await tx.demandes_paiement.update({
      where: { id: demandeId },
      data: { statut: nextStatut, updated_at: new Date() },
    });
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
