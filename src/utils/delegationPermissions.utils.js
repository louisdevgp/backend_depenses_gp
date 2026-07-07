function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function canManageDelegation({ admin = false, actorAgentId, principalId }) {
  if (admin) return true;
  const actor = toNumber(actorAgentId);
  const principal = toNumber(principalId);
  return actor !== null && principal !== null && actor === principal;
}

module.exports = {
  canManageDelegation,
};
