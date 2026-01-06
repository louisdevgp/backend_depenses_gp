const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");

function buildPublicUrl(req, filename) {
  // si tu veux stocker une URL absolue
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

async function createDocumentsFromUploads({ files, body, upload_by_id, req }) {
  const {
    demande_id = null,
    reception_id = null,
    paiement_id = null,
    bon_commande_id = null,
    type_document,
  } = body;

  if (!type_document) throw new Error("type_document is required");

  const data = files.map((f) => ({
    uuid: uuidv4(),
    demande_id: demande_id ? Number(demande_id) : null,
    reception_id: reception_id ? Number(reception_id) : null,
    paiement_id: paiement_id ? Number(paiement_id) : null,
    bon_commande_id: bon_commande_id ? Number(bon_commande_id) : null,
    type_document,
    // si tu veux URL relative:
    url: `/uploads/${f.filename}`,
    // ou URL absolue (si tu passes req)
    // url: buildPublicUrl(req, f.filename),
    nom_fichier: f.originalname,
    format: f.mimetype,
    taille: BigInt(f.size),
    upload_by_id: Number(upload_by_id),
  }));

  // createMany ne retourne pas les rows créées -> on crée en transaction
  const created = await prisma.$transaction(
    data.map((d) => prisma.documents.create({ data: d }))
  );

  return created;
}

async function listDocuments(filters = {}) {
  const where = {};
  for (const key of ["demande_id", "reception_id", "paiement_id", "bon_commande_id"]) {
    if (filters[key] != null) where[key] = Number(filters[key]);
  }
  if (filters.type_document) where.type_document = filters.type_document;

  return prisma.documents.findMany({ where, orderBy: { created_at: "desc" } });
}

async function getDocumentById(id) {
  return prisma.documents.findUnique({ where: { id: Number(id) } });
}

async function deleteDocument(id) {
  return prisma.documents.delete({ where: { id: Number(id) } });
}

module.exports = {
  createDocumentsFromUploads,
  listDocuments,
  getDocumentById,
  deleteDocument,
};
