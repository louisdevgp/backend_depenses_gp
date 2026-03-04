const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const permissionMeta = require("../config/permissions.meta");

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
        .map((c) => c.toUpperCase())
    )
  );
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
  for (const row of rows) {
    const code = idToCode.get(row.permission_id);
    if (!code) continue;
    if (row.is_allowed) allowCodes.push(code);
    else denyCodes.push(code);
  }

  return { user_id: id, allowCodes, denyCodes };
};

exports.setUserPermissionOverrides = async (userId, payload = {}) => {
  const id = toIntId(userId);
  const { allowCodes, denyCodes } = normalizeOverrideCodes(payload);

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

    return { user_id: id, allowCodes, denyCodes };
  });
};
