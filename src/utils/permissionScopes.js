const DEFAULT_SCOPE = { type: "GLOBAL", id: null };
const VALID_SCOPE_TYPES = new Set(["GLOBAL", "DIRECTION", "DEPARTEMENT", "SERVICE"]);
const ROLE_IMPLICATIONS = {
  DG: ["DIRECTEUR"],
  DGA: ["DIRECTEUR"],
  DAF: ["DIRECTEUR"],
};

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function expandRoles(roleNames) {
  const out = new Set((roleNames || []).map(normalizeRoleName).filter(Boolean));
  for (const r of Array.from(out)) {
    const implied = ROLE_IMPLICATIONS[r] || [];
    for (const ir of implied) out.add(normalizeRoleName(ir));
  }
  return Array.from(out);
}

function normalizePermissionCode(code) {
  return String(code || "").trim().toUpperCase();
}

function normalizeScopeType(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  return VALID_SCOPE_TYPES.has(v) ? v : null;
}

function normalizeScopeId(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDelegationScope(scopeRaw) {
  if (scopeRaw == null) return DEFAULT_SCOPE;
  const s = String(scopeRaw).trim();
  if (!s) return DEFAULT_SCOPE;
  if (s.toUpperCase() === "GLOBAL") return DEFAULT_SCOPE;
  const m = /^([A-Z_]+)\s*:\s*(\d+)$/i.exec(s);
  if (!m) return null;
  const type = normalizeScopeType(m[1]);
  const id = normalizeScopeId(m[2]);
  if (!type) return null;
  return { type, id };
}

function scopeKey(scope) {
  const type = normalizeScopeType(scope?.type || scope?.scope_type) || "GLOBAL";
  const id = normalizeScopeId(scope?.id ?? scope?.scope_id);
  return `${type}:${id ?? "GLOBAL"}`;
}

function addScopeToMap(map, code, scope) {
  const key = scopeKey(scope);
  const list = map.get(code) || [];
  if (!list.some((s) => scopeKey(s) === key)) {
    list.push({
      type: normalizeScopeType(scope?.type || scope?.scope_type) || "GLOBAL",
      id: normalizeScopeId(scope?.id ?? scope?.scope_id),
    });
  }
  map.set(code, list);
}

function ensureDefaultScopes(allowedCodes, map) {
  for (const code of allowedCodes) {
    const list = map.get(code);
    if (!list || !list.length) {
      map.set(code, [DEFAULT_SCOPE]);
    }
  }
}

function scopesMapToObject(map) {
  const obj = {};
  for (const [code, list] of map.entries()) {
    obj[code] = list || [];
  }
  return obj;
}

function getScopesForPermissionFromUser(user, code) {
  const permCode = normalizePermissionCode(code);
  if (!permCode) return [DEFAULT_SCOPE];
  const map = user?.permissionScopes || {};
  const list = map[permCode];
  if (!Array.isArray(list) || list.length === 0) return [DEFAULT_SCOPE];
  return list.map((s) => ({
    type: normalizeScopeType(s?.type || s?.scope_type) || "GLOBAL",
    id: normalizeScopeId(s?.id ?? s?.scope_id),
  }));
}

function buildOrgScopeWhere(scopes, { wrap } = {}) {
  const list = Array.isArray(scopes) ? scopes : [];
  const normalized = list
    .map((s) => ({
      type: normalizeScopeType(s?.type || s?.scope_type),
      id: normalizeScopeId(s?.id ?? s?.scope_id),
    }))
    .filter((s) => s.type);

  if (!normalized.length) return null;

  if (normalized.some((s) => s.type === "GLOBAL")) return null;

  const directionIds = new Set();
  const departementIds = new Set();
  const serviceIds = new Set();

  for (const s of normalized) {
    if (s.type === "DIRECTION" && s.id != null) directionIds.add(Number(s.id));
    if (s.type === "DEPARTEMENT" && s.id != null) departementIds.add(Number(s.id));
    if (s.type === "SERVICE" && s.id != null) serviceIds.add(Number(s.id));
  }

  const ors = [];
  if (directionIds.size) ors.push({ direction_id: { in: Array.from(directionIds) } });
  if (departementIds.size) ors.push({ departement_id: { in: Array.from(departementIds) } });
  if (serviceIds.size) ors.push({ service_id: { in: Array.from(serviceIds) } });

  if (!ors.length) return { id: -1 };
  const base = ors.length === 1 ? ors[0] : { OR: ors };
  return wrap ? wrap(base) : base;
}

async function getUserPermissionProfile({ prisma, userId }) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    return { allowedCodes: [], deniedCodes: [], scopesByCode: {} };
  }

  const [user, agent] = await Promise.all([
    prisma.users.findUnique({
      where: { id },
      select: { user_roles: { select: { roles: { select: { name: true } } } } },
    }),
    prisma.agents.findFirst({
      where: { user_id: id, deleted_at: null },
      select: { id: true, roles: { select: { name: true } } },
    }),
  ]);

  const baseRoles = [
    ...(user?.user_roles || []).map((ur) => normalizeRoleName(ur?.roles?.name)),
    normalizeRoleName(agent?.roles?.name),
  ].filter(Boolean);

  let delegations = [];
  if (agent?.id) {
    const now = new Date();
    delegations = await prisma.delegations.findMany({
      where: {
        delegate_id: Number(agent.id),
        is_active: true,
        start_at: { lte: now },
        end_at: { gte: now },
      },
      select: { role_name: true, scope: true },
    });
  }

  const delegatedRoles = Array.from(
    new Set(delegations.map((d) => normalizeRoleName(d.role_name)).filter(Boolean))
  );

  const effectiveRoles = expandRoles([...baseRoles, ...delegatedRoles]);

  const roleRows = effectiveRoles.length
    ? await prisma.roles.findMany({
        where: { name: { in: effectiveRoles }, deleted_at: null, is_active: true },
        select: { id: true, name: true },
      })
    : [];

  const roleById = new Map(roleRows.map((r) => [Number(r.id), normalizeRoleName(r.name)]));
  const roleIds = roleRows.map((r) => r.id);

  const [userPermRows, rolePermRows] = await Promise.all([
    prisma.user_permissions.findMany({
      where: { user_id: id, deleted_at: null },
      select: { permission_id: true, is_allowed: true },
    }),
    roleIds.length
      ? prisma.role_permissions.findMany({
          where: { role_id: { in: roleIds }, deleted_at: null },
          select: { role_id: true, permission_id: true },
        })
      : Promise.resolve([]),
  ]);

  const permIds = Array.from(
    new Set([
      ...userPermRows.map((r) => r.permission_id).filter(Boolean),
      ...rolePermRows.map((r) => r.permission_id).filter(Boolean),
    ])
  );

  if (!permIds.length) {
    return { allowedCodes: [], deniedCodes: [], scopesByCode: {} };
  }

  const permRows = await prisma.permissions.findMany({
    where: { id: { in: permIds }, deleted_at: null, is_active: true },
    select: { id: true, code: true },
  });

  const idToCode = new Map(permRows.map((p) => [p.id, normalizePermissionCode(p.code)]));
  const codeToId = new Map(permRows.map((p) => [normalizePermissionCode(p.code), p.id]));

  const roleAllowed = new Set();
  const roleToCodes = new Map();
  for (const row of rolePermRows) {
    const code = idToCode.get(row.permission_id);
    if (!code) continue;
    roleAllowed.add(code);
    const roleName = roleById.get(Number(row.role_id));
    if (!roleName) continue;
    const list = roleToCodes.get(roleName) || new Set();
    list.add(code);
    roleToCodes.set(roleName, list);
  }

  const allowSet = new Set();
  const denySet = new Set();
  for (const row of userPermRows) {
    const code = idToCode.get(row.permission_id);
    if (!code) continue;
    if (row.is_allowed) allowSet.add(code);
    else denySet.add(code);
  }

  const allowedCodes = Array.from(
    new Set([...roleAllowed, ...allowSet].filter((c) => !denySet.has(c)))
  );

  const allowedPermIds = Array.from(
    new Set(allowedCodes.map((c) => codeToId.get(c)).filter(Boolean))
  );

  const scopesMap = new Map();
  if (allowedPermIds.length) {
    const scopeRows = await prisma.user_permission_scopes.findMany({
      where: {
        user_id: id,
        permission_id: { in: allowedPermIds },
        deleted_at: null,
      },
      select: { permission_id: true, scope_type: true, scope_id: true },
    });

    for (const row of scopeRows) {
      const code = idToCode.get(row.permission_id);
      if (!code) continue;
      addScopeToMap(scopesMap, code, { type: row.scope_type, id: row.scope_id });
    }
  }

  if (delegations.length) {
    for (const del of delegations) {
      const baseRole = normalizeRoleName(del.role_name);
      if (!baseRole) continue;
      const expanded = expandRoles([baseRole]);
      const scope = parseDelegationScope(del.scope);
      if (!scope) continue;
      for (const r of expanded) {
        const codes = roleToCodes.get(r);
        if (!codes) continue;
        for (const code of codes) {
          addScopeToMap(scopesMap, code, scope);
        }
      }
    }
  }

  ensureDefaultScopes(allowedCodes, scopesMap);

  return {
    allowedCodes,
    deniedCodes: Array.from(denySet),
    scopesByCode: scopesMapToObject(scopesMap),
  };
}

module.exports = {
  DEFAULT_SCOPE,
  VALID_SCOPE_TYPES,
  normalizePermissionCode,
  normalizeScopeType,
  normalizeScopeId,
  getUserPermissionProfile,
  getScopesForPermissionFromUser,
  buildOrgScopeWhere,
  parseDelegationScope,
  expandRoles,
  scopeKey,
};
