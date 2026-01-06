const prisma = require("../config/prisma");

function toStageStatus(roleName) {
  return `validation_${String(roleName).toLowerCase()}`;
}

async function getAgentFromUserId(userId) {
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true },
  });
}

async function getActiveDelegationsForDelegate(agentId) {
  const now = new Date();
  return prisma.delegations.findMany({
    where: {
      delegate_id: Number(agentId),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    select: { principal_id: true, role_name: true },
  });
}

async function canActOnStep(tx, step, agent) {
  if (step.validator_id && step.validator_id === agent.id) return true;

  const now = new Date();
  const deleg = await tx.delegations.findFirst({
    where: {
      principal_id: step.validator_id || -1,
      delegate_id: agent.id,
      role_name: step.role_name,
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    select: { id: true },
  });

  return !!deleg;
}

async function ensurePreviousValidated(tx, step) {
  if (step.level <= 1) return true;

  const prev = await tx.validation_steps.findFirst({
    where: { demande_id: step.demande_id, level: step.level - 1 },
    select: { status: true },
  });

  if (!prev || prev.status !== "valide") {
    throw new Error("Étape précédente non validée");
  }
  return true;
}

async function updateDemandeStageFromNextPendingStep(tx, demandeId) {
  const next = await tx.validation_steps.findFirst({
    where: { demande_id: Number(demandeId), status: "en_attente" },
    orderBy: { level: "asc" },
  });

  if (!next) {
    await tx.demandes_paiement.update({
      where: { id: Number(demandeId) },
      data: { statut: "approuvee" },
    });
    return { statut: "approuvee" };
  }

  const newStatut = toStageStatus(next.role_name);
  await tx.demandes_paiement.update({
    where: { id: Number(demandeId) },
    data: { statut: newStatut },
  });

  return { statut: newStatut, next_role: next.role_name, next_level: next.level };
}

/**
 * ✅ Pending visible uniquement si:
 * - status=en_attente
 * - (validator_id = agent.id) OU delegation active vers ce validator_id
 * - ET step précédent validé si level>1
 */
async function getPendingForUser(userId) {
  const agent = await getAgentFromUserId(userId);
  if (!agent) return [];

  const delegs = await getActiveDelegationsForDelegate(agent.id);
  const principalIds = delegs.map((d) => d.principal_id).filter(Boolean);

  const steps = await prisma.validation_steps.findMany({
    where: {
      status: "en_attente",
      OR: [
        { validator_id: agent.id },
        ...(principalIds.length ? [{ validator_id: { in: principalIds } }] : []),
      ],
    },
    include: {
      demandes_paiement: { include: { documents: true, fournisseurs: true } },
    },
    orderBy: { level: "asc" },
  });

  // Filtre séquentiel (ne montrer que si step précédent validé)
  const byDemande = new Map();
  for (const s of steps) {
    const list = byDemande.get(s.demande_id) || [];
    list.push(s);
    byDemande.set(s.demande_id, list);
  }

  const demandeIds = Array.from(byDemande.keys());
  const allPrev = await prisma.validation_steps.findMany({
    where: { demande_id: { in: demandeIds } },
    select: { demande_id: true, level: true, status: true },
  });

  const statusMap = new Map(); // key: demandeId-level => status
  for (const p of allPrev) statusMap.set(`${p.demande_id}-${p.level}`, p.status);

  const visible = [];
  for (const s of steps) {
    if (s.level <= 1) {
      visible.push(s);
      continue;
    }
    const prevStatus = statusMap.get(`${s.demande_id}-${s.level - 1}`);
    if (prevStatus === "valide") visible.push(s);
  }

  return visible;
}

async function approveStep(stepId, userId) {
  return prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
      include: { demandes_paiement: true },
    });

    if (!step || step.status !== "en_attente") throw new Error("Étape invalide");

    const agent = await tx.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      include: { roles: true },
    });
    if (!agent) throw new Error("Non autorisé");

    await ensurePreviousValidated(tx, step);

    const ok = await canActOnStep(tx, step, agent);
    if (!ok) throw new Error("Non autorisé");

    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "valide",
        validated_by_id: agent.id,
        validated_at: new Date(),
        updated_at: new Date(),
      },
    });

    const stage = await updateDemandeStageFromNextPendingStep(tx, step.demande_id);
    return { stepId: step.id, demandeId: step.demande_id, stage };
  });
}

async function rejectStep(stepId, userId, commentaire) {
  return prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
    });
    if (!step || step.status !== "en_attente") throw new Error("Étape invalide");

    const agent = await tx.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      include: { roles: true },
    });
    if (!agent) throw new Error("Non autorisé");

    await ensurePreviousValidated(tx, step);

    const ok = await canActOnStep(tx, step, agent);
    if (!ok) throw new Error("Non autorisé");

    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "rejete",
        validated_by_id: agent.id,
        commentaire,
        validated_at: new Date(),
        updated_at: new Date(),
      },
    });

    await tx.demandes_paiement.update({
      where: { id: step.demande_id },
      data: { statut: "rejete" },
    });

    return { rejected: true, stepId: step.id, demandeId: step.demande_id };
  });
}

async function getStepsByDemande(demandeId) {
  return prisma.validation_steps.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { level: "asc" },
    include: {
      agents_validation_steps_validator_idToagents: true,
      agents_validation_steps_validated_by_idToagents: true,
    },
  });
}

async function getValidationsDoneBydemande(demandeIdOrUuid) {
  const demande = await prisma.demandes_paiement.findFirst({
    where: {
      OR: [{ id: Number(demandeIdOrUuid) || -1 }, { uuid: String(demandeIdOrUuid) }],
    },
    select: { id: true },
  });
  if (!demande) return [];

  return prisma.validation_steps.findMany({
    where: { demande_id: demande.id, status: "valide" },
    include: { demandes_paiement: true },
    orderBy: { validated_at: "desc" },
  });
}

async function validationDone(userId) {
  const agent = await getAgentFromUserId(userId);
  if (!agent) return [];

  return prisma.validation_steps.findMany({
    where: { validated_by_id: agent.id, status: "valide" },
    orderBy: { validated_at: "desc" },
    include: { demandes_paiement: true },
  });
}

async function getByUuid(uuid) {
  return prisma.validation_steps.findUnique({
    where: { uuid: String(uuid) },
    include: {
      demandes_paiement: {
        include: { documents: true },
      },
    },
  });
}

module.exports = {
  getPendingForUser,
  approveStep,
  rejectStep,
  getStepsByDemande,
  validationDone,
  getByUuid,
  getValidationsDoneBydemande,
};
