const GLOBAL_SCOPE_ROLES = new Set(["DAF", "DGA", "DG"]);

function defaultDelegationScopeForRole(roleName, org) {
  const role = String(roleName || "").trim().toUpperCase();
  if (GLOBAL_SCOPE_ROLES.has(role)) return "GLOBAL";

  if (!org) return "GLOBAL";
  if (org.service_id) return `SERVICE:${Number(org.service_id)}`;
  if (org.departement_id) return `DEPARTEMENT:${Number(org.departement_id)}`;
  if (org.direction_id) return `DIRECTION:${Number(org.direction_id)}`;
  return "GLOBAL";
}

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
  defaultDelegationScopeForRole,
  candidateScopesForOrg,
  delegationScopeCoversOrg,
  delegationScopeCoversAgent,
};
