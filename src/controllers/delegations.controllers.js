const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const notifications = require("../services/notifications.services");
const { v4: uuidv4 } = require("uuid");

// Délégations autorisées uniquement entre rôles validateurs.
// Le délégué peut aussi être COMPTABLE (ex: DAF -> COMPTABLE).
const ALLOWED_PRINCIPAL_ROLES = new Set(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG"]);
const ALLOWED_DELEGATE_ROLES = new Set(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE"]);

function parseScope(scopeRaw) {
  if (scopeRaw == null) return null;
  const s = String(scopeRaw).trim();
  if (!s) return null;

  if (s.toUpperCase() === "GLOBAL") return { level: "GLOBAL", id: null, normalized: "GLOBAL" };

  const m = /^([A-Z_]+)\s*:\s*(\d+)$/i.exec(s);
  if (!m) return null;

  const level = String(m[1]).toUpperCase();
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!["DIRECTION", "DEPARTEMENT", "SERVICE"].includes(level)) return null;

  return { level, id, normalized: `${level}:${id}` };
}

async function getAgentOrg(agentId) {
  if (!agentId) return null;
  return prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { id: true, direction_id: true, departement_id: true, service_id: true },
  });
}

function computeDefaultScopeFromPrincipalOrg(principalOrg) {
  if (!principalOrg) return "GLOBAL";
  if (principalOrg.service_id) return `SERVICE:${Number(principalOrg.service_id)}`;
  if (principalOrg.departement_id) return `DEPARTEMENT:${Number(principalOrg.departement_id)}`;
  if (principalOrg.direction_id) return `DIRECTION:${Number(principalOrg.direction_id)}`;
  return "GLOBAL";
}

function validateScopeAgainstPrincipalOrg(scopeParsed, principalOrg) {
  if (!scopeParsed) return { ok: true };
  if (scopeParsed.level === "GLOBAL") return { ok: true };

  if (!principalOrg) return { ok: false, message: "Portée invalide (principal introuvable)" };

  if (scopeParsed.level === "DIRECTION") {
    if (!principalOrg.direction_id) return { ok: false, message: "Le principal n'a pas de direction" };
    if (Number(principalOrg.direction_id) !== Number(scopeParsed.id)) {
      return { ok: false, message: "Portée direction incompatible avec le principal" };
    }
    return { ok: true };
  }

  if (scopeParsed.level === "DEPARTEMENT") {
    if (!principalOrg.departement_id) return { ok: false, message: "Le principal n'a pas de département" };
    if (Number(principalOrg.departement_id) !== Number(scopeParsed.id)) {
      return { ok: false, message: "Portée département incompatible avec le principal" };
    }
    return { ok: true };
  }

  if (scopeParsed.level === "SERVICE") {
    if (!principalOrg.service_id) return { ok: false, message: "Le principal n'a pas de service" };
    if (Number(principalOrg.service_id) !== Number(scopeParsed.id)) {
      return { ok: false, message: "Portée service incompatible avec le principal" };
    }
    return { ok: true };
  }

  return { ok: false, message: "Portée invalide" };
}

function whereIdOrUuid(idOrUuid) {
  const n = Number(idOrUuid);
  return Number.isFinite(n) ? { id: n } : { uuid: idOrUuid };
}

function isAdmin(req) {
  const roles = req.user?.roles || [];
  return Array.isArray(roles) && roles.includes("ADMIN");
}

async function resolveActorAgentId(req) {
  const tokenAgentId = Number(req.user?.agentId);
  if (Number.isFinite(tokenAgentId) && tokenAgentId > 0) return tokenAgentId;

  const userId = Number(req.user?.userId);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const agent = await prisma.agents.findFirst({ where: { user_id: userId, deleted_at: null } });
  return agent?.id || null;
}

async function getAgentLabel(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { id: true, nom: true, prenom: true, user_id: true },
  });
  if (!a) return null;
  return {
    id: a.id,
    user_id: a.user_id,
    label: `${a.nom || ""} ${a.prenom || ""}`.trim() || `Agent#${a.id}`,
  };
}

function formatPeriod(startAt, endAt) {
  try {
    const s = startAt ? new Date(startAt) : null;
    const e = endAt ? new Date(endAt) : null;
    const sTxt = s && !Number.isNaN(s.getTime()) ? s.toLocaleString("fr-FR") : "?";
    const eTxt = e && !Number.isNaN(e.getTime()) ? e.toLocaleString("fr-FR") : "?";
    return `${sTxt} → ${eTxt}`;
  } catch {
    return "";
  }
}

async function notifyDelegation({ type, principal, delegate, role_name, period, is_active, actorLabel }) {
  const msg =
    type === "delegation_created"
      ? `Délégation créée (${role_name}) : ${principal?.label} → ${delegate?.label} • ${period}`
      : type === "delegation_updated"
        ? `Délégation modifiée (${role_name}) : ${principal?.label} → ${delegate?.label} • ${period}`
        : type === "delegation_toggled"
          ? `Délégation ${is_active ? "activée" : "désactivée"} (${role_name}) : ${principal?.label} → ${delegate?.label} • ${period}`
          : `Délégation supprimée (${role_name}) : ${principal?.label} → ${delegate?.label} • ${period}`;

  const meta = {
    role_name,
    period,
    is_active,
    principal_id: principal?.id,
    delegate_id: delegate?.id,
    actor: actorLabel || null,
  };

  const targets = [principal?.user_id, delegate?.user_id].filter(Boolean);
  for (const uid of Array.from(new Set(targets))) {
    await notifications.createNotification({
      user_id: uid,
      type,
      message: msg,
      meta,
      sendEmailNow: true,
    });
  }
}

async function resolveAgentId(agentIdOrUuid) {
  const a = await prisma.agents.findFirst({ where: { ...whereIdOrUuid(agentIdOrUuid), deleted_at: null } });
  return a?.id || null;
}

async function getAgentRoleName(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { id: true, roles: { select: { name: true } } },
  });
  return a?.roles?.name || null;
}

exports.list = async (req, res) => {
  const { principalIdOrUuid, delegateIdOrUuid, activeNow } = req.query;
  const where = {};

  const admin = isAdmin(req);
  const actorAgentId = await resolveActorAgentId(req);
  if (!admin && !actorAgentId) {
    return res.status(403).json({ success: false, message: "Agent non trouvé pour cet utilisateur" });
  }

  if (admin) {
    if (principalIdOrUuid) {
      const id = await resolveAgentId(principalIdOrUuid);
      if (!id) return res.status(400).json({ success: false, message: "Invalid principalIdOrUuid" });
      where.principal_id = id;
    }

    if (delegateIdOrUuid) {
      const id = await resolveAgentId(delegateIdOrUuid);
      if (!id) return res.status(400).json({ success: false, message: "Invalid delegateIdOrUuid" });
      where.delegate_id = id;
    }
  } else {
    // non-admin: visibilité limitée aux délégations où l'agent est principal OU délégué
    where.OR = [{ principal_id: actorAgentId }, { delegate_id: actorAgentId }];
  }

  if (String(activeNow) === "1") {
    const now = new Date();
    where.is_active = true;
    where.start_at = { lte: now };
    where.end_at = { gte: now };
  }

  const rows = await prisma.delegations.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      agents_delegations_principal_idToagents: true,
      agents_delegations_delegate_idToagents: true,
      agents_delegations_created_by_idToagents: true,
    },
  });

  res.json({ success: true, data: rows });
};

exports.getOne = async (req, res) => {
  const row = await prisma.delegations.findFirst({
    where: whereIdOrUuid(req.params.idOrUuid),
    include: {
      agents_delegations_principal_idToagents: true,
      agents_delegations_delegate_idToagents: true,
      agents_delegations_created_by_idToagents: true,
    },
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });

  const admin = isAdmin(req);
  if (!admin) {
    const actorAgentId = await resolveActorAgentId(req);
    if (!actorAgentId) return res.status(403).json({ success: false, message: "Agent non trouvé" });
    if (row.principal_id !== actorAgentId && row.delegate_id !== actorAgentId) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
  }

  res.json({ success: true, data: row });
};

exports.create = async (req, res) => {
  const { principalIdOrUuid, delegateIdOrUuid, role_name, scope, start_at, end_at } = req.body;
  const admin = isAdmin(req);
  const actorAgentId = await resolveActorAgentId(req);
  if (!admin && !actorAgentId) {
    return res.status(403).json({ success: false, message: "Agent non trouvé" });
  }

  const roleNameNorm = String(role_name || "").trim().toUpperCase();
  if (!principalIdOrUuid || !delegateIdOrUuid || !roleNameNorm || !start_at || !end_at) {
    return res.status(400).json({ success: false, message: "principal, delegate, role_name, start_at, end_at required" });
  }

  if (roleNameNorm === "ADMIN") {
    return res.status(400).json({ success: false, message: "Le rôle ADMIN ne peut pas être délégué" });
  }

  const principal_id = await resolveAgentId(principalIdOrUuid);
  const delegate_id = await resolveAgentId(delegateIdOrUuid);
  if (!principal_id || !delegate_id) {
    return res.status(400).json({ success: false, message: "Principal/delegate not found" });
  }

  if (Number(principal_id) === Number(delegate_id)) {
    return res.status(400).json({ success: false, message: "Le principal et le délégué doivent être différents" });
  }

  // role_name must be the principal's actual role
  const principalRole = await getAgentRoleName(principal_id);
  if (!principalRole) {
    return res.status(400).json({ success: false, message: "Le principal n'a pas de rôle défini" });
  }
  if (String(principalRole).toUpperCase() === "ADMIN") {
    return res.status(400).json({ success: false, message: "Le rôle ADMIN ne peut pas être délégué" });
  }

  // ✅ délégations uniquement entre validateurs: le principal doit être un rôle valideur
  if (!ALLOWED_PRINCIPAL_ROLES.has(String(principalRole).toUpperCase())) {
    return res
      .status(400)
      .json({ success: false, message: "Les délégations ne sont autorisées que pour les rôles validateurs" });
  }

  if (roleNameNorm !== String(principalRole).trim().toUpperCase()) {
    return res.status(400).json({ success: false, message: "role_name doit être le rôle du principal" });
  }

  // ✅ le délégué doit être un validateur ou COMPTABLE, pas DEMANDEUR
  const delegateRole = await getAgentRoleName(delegate_id);
  if (!delegateRole) {
    return res.status(400).json({ success: false, message: "Le délégué n'a pas de rôle défini" });
  }
  if (String(delegateRole).toUpperCase() === "ADMIN") {
    return res.status(400).json({ success: false, message: "Le rôle ADMIN ne peut pas être délégué" });
  }
  if (!ALLOWED_DELEGATE_ROLES.has(String(delegateRole).toUpperCase())) {
    return res.status(400).json({ success: false, message: "Le délégué doit être un validateur (ou COMPTABLE)" });
  }

  // non-admin: on autorise uniquement la création si l'utilisateur est le principal
  if (!admin && principal_id !== actorAgentId) {
    return res.status(403).json({ success: false, message: "Vous ne pouvez créer des délégations que pour vous-même" });
  }

  // Portée (scope): si absent → auto; si présent → validé/normalisé.
  const principalOrg = await getAgentOrg(principal_id);
  const parsedScope = parseScope(scope);
  if (scope != null && String(scope).trim() !== "" && !parsedScope) {
    return res.status(400).json({ success: false, message: "Portée invalide (scope)" });
  }
  const scopeCheck = validateScopeAgainstPrincipalOrg(parsedScope, principalOrg);
  if (!scopeCheck.ok) {
    return res.status(400).json({ success: false, message: scopeCheck.message || "Portée invalide" });
  }
  const scopeFinal = parsedScope?.normalized || computeDefaultScopeFromPrincipalOrg(principalOrg);

  const created_by_id = actorAgentId || principal_id;

  // Prisma: uuid requis dans le schema. Généré si non fourni.
  const uuid = req.body.uuid ? String(req.body.uuid).trim() : uuidv4();

  const row = await prisma.delegations.create({
    data: {
      uuid,
      principal_id,
      delegate_id,
      role_name: roleNameNorm,
      scope: scopeFinal,
      start_at: new Date(start_at),
      end_at: new Date(end_at),
      is_active: true,
      created_by_id,
    },
  });

  // Notifications (email)
  try {
    const principal = await getAgentLabel(principal_id);
    const delegate = await getAgentLabel(delegate_id);
    await notifyDelegation({
      type: "delegation_created",
      principal,
      delegate,
      role_name,
      period: formatPeriod(row.start_at, row.end_at),
      is_active: row.is_active,
      actorLabel: (await getAgentLabel(actorAgentId))?.label,
    });
  } catch {
    // ignore notification errors
  }

  res.status(201).json({ success: true, data: row });
};

exports.update = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const admin = isAdmin(req);
  const actorAgentId = await resolveActorAgentId(req);
  if (!admin) {
    if (!actorAgentId) return res.status(403).json({ success: false, message: "Agent non trouvé" });
    if (existing.principal_id !== actorAgentId && existing.delegate_id !== actorAgentId) {
      return res.status(403).json({ success: false, message: "Non autorisé" });
    }
  }

  const data = {};

  // ✅ période modifiable par principal OU délégué
  if (req.body.start_at) data.start_at = new Date(req.body.start_at);
  if (req.body.end_at) data.end_at = new Date(req.body.end_at);

  // Champs sensibles: seulement admin ou principal
  const canEditSensitive = admin || (actorAgentId && existing.principal_id === actorAgentId);
  if (canEditSensitive) {
    if (req.body.role_name) {
      const nextRole = String(req.body.role_name).trim().toUpperCase();
      if (nextRole === "ADMIN") {
        return res.status(400).json({ success: false, message: "Le rôle ADMIN ne peut pas être délégué" });
      }

      const principalRole = await getAgentRoleName(existing.principal_id);
      if (!principalRole) {
        return res.status(400).json({ success: false, message: "Le principal n'a pas de rôle défini" });
      }
      if (String(principalRole).toUpperCase() === "ADMIN") {
        return res.status(400).json({ success: false, message: "Le rôle ADMIN ne peut pas être délégué" });
      }
      if (nextRole !== String(principalRole).trim().toUpperCase()) {
        return res.status(400).json({ success: false, message: "role_name doit être le rôle du principal" });
      }

      data.role_name = nextRole;
    }
    if (req.body.scope !== undefined) data.scope = req.body.scope;
  }

  // Validation scope si fourni (normalisation + défaut auto)
  if (canEditSensitive && req.body.scope !== undefined) {
    const principalRole = await getAgentRoleName(existing.principal_id);
    if (!principalRole || String(principalRole).toUpperCase() === "ADMIN") {
      return res.status(400).json({ success: false, message: "Le principal n'a pas de rôle valide" });
    }
    if (!ALLOWED_PRINCIPAL_ROLES.has(String(principalRole).toUpperCase())) {
      return res
        .status(400)
        .json({ success: false, message: "Les délégations ne sont autorisées que pour les rôles validateurs" });
    }

    const principalOrg = await getAgentOrg(existing.principal_id);
    const parsedScope = parseScope(req.body.scope);
    if (req.body.scope != null && String(req.body.scope).trim() !== "" && !parsedScope) {
      return res.status(400).json({ success: false, message: "Portée invalide (scope)" });
    }
    const scopeCheck = validateScopeAgainstPrincipalOrg(parsedScope, principalOrg);
    if (!scopeCheck.ok) {
      return res.status(400).json({ success: false, message: scopeCheck.message || "Portée invalide" });
    }
    data.scope = parsedScope?.normalized || computeDefaultScopeFromPrincipalOrg(principalOrg);
  }

  const row = await prisma.delegations.update({
    where: { id: existing.id },
    data,
  });

  // Notifications (email)
  try {
    const principal = await getAgentLabel(existing.principal_id);
    const delegate = await getAgentLabel(existing.delegate_id);
    await notifyDelegation({
      type: "delegation_updated",
      principal,
      delegate,
      role_name: row.role_name,
      period: formatPeriod(row.start_at, row.end_at),
      is_active: row.is_active,
      actorLabel: (await getAgentLabel(actorAgentId))?.label,
    });
  } catch {
    // ignore
  }

  res.json({ success: true, data: row });
};

exports.toggleActive = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const admin = isAdmin(req);
  const actorAgentId = await resolveActorAgentId(req);
  if (!admin) {
    if (!actorAgentId) return res.status(403).json({ success: false, message: "Agent non trouvé" });
    if (existing.principal_id !== actorAgentId && existing.delegate_id !== actorAgentId) {
      return res.status(403).json({ success: false, message: "Non autorisé" });
    }
  }

  const row = await prisma.delegations.update({
    where: { id: existing.id },
    data: { is_active: !existing.is_active },
  });

  // Notifications (email)
  try {
    const principal = await getAgentLabel(existing.principal_id);
    const delegate = await getAgentLabel(existing.delegate_id);
    await notifyDelegation({
      type: "delegation_toggled",
      principal,
      delegate,
      role_name: row.role_name,
      period: formatPeriod(row.start_at, row.end_at),
      is_active: row.is_active,
      actorLabel: (await getAgentLabel(actorAgentId))?.label,
    });
  } catch {
    // ignore
  }

  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const admin = isAdmin(req);
  const actorAgentId = await resolveActorAgentId(req);
  if (!admin) {
    if (!actorAgentId) return res.status(403).json({ success: false, message: "Agent non trouvé" });
    // suppression reste réservée au principal (ou admin)
    if (existing.principal_id !== actorAgentId) {
      return res.status(403).json({ success: false, message: "Seul le principal peut supprimer cette délégation" });
    }
  }

  // Notifications (email) avant delete
  try {
    const principal = await getAgentLabel(existing.principal_id);
    const delegate = await getAgentLabel(existing.delegate_id);
    await notifyDelegation({
      type: "delegation_deleted",
      principal,
      delegate,
      role_name: existing.role_name,
      period: formatPeriod(existing.start_at, existing.end_at),
      is_active: existing.is_active,
      actorLabel: (await getAgentLabel(actorAgentId))?.label,
    });
  } catch {
    // ignore
  }

  await prisma.delegations.delete({ where: { id: existing.id } });
  res.json({ success: true, message: "Deleted" });
};

exports.listAgentsForDelegation = async (req, res) => {
  // minimal list for UI selection
  const rows = await prisma.agents.findMany({
    where: {
      deleted_at: null,
      roles: { is: { name: { in: Array.from(new Set([...ALLOWED_PRINCIPAL_ROLES, ...ALLOWED_DELEGATE_ROLES])) } } },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    select: {
      id: true,
      uuid: true,
      nom: true,
      prenom: true,
      direction_id: true,
      departement_id: true,
      service_id: true,
      users: { select: { email: true } },
      roles: { select: { name: true } },
    },
  });

  res.json({ success: true, data: rows });
};
