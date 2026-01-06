const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function idWhere(idOrUuid) {
  const asNumber = Number(idOrUuid);
  if (!Number.isNaN(asNumber)) return { id: asNumber };
  return { uuid: idOrUuid };
}

async function me(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: { user_roles: { include: { roles: true } }, agents: true },
  });

  if (!user || user.deleted_at) throw new Error("User not found");

  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    is_active: user.is_active,
    roles: user.user_roles.map((ur) => ur.roles.name),
    agent: user.agents?.[0] || null,
  };
}

async function list(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  const skip = (page - 1) * limit;

  const q = (query.q || "").trim();
  const is_active = query.is_active === undefined ? undefined : query.is_active === "true";

  const where = {
    deleted_at: null,
    ...(is_active === undefined ? {} : { is_active }),
    ...(q
      ? {
          OR: [
            { email: { contains: q } },
            { nom: { contains: q } },
            { prenom: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.users.count({ where }),
    prisma.users.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: "desc" },
      include: { user_roles: { include: { roles: true } } },
    }),
  ]);

  return {
    page,
    limit,
    total,
    items: items.map((u) => ({
      id: u.id,
      uuid: u.uuid,
      email: u.email,
      nom: u.nom,
      prenom: u.prenom,
      is_active: u.is_active,
      roles: u.user_roles.map((ur) => ur.roles.name),
      created_at: u.created_at,
    })),
  };
}

async function getById(idOrUuid) {
  const user = await prisma.users.findFirst({
    where: { ...idWhere(idOrUuid), deleted_at: null },
    include: { user_roles: { include: { roles: true } }, agents: true },
  });
  if (!user) throw new Error("User not found");
  return {
    ...user,
    roles: user.user_roles.map((ur) => ur.roles.name),
    agent: user.agents?.[0] || null,
  };
}

async function update(idOrUuid, payload) {
  const data = {};
  if (payload.nom !== undefined) data.nom = payload.nom;
  if (payload.prenom !== undefined) data.prenom = payload.prenom;
  if (payload.is_active !== undefined) data.is_active = !!payload.is_active;

  const updated = await prisma.users.update({
    where: idWhere(idOrUuid),
    data,
  });
  return { id: updated.id, uuid: updated.uuid };
}

async function softDelete(idOrUuid, performedByUserId) {
  // soft delete user + audit optionnel
  const updated = await prisma.users.update({
    where: idWhere(idOrUuid),
    data: { deleted_at: new Date(), is_active: false },
  });

  // si tu veux logger dans audit_logs ici (optionnel)
  // await prisma.audit_logs.create({ data: {...} });

  return { id: updated.id, uuid: updated.uuid, deleted: true };
}

module.exports = { me, list, getById, update, softDelete };
