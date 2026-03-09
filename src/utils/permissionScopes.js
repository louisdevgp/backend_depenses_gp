const DEFAULT_SCOPE = { type: "GLOBAL", id: null };
const VALID_SCOPE_TYPES = new Set(["GLOBAL", "DIRECTION", "DEPARTEMENT", "SERVICE"]);

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

  const rows = await prisma.user_permissions.findMany({
    where: { user_id: id, deleted_at: null },
    select: { permission_id: true, is_allowed: true },
  });

  if (!rows.length) {
    return { allowedCodes: [], deniedCodes: [], scopesByCode: {} };
  }

  const permIds = Array.from(new Set(rows.map((r) => r.permission_id).filter(Boolean)));
  if (!permIds.length) {
    return { allowedCodes: [], deniedCodes: [], scopesByCode: {} };
  }

  const permRows = await prisma.permissions.findMany({
    where: { id: { in: permIds }, deleted_at: null, is_active: true },
    select: { id: true, code: true },
  });

  const idToCode = new Map(permRows.map((p) => [p.id, normalizePermissionCode(p.code)]));
  const allowSet = new Set();
  const denySet = new Set();
  const allowIds = new Set();

  for (const row of rows) {
    const code = idToCode.get(row.permission_id);
    if (!code) continue;
    if (row.is_allowed) {
      allowSet.add(code);
      allowIds.add(row.permission_id);
    } else {
      denySet.add(code);
    }
  }

  const scopesMap = new Map();
  if (allowIds.size) {
    const scopeRows = await prisma.user_permission_scopes.findMany({
      where: {
        user_id: id,
        permission_id: { in: Array.from(allowIds) },
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

  const allowedCodes = Array.from(allowSet);
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
  scopeKey,
};
