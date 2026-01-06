const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");

async function assertDemandePayable(demandeId) {
  const demande = await prisma.demandes_paiement.findFirst({
    where: { id: Number(demandeId), deleted_at: null },
    select: { id: true },
  });

  if (!demande) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  // Vérifie qu'il n'y a AUCUNE étape encore en attente
  // (si tu veux gérer "required=false", on l'ajoute)
  const pending = await prisma.validation_steps.count({
    where: {
      demande_id: Number(demandeId),
      status: { in: ["en_attente", "rejetee"] }, // rejetee => pas payable
    },
  });

  if (pending > 0) {
    const err = new Error("Demande non payable : validations incomplètes ou rejetée");
    err.statusCode = 400;
    throw err;
  }

  return true;
}

async function createPaiement({ demande_id, type_paiement, montant, date_paiement, moyen_paiement, reference_piece, compte_debite, commentaire, documents = [] }, comptableAgentId) {
  await assertDemandePayable(demande_id);

  const paiement = await prisma.paiements.create({
    data: {
      uuid: uuidv4(),
      demande_id: Number(demande_id),
      type_paiement,
      montant: Number(montant),
      date_paiement: date_paiement ? new Date(date_paiement) : new Date(),
      moyen_paiement,
      reference_piece: reference_piece || null,
      compte_debite: compte_debite || null,
      commentaire: commentaire || null,
      comptable_id: Number(comptableAgentId),
      documents: documents?.length
        ? {
            create: documents.map((d) => ({
              uuid: uuidv4(),
              type_document: d.type_document, // ex: "preuve_paiement"
              url: d.url,
              nom_fichier: d.nom_fichier || "document",
              format: d.format || null,
              taille: d.taille ? BigInt(d.taille) : null,
              upload_by_id: Number(comptableAgentId),
              created_at: new Date(),
            })),
          }
        : undefined
    },
    include: {
      documents: true,
      demandes_paiement: { select: { id: true, uuid: true, motif: true, montant: true } },
    },
  }).then(async (paiement) => {
    // controler si la creéation du paiement a réussi
    if (!paiement || !paiement.id) {
      const err = new Error("Erreur lors de la création du paiement");
      err.statusCode = 500;
        throw err;
    }
}).catch((error) => {
    const err = new Error("Erreur lors de la création du paiement: " + error.message);
    err.statusCode = 500;
    throw err;
});

  return paiement;
}

async function listPaiements({ demande_id, from, to, moyen_paiement }) {
  return prisma.paiements.findMany({
    where: {
      ...(demande_id ? { demande_id: Number(demande_id) } : {}),
      ...(moyen_paiement ? { moyen_paiement } : {}),
      ...(from || to
        ? {
            date_paiement: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function getPaiementById(id) {
  const paiement = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function getPaiementByUuid(uuid) {
  const paiement = await prisma.paiements.findFirst({
    where: { uuid },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function listByDemande(demandeId) {
  return prisma.paiements.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function updatePaiement(id, payload) {
  // tu peux ajouter une règle: interdire update si paiement "verrouillé"
  return prisma.paiements.update({
    where: { id: Number(id) },
    data: {
      type_paiement: payload.type_paiement ?? undefined,
      montant: payload.montant != null ? Number(payload.montant) : undefined,
      date_paiement: payload.date_paiement ? new Date(payload.date_paiement) : undefined,
      moyen_paiement: payload.moyen_paiement ?? undefined,
      reference_piece: payload.reference_piece ?? undefined,
      compte_debite: payload.compte_debite ?? undefined,
      commentaire: payload.commentaire ?? undefined,
    },
    include: { documents: true },
  });
}

async function deletePaiement(id) {
  // Hard delete (car pas de deleted_at dans schema)
  await prisma.documents.deleteMany({ where: { paiement_id: Number(id) } });
  await prisma.paiements.delete({ where: { id: Number(id) } });
  return true;
}

module.exports = {
  createPaiement,
  listPaiements,
  getPaiementById,
  getPaiementByUuid,
  listByDemande,
  updatePaiement,
  deletePaiement,
};
