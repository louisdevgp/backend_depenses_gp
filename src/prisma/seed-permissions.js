const { PrismaClient } = require("@prisma/client");
const { randomUUID: uuidv4 } = require("crypto");

const prisma = new PrismaClient();

const permissionMap = require("../config/permissions");
const P = require("../constants/permissions");
const seedLog = require("./seed-logger");

function toLabel(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const startedAt = Date.now();
  seedLog.start("seed:permissions");

  // 1) Upsert all permissions (from constants)
  const codes = Array.from(new Set(Object.values(P).map((v) => String(v).trim()).filter(Boolean)));
  const existingPermissions = await prisma.permissions.findMany({
    where: { code: { in: codes } },
    select: { code: true, is_active: true, deleted_at: true },
  });
  const existingByCode = new Map(existingPermissions.map((p) => [String(p.code), p]));
  let permissionsCreated = 0;
  let permissionsReactivated = 0;

  for (const code of codes) {
    const existing = existingByCode.get(code);
    if (!existing) permissionsCreated += 1;
    if (existing && (!existing.is_active || existing.deleted_at)) permissionsReactivated += 1;

    await prisma.permissions.upsert({
      where: { code },
      update: { label: toLabel(code), is_active: true, deleted_at: null },
      create: {
        uuid: uuidv4(),
        code,
        label: toLabel(code),
        is_active: true,
        deleted_at: null,
      },
    });
  }
  seedLog.info("permissions synced", {
    total: codes.length,
    created: permissionsCreated,
    reactivated: permissionsReactivated,
  });

  // 2) Build desired role-permission pairs from current mapping
  const desiredPairs = [];
  for (const [permCode, allowedRoles] of Object.entries(permissionMap || {})) {
    const pr = String(permCode || "").trim();
    if (!pr) continue;
    for (const roleNameRaw of Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]) {
      const roleName = String(roleNameRaw || "")
        .trim()
        .toUpperCase();
      if (!roleName) continue;
      desiredPairs.push({ roleName, permCode: pr });
    }
  }

  const roleNames = Array.from(new Set(desiredPairs.map((p) => p.roleName)));
  const permCodes = Array.from(new Set(desiredPairs.map((p) => p.permCode)));

  const [roles, perms] = await Promise.all([
    prisma.roles.findMany({ where: { name: { in: roleNames }, deleted_at: null, is_active: true } }),
    prisma.permissions.findMany({ where: { code: { in: permCodes }, deleted_at: null, is_active: true } }),
  ]);

  const roleByName = new Map(roles.map((r) => [String(r.name).toUpperCase(), r]));
  const permByCode = new Map(perms.map((p) => [String(p.code), p]));
  const missingRoles = roleNames.filter((name) => !roleByName.has(name));
  const missingPerms = permCodes.filter((code) => !permByCode.has(code));
  if (missingRoles.length) seedLog.warn("roles missing for permission mapping", missingRoles);
  if (missingPerms.length) seedLog.warn("permissions missing for role mapping", missingPerms);

  const entries = [];
  const entryKeys = new Set();
  for (const pair of desiredPairs) {
    const role = roleByName.get(pair.roleName);
    const perm = permByCode.get(pair.permCode);
    if (!role || !perm) continue;
    const key = `${role.id}:${perm.id}`;
    if (entryKeys.has(key)) continue;
    entryKeys.add(key);
    entries.push({
      role_id: role.id,
      permission_id: perm.id,
    });
  }

  // 3) Restore soft-deleted rows for desired pairs
  let restoredRolePermissions = 0;
  for (const e of entries) {
    const restored = await prisma.role_permissions.updateMany({
      where: {
        role_id: e.role_id,
        permission_id: e.permission_id,
        deleted_at: { not: null },
      },
      data: { deleted_at: null },
    });
    restoredRolePermissions += restored.count || 0;
  }

  // 4) Create missing rows (skipDuplicates)
  let createdRolePermissions = 0;
  if (entries.length) {
    const created = await prisma.role_permissions.createMany({
      data: entries.map((e) => ({
        uuid: uuidv4(),
        role_id: e.role_id,
        permission_id: e.permission_id,
        deleted_at: null,
      })),
      skipDuplicates: true,
    });
    createdRolePermissions = created.count || 0;
  }

  seedLog.info("role permissions synced", {
    desired: entries.length,
    restored: restoredRolePermissions,
    created: createdRolePermissions,
  });
  seedLog.end("seed:permissions", startedAt);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    seedLog.error("seed:permissions failed", e);
    prisma.$disconnect();
    process.exit(1);
  });

