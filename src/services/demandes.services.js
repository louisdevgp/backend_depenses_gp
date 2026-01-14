const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");

function withStatusCode(err, statusCode) {
  err.statusCode = statusCode;
  return err;
}

function getUserIdFromToken(user) {
  const userId = user?.userId ?? user?.id;
  return userId != null ? Number(userId) : null;
}

function isAdminUser({ tokenRoles = [], agentRoleName }) {
  if (Array.isArray(tokenRoles) && tokenRoles.includes("ADMIN")) return true;
  return String(agentRoleName || "").toUpperCase() === "ADMIN";
}

async function getDemandeurUserId(demandeId) {
  const row = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      demandeur_id: true,
      agents_demandes_paiement_demandeur_idToagents: { select: { user_id: true } },
    },
  });

  const linkedUserId = row?.agents_demandes_paiement_demandeur_idToagents?.user_id;
  if (linkedUserId != null) return Number(linkedUserId);

  // Fallback legacy: si la relation est absente, on ne peut pas résoudre le user.
  // Dans ce cas, on retourne null et on laisse l'appelant gérer un fallback.
  return null;
}

async function assertCanEditDemande({ user, demande, action = "Modification" }) {
  const actorUserId = getUserIdFromToken(user);
  if (!actorUserId) throw withStatusCode(new Error("Unauthorized"), 401);

  const agent = await getAgentFromUser(user);
  const isAdmin = isAdminUser({ tokenRoles: user?.roles, agentRoleName: agent?.roles?.name });
  if (isAdmin) return { agent };

  const demandeurUserId = await getDemandeurUserId(demande.id);
  if (demandeurUserId != null) {
    if (Number(demandeurUserId) !== Number(actorUserId)) {
      throw withStatusCode(new Error(`${action} non autorisée`), 403);
    }
    return { agent };
  }

  // Fallback ultime: compare via agent.id si on ne peut pas résoudre le user_id du demandeur.
  const demandeurId = Number(demande.demandeur_id);
  const isOwnerByAgentId = Number.isFinite(demandeurId) && demandeurId === Number(agent.id);
  const isOwnerByUserId = Number.isFinite(demandeurId) && demandeurId === Number(actorUserId);
  if (!isOwnerByAgentId && !isOwnerByUserId) throw withStatusCode(new Error(`${action} non autorisée`), 403);

  return { agent };
}

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

async function getAgentFromUser(user) {
  const userId = user.userId || user.id;
  if (!userId) throw new Error("Token invalide: userId manquant");

  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true, users: true },
  });

  if (!agent) throw new Error("Agent introuvable pour cet utilisateur");
  if (!agent.roles?.name) throw new Error("Role agent introuvable (agent.role_id non défini)");
  return agent;
}

function roleToFlowCode(roleName) {
  // Le flow est sélectionné en fonction du rôle du demandeur.
  // Ces codes doivent exister en DB (validation_flows.code).
  const r = String(roleName || "").toUpperCase();

  if (r === "RESPONSABLE") return "FLOW_RESPONSABLE";
  if (r === "DIRECTEUR") return "FLOW_DIRECTEUR";
  if (r === "DAF") return "FLOW_DAF";
  if (r === "DGA") return "FLOW_DGA";
  if (r === "DG") return "FLOW_DG";

  // Par défaut (DEMANDEUR, COMPTABLE, autres): flow demandeur standard
  return "FLOW_DEMANDEUR_LAMBDA";
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

async function getActiveManagerId(tx, agentId, at = new Date()) {
  // 1) Privilégier la ligne de reporting active (historique)
  const line = await tx.agent_reporting_lines.findFirst({
    where: {
      agent_id: Number(agentId),
      start_at: { lte: at },
      OR: [{ end_at: null }, { end_at: { gte: at } }],
    },
    select: { manager_id: true, start_at: true },
    orderBy: { start_at: "desc" },
  });

  if (line?.manager_id) return Number(line.manager_id);

  // 2) Fallback vers le champ manager_id sur l'agent
  const a = await tx.agents.findUnique({
    where: { id: Number(agentId) },
    select: { manager_id: true },
  });
  return a?.manager_id ? Number(a.manager_id) : null;
}

async function findAgentIdByRoleInScope(tx, roleName, scope) {
  const role = await tx.roles.findFirst({ where: { name: roleName, is_active: true }, select: { id: true } });
  if (!role) return null;

  const whereBase = { role_id: role.id, deleted_at: null };

  if (scope?.service_id) {
    const a = await tx.agents.findFirst({
      where: { ...whereBase, service_id: Number(scope.service_id) },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (a?.id) return Number(a.id);
  }

  if (scope?.departement_id) {
    const a = await tx.agents.findFirst({
      where: { ...whereBase, departement_id: Number(scope.departement_id) },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (a?.id) return Number(a.id);
  }

  if (scope?.direction_id) {
    const a = await tx.agents.findFirst({
      where: { ...whereBase, direction_id: Number(scope.direction_id) },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (a?.id) return Number(a.id);
  }

  return null;
}

function agentLabel(agent) {
  const parts = [agent?.nom, agent?.prenom].filter(Boolean);
  const label = parts.join(" ").trim();
  return label || (agent?.id ? `Agent#${agent.id}` : "Agent");
}

// ✅ hiérarchie + rôles globaux
async function resolveValidatorForRole({ tx, roleName, demandeurAgent }) {
  const demandeurRole = String(demandeurAgent?.roles?.name || "").toUpperCase();
  const targetRole = String(roleName || "").toUpperCase();

  // 1) RESPONSABLE = manager direct de l'agent demandeur
  if (targetRole === "RESPONSABLE") {
    const responsableId = await getActiveManagerId(tx, demandeurAgent.id);
    if (!responsableId) {
      const fallbackId = await findAgentIdByRoleInScope(tx, "RESPONSABLE", {
        service_id: demandeurAgent.service_id,
        departement_id: demandeurAgent.departement_id,
        direction_id: demandeurAgent.direction_id,
      });
      if (fallbackId) return Number(fallbackId);

      throw new Error(
        `Aucun RESPONSABLE défini pour ${agentLabel(demandeurAgent)}. ` +
          "Renseignez un manager actif (agent_reporting_lines ou agents.manager_id), " +
          "ou définissez un agent RESPONSABLE dans le même service/département/direction.",
      );
    }

    // Optionnel: si le manager trouvé n'a pas le rôle attendu, fallback par scope
    const managerRole = await tx.agents.findUnique({
      where: { id: Number(responsableId) },
      select: { roles: { select: { name: true } } },
    });
    if (String(managerRole?.roles?.name || "").toUpperCase() !== "RESPONSABLE") {
      const fallbackId = await findAgentIdByRoleInScope(tx, "RESPONSABLE", {
        service_id: demandeurAgent.service_id,
        departement_id: demandeurAgent.departement_id,
        direction_id: demandeurAgent.direction_id,
      });
      if (fallbackId) return Number(fallbackId);
    }

    return Number(responsableId);
  }

  // 2) DIRECTEUR = manager du responsable
  if (targetRole === "DIRECTEUR") {
    // Procédure: le DIRECTEUR est généralement le manager direct du demandeur.
    // Compat: si le manager direct est RESPONSABLE, on remonte d'un niveau.
    const managerId = await getActiveManagerId(tx, demandeurAgent.id);
    if (!managerId) {
      const fallbackId = await findAgentIdByRoleInScope(tx, "DIRECTEUR", {
        direction_id: demandeurAgent.direction_id,
        departement_id: demandeurAgent.departement_id,
      });
      if (fallbackId) return Number(fallbackId);

      throw new Error(
        `Aucun DIRECTEUR défini pour ${agentLabel(demandeurAgent)}. ` +
          "Renseignez un manager actif (agent_reporting_lines ou agents.manager_id), " +
          "ou définissez un DIRECTEUR dans la même direction.",
      );
    }

    // Cas important: si le demandeur est RESPONSABLE, son DIRECTEUR est son manager direct.
    if (demandeurRole === "RESPONSABLE") return Number(managerId);

    const manager = await tx.agents.findUnique({
      where: { id: Number(managerId) },
      select: { id: true, nom: true, prenom: true, direction_id: true, departement_id: true, roles: { select: { name: true } } },
    });
    const managerRole = String(manager?.roles?.name || "").toUpperCase();

    if (managerRole === "DIRECTEUR") return Number(managerId);

    // Legacy: DEMANDEUR -> RESPONSABLE -> DIRECTEUR
    if (managerRole === "RESPONSABLE") {
      const directeurId = await getActiveManagerId(tx, managerId);
      if (directeurId) return Number(directeurId);

      const fallbackId = await findAgentIdByRoleInScope(tx, "DIRECTEUR", {
        direction_id: manager?.direction_id || demandeurAgent.direction_id,
        departement_id: manager?.departement_id || demandeurAgent.departement_id,
      });
      if (fallbackId) return Number(fallbackId);

      throw new Error(
        `Aucun DIRECTEUR défini au-dessus du RESPONSABLE ${agentLabel(manager)}. ` +
          "Renseignez un manager actif du RESPONSABLE (agent_reporting_lines ou agents.manager_id), " +
          "ou définissez un DIRECTEUR dans la même direction.",
      );
    }

    // Fallback: chercher un DIRECTEUR dans le scope
    const fallbackId = await findAgentIdByRoleInScope(tx, "DIRECTEUR", {
      direction_id: demandeurAgent.direction_id,
      departement_id: demandeurAgent.departement_id,
    });
    if (fallbackId) return Number(fallbackId);

    throw new Error(
      `Le manager de ${agentLabel(demandeurAgent)} (${agentLabel(manager)}) n'est pas DIRECTEUR/RESPONSABLE; impossible de déterminer le DIRECTEUR. ` +
        "Ajustez la hiérarchie (manager/reporting line) ou définissez un DIRECTEUR dans la même direction.",
    );
  }

  // 3) DGA / DG / DAF = validateurs globaux (pas besoin même direction)
  if (["DGA", "DG", "DAF"].includes(targetRole)) {
    const role = await tx.roles.findFirst({ where: { name: targetRole, is_active: true } });
    if (!role) throw new Error(`Rôle ${roleName} introuvable en DB`);

    const agent = await tx.agents.findFirst({
      where: { role_id: role.id, deleted_at: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (!agent) throw new Error(`Aucun agent trouvé pour le rôle global ${targetRole}`);
    return Number(agent.id);
  }

  // fallback: chercher un agent par rôle (si tu ajoutes d'autres rôles)
  const role = await tx.roles.findFirst({ where: { name: targetRole, is_active: true } });
  if (!role) throw new Error(`Rôle ${roleName} introuvable`);
  const agent = await tx.agents.findFirst({
    where: { role_id: role.id, deleted_at: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!agent) throw new Error(`Aucun agent trouvé pour rôle ${roleName}`);
  return Number(agent.id);
}

function toStageStatus(roleName) {
  return `validation_${String(roleName).toLowerCase()}`;
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizePaiementMode(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "100/100";
  if (s === "100/100" || s === "100_100" || s === "100-100") return "100/100";
  if (s === "70/30" || s === "70_30" || s === "70-30") return "70/30";
  if (s === "50/50" || s === "50_50" || s === "50-50") return "50/50";
  return null;
}

function buildPaiementConditions({ total, mode }) {
  const m = normalizePaiementMode(mode);
  if (!m) throw new Error("Condition de paiement invalide (attendu: 70/30, 50/50, 100/100)");

  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) throw new Error("Montant demande invalide pour conditions de paiement");

  if (m === "100/100") {
    return [{ pourcentage: 100, montant_prevu: round2(t), label: "Tranche 1", condition_texte: "100/100" }];
  }

  const firstPct = m === "70/30" ? 70 : 50;
  const secondPct = m === "70/30" ? 30 : 50;
  const firstAmount = round2((t * firstPct) / 100);
  const secondAmount = round2(t - firstAmount);

  return [
    { pourcentage: firstPct, montant_prevu: firstAmount, label: "Tranche 1", condition_texte: m },
    { pourcentage: secondPct, montant_prevu: secondAmount, label: "Tranche 2", condition_texte: m },
  ];
}

async function buildValidationStepsCreateInput(tx, demandeId, flow, demandeurAgent) {
  const steps = [];

  for (const s of flow.validation_flow_steps) {
    const validator_id = await resolveValidatorForRole({
      tx,
      roleName: s.role_name,
      demandeurAgent,
    });

    steps.push({
      uuid: uuidv4(),
      demande_id: Number(demandeId),
      level: s.step_order,
      role_name: s.role_name,
      validator_id,
      status: s.step_order === 1 ? "en_attente" : "bloque", // ✅ visibilité progressive
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

  const fournisseurId = payload.fournisseur_id ? Number(payload.fournisseur_id) : null;

  if (!payload.motif) throw new Error("motif requis");
  if (payload.montant == null) throw new Error("montant requis");
  if (!fournisseurId && !payload.beneficiaire) throw new Error("beneficiaire requis");

  const items = Array.isArray(payload.items) ? payload.items : [];
  const demande = await prisma.$transaction(async (tx) => {
    let beneficiaireFinal = payload.beneficiaire;
    if (fournisseurId) {
      const f = await tx.fournisseurs.findUnique({
        where: { id: Number(fournisseurId) },
        select: { nom: true },
      });
      if (!f) throw new Error("Fournisseur introuvable");
      beneficiaireFinal = f.nom;
    }

    const demande = await tx.demandes_paiement.create({
      data: {
        uuid: uuidv4(),
        motif: payload.motif,
        description: payload.description || null,
        montant: payload.montant,
        devise: payload.devise || null,
        taux_change: payload.taux_change || null,
        montant_base: payload.montant_base || null,

        beneficiaire: beneficiaireFinal,
        fournisseur_id: fournisseurId,
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

    // ✅ conditions de paiement (échéancier) - créé dès la création de la demande
    // Règle: 100/100 = 1 tranche; 70/30 et 50/50 = 2 tranches (la plus grande en premier)
    const paiementMode = normalizePaiementMode(payload.conditions_paiement_mode);
    const conditions = buildPaiementConditions({ total: demande.montant, mode: paiementMode || "100/100" });

    await tx.conditions_paiement.createMany({
      data: conditions.map((c, idx) => ({
        uuid: uuidv4(),
        demande_id: demande.id,
        label: c.label || `Tranche ${idx + 1}`,
        type_echeance: "pourcentage",
        pourcentage: c.pourcentage,
        montant_prevu: c.montant_prevu,
        date_echeance: null,
        condition_texte: c.condition_texte,
        statut: "prevu",
        paiement_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      })),
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

    // ✅ statut = étape courante (role du step 1)
    const first = stepsData.find((s) => s.level === 1);
    if (first?.role_name) {
      await tx.demandes_paiement.update({
        where: { id: demande.id },
        data: { statut: toStageStatus(first.role_name) },
      });

      // notif au 1er validateur: envoyée après commit (email)
    }

    // notif au demandeur: envoyée après commit (email)

    return tx.demandes_paiement.findUnique({
      where: { id: demande.id },
      include: {
        demande_items: true,
        conditions_paiement: { orderBy: { id: "asc" } },
        validation_flows: { include: { validation_flow_steps: true } },
        validation_steps: { orderBy: { level: "asc" } },
        fournisseurs: true,
        agents_demandes_paiement_demandeur_idToagents: { include: { roles: true, users: true } },
      },
    });
  });

  // Notifications after commit (safe for email)
  try {
    if (agent?.users?.id) {
      await notifications.createNotification({
        user_id: agent.users.id,
        type: "demande_created",
        demande_id: demande.id,
        message: `Votre demande a été soumise. Motif: ${payload.motif}.`,
        meta: { demandeUuid: demande.uuid },
        sendEmailNow: true,
      });
    }

    const first = await prisma.validation_steps.findFirst({
      where: { demande_id: demande.id, level: 1 },
      select: { validator_id: true, role_name: true },
    });

    if (first?.validator_id) {
      const firstValidator = await prisma.agents.findUnique({
        where: { id: Number(first.validator_id) },
        include: { users: true },
      });

      if (firstValidator?.users?.id) {
        await notifications.createNotification({
          user_id: firstValidator.users.id,
          type: "validation_pending",
          demande_id: demande.id,
          message: `Une demande est en attente de votre validation (${first.role_name}).`,
          meta: { demandeUuid: demande.uuid, level: 1 },
          sendEmailNow: true,
        });
      }
    }
  } catch {
    // notifications should never block demande creation
  }

  return demande;
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
      conditions_paiement: { orderBy: { id: "asc" } },
      fournisseurs: true,
      validation_flows: { include: { validation_flow_steps: { orderBy: { step_order: "asc" } } } },
      validation_steps: { orderBy: { level: "asc" } },
      documents: true,
      bons_commande: { include: { documents: true } },
      receptions: true,
      paiements: true,
    },
  });

  if (!demande) throw new Error("Demande introuvable");
  return demande;
};

exports.update = async (user, idOrUuid, payload) => {
  const demande = await exports.getOne(idOrUuid);

  // Autorisation: ADMIN ou demandeur uniquement (owner)
  await assertCanEditDemande({ user, demande, action: "Modification" });

  // Verrouillage: la demande est "engagée" dès qu'une validation est passée
  // ou dès que le statut dépasse le stade initial.
  const anyValidated = await prisma.validation_steps.count({
    where: { demande_id: demande.id, status: { in: ["valide", "rejete", "rejetee", "rejeté"] } },
  });

  const statut = String(demande.statut || "").toLowerCase();
  const isEditableStage =
    statut === "draft" ||
    statut === "brouillon" ||
    statut === "soumise" ||
    statut.startsWith("validation_");

  if (anyValidated > 0 || !isEditableStage) {
    throw withStatusCode(new Error("Demande verrouillée (engagée)"), 409);
  }

  const nextFournisseurId = payload.fournisseur_id !== undefined ? payload.fournisseur_id : demande.fournisseur_id;

  let beneficiaireFinal = payload.beneficiaire ?? demande.beneficiaire;
  if (nextFournisseurId) {
    const f = await prisma.fournisseurs.findUnique({
      where: { id: Number(nextFournisseurId) },
      select: { nom: true },
    });
    if (!f) throw new Error("Fournisseur introuvable");
    beneficiaireFinal = f.nom;
  } else {
    if (!beneficiaireFinal) throw new Error("beneficiaire requis");
  }

  const updated = await prisma.demandes_paiement.update({
    where: { id: demande.id },
    data: {
      motif: payload.motif ?? demande.motif,
      description: payload.description ?? demande.description,
      montant: payload.montant ?? demande.montant,
      devise: payload.devise ?? demande.devise,
      taux_change: payload.taux_change ?? demande.taux_change,
      montant_base: payload.montant_base ?? demande.montant_base,
      beneficiaire: beneficiaireFinal,
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

  // Notifications after commit (emails non-bloquants)
  try {
    const agent = await getAgentFromUser(user);
    const actorUserId = agent?.users?.id || null;

    const demandeurUserId = await prisma.demandes_paiement.findUnique({
      where: { id: updated.id },
      select: { agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } } },
    });

    const demandeurUid = demandeurUserId?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null;

    const current = await prisma.validation_steps.findFirst({
      where: { demande_id: updated.id, status: "en_attente" },
      orderBy: { level: "asc" },
      select: { validator_id: true, role_name: true, level: true },
    });

    let validatorUserId = null;
    if (current?.validator_id) {
      const a = await prisma.agents.findUnique({
        where: { id: Number(current.validator_id) },
        select: { users: { select: { id: true } } },
      });
      validatorUserId = a?.users?.id || null;
    }

    const recipients = Array.from(new Set([demandeurUid, validatorUserId].filter(Boolean))).filter(
      (uid) => Number(uid) !== Number(actorUserId)
    );

    if (recipients.length) {
      await Promise.allSettled(
        recipients.map((uid) =>
          notifications.createNotification({
            user_id: uid,
            type: "demande_updated",
            demande_id: updated.id,
            message: `La demande a été mise à jour. Motif: ${updated.motif}.`,
            meta: { demandeUuid: updated.uuid, currentRole: current?.role_name, currentLevel: current?.level },
            sendEmailNow: true,
          })
        )
      );
    }
  } catch {
    // ignore
  }

  return updated;
};

exports.softDelete = async (user, idOrUuid) => {
  const demande = await exports.getOne(idOrUuid);

  // Autorisation: ADMIN ou demandeur uniquement (owner)
  const { agent } = await assertCanEditDemande({ user, demande, action: "Suppression" });

  await prisma.demandes_paiement.update({
    where: { id: demande.id },
    data: { deleted_at: new Date() },
  });

  // Notifications after commit (emails non-bloquants)
  try {
    const actorUserId = agent?.users?.id || null;
    const demandeurUserId = await prisma.demandes_paiement.findUnique({
      where: { id: demande.id },
      select: { agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } } },
    });
    const demandeurUid = demandeurUserId?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null;
    if (demandeurUid && Number(demandeurUid) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUid,
        type: "demande_deleted",
        demande_id: demande.id,
        message: `Une demande a été supprimée (soft delete). Motif: ${demande.motif}.`,
        meta: { demandeUuid: demande.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }
};
