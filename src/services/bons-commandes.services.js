const { randomUUID } = require("crypto");
const { generateBonCommandeNumero } = require("../utils/numero.utils");

async function assertDemandeApproved(tx, demandeId) {
  const demande = await tx.demandes_paiement.findFirst({
    where: { id: Number(demandeId), deleted_at: null },
    select: { id: true, statut: true },
  });

  if (!demande) throw new Error("Demande introuvable");

  const statut = String(demande.statut || "").toLowerCase();
  const allowed = statut === "approuvee" || statut === "en_attente_paiement";
  if (!allowed) {
    throw new Error("Bon de commande impossible : demande non approuvée");
  }

  const totalSteps = await tx.validation_steps.count({
    where: { demande_id: Number(demandeId) },
  });
  if (totalSteps <= 0) {
    throw new Error("Bon de commande impossible : workflow de validation introuvable");
  }

  const notApprovedCount = await tx.validation_steps.count({
    where: {
      demande_id: Number(demandeId),
      status: { in: ["en_attente", "bloque", "rejete"] },
    },
  });

  if (notApprovedCount > 0) {
    throw new Error("Bon de commande impossible : demande non approuvée (validations incomplètes ou rejetée)");
  }
}

async function createBonCommande(prisma, payload, createdByAgent) {
  const {
    demande_id,
    fournisseur_id = null,
    statut = "brouillon",
    date_commande = null,
    items = [],
  } = payload;

  if (!demande_id) throw new Error("demande_id requis");

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items requis (au moins 1 ligne)");
  }

  return prisma.$transaction(async (tx) => {
    // ✅ Règle métier : BC seulement après validations
    await assertDemandeApproved(tx, demande_id);

    // ✅ Règle métier : 1 seul BC par demande
    const existingBcCount = await tx.bons_commande.count({
      where: { demande_id: Number(demande_id) },
    });
    if (existingBcCount > 0) {
      throw new Error("Un bon de commande existe déjà pour cette demande");
    }

    // ✅ Autorisation : demandeur (créateur de la demande) ou rôle privilégié
    const creatorId = Number(createdByAgent?.id);
    const creatorRole = String(createdByAgent?.roleName || "").toUpperCase();
    if (!creatorId) throw new Error("Créateur BC invalide");

    const demande = await tx.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      select: { id: true, demandeur_id: true },
    });
    if (!demande) throw new Error("Demande introuvable");

    const privileged = ["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"];
    const canCreate = creatorId === Number(demande.demandeur_id) || privileged.includes(creatorRole);
    if (!canCreate) throw new Error("Bon de commande: action non autorisée");

    const numero = await generateBonCommandeNumero(tx);

    const bc = await tx.bons_commande.create({
      data: {
        uuid: randomUUID(),
        demande_id: Number(demande_id),
        fournisseur_id: fournisseur_id ? Number(fournisseur_id) : null,
        numero,
        statut,
        date_commande: date_commande ? new Date(date_commande) : null,
        created_by_id: creatorId,
      },
    });

    const itemsData = items.map((it) => {
      if (!it.designation) throw new Error("designation requis dans items");
      const quantite = it.quantite ?? 1;
      const prix_unitaire = it.prix_unitaire ?? null;

      const total_ligne =
        prix_unitaire !== null && prix_unitaire !== undefined
          ? Number(quantite) * Number(prix_unitaire)
          : it.total_ligne ?? null;

      return {
        uuid: randomUUID(),
        bon_commande_id: bc.id,
        designation: String(it.designation),
        quantite: Number(quantite),
        prix_unitaire: prix_unitaire !== null ? Number(prix_unitaire) : null,
        unite: it.unite ? String(it.unite) : null,
        total_ligne: total_ligne !== null ? Number(total_ligne) : null,
      };
    });

    await tx.bon_commande_items.createMany({ data: itemsData });

    return tx.bons_commande.findUnique({
      where: { id: bc.id },
      include: { bon_commande_items: true, fournisseurs: true },
    });
  });
}

async function listBonCommandes(prisma, query = {}) {
  const { demande_id, fournisseur_id, statut, skip = 0, take = 50 } = query;

  return prisma.bons_commande.findMany({
    where: {
      ...(demande_id ? { demande_id: Number(demande_id) } : {}),
      ...(fournisseur_id ? { fournisseur_id: Number(fournisseur_id) } : {}),
      ...(statut ? { statut: String(statut) } : {}),
    },
    orderBy: { created_at: "desc" },
    skip: Number(skip) || 0,
    take: Math.min(Number(take) || 50, 200),
    include: { bon_commande_items: true, fournisseurs: true },
  });
}

async function getBonCommandeById(prisma, id) {
  return prisma.bons_commande.findUnique({
    where: { id: Number(id) },
    include: { bon_commande_items: true, fournisseurs: true, documents: true, receptions: true },
  });
}

async function getBonCommandeByUuid(prisma, uuid) {
  return prisma.bons_commande.findUnique({
    where: { uuid: String(uuid) },
    include: { bon_commande_items: true, fournisseurs: true, documents: true, receptions: true },
  });
}

async function updateBonCommande(prisma, id, payload) {
  const {
    fournisseur_id,
    statut,
    date_commande,
    numero, // optionnel, mais normalement on évite
    items, // si fourni => replace items
  } = payload;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.bons_commande.findUnique({
      where: { id: Number(id) },
      select: { id: true },
    });
    if (!existing) throw new Error("Bon de commande introuvable");

    const updated = await tx.bons_commande.update({
      where: { id: Number(id) },
      data: {
        ...(fournisseur_id !== undefined
          ? { fournisseur_id: fournisseur_id ? Number(fournisseur_id) : null }
          : {}),
        ...(statut !== undefined ? { statut: String(statut) } : {}),
        ...(date_commande !== undefined
          ? { date_commande: date_commande ? new Date(date_commande) : null }
          : {}),
        ...(numero !== undefined ? { numero: String(numero) } : {}),
      },
    });

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("items doit contenir au moins 1 ligne");
      }

      await tx.bon_commande_items.deleteMany({
        where: { bon_commande_id: updated.id },
      });

      const itemsData = items.map((it) => {
        if (!it.designation) throw new Error("designation requis dans items");
        const quantite = it.quantite ?? 1;
        const prix_unitaire = it.prix_unitaire ?? null;

        const total_ligne =
          prix_unitaire !== null && prix_unitaire !== undefined
            ? Number(quantite) * Number(prix_unitaire)
            : it.total_ligne ?? null;

        return {
          uuid: randomUUID(),
          bon_commande_id: updated.id,
          designation: String(it.designation),
          quantite: Number(quantite),
          prix_unitaire: prix_unitaire !== null ? Number(prix_unitaire) : null,
          unite: it.unite ? String(it.unite) : null,
          total_ligne: total_ligne !== null ? Number(total_ligne) : null,
        };
      });

      await tx.bon_commande_items.createMany({ data: itemsData });
    }

    return tx.bons_commande.findUnique({
      where: { id: updated.id },
      include: { bon_commande_items: true, fournisseurs: true },
    });
  });
}

// recommandé : annuler au lieu de delete
async function cancelBonCommande(prisma, id) {
  return prisma.bons_commande.update({
    where: { id: Number(id) },
    data: { statut: "annule" },
  });
}

// optionnel : delete (cascade items via FK)
async function deleteBonCommande(prisma, id) {
  return prisma.bons_commande.delete({ where: { id: Number(id) } });
}

module.exports = {
  createBonCommande,
  listBonCommandes,
  getBonCommandeById,
  getBonCommandeByUuid,
  updateBonCommande,
  cancelBonCommande,
  deleteBonCommande,
};
