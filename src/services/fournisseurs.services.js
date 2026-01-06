const prisma = require("../config/prisma");
const { whereIdOrUuid } = require("../utils/id.utils");
const { v4: uuidv4 } = require("uuid");

async function createFournisseur(payload) {
  const data = {
    uuid: uuidv4(),
    nom: payload.nom,
    rccm: payload.rccm ?? null,
    nif: payload.nif ?? null,
    telephone: payload.telephone ?? null,
    email: payload.email ?? null,
    adresse: payload.adresse ?? null,
    ville: payload.ville ?? null,
    pays: payload.pays ?? null,
    is_active: payload.is_active ?? true,
  };

  return prisma.fournisseurs.create({ data });
}

async function listFournisseurs({ q, is_active, include_contacts }) {
  const where = {
    deleted_at: null,
    ...(typeof is_active === "boolean" ? { is_active } : {}),
    ...(q
      ? {
          OR: [
            { nom: { contains: q } },
            { email: { contains: q } },
            { telephone: { contains: q } },
            { rccm: { contains: q } },
            { nif: { contains: q } },
          ],
        }
      : {}),
  };

  return prisma.fournisseurs.findMany({
    where,
    orderBy: { id: "desc" },
    include: include_contacts ? { fournisseur_contacts: true } : undefined,
  });
}

async function getFournisseur(idOrUuid, include_contacts = true) {
  const where = {
    ...whereIdOrUuid(idOrUuid),
    deleted_at: null,
  };

  const fournisseur = await prisma.fournisseurs.findFirst({
    where,
    include: include_contacts ? { fournisseur_contacts: true } : undefined,
  });

  return fournisseur;
}

async function updateFournisseur(idOrUuid, payload) {
  // on récupère d'abord l'id (car update() ne supporte pas findFirst avec deleted_at)
  const found = await prisma.fournisseurs.findFirst({
    where: { ...whereIdOrUuid(idOrUuid), deleted_at: null },
  });
  if (!found) return null;

  const data = {
    nom: payload.nom ?? undefined,
    rccm: payload.rccm ?? undefined,
    nif: payload.nif ?? undefined,
    telephone: payload.telephone ?? undefined,
    email: payload.email ?? undefined,
    adresse: payload.adresse ?? undefined,
    ville: payload.ville ?? undefined,
    pays: payload.pays ?? undefined,
    is_active: typeof payload.is_active === "boolean" ? payload.is_active : undefined,
    updated_at: new Date(),
  };

  return prisma.fournisseurs.update({
    where: { id: found.id },
    data,
  });
}

async function softDeleteFournisseur(idOrUuid) {
  const found = await prisma.fournisseurs.findFirst({
    where: { ...whereIdOrUuid(idOrUuid), deleted_at: null },
  });
  if (!found) return null;

  return prisma.fournisseurs.update({
    where: { id: found.id },
    data: {
      is_active: false,
      deleted_at: new Date(),
      updated_at: new Date(),
    },
  });
}

module.exports = {
  createFournisseur,
  listFournisseurs,
  getFournisseur,
  updateFournisseur,
  softDeleteFournisseur,
};
