const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { v4: uuidv4 } = require("uuid");

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

function toStageStatus(roleName) {
  return `validation_${String(roleName).toLowerCase()}`;
}

async function getAgentFromUser(user) {
  const userId = user.userId || user.id;
  if (!userId) throw new Error("Token invalide: userId manquant");

  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true },
  });
  if (!agent) throw new Error("Agent introuvable pour cet utilisateur");
  if (!agent.roles?.name) throw new Error("Role agent introuvable (agent.role_id non défini)");
  return agent;
}

// mapping rôle demandeur -> flow code
function roleToFlowCode(roleName) {
  const map = {
    DEMANDEUR: "FLOW_DEMANDEUR_LAMBDA",
    RESPONSABLE: "FLOW_RESPONSABLE",
    DIRECTEUR: "FLOW_DIRECTEUR",
    DAF: "FLOW_DAF",
    DGA: "FLOW_DGA",
    DG: "FLOW_DG",
    ADMIN: "FLOW_DEMANDEUR_LAMBDA",
    COMPTABLE: "FLOW_DEMANDEUR_LAMBDA",
  };
  return map[String(roleName || "").toUpperCase()] || "FLOW_DEMANDEUR_LAMBDA";
}

async function resolveValidationFlowForAgent(agent) {
  const code = roleToFlowCode(agent.roles.name);
  const flow = await prisma.validation_flows.findFirst({
    where: { code, is_active: true },
    include: { validation_flow_steps: { orderBy: { step_order: "asc" } } },
  });
  if (!flow) throw new Error(`Validation flow introuvable pour code=${code}`);
  if (!flow.validation_flow_steps?.length) throw new Error(`Le flow ${code} n'a aucun step`);
  return flow;
}

// ✅ règle validator_id par managers + global roles
async function resolveValidatorIdForRole({ tx, demandeurAgent, roleName }) {
  const role = String(roleName).toUpperCase();

  if (role === "RESPONSABLE") {
    // responsable direct du demandeur
    return demandeurAgent.manager_id ? Number(demandeurAgent.manager_id) : null;
  }

  if (role === "DIRECTEUR") {
    // directeur = manager du responsable
    if (!demandeurAgent.manager_id) return null;
    const responsable = await tx.agents.findUnique({
      where: { id: Number(demandeurAgent.manager_id) },
      select: { manager_id: true },
    });
    return responsable?.manager_id ? Number(responsable.manager_id) : null;
  }

  // rôles globaux (DAF/DG/DGA…)
  const global = await tx.agents.findFirst({
    where: {
      deleted_at: null,
      roles: { name: role },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return global?.id ? Number(global.id) : null;
}

async function buildValidationStepsCreateInput(tx, demandeId, flow, demandeurAgent) {
  const steps = [];
  for (const s of flow.validation_flow_steps) {
    const validator_id = await resolveValidatorIdForRole({
      tx,
      demandeurAgent,
      roleName: s.role_name,
    });

    steps.push({
      uuid: uuidv4(),
      demande_id: Number(demandeId),
      level: Number(s.step_order),
      role_name: String(s.role_name).toUpperCase(),
      status: "en_attente",
      validator_id: validator_id ? Number(validator_id) : null,
      validated_by_id: null,
      commentaire: null,
      signature_url: null,
      validated_at: null,
    });
  }
  return steps;
}

exports.createDemande = async (user, payload) => {
  const agent = await getAgentFromUser(user);
  const flow = await resolveValidationFlowForAgent(agent);

  if (!payload.motif) throw new Error("motif requis");
  if (payload.montant == null) throw new Error("montant requis");
  if (!payload.beneficiaire) throw new Error("beneficiaire requis");

  const items = Array.isArray(payload.items) ? payload.items : [];

  return prisma.$transaction(async (tx) => {
    const demande = await tx.demandes_paiement.create({
      data: {
        uuid: uuidv4(),
        motif: payload.motif,
        description: payload.description || null,
        montant: payload.montant,
        devise: payload.devise || null,
        taux_change: payload.taux_change || null,
        montant_base: payload.montant_base || null,

        beneficiaire: payload.beneficiaire,
        fournisseur_id: payload.fournisseur_id || null,
        remarque: payload.remarque || null,

        demandeur_id: agent.id,
        direction_id: payload.direction_id || agent.direction_id || null,
        departement_id: payload.departement_id || agent.departement_id || null,
        service_id: payload.service_id || agent.service_id || null,

        // ✅ soumise dès création
        statut: "soumise",

        budget_prevu: payload.budget_prevu ?? null,
        budget_disponible: payload.budget_disponible ?? null,
        paiement_immediat: payload.paiement_immediat ?? null,

        ajournee: false,
        ajournee_le: null,
        ajournee_par_id: null,

        validation_flow_id: flow.id,
      },
    });

    if (items.length) {
      await tx.demande_items.createMany({
        data: items.map((it) => ({
          uuid: uuidv4(),
          demande_id: demande.id,
          designation: it.designation,
          quantite: it.quantite ?? 1,
          prix_unitaire: it.prix_unitaire ?? null,
          unite: it.unite ?? null,
          specifications: it.specifications ?? null,
          total_ligne: it.total_ligne ?? null,
        })),
      });
    }

    const stepsData = await buildValidationStepsCreateInput(tx, demande.id, flow, agent);
    await tx.validation_steps.createMany({ data: stepsData });

    // ✅ mettre le statut au stage du premier step (validation_responsable / validation_directeur / ...)
    const first = stepsData.sort((a, b) => a.level - b.level)[0];
    if (first?.role_name) {
      await tx.demandes_paiement.update({
        where: { id: demande.id },
        data: { statut: toStageStatus(first.role_name) },
      });
    }

    return tx.demandes_paiement.findUnique({
      where: { id: demande.id },
      include: {
        demande_items: true,
        validation_flows: { include: { validation_flow_steps: true } },
        validation_steps: { orderBy: { level: "asc" } },
        fournisseurs: true,
        agents_demandes_paiement_demandeur_idToagents: { include: { roles: true } },
      },
    });
  });
};

exports.listDemandes = async (query) => {
  const where = { deleted_at: null };
  if (query.statut) where.statut = String(query.statut);
  if (query.fournisseur_id) where.fournisseur_id = Number(query.fournisseur_id);
  if (query.demandeur_id) where.demandeur_id = Number(query.demandeur_id);

  return prisma.demandes_paiement.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      fournisseurs: true,
      validation_steps: { orderBy: { level: "asc" } },
      documents: true,
    },
  });
};

exports.listMyDemandes = async (user) => {
  const agent = await getAgentFromUser(user);
  return prisma.demandes_paiement.findMany({
    where: { deleted_at: null, demandeur_id: agent.id },
    orderBy: { created_at: "desc" },
    include: {
      fournisseurs: true,
      validation_steps: { orderBy: { level: "asc" } },
      demande_items: true,
      documents: true,
    },
  });
};

exports.listByDemandeur = async (demandeurId) => {
  return prisma.demandes_paiement.findMany({
    where: { deleted_at: null, demandeur_id: Number(demandeurId) },
    orderBy: { created_at: "desc" },
    include: {
      fournisseurs: true,
      validation_steps: { orderBy: { level: "asc" } },
      demande_items: true,
      documents: true,
    },
  });
};

exports.getOne = async (idOrUuid) => {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };

  const demande = await prisma.demandes_paiement.findFirst({
    where: { ...where, deleted_at: null },
    include: {
      demande_items: true,
      fournisseurs: true,
      validation_flows: { include: { validation_flow_steps: { orderBy: { step_order: "asc" } } } },
      validation_steps: {
        orderBy: { level: "asc" },
        include: {
          agents_validation_steps_validator_idToagents: true,
          agents_validation_steps_validated_by_idToagents: true,
        },
      },
      documents: true,
      bons_commande: true,
      receptions: true,
      paiements: true,
    },
  });

  if (!demande) throw new Error("Demande introuvable");
  return demande;
};

exports.update = async (user, idOrUuid, payload) => {
  const demande = await exports.getOne(idOrUuid);

  return prisma.demandes_paiement.update({
    where: { id: demande.id },
    data: {
      motif: payload.motif ?? demande.motif,
      description: payload.description ?? demande.description,
      montant: payload.montant ?? demande.montant,
      devise: payload.devise ?? demande.devise,
      taux_change: payload.taux_change ?? demande.taux_change,
      montant_base: payload.montant_base ?? demande.montant_base,
      beneficiaire: payload.beneficiaire ?? demande.beneficiaire,
      fournisseur_id: payload.fournisseur_id ?? demande.fournisseur_id,
      remarque: payload.remarque ?? demande.remarque,
      direction_id: payload.direction_id ?? demande.direction_id,
      departement_id: payload.departement_id ?? demande.departement_id,
      service_id: payload.service_id ?? demande.service_id,
      budget_prevu: payload.budget_prevu ?? demande.budget_prevu,
      budget_disponible: payload.budget_disponible ?? demande.budget_disponible,
      paiement_immediat: payload.paiement_immediat ?? demande.paiement_immediat,
      updated_at: new Date(),
    },
    include: {
      demande_items: true,
      validation_steps: { orderBy: { level: "asc" } },
      fournisseurs: true,
      documents: true,
    },
  });
};

exports.softDelete = async (user, idOrUuid) => {
  const demande = await exports.getOne(idOrUuid);

  const agent = await getAgentFromUser(user);
  const role = agent.roles?.name;

  if (role !== "ADMIN" && demande.demandeur_id !== agent.id) {
    throw new Error("Suppression non autorisée");
  }

  await prisma.demandes_paiement.update({
    where: { id: demande.id },
    data: { deleted_at: new Date() },
  });
};
