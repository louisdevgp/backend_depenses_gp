const { delegationScopeCoversOrg } = require("./delegationScope.utils");

function demandeOrg(demande) {
  return {
    direction_id: demande?.direction_id ?? null,
    departement_id: demande?.departement_id ?? null,
    service_id: demande?.service_id ?? null,
  };
}

function normalizedExcludedUserIds(excludeUserIds = []) {
  return new Set(
    (Array.isArray(excludeUserIds) ? excludeUserIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
}

function agentLabel(agent, fallback = "le delegant") {
  const label = [agent?.prenom, agent?.nom].filter(Boolean).join(" ").trim();
  return label || fallback;
}

async function getActiveDelegateEntriesForPrincipalAgents(
  prisma,
  principalAgents,
  org,
  { excludeUserIds = [] } = {}
) {
  const agentById = new Map(
    (Array.isArray(principalAgents) ? principalAgents : [])
      .filter((agent) => agent?.id != null)
      .map((agent) => [Number(agent.id), agent])
  );
  const principalAgentIds = Array.from(agentById.keys()).filter((id) => Number.isInteger(id) && id > 0);
  if (!principalAgentIds.length) return [];

  const excluded = normalizedExcludedUserIds(excludeUserIds);

  const now = new Date();
  const delegations = await prisma.delegations.findMany({
    where: {
      principal_id: { in: principalAgentIds },
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    include: {
      agents_delegations_delegate_idToagents: {
        include: { users: true },
      },
    },
  });

  const byUserId = new Map();

  for (const delegation of delegations) {
    if (!delegationScopeCoversOrg(delegation.scope, org)) continue;

    const delegateAgent = delegation.agents_delegations_delegate_idToagents;
    const delegateUser = delegateAgent?.users;
    const userId = Number(delegateUser?.id);
    if (!Number.isInteger(userId) || userId <= 0) continue;
    if (excluded.has(userId)) continue;
    if (delegateAgent?.deleted_at) continue;
    if (!delegateUser?.is_active || delegateUser?.deleted_at) continue;

    byUserId.set(userId, {
      user: delegateUser,
      principalAgent: agentById.get(Number(delegation.principal_id)) || null,
      delegation,
    });
  }

  return Array.from(byUserId.values());
}

async function getActiveDelegateUsersForDemande(prisma, demande, { excludeUserIds = [] } = {}) {
  const principalAgentId = Number(demande?.demandeur_id);
  if (!Number.isFinite(principalAgentId) || principalAgentId <= 0) return [];

  const principalAgent =
    demande?.agents_demandes_paiement_demandeur_idToagents || { id: principalAgentId };
  const entries = await getActiveDelegateEntriesForPrincipalAgents(
    prisma,
    [principalAgent],
    demandeOrg(demande),
    { excludeUserIds }
  );
  return entries.map((entry) => entry.user);
}

async function isActiveDelegateAgentForDemande(prisma, demande, delegateAgentId) {
  const principalAgentId = Number(demande?.demandeur_id);
  const delegateId = Number(delegateAgentId);
  if (!Number.isInteger(principalAgentId) || principalAgentId <= 0) return false;
  if (!Number.isInteger(delegateId) || delegateId <= 0) return false;
  if (principalAgentId === delegateId) return false;

  const now = new Date();
  const delegations = await prisma.delegations.findMany({
    where: {
      principal_id: principalAgentId,
      delegate_id: delegateId,
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    select: { scope: true },
  });

  const org = demandeOrg(demande);
  return delegations.some((delegation) => delegationScopeCoversOrg(delegation.scope, org));
}

async function getActiveDelegateEntriesForNotificationRecipient(
  prisma,
  recipientUserId,
  org,
  { excludeUserIds = [] } = {}
) {
  const userId = Number(recipientUserId);
  if (!Number.isInteger(userId) || userId <= 0) return [];

  const principalAgents = await prisma.agents.findMany({
    where: { user_id: userId, deleted_at: null },
    select: {
      id: true,
      nom: true,
      prenom: true,
      direction_id: true,
      departement_id: true,
      service_id: true,
    },
  });

  return getActiveDelegateEntriesForPrincipalAgents(prisma, principalAgents, org, {
    excludeUserIds: [userId, ...(Array.isArray(excludeUserIds) ? excludeUserIds : [])],
  });
}

module.exports = {
  agentLabel,
  getActiveDelegateEntriesForNotificationRecipient,
  getActiveDelegateUsersForDemande,
  isActiveDelegateAgentForDemande,
};
