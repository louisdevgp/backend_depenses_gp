const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");
const { saveSignaturePngDataUrl } = require("./signatures.services");

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeReceptionPhase(value) {
  if (value == null) return null;
  const v = String(value).trim().toUpperCase();
  if (!v) return null;
  if (v === "AVANT" || v === "AVANT_PAIEMENT") return "AVANT_PAIEMENT";
  if (v === "APRES" || v === "APRES_PAIEMENT") return "APRES_PAIEMENT";
  return null;
}

function candidateScopesForDemandeOrg(org) {
  const scopes = ["GLOBAL"];
  if (!org) return scopes;
  if (org.direction_id) scopes.push(`DIRECTION:${Number(org.direction_id)}`);
  if (org.departement_id) scopes.push(`DEPARTEMENT:${Number(org.departement_id)}`);
  if (org.service_id) scopes.push(`SERVICE:${Number(org.service_id)}`);
  return scopes;
}

async function getAgentById(tx, agentId) {
  const client = tx || prisma;
  if (!agentId) return null;
  return client.agents.findUnique({
    where: { id: Number(agentId) },
    select: { id: true, direction_id: true, deleted_at: true, roles: { select: { name: true } } },
  });
}

async function canActAsDirectorForDemande(tx, agentId, demandeOrg) {
  const client = tx || prisma;
  const agent = await getAgentById(client, agentId);
  if (!agent || agent.deleted_at) return false;

  const role = normalizeRoleName(agent?.roles?.name);
  if (role === "ADMIN") return true;

  if (role === "DIRECTEUR") {
    if (!agent.direction_id || !demandeOrg?.direction_id) return false;
    return Number(agent.direction_id) === Number(demandeOrg.direction_id);
  }

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await client.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: "DIRECTEUR",
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

async function canActAsResponsableForDemande(tx, agentId, demandeOrg) {
  const client = tx || prisma;
  const agent = await getAgentById(client, agentId);
  if (!agent || agent.deleted_at) return false;

  const role = normalizeRoleName(agent?.roles?.name);
  if (role === "ADMIN") return true;

  if (role === "RESPONSABLE") {
    if (!agent.direction_id || !demandeOrg?.direction_id) return false;
    return Number(agent.direction_id) === Number(demandeOrg.direction_id);
  }

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await client.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: "RESPONSABLE",
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

const GLOBAL_READ_ROLES = new Set(["ADMIN", "DAF"]);
const DIRECTION_READ_ROLES = new Set(["DIRECTEUR", "RESPONSABLE"]);

async function getAgentFromAuthUser(user) {
  const userId = user?.userId;
  if (!userId) return null;
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { id: true, direction_id: true },
  });
}

async function receptionScopeWhereForUser(user) {
  const roles = new Set((user?.roles || []).map(normalizeRoleName));
  if (Array.from(roles).some((r) => GLOBAL_READ_ROLES.has(r))) return null;

  const agent = await getAgentFromAuthUser(user);
  if (!agent) {
    const err = new Error("Accès interdit");
    err.statusCode = 403;
    throw err;
  }

  if (Array.from(roles).some((r) => DIRECTION_READ_ROLES.has(r))) {
    if (!agent.direction_id) {
      const err = new Error("Accès interdit");
      err.statusCode = 403;
      throw err;
    }
    return { demandes_paiement: { is: { direction_id: Number(agent.direction_id) } } };
  }

  if (roles.has("DEMANDEUR")) {
    return { demandes_paiement: { is: { demandeur_id: Number(agent.id) } } };
  }

  const err = new Error("Accès interdit");
  err.statusCode = 403;
  throw err;
}

function userDisplayNameFromAgent(agent) {
  const prenom = agent?.users?.prenom ? String(agent.users.prenom).trim() : "";
  const nom = agent?.users?.nom ? String(agent.users.nom).trim() : "";
  const full = `${prenom} ${nom}`.trim();
  return full || null;
}

function withReceptionDisplayNames(row) {
  if (!row) return row;
  return {
    ...row,
    receveur_nom: userDisplayNameFromAgent(row.agents_receptions_recu_par_idToagents) || row.receveur_nom || null,
    visa_directeur_nom: userDisplayNameFromAgent(row.agents_receptions_visa_directeur_idToagents) || null,
    visa_daf_nom: userDisplayNameFromAgent(row.agents_receptions_visa_daf_idToagents) || null,
  };
}

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
    phase: phaseRaw,
    date_reception,
    conforme,
    description,
    reference_facture,
    montant,
    observations,
  } = payload;

  const requestedPhase = normalizeReceptionPhase(phaseRaw);
  if (phaseRaw != null && !requestedPhase) {
    const err = new Error("Phase de réception invalide");
    err.statusCode = 400;
    throw err;
  }

  const phase = requestedPhase || (paiement_id ? "APRES_PAIEMENT" : "AVANT_PAIEMENT");

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

      if (demande_id && Number(demande_id) !== Number(paiement.demande_id)) {
        const err = new Error("paiement_id et demande_id ne correspondent pas");
        err.statusCode = 400;
        throw err;
      }
    } else {
      if (!demande_id) {
        const err = new Error("demande_id obligatoire pour une réception avant paiement");
        err.statusCode = 400;
        throw err;
      }
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

    const demandeOrg = {
      direction_id: demande?.direction_id ?? null,
      departement_id: demande?.departement_id ?? null,
      service_id: demande?.service_id ?? null,
    };

    const isOwner = Number(demande.demandeur_id) === Number(userAgentId);
    const canDirector = await canActAsDirectorForDemande(tx, userAgentId, demandeOrg);
    const canResponsable = await canActAsResponsableForDemande(tx, userAgentId, demandeOrg);
    if (!isOwner && !canDirector && !canResponsable) {
      const err = new Error("Seul le Directeur de la direction, le responsable ou le demandeur peut créer une réception");
      err.statusCode = 403;
      throw err;
    }
    if ((isOwner || canResponsable) && !canDirector) {
      const pending = await tx.validation_steps.count({
        where: {
          demande_id: Number(demande.id),
          status: { not: "valide" },
        },
      });
      if (pending > 0) {
        const err = new Error("Demande non eligible: validations incompl?tes");
        err.statusCode = 409;
        throw err;
      }

      const statut = String(demande?.statut || "").toLowerCase();
      const allowedStatuts = new Set(["approuvee", "en_attente_paiement", "paye", "payee"]);
      if (!allowedStatuts.has(statut)) {
        const err = new Error("Demande non eligible pour r?ception");
        err.statusCode = 409;
        throw err;
      }
    }



    let hasPaiement = Boolean(paiement_id);
    if (!hasPaiement) {
      const paiementCount = await tx.paiements.count({ where: { demande_id: Number(demande.id) } });
      hasPaiement = paiementCount > 0;
    }

    if (phase === "APRES_PAIEMENT" && !hasPaiement) {
      const err = new Error("Aucun paiement enregistré pour cette demande");
      err.statusCode = 400;
      throw err;
    }

    if (phase === "AVANT_PAIEMENT" && hasPaiement) {
      const err = new Error("Paiement déjà effectué pour cette demande");
      err.statusCode = 400;
      throw err;
    }

    const existingReception = await tx.receptions.findFirst({
      where: { demande_id: Number(demande.id), phase },
      select: { id: true },
    });
    if (existingReception) {
      const err = new Error("Réception déjà créée pour cette phase");
      err.statusCode = 409;
      throw err;
    }

    const autoVisaDirecteur = canDirector && (conforme != null ? Boolean(conforme) : true);

    const reception = await tx.receptions.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande.id),
        paiement_id: phase === "APRES_PAIEMENT" && paiement_id ? Number(paiement_id) : null,
        phase,
        date_reception: date_reception ? new Date(date_reception) : new Date(),
        conforme: conforme != null ? Boolean(conforme) : true,
        recu_par_id: Number(userAgentId),
        visa_directeur_id: autoVisaDirecteur ? Number(userAgentId) : null,
        created_at: new Date(),
        description: description ? String(description) : "",
        fournisseur: "",
        reference_facture: reference_facture ? String(reference_facture) : null,
        montant: montant != null && String(montant).trim() !== "" ? Number(montant) : null,
        observations: observations ? String(observations) : null,
      },
      include: { demandes_paiement: true },
    });

    // ✅ statut demande:
    // - si en attente paiement, on conserve
    // - sinon -> receptionnee (la cloture est manuelle)
    const currentStatut = String(demande?.statut || "").toLowerCase();
    const nextStatut = currentStatut === "en_attente_paiement" ? "en_attente_paiement" : "receptionnee";

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
      autoVisaDirecteur,
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

    if (result?.autoVisaDirecteur) {
      const dafUserId = await resolveRoleUserId("DAF");
      if (dafUserId) {
        await notifications.createNotification({
          user_id: dafUserId,
          type: "reception_visa_pending",
          demande_id: result.demandeId,
          message: "Une rÃ©ception attend votre Visa DAF.",
          meta: {
            receptionId: result.reception.id,
            receptionUuid: result.reception.uuid,
            ...(result.paiementId ? { paiementId: result.paiementId } : {}),
          },
          sendEmailNow: true,
        });
      }
    }
  } catch {
    // ignore email errors
  }

  return result.reception;
}

async function listReceptions(query = {}, authUser = null) {
  const where = {};

  if (query.demande_id) where.demande_id = Number(query.demande_id);
  if (query.conforme != null) where.conforme = query.conforme === "true";
  if (query.phase) {
    const phase = normalizeReceptionPhase(query.phase);
    if (phase) where.phase = phase;
  }

  if (query.date_debut || query.date_fin) {
    where.date_reception = {};
    if (query.date_debut) where.date_reception.gte = new Date(query.date_debut);
    if (query.date_fin) where.date_reception.lte = new Date(query.date_fin);
  }

  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const scopedWhere = scopeWhere ? { AND: [where, scopeWhere] } : where;

  const rows = await prisma.receptions.findMany({
    where: scopedWhere,
    orderBy: { created_at: "desc" },
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });

  return (rows || []).map(withReceptionDisplayNames);
}

async function getReceptionById(id, authUser = null) {
  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const where = scopeWhere
    ? { AND: [{ id: Number(id) }, scopeWhere] }
    : { id: Number(id) };
  const row = await prisma.receptions.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });
  return withReceptionDisplayNames(row);
}

async function getReceptionByUuid(uuid, authUser = null) {
  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const where = scopeWhere
    ? { AND: [{ uuid: String(uuid) }, scopeWhere] }
    : { uuid: String(uuid) };
  const row = await prisma.receptions.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });
  return withReceptionDisplayNames(row);
}

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

async function getReceptionByIdOrUuid(idOrUuid, authUser = null) {
  return isNumericId(idOrUuid)
    ? getReceptionById(idOrUuid, authUser)
    : getReceptionByUuid(idOrUuid, authUser);
}

async function assertCanReadReception(idOrUuid, authUser = null) {
  const row = await getReceptionByIdOrUuid(idOrUuid, authUser);
  if (!row) {
    const err = new Error("Réception introuvable");
    err.statusCode = 404;
    throw err;
  }
  return true;
}

async function updateReception(id, payload, actorAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) return null;
  if (existing.visa_directeur_id) throw new Error("Réception déjà visée par le Directeur");

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["ADMIN"]);
  const isOwner = Number(existing.recu_par_id) === Number(actorAgentId);
  if (!isOwner && !privileged.has(role)) throw new Error("Modification non autorisée");

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
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

async function visaDirecteur(id, { signature_directeur_url, signature_data_url, commentaire } = {}, directeurAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (existing.visa_directeur_id) throw new Error("Réception déjà visée par le Directeur");

  const demandeOrg = await prisma.demandes_paiement.findUnique({
    where: { id: Number(existing.demande_id) },
    select: { direction_id: true, departement_id: true, service_id: true },
  });

  const canVisa = await canActAsDirectorForDemande(prisma, directeurAgentId, demandeOrg);
  if (!canVisa) {
    const err = new Error("Visa Directeur non autorisé pour cette direction");
    err.statusCode = 403;
    throw err;
  }

  // On ignore les signatures car on ne les gère plus
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_directeur_id: Number(directeurAgentId),
      // Plus de signature_directeur_url
      visa_directeur_commentaire: commentaireTrimmed ? commentaireTrimmed : null,
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

async function visaDaf(id, { signature_daf_url, signature_data_url, commentaire } = {}, dafAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (!existing.visa_directeur_id) throw new Error("Visa Directeur requis avant le Visa DAF");
  if (existing.visa_daf_id) throw new Error("Réception déjà visée par le DAF");

  // On ignore les signatures car on ne les gère plus
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_daf_id: Number(dafAgentId),
      // Plus de signature_daf_url
      visa_daf_commentaire: commentaireTrimmed ? commentaireTrimmed : null,
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
        message: "La réception a été visée par le DAF. Tous les visas sont faits, vous pouvez clôturer votre demande.",
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
    select: { id: true, uuid: true, demande_id: true, recu_par_id: true, visa_directeur_id: true },
  });
  if (!existing) {
    const err = new Error("Reception introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (existing.visa_directeur_id) {
    const err = new Error("Réception déjà visée par le Directeur");
    err.statusCode = 409;
    throw err;
  }

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["ADMIN"]);
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
  getReceptionByIdOrUuid,
  assertCanReadReception,
  updateReception,
  visaDirecteur,
  visaDaf,
  deleteReception,
};
