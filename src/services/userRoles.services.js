const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function idWhere(idOrUuid) {
  const asNumber = Number(idOrUuid);
  if (!Number.isNaN(asNumber)) return { id: asNumber };
  return { uuid: idOrUuid };
}

async function setRoles(userIdOrUuid, roleNames) {
  if (!Array.isArray(roleNames) || roleNames.length === 0) {
    throw new Error("roles[] required");
  }

  const user = await prisma.users.findFirst({ where: { ...idWhere(userIdOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const roles = await prisma.roles.findMany({
    where: { name: { in: roleNames }, deleted_at: null, is_active: true },
  });
  if (roles.length !== roleNames.length) throw new Error("Some roles not found/inactive");

  await prisma.$transaction(async (tx) => {
    await tx.user_roles.deleteMany({ where: { user_id: user.id } });
    await tx.user_roles.createMany({
      data: roles.map((r) => ({ user_id: user.id, role_id: r.id })),
    });
  });

  return { user_id: user.id, roles: roleNames };
}

async function addRole(userIdOrUuid, roleName) {
  if (!roleName) throw new Error("role required");

  const user = await prisma.users.findFirst({ where: { ...idWhere(userIdOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const role = await prisma.roles.findFirst({
    where: { name: roleName, deleted_at: null, is_active: true },
  });
  if (!role) throw new Error("Role not found/inactive");

  await prisma.user_roles.upsert({
    where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
    update: {},
    create: { user_id: user.id, role_id: role.id },
  });

  return { user_id: user.id, added: roleName };
}

async function removeRole(userIdOrUuid, roleName) {
  const user = await prisma.users.findFirst({ where: { ...idWhere(userIdOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const role = await prisma.roles.findFirst({ where: { name: roleName } });
  if (!role) throw new Error("Role not found");

  await prisma.user_roles.delete({
    where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
  });

  return { user_id: user.id, removed: roleName };
}

module.exports = { setRoles, addRole, removeRole };
