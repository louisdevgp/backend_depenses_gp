function candidateScopesForOrg(org) {
  const scopes = ["GLOBAL"];
  if (!org) return scopes;
  if (org.direction_id) scopes.push(`DIRECTION:${Number(org.direction_id)}`);
  if (org.departement_id) scopes.push(`DEPARTEMENT:${Number(org.departement_id)}`);
  if (org.service_id) scopes.push(`SERVICE:${Number(org.service_id)}`);
  return scopes;
}

function delegationScopeCoversOrg(scope, org) {
  const raw = String(scope || "").trim();
  if (!raw || raw.toUpperCase() === "GLOBAL") return true;
  return candidateScopesForOrg(org).includes(raw);
}

function delegationScopeCoversAgent(scope, agent) {
  return delegationScopeCoversOrg(scope, {
    direction_id: agent?.direction_id ?? null,
    departement_id: agent?.departement_id ?? null,
    service_id: agent?.service_id ?? null,
  });
}

module.exports = {
  candidateScopesForOrg,
  delegationScopeCoversOrg,
  delegationScopeCoversAgent,
};
