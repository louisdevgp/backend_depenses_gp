const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { randomUUID: uuidv4 } = require("crypto");

function toIntId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid id");
  return n;
}

exports.list = async ({ includeDeleted = "false" } = {}) => {
  const include = includeDeleted === "true";
  return prisma.roles.findMany({
    where: include ? {} : { deleted_at: null },
    orderBy: { id: "desc" },
  });
};

exports.getById = async (id) => {
  return prisma.roles.findFirst({
    where: { id: toIntId(id) },
  });
};

exports.create = async ({ name, label, description }) => {
  if (!name || !label) throw new Error("name and label are required");

  return prisma.roles.create({
    data: {
      uuid: uuidv4(),
      name: String(name).trim().toUpperCase(),
      label: String(label).trim(),
      description: description ? String(description) : null,
      is_active: true,
      deleted_at: null,
    },
  });
};

exports.update = async (id, { name, label, description, is_active }) => {
  const roleId = toIntId(id);

  const data = {};
  if (name !== undefined) data.name = String(name).trim().toUpperCase();
  if (label !== undefined) data.label = String(label).trim();
  if (description !== undefined) data.description = description ? String(description) : null;
  if (is_active !== undefined) data.is_active = Boolean(is_active);

  return prisma.roles.update({
    where: { id: roleId },
    data,
  });
};

exports.softDelete = async (id) => {
  const roleId = toIntId(id);

  // sécurité: si le role est utilisé (agents ou user_roles), tu peux bloquer
  const usedInAgents = await prisma.agents.count({ where: { role_id: roleId } });
  const usedInUserRoles = await prisma.user_roles.count({ where: { role_id: roleId } });

  if (usedInAgents > 0 || usedInUserRoles > 0) {
    // on le désactive plutôt que supprimer
    return prisma.roles.update({
      where: { id: roleId },
      data: { is_active: false, deleted_at: new Date() },
    });
  }

  return prisma.roles.update({
    where: { id: roleId },
    data: { is_active: false, deleted_at: new Date() },
  });
};

exports.restore = async (id) => {
  const roleId = toIntId(id);
  return prisma.roles.update({
    where: { id: roleId },
    data: { is_active: true, deleted_at: null },
  });
};

