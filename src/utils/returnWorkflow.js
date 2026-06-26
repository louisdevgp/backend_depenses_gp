const EXECUTIVE_RETURN_ROLES = new Set(["DAF", "DGA", "DG"]);

function normalizeRoleName(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeLevel(value) {
  const level = Number(value);
  return Number.isFinite(level) && level > 0 ? level : null;
}

function findReturnStep(steps = []) {
  return [...(Array.isArray(steps) ? steps : [])]
    .filter((step) => String(step?.status || "").toLowerCase() === "retour_modification")
    .sort((a, b) => (normalizeLevel(b?.level) || 0) - (normalizeLevel(a?.level) || 0))[0] || null;
}

async function resolveDirectionDirectorAgent(client, directionId) {
  if (!client || directionId == null) return null;

  return client.agents.findFirst({
    where: {
      deleted_at: null,
      direction_id: Number(directionId),
      OR: [
        { roles: { is: { name: "DIRECTEUR" } } },
        { users: { user_roles: { some: { roles: { name: "DIRECTEUR" } } } } },
      ],
    },
    orderBy: { id: "asc" },
  });
}

function resolveReturnTarget({
  steps = [],
  returnStep = null,
  demandeurId = null,
  directionDirectorAgentId = null,
} = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const current = returnStep || findReturnStep(list);
  const returnLevel = normalizeLevel(current?.level);

  if (!current || !returnLevel) return null;

  const returnRole = normalizeRoleName(current.role_name);
  let targetStep = null;

  if (returnRole === "DAF") {
    return {
      kind: "direction_director",
      returnStep: current,
      targetStep: null,
      targetAgentId:
        directionDirectorAgentId != null ? Number(directionDirectorAgentId) : null,
      targetRole: "DIRECTEUR",
      restartLevel: returnLevel,
    };
  }

  if (EXECUTIVE_RETURN_ROLES.has(returnRole)) {
    targetStep = list
      .filter(
        (step) =>
          normalizeRoleName(step?.role_name) === "DIRECTEUR" &&
          normalizeLevel(step?.level) != null &&
          Number(step.level) < returnLevel
      )
      .sort((a, b) => Number(b.level) - Number(a.level))[0] || null;
  } else if (returnLevel > 1) {
    targetStep =
      list.find((step) => normalizeLevel(step?.level) === returnLevel - 1) || null;
  }

  if (targetStep) {
    return {
      kind: "validation_step",
      returnStep: current,
      targetStep,
      targetAgentId: targetStep.validator_id != null ? Number(targetStep.validator_id) : null,
      targetRole: normalizeRoleName(targetStep.role_name) || null,
      restartLevel: normalizeLevel(targetStep.level),
    };
  }

  return {
    kind: "demandeur",
    returnStep: current,
    targetStep: null,
    targetAgentId: demandeurId != null ? Number(demandeurId) : null,
    targetRole: "DEMANDEUR",
    restartLevel: returnLevel,
  };
}

module.exports = {
  EXECUTIVE_RETURN_ROLES,
  findReturnStep,
  normalizeRoleName,
  resolveDirectionDirectorAgent,
  resolveReturnTarget,
};
