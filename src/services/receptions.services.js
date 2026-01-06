const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");

async function createReception(payload, userAgentId) {
  const data = {
    uuid: uuidv4(),
    demande_id: Number(payload.demande_id),
    bon_commande_id: payload.bon_commande_id ? Number(payload.bon_commande_id) : null,
    fournisseur: payload.fournisseur,
    description: payload.description,
    reference_facture: payload.reference_facture || null,
    montant: payload.montant != null ? payload.montant : null,
    date_reception: new Date(payload.date_reception),
    conforme: Boolean(payload.conforme),
    observations: payload.observations || null,
    recu_par_id: Number(userAgentId),
  };

  return prisma.receptions.create({ data });
}

async function listReceptions(query = {}) {
  const where = {};

  if (query.demande_id) where.demande_id = Number(query.demande_id);
  if (query.bon_commande_id) where.bon_commande_id = Number(query.bon_commande_id);
  if (query.conforme != null) where.conforme = query.conforme === "true";

  // filtre date (optionnel)
  if (query.date_debut || query.date_fin) {
    where.date_reception = {};
    if (query.date_debut) where.date_reception.gte = new Date(query.date_debut);
    if (query.date_fin) where.date_reception.lte = new Date(query.date_fin);
  }

  return prisma.receptions.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      documents: true,
      bons_commande: true,
      demandes_paiement: true,
    },
  });
}

async function getReceptionById(id) {
  return prisma.receptions.findUnique({
    where: { id: Number(id) },
    include: { documents: true, bons_commande: true, demandes_paiement: true },
  });
}

async function getReceptionByUuid(uuid) {
  return prisma.receptions.findUnique({
    where: { uuid },
    include: { documents: true, bons_commande: true, demandes_paiement: true },
  });
}

async function updateReception(id, payload) {
  // (Option métier) bloquer si déjà visée DAF
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) return null;
  if (existing.visa_daf_id) throw new Error("Reception already approved by DAF");

  return prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      fournisseur: payload.fournisseur ?? undefined,
      description: payload.description ?? undefined,
      reference_facture: payload.reference_facture ?? undefined,
      montant: payload.montant ?? undefined,
      date_reception: payload.date_reception ? new Date(payload.date_reception) : undefined,
      conforme: payload.conforme != null ? Boolean(payload.conforme) : undefined,
      observations: payload.observations ?? undefined,
      updated_at: new Date(),
    },
  });
}

async function visaDirecteur(id, { signature_directeur_url }, directeurAgentId) {
  return prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_directeur_id: Number(directeurAgentId),
      signature_directeur_url: signature_directeur_url || null,
      updated_at: new Date(),
    },
  });
}

async function visaDaf(id, { signature_daf_url }, dafAgentId) {
  return prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_daf_id: Number(dafAgentId),
      signature_daf_url: signature_daf_url || null,
      updated_at: new Date(),
    },
  });
}

async function deleteReception(id) {
  // Ta table n’a pas deleted_at => delete hard
  return prisma.receptions.delete({ where: { id: Number(id) } });
}

module.exports = {
  createReception,
  listReceptions,
  getReceptionById,
  getReceptionByUuid,
  updateReception,
  visaDirecteur,
  visaDaf,
  deleteReception,
};
