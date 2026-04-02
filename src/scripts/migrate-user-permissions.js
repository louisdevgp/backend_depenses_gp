const { PrismaClient } = require("@prisma/client");
const { randomUUID: uuidv4 } = require("crypto");

const prisma = new PrismaClient();

async function main() {
  const rolePermRows = await prisma.role_permissions.findMany({
    where: { deleted_at: null },
    select: { role_id: true, permission_id: true },
  });

  if (!rolePermRows.length) {
    console.log("No role_permissions rows found. Nothing to migrate.");
    return;
  }

  const roleToPerms = new Map();
  for (const row of rolePermRows) {
    if (!row.role_id || !row.permission_id) continue;
    const list = roleToPerms.get(row.role_id) || [];
    list.push(row.permission_id);
    roleToPerms.set(row.role_id, list);
  }

  const users = await prisma.users.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      user_roles: { select: { role_id: true } },
      agents: { where: { deleted_at: null }, select: { role_id: true } },
    },
  });

  let createdPerms = 0;
  let createdScopes = 0;

  for (const user of users) {
    const roleIds = new Set();
    (user.user_roles || []).forEach((ur) => {
      if (ur?.role_id) roleIds.add(ur.role_id);
    });
    (user.agents || []).forEach((a) => {
      if (a?.role_id) roleIds.add(a.role_id);
    });

    if (!roleIds.size) continue;

    const permIds = new Set();
    for (const roleId of roleIds) {
      const perms = roleToPerms.get(roleId) || [];
      perms.forEach((pid) => permIds.add(pid));
    }
    if (!permIds.size) continue;

    const existingPermsRows = await prisma.user_permissions.findMany({
      where: { user_id: user.id, permission_id: { in: Array.from(permIds) } },
      select: { permission_id: true },
    });
    const existingPermSet = new Set(existingPermsRows.map((r) => r.permission_id));

    for (const permId of permIds) {
      if (!existingPermSet.has(permId)) {
        await prisma.user_permissions.create({
          data: {
            uuid: uuidv4(),
            user_id: user.id,
            permission_id: permId,
            is_allowed: true,
            deleted_at: null,
          },
        });
        createdPerms += 1;
      }

      // ensure GLOBAL scope
      const existingScope = await prisma.user_permission_scopes.findFirst({
        where: {
          user_id: user.id,
          permission_id: permId,
          scope_type: "GLOBAL",
          scope_id: null,
        },
        select: { id: true },
      });

      if (!existingScope) {
        await prisma.user_permission_scopes.create({
          data: {
            uuid: uuidv4(),
            user_id: user.id,
            permission_id: permId,
            scope_type: "GLOBAL",
            scope_id: null,
            deleted_at: null,
          },
        });
        createdScopes += 1;
      }
    }
  }

  console.log(
    `Migration done. user_permissions: +${createdPerms} created. ` +
      `user_permission_scopes: +${createdScopes} created.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

