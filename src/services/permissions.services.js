const prisma = require("../config/prisma");
const { randomUUID: uuidv4 } = require("crypto");
const permissionMeta = require("../config/permissions.meta");
const {
  normalizePermissionCode,
  normalizeScopeType,
  normalizeScopeId,
  scopeKey,
} = require("../utils/permissionScopes");

const VALID_APPLIES_TO = new Set(["menu", "action"]);

function normalizeAppliesTo(raw) {
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "both") {
      items = ["menu", "action"];
    } else {
      items = [raw];
    }
  }

  const out = items
    .map((v) => String(v || "").trim().toLowerCase())
    .filter((v) => VALID_APPLIES_TO.has(v));

  if (!out.length) return ["action"];
  return Array.from(new Set(out));
}

function mergePermissionMeta(row) {
  const meta = permissionMeta[row.code] || {};
  const appliesTo = normalizeAppliesTo(meta.appliesTo ?? meta.scope);
  const moduleName = String(meta.module || "").trim() || "Other";
  const label = row.label || meta.label || row.code;

  return {
    ...row,
    label,
    module: moduleName,
    appliesTo,
    description: meta.description || undefined,
  };
}

function toIntId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) throw new Error("INVALID_ID");
  return n;
}

function normalizeCodes(codes) {
  const arr = Array.isArray(codes) ? codes : [codes];
  return Array.from(
    new Set(
      arr
        .map((c) => String(c || "").trim())
        .filter(Boolean)
        .map((c) => normalizePermissionCode(c))
    )
  );
}

function normalizeScopePayload(scopes) {
  const out = {};
  if (!scopes || typeof scopes !== "object") return out;

  for (const [rawCode, rawList] of Object.entries(scopes)) {
    const code = normalizePermissionCode(rawCode);
    if (!code) continue;
    const list = Array.isArray(rawList) ? rawList : [];
    const normalized = [];
    for (const item of list) {
      const type = normalizeScopeType(item?.type || item?.scope_type);
      if (!type) continue;
      const id = normalizeScopeId(item?.id ?? item?.scope_id);
      normalized.push({ type, id });
    }
    out[code] = normalized;
  }
  return out;
}

exports.listPermissions = async () => {
  const rows = await prisma.permissions.findMany({
    where: { deleted_at: null, is_active: true },
    orderBy: { code: "asc" },
  });
  return rows.map(mergePermissionMeta);
};

exports.getRolePermissionCodes = async (roleId) => {
  const id = toIntId(roleId);

  const role = await prisma.roles.findFirst({
    where: { id, deleted_at: null, is_active: true },
  });
  if (!role) throw new Error("ROLE_NOT_FOUND");

  const rows = await prisma.role_permissions.findMany({
    where: {
      role_id: id,
      deleted_at: null,
    },
    select: { permission_id: true },
  });

  const permIds = Array.from(new Set(rows.map((r) => r.permission_id).filter(Boolean)));
  if (!permIds.length) return [];

  const permRows = await prisma.permissions.findMany({
    where: { id: { in: permIds }, deleted_at: null, is_active: true },
    select: { code: true },
  });

  return permRows.map((p) => p.code).filter(Boolean);
};

exports.setRolePermissions = async (roleId, permissionCodes) => {
  const id = toIntId(roleId);
  const codes = normalizeCodes(permissionCodes);

  const role = await prisma.roles.findFirst({
    where: { id, deleted_at: null, is_active: true },
  });
  if (!role) throw new Error("ROLE_NOT_FOUND");

  const perms = codes.length
    ? await prisma.permissions.findMany({
        where: { code: { in: codes }, deleted_at: null, is_active: true },
        select: { id: true, code: true },
      })
    : [];

  if (codes.length && perms.length !== codes.length) {
    const found = new Set(perms.map((p) => p.code));
    const missing = codes.filter((c) => !found.has(c));
    throw new Error(`UNKNOWN_PERMISSION: ${missing.join(",")}`);
  }

  const permIds = perms.map((p) => p.id);

  return prisma.$transaction(async (tx) => {
    // Soft-delete removed permissions
    await tx.role_permissions.updateMany({
      where: {
        role_id: id,
        deleted_at: null,
        ...(permIds.length ? { permission_id: { notIn: permIds } } : {}),
      },
      data: { deleted_at: new Date() },
    });

    if (permIds.length) {
      // Restore if previously deleted
      await tx.role_permissions.updateMany({
        where: {
          role_id: id,
          permission_id: { in: permIds },
          deleted_at: { not: null },
        },
        data: { deleted_at: null },
      });

      // Create missing pairs
      const existing = await tx.role_permissions.findMany({
        where: {
          role_id: id,
          permission_id: { in: permIds },
          deleted_at: null,
        },
        select: { permission_id: true },
      });
      const existingSet = new Set(existing.map((e) => e.permission_id));

      const toCreate = permIds.filter((pid) => !existingSet.has(pid));
      if (toCreate.length) {
        await tx.role_permissions.createMany({
          data: toCreate.map((pid) => ({
            uuid: uuidv4(),
            role_id: id,
            permission_id: pid,
            deleted_at: null,
          })),
        });
      }
    }

    return {
      role_id: id,
      permissionCodes: perms.map((p) => p.code),
    };
  });
};

function normalizeOverrideCodes(input) {
  const allowCodes = normalizeCodes(input?.allowCodes ?? input?.allow ?? []);
  const denyCodes = normalizeCodes(input?.denyCodes ?? input?.deny ?? []);
  const overlap = allowCodes.filter((c) => denyCodes.includes(c));
  if (overlap.length) {
    throw new Error(`PERMISSION_CONFLICT: ${overlap.join(",")}`);
  }
  return { allowCodes, denyCodes };
}

exports.getUserPermissionOverrides = async (userId) => {
  const id = toIntId(userId);

  const user = await prisma.users.findFirst({
    where: { id, deleted_at: null },
    select: { id: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const rows = await prisma.user_permissions.findMany({
    where: { user_id: id, deleted_at: null },
    select: { permission_id: true, is_allowed: true },
  });

  if (!rows.length) {
    return { user_id: id, allowCodes: [], denyCodes: [] };
  }

  const permIds = Array.from(new Set(rows.map((r) => r.permission_id).filter(Boolean)));
  if (!permIds.length) {
    return { user_id: id, allowCodes: [], denyCodes: [] };
  }

  const permRows = await prisma.permissions.findMany({
    where: { id: { in: permIds }, deleted_at: null, is_active: true },
    select: { id: true, code: true },
  });
  const idToCode = new Map(permRows.map((p) => [p.id, p.code]));

  const allowCodes = [];
  const denyCodes = [];
  const allowIds = new Set();
  for (const row of rows) {
    const code = idToCode.get(row.permission_id);
    if (!code) continue;
    if (row.is_allowed) {
      allowCodes.push(code);
      allowIds.add(row.permission_id);
    } else {
      denyCodes.push(code);
    }
  }

  const scopes = {};
  if (allowIds.size) {
    const scopeRows = await prisma.user_permission_scopes.findMany({
      where: { user_id: id, permission_id: { in: Array.from(allowIds) }, deleted_at: null },
      select: { permission_id: true, scope_type: true, scope_id: true },
    });
    const codeToScopes = new Map();
    for (const row of scopeRows) {
      const code = idToCode.get(row.permission_id);
      if (!code) continue;
      const list = codeToScopes.get(code) || [];
      list.push({ type: row.scope_type, id: row.scope_id });
      codeToScopes.set(code, list);
    }
    for (const code of allowCodes) {
      scopes[code] = codeToScopes.get(code) || [{ type: "GLOBAL", id: null }];
    }
  }

  return { user_id: id, allowCodes, denyCodes, scopes };
};

exports.setUserPermissionOverrides = async (userId, payload = {}) => {
  const id = toIntId(userId);
  const { allowCodes, denyCodes } = normalizeOverrideCodes(payload);
  const scopePayload = normalizeScopePayload(payload?.scopes);

  const user = await prisma.users.findFirst({
    where: { id, deleted_at: null },
    select: { id: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const allCodes = [...allowCodes, ...denyCodes];
  const perms = allCodes.length
    ? await prisma.permissions.findMany({
        where: { code: { in: allCodes }, deleted_at: null, is_active: true },
        select: { id: true, code: true },
      })
    : [];

  if (allCodes.length && perms.length !== allCodes.length) {
    const found = new Set(perms.map((p) => p.code));
    const missing = allCodes.filter((c) => !found.has(c));
    throw new Error(`UNKNOWN_PERMISSION: ${missing.join(",")}`);
  }

  const codeToId = new Map(perms.map((p) => [p.code, p.id]));
  const allowIds = allowCodes.map((c) => codeToId.get(c)).filter(Boolean);
  const denyIds = denyCodes.map((c) => codeToId.get(c)).filter(Boolean);
  const allIds = Array.from(new Set([...allowIds, ...denyIds]));

  return prisma.$transaction(async (tx) => {
    if (allIds.length) {
      await tx.user_permissions.updateMany({
        where: { user_id: id, deleted_at: null, permission_id: { notIn: allIds } },
        data: { deleted_at: new Date() },
      });
    } else {
      await tx.user_permissions.updateMany({
        where: { user_id: id, deleted_at: null },
        data: { deleted_at: new Date() },
      });
    }

    if (allowIds.length) {
      await tx.user_permissions.updateMany({
        where: { user_id: id, permission_id: { in: allowIds } },
        data: { is_allowed: true, deleted_at: null },
      });
    }

    if (denyIds.length) {
      await tx.user_permissions.updateMany({
        where: { user_id: id, permission_id: { in: denyIds } },
        data: { is_allowed: false, deleted_at: null },
      });
    }

    const existing = allIds.length
      ? await tx.user_permissions.findMany({
          where: { user_id: id, permission_id: { in: allIds }, deleted_at: null },
          select: { permission_id: true },
        })
      : [];
    const existingSet = new Set(existing.map((e) => e.permission_id));

    const toCreate = [];
    for (const pid of allowIds) {
      if (!existingSet.has(pid)) {
        toCreate.push({
          uuid: uuidv4(),
          user_id: id,
          permission_id: pid,
          is_allowed: true,
          deleted_at: null,
        });
      }
    }
    for (const pid of denyIds) {
      if (!existingSet.has(pid)) {
        toCreate.push({
          uuid: uuidv4(),
          user_id: id,
          permission_id: pid,
          is_allowed: false,
          deleted_at: null,
        });
      }
    }

    if (toCreate.length) {
      await tx.user_permissions.createMany({ data: toCreate });
    }

    // --- scopes (allowed permissions only) ---
    const allowedIdToCode = new Map(perms.map((p) => [p.id, p.code]));
    const desiredScopes = [];
    for (const pid of allowIds) {
      const code = allowedIdToCode.get(pid);
      if (!code) continue;
      const desired = scopePayload[code];
      const scopes = Array.isArray(desired) && desired.length ? desired : [{ type: "GLOBAL", id: null }];
      for (const s of scopes) {
        desiredScopes.push({
          permission_id: pid,
          scope_type: normalizeScopeType(s.type) || "GLOBAL",
          scope_id: normalizeScopeId(s.id),
        });
      }
    }

    const existingScopes = await tx.user_permission_scopes.findMany({
      where: { user_id: id },
      select: { id: true, permission_id: true, scope_type: true, scope_id: true, deleted_at: true },
    });

    const desiredKeySet = new Set(desiredScopes.map((s) => `${s.permission_id}:${scopeKey(s)}`));
    const existingKeySet = new Set(existingScopes.map((s) => `${s.permission_id}:${scopeKey(s)}`));

    // Soft-delete scopes not desired
    const toDeleteIds = existingScopes
      .filter((s) => !desiredKeySet.has(`${s.permission_id}:${scopeKey(s)}`) && s.deleted_at == null)
      .map((s) => s.id);
    if (toDeleteIds.length) {
      await tx.user_permission_scopes.updateMany({
        where: { id: { in: toDeleteIds } },
        data: { deleted_at: new Date() },
      });
    }

    // Restore scopes that exist but were deleted
    const toRestoreIds = existingScopes
      .filter((s) => desiredKeySet.has(`${s.permission_id}:${scopeKey(s)}`) && s.deleted_at != null)
      .map((s) => s.id);
    if (toRestoreIds.length) {
      await tx.user_permission_scopes.updateMany({
        where: { id: { in: toRestoreIds } },
        data: { deleted_at: null },
      });
    }

    // Create missing scopes
    const toCreateScopes = desiredScopes.filter(
      (s) => !existingKeySet.has(`${s.permission_id}:${scopeKey(s)}`)
    );
    if (toCreateScopes.length) {
      await tx.user_permission_scopes.createMany({
        data: toCreateScopes.map((s) => ({
          uuid: uuidv4(),
          user_id: id,
          permission_id: s.permission_id,
          scope_type: s.scope_type,
          scope_id: s.scope_id,
          deleted_at: null,
        })),
      });
    }

    return { user_id: id, allowCodes, denyCodes, scopes: scopePayload };
  });
};

