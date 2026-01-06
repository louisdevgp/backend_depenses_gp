const prisma = require("../config/prisma");
const { whereIdOrUuid } = require("../utils/id.utils");
const { v4: uuidv4 } = require("uuid");

async function resolveFournisseurId(fournisseurIdOrUuid) {
  const f = await prisma.fournisseurs.findFirst({
    where: { ...whereIdOrUuid(fournisseurIdOrUuid), deleted_at: null },
    select: { id: true },
  });
  return f?.id ?? null;
}

async function createContact(fournisseurIdOrUuid, payload) {
  const fournisseurId = await resolveFournisseurId(fournisseurIdOrUuid);
  if (!fournisseurId) return { notFound: true };

  // si is_primary=true => on désactive les autres primary de ce fournisseur
  return prisma.$transaction(async (tx) => {
    if (payload.is_primary === true) {
      await tx.fournisseur_contacts.updateMany({
        where: { fournisseur_id: fournisseurId, is_primary: true },
        data: { is_primary: false },
      });
    }

    const data = {
      uuid: uuidv4(),
      fournisseur_id: fournisseurId,
      nom: payload.nom,
      prenom: payload.prenom ?? null,
      fonction: payload.fonction ?? null,
      telephone: payload.telephone ?? null,
      email: payload.email ?? null,
      is_primary: payload.is_primary ?? false,
    };

    const created = await tx.fournisseur_contacts.create({ data });
    return { created };
  });
}

async function listContacts(fournisseurIdOrUuid) {
  const fournisseurId = await resolveFournisseurId(fournisseurIdOrUuid);
  if (!fournisseurId) return null;

  return prisma.fournisseur_contacts.findMany({
    where: { fournisseur_id: fournisseurId },
    orderBy: [{ is_primary: "desc" }, { id: "desc" }],
  });
}

async function getContact(fournisseurIdOrUuid, contactIdOrUuid) {
  const fournisseurId = await resolveFournisseurId(fournisseurIdOrUuid);
  if (!fournisseurId) return null;

  return prisma.fournisseur_contacts.findFirst({
    where: { fournisseur_id: fournisseurId, ...whereIdOrUuid(contactIdOrUuid) },
  });
}

async function updateContact(fournisseurIdOrUuid, contactIdOrUuid, payload) {
  const fournisseurId = await resolveFournisseurId(fournisseurIdOrUuid);
  if (!fournisseurId) return null;

  const found = await prisma.fournisseur_contacts.findFirst({
    where: { fournisseur_id: fournisseurId, ...whereIdOrUuid(contactIdOrUuid) },
  });
  if (!found) return null;

  return prisma.$transaction(async (tx) => {
    if (payload.is_primary === true) {
      await tx.fournisseur_contacts.updateMany({
        where: { fournisseur_id: fournisseurId, is_primary: true },
        data: { is_primary: false },
      });
    }

    return tx.fournisseur_contacts.update({
      where: { id: found.id },
      data: {
        nom: payload.nom ?? undefined,
        prenom: payload.prenom ?? undefined,
        fonction: payload.fonction ?? undefined,
        telephone: payload.telephone ?? undefined,
        email: payload.email ?? undefined,
        is_primary: typeof payload.is_primary === "boolean" ? payload.is_primary : undefined,
      },
    });
  });
}

async function deleteContact(fournisseurIdOrUuid, contactIdOrUuid) {
  const fournisseurId = await resolveFournisseurId(fournisseurIdOrUuid);
  if (!fournisseurId) return null;

  const found = await prisma.fournisseur_contacts.findFirst({
    where: { fournisseur_id: fournisseurId, ...whereIdOrUuid(contactIdOrUuid) },
  });
  if (!found) return null;

  await prisma.fournisseur_contacts.delete({ where: { id: found.id } });
  return true;
}

module.exports = {
  createContact,
  listContacts,
  getContact,
  updateContact,
  deleteContact,
};
