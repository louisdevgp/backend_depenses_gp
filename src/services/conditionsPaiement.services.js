const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function createConditionPaiement(data) {
  return prisma.conditions_paiement.create({
    data: {
      uuid: data.uuid,
      demande_id: data.demande_id,
      source: data.source ?? "DEMANDEUR",
      label: data.label,
      pourcentage: data.pourcentage ?? null,
      montant_prevu: data.montant_prevu ?? null,
      date_echeance: data.date_echeance ?? null,
      condition_texte: data.condition_texte ?? null,
      statut: data.statut ?? "prevu",
      paiement_id: data.paiement_id ?? null,
    },
  });
}

async function listConditionsPaiement(filters = {}) {
  const where = {};
  if (filters.demande_id) where.demande_id = Number(filters.demande_id);
  if (filters.paiement_id) where.paiement_id = Number(filters.paiement_id);
  if (filters.statut) where.statut = String(filters.statut);
  if (filters.source) where.source = String(filters.source);

  return prisma.conditions_paiement.findMany({
    where,
    orderBy: [{ created_at: "desc" }],
  });
}

async function getConditionPaiementById(id) {
  return prisma.conditions_paiement.findUnique({ where: { id: Number(id) } });
}

async function updateConditionPaiement(id, data) {
  return prisma.conditions_paiement.update({
    where: { id: Number(id) },
    data: {
      label: data.label,
      pourcentage: data.pourcentage ?? null,
      montant_prevu: data.montant_prevu ?? null,
      date_echeance: data.date_echeance ?? null,
      condition_texte: data.condition_texte ?? null,
      statut: data.statut,
      paiement_id: data.paiement_id ?? null,
      updated_at: new Date(),
    },
  });
}

async function deleteConditionPaiement(id) {
  return prisma.conditions_paiement.delete({ where: { id: Number(id) } });
}

module.exports = {
  createConditionPaiement,
  listConditionsPaiement,
  getConditionPaiementById,
  updateConditionPaiement,
  deleteConditionPaiement,
};
