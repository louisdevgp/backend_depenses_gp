const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");

const prisma = new PrismaClient();

const permissionMap = require("../config/permissions");
const P = require("../constants/permissions");

function toLabel(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  // 1) Upsert all permissions (from constants)
  const codes = Array.from(new Set(Object.values(P).map((v) => String(v).trim()).filter(Boolean)));
  for (const code of codes) {
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

  const entries = [];
  for (const pair of desiredPairs) {
    const role = roleByName.get(pair.roleName);
    const perm = permByCode.get(pair.permCode);
    if (!role || !perm) continue;
    entries.push({
      role_id: role.id,
      permission_id: perm.id,
    });
  }

  // 3) Restore soft-deleted rows for desired pairs
  for (const e of entries) {
    await prisma.role_permissions.updateMany({
      where: {
        role_id: e.role_id,
        permission_id: e.permission_id,
        deleted_at: { not: null },
      },
      data: { deleted_at: null },
    });
  }

  // 4) Create missing rows (skipDuplicates)
  if (entries.length) {
    await prisma.role_permissions.createMany({
      data: entries.map((e) => ({
        uuid: uuidv4(),
        role_id: e.role_id,
        permission_id: e.permission_id,
        deleted_at: null,
      })),
      skipDuplicates: true,
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
