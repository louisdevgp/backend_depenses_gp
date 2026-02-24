const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function idWhere(idOrUuid) {
  const asNumber = Number(idOrUuid);
  if (!Number.isNaN(asNumber)) return { id: asNumber };
  return { uuid: idOrUuid };
}

async function getPrimaryRoleName(userId) {
  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { roles: { select: { name: true } } },
  });
  const roleName = agent?.roles?.name ? normalizeRoleName(agent.roles.name) : null;
  return roleName || null;
}

async function setRoles(userIdOrUuid, roleNames) {
  if (!Array.isArray(roleNames)) {
    throw new Error("roles[] required");
  }

  const user = await prisma.users.findFirst({ where: { ...idWhere(userIdOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const primaryRole = await getPrimaryRoleName(user.id);
  if (roleNames.length === 0 && !primaryRole) {
    throw new Error("roles[] required");
  }

  const normalized = Array.from(new Set(roleNames.map(normalizeRoleName).filter(Boolean)));
  if (primaryRole && !normalized.includes(primaryRole)) normalized.push(primaryRole);

  const roles = await prisma.roles.findMany({
    where: { name: { in: normalized }, deleted_at: null, is_active: true },
  });
  if (roles.length !== normalized.length) throw new Error("Some roles not found/inactive");

  await prisma.$transaction(async (tx) => {
    await tx.user_roles.deleteMany({ where: { user_id: user.id } });
    await tx.user_roles.createMany({
      data: roles.map((r) => ({ user_id: user.id, role_id: r.id })),
    });
  });

  return { user_id: user.id, roles: normalized };
}

async function addRole(userIdOrUuid, roleName) {
  if (!roleName) throw new Error("role required");

  const user = await prisma.users.findFirst({ where: { ...idWhere(userIdOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const role = await prisma.roles.findFirst({
    where: { name: normalizeRoleName(roleName), deleted_at: null, is_active: true },
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

  const primaryRole = await getPrimaryRoleName(user.id);
  const normalized = normalizeRoleName(roleName);
  if (primaryRole && normalized === primaryRole) {
    throw new Error("Cannot remove primary role");
  }

  const role = await prisma.roles.findFirst({ where: { name: normalized } });
  if (!role) throw new Error("Role not found");

  await prisma.user_roles.delete({
    where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
  });

  return { user_id: user.id, removed: roleName };
}

module.exports = { setRoles, addRole, removeRole };
