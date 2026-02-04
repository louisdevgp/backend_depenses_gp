
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
  return null;
}

async function getAgentFromUser(user) {
  const userId = user?.userId || user?.id;
  if (!userId) throw new Error("Token invalide: userId manquant");

  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true, users: true },
  });

  if (!agent) throw new Error("Agent introuvable pour cet utilisateur");
  if (!agent.roles?.name) throw new Error("Role agent introuvable (agent.role_id non defini)");
  return agent;
}

async function assertCanEditDemande({ user, demande, action = "Modification" }) {
  const actorUserId = getUserIdFromToken(user);
  if (!actorUserId) throw withStatusCode(new Error("Unauthorized"), 401);

  const agent = await getAgentFromUser(user);
  const isAdmin = isAdminUser({ tokenRoles: user?.roles, agentRoleName: agent?.roles?.name });
  if (isAdmin) return { agent };

  const demandeurUserId = await getDemandeurUserId(demande.id);
  if (demandeurUserId != null) {
    const isOwnerByUserId = Number(demandeurUserId) === Number(actorUserId);
    const isOwnerByAgentId = Number(demande.demandeur_id) === Number(agent.id);
    const isOwnerByUserIdFallback = Number(demande.demandeur_id) === Number(actorUserId);
    if (!isOwnerByUserId && !isOwnerByAgentId && !isOwnerByUserIdFallback) {
      throw withStatusCode(new Error(`${action} non autorisee`), 403);
    }
    return { agent };
  }

  const demandeurId = Number(demande.demandeur_id);
  const isOwnerByAgentId = Number.isFinite(demandeurId) && demandeurId === Number(agent.id);
  const isOwnerByUserId = Number.isFinite(demandeurId) && demandeurId === Number(actorUserId);
  if (!isOwnerByAgentId && !isOwnerByUserId) throw withStatusCode(new Error(`${action} non autorisee`), 403);

  return { agent };
}

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function userEffectiveRoles(user, agent) {
  const tokenRoles = Array.isArray(user?.roles) ? user.roles : [];
  const out = new Set(tokenRoles.map(normalizeRoleName).filter(Boolean));
  if (agent?.roles?.name) out.add(normalizeRoleName(agent.roles.name));
  return Array.from(out);
}

function hasAnyRole(roles, needles) {
  const set = new Set((roles || []).map(normalizeRoleName));
  for (const n of needles) {
    if (set.has(normalizeRoleName(n))) return true;
  }
  return false;
}

function applyListScopeForUser({ where, roles, agent }) {
  if (hasAnyRole(roles, ["ADMIN", "DG", "DGA", "DAF", "COMPTABLE", "CAISSE"])) return where;

  if (hasAnyRole(roles, ["ASSISTANTE_TECHNIQUE"])) {
    const dirId = agent?.direction_id ? Number(agent.direction_id) : null;
    if (!dirId) return { ...where, id: -1 };
    return { ...where, direction_id: dirId };
  }

  if (hasAnyRole(roles, ["RESPONSABLE", "DIRECTEUR"])) {
    const dirId = agent?.direction_id ? Number(agent.direction_id) : null;
    if (!dirId) return { ...where, id: -1 };
    return { ...where, direction_id: dirId };
  }

  if (hasAnyRole(roles, ["DEMANDEUR"])) {
    return { ...where, demandeur_id: Number(agent.id) };
  }

  return where;
}
function assertCanReadDemande({ demande, roles, agent }) {
  if (!demande) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const agentUserId = agent?.user_id ?? agent?.users?.id;
  const demandeurUserId = demande?.agents_demandes_paiement_demandeur_idToagents?.user_id;
  const isOwnerByAgentId = Number(demande.demandeur_id) === Number(agent?.id);
  const isOwnerByUserId =
    agentUserId != null && demandeurUserId != null && Number(demandeurUserId) === Number(agentUserId);
  const isOwnerByUserIdFallback =
    agentUserId != null && Number(demande.demandeur_id) === Number(agentUserId);
  if (isOwnerByAgentId || isOwnerByUserId || isOwnerByUserIdFallback) return true;

  if (hasAnyRole(roles, ["ADMIN", "DG", "DGA", "DAF", "COMPTABLE", "CAISSE"])) return true;

  if (hasAnyRole(roles, ["ASSISTANTE_TECHNIQUE"])) {
    const dirId = agent?.direction_id ? Number(agent.direction_id) : null;
    if (!dirId || Number(demande.direction_id) !== dirId) {
      const err = new Error("Acces refuse: demande hors de votre direction");
      err.statusCode = 403;
      throw err;
    }
    return true;
  }

  if (hasAnyRole(roles, ["RESPONSABLE", "DIRECTEUR"])) {
    const dirId = agent?.direction_id ? Number(agent.direction_id) : null;
    if (!dirId || Number(demande.direction_id) !== dirId) {
      const err = new Error("Acces refuse: demande hors de votre direction");
      err.statusCode = 403;
      throw err;
    }
    return true;
  }

  if (hasAnyRole(roles, ["DEMANDEUR"])) {
    const agentUserId = agent?.user_id ?? agent?.users?.id;
    const demandeurUserId = demande?.agents_demandes_paiement_demandeur_idToagents?.user_id;
    const isOwnerByAgentId = Number(demande.demandeur_id) === Number(agent.id);
    const isOwnerByUserId =
      agentUserId != null && demandeurUserId != null && Number(demandeurUserId) === Number(agentUserId);
    if (!isOwnerByAgentId && !isOwnerByUserId) {
      const err = new Error("Acces refuse");
      err.statusCode = 403;
      throw err;
    }
    return true;
  }

  return true;
}

exports.assertCanReadDemandeByIdOrUuid = async (user, idOrUuid) => {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };

  const demande = await prisma.demandes_paiement.findFirst({
    where: { ...where, deleted_at: null },
    select: { id: true, uuid: true, demandeur_id: true, direction_id: true },
  });

  const agent = await getAgentFromUser(user);
  const roles = userEffectiveRoles(user, agent);
  assertCanReadDemande({ demande, roles, agent });
  return true;
};

function normalizeBooleanLikeString(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (["true", "1", "oui", "yes"].includes(v)) return true;
  if (["false", "0", "non", "no"].includes(v)) return false;
  return null;
}

function normalizeDafCritere4(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const boolLike = normalizeBooleanLikeString(trimmed);
    if (boolLike === true) return "Oui";
    if (boolLike === false) return "Non";
    return trimmed;
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return value ? "Oui" : "Non";
  const fallback = String(value).trim();
  return fallback || null;
}

function normalizePaiementMode(value) {
  if (!value) return null;
  const v = String(value).replace(/\s/g, "");
  if (["70/30", "50/50", "100/100"].includes(v)) return v;
  return null;
}

function computeItemsTotal(items = []) {
  let total = 0;
  let hasPricedItems = false;

  for (const it of items) {
    const q = Number(it?.quantite);
    const pu = Number(it?.prix_unitaire);
    const tl = Number(it?.total_ligne);

    if (Number.isFinite(q) && Number.isFinite(pu)) {
      const line = q * pu;
      if (Number.isFinite(line)) total += line;
      hasPricedItems = true;
      continue;
    }

    if (Number.isFinite(tl)) {
      total += tl;
      hasPricedItems = true;
    }
  }

  return { total, hasPricedItems };
}

function computeMontantNet({ montantBrut, remise_type, remise_valeur }) {
  const brutNum = Number(montantBrut);
  const brut = Number.isFinite(brutNum) ? brutNum : 0;
  const type = remise_type ? String(remise_type) : null;
  const valNum = Number(remise_valeur);
  const val = Number.isFinite(valNum) ? valNum : 0;

  let remise = 0;
  if (type === "montant") remise = val;
  if (type === "pourcentage") remise = brut * (val / 100);

  const net = Math.max(0, brut - (Number.isFinite(remise) ? remise : 0));

  return {
    montant_net: net,
    remise_type: type || null,
    remise_valeur: type ? val : null,
  };
}

function buildPaiementConditions({ total, mode }) {
  const totalNum = Number(total) || 0;
  const normalized = normalizePaiementMode(mode) || "100/100";

  let parts = [100];
  if (normalized === "70/30") parts = [70, 30];
  if (normalized === "50/50") parts = [50, 50];

  return parts.map((p, idx) => {
    const montant_prevu = (totalNum * p) / 100;
    return {
      label: `Tranche ${idx + 1}`,
      pourcentage: p,
      montant_prevu,
      condition_texte: null,
    };
  });
}

function buildCustomPaiementConditions({ total, tranches = [] }) {
  const totalNum = Number(total) || 0;
  const out = [];

  for (const [idx, t] of tranches.entries()) {
    const label = t?.label ? String(t.label) : `Tranche ${idx + 1}`;
    const p = t?.pourcentage != null ? Number(t.pourcentage) : null;
    const m = t?.montant_prevu != null ? Number(t.montant_prevu) : null;

    if (Number.isFinite(p)) {
      out.push({
        label,
        pourcentage: p,
        montant_prevu: (totalNum * p) / 100,
        condition_texte: t?.condition_texte ? String(t.condition_texte) : null,
      });
      continue;
    }

    if (Number.isFinite(m)) {
      out.push({
        label,
        pourcentage: totalNum ? (m / totalNum) * 100 : null,
        montant_prevu: m,
        condition_texte: t?.condition_texte ? String(t.condition_texte) : null,
      });
      continue;
    }
  }

  return out;
}

function toStageStatus(roleName) {
  return `validation_${String(roleName).toLowerCase()}`;
}

function roleToFlowCode(roleName) {
  const r = String(roleName || "").toUpperCase();
  if (r === "RESPONSABLE") return "FLOW_RESPONSABLE";
  if (r === "DIRECTEUR") return "FLOW_DIRECTEUR";
  if (r === "DAF") return "FLOW_DAF";
  if (r === "DGA") return "FLOW_DGA";
  if (r === "DG") return "FLOW_DG";
  return "FLOW_DEMANDEUR_LAMBDA";
}

async function resolveValidationFlowForAgent(agent) {
  const code = roleToFlowCode(agent.roles.name);
  const flow = await prisma.validation_flows.findFirst({
    where: { code, is_active: true },
    include: { validation_flow_steps: { orderBy: { step_order: "asc" } } },
  });
  if (flow) return flow;

  const fallback = await prisma.validation_flows.findFirst({
    where: { is_active: true },
    include: { validation_flow_steps: { orderBy: { step_order: "asc" } } },
  });
  if (!fallback) throw new Error("Validation flow introuvable");
  return fallback;
}

async function resolveValidatorForRole(tx, roleName, demandeOrg) {
  const role = String(roleName || "").trim().toUpperCase();
  const baseWhere = {
    deleted_at: null,
    roles: { is: { name: role } },
  };

  if (["RESPONSABLE", "DIRECTEUR", "ASSISTANTE_TECHNIQUE"].includes(role)) {
    if (!demandeOrg?.direction_id) return null;
    return tx.agents.findFirst({
      where: { ...baseWhere, direction_id: Number(demandeOrg.direction_id) },
      orderBy: { id: "asc" },
    });
  }

  return tx.agents.findFirst({
    where: baseWhere,
    orderBy: { id: "asc" },
  });
}

async function buildValidationStepsForDemande(tx, flow, demande) {
  const steps = await tx.validation_flow_steps.findMany({
    where: { flow_id: Number(flow.id) },
    orderBy: { step_order: "asc" },
  });

  const created = [];
  for (const s of steps) {
    const validator = await resolveValidatorForRole(tx, s.role_name, demande);
    const validator_id = validator?.id || null;

    const row = await tx.validation_steps.create({
      data: {
        uuid: uuidv4(),
        demande_id: demande.id,
        level: s.step_order,
        role_name: s.role_name,
        validator_id,
        status: s.step_order === 1 ? "en_attente" : "bloque",
        validated_by_id: null,
        commentaire: null,
        signature_url: null,
        validated_at: null,
      },
    });

    created.push(row);
  }

  return created;
}
exports.createDemande = async (user, payload) => {
  const agent = await getAgentFromUser(user);
  const flow = await resolveValidationFlowForAgent(agent);

  if (!payload.motif) throw new Error("motif requis");
  if (!payload.beneficiaire) throw new Error("beneficiaire requis");

  const items = Array.isArray(payload.items) ? payload.items : [];

  let montantAPayer = payload.montant;
  if (items.length > 0) {
    const { total: totalItems, hasPricedItems } = computeItemsTotal(items);
    if (hasPricedItems) montantAPayer = totalItems;
  }

  if (montantAPayer == null) throw new Error("montant requis");

  const remiseCalc = computeMontantNet({
    montantBrut: montantAPayer,
    remise_type: payload.remise_type,
    remise_valeur: payload.remise_valeur,
  });

  if (payload.conditions_paiement_custom !== undefined && payload.conditions_paiement_mode !== undefined) {
    throw withStatusCode(new Error("Fournir soit conditions_paiement_mode, soit conditions_paiement_custom"), 400);
  }

  const customTranches = Array.isArray(payload.conditions_paiement_custom) ? payload.conditions_paiement_custom : null;

  for (const it of items) {
    const designation = String(it?.designation ?? "").trim();
    const unite = String(it?.unite ?? "").trim();
    const specifications = String(it?.specifications ?? "").trim();
    const qRaw = it?.quantite;
    const puRaw = it?.prix_unitaire;
    const tlRaw = it?.total_ligne;

    const hasAnyField =
      designation ||
      unite ||
      specifications ||
      (qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== "") ||
      (puRaw !== undefined && puRaw !== null && String(puRaw).trim() !== "") ||
      (tlRaw !== undefined && tlRaw !== null && String(tlRaw).trim() !== "");

    if (!hasAnyField) continue;
    if (!designation) throw withStatusCode(new Error("Chaque item doit avoir une designation"), 400);

    const q = qRaw === undefined || qRaw === null || String(qRaw).trim() === "" ? 1 : Number(qRaw);
    if (!Number.isFinite(q) || q <= 0) throw withStatusCode(new Error("Quantite invalide sur un item"), 400);

    if (puRaw !== undefined && puRaw !== null && String(puRaw).trim() !== "") {
      const pu = Number(puRaw);
      if (!Number.isFinite(pu) || pu < 0) throw withStatusCode(new Error("Prix unitaire invalide sur un item"), 400);
    }

    if (tlRaw !== undefined && tlRaw !== null && String(tlRaw).trim() !== "") {
      const tl = Number(tlRaw);
      if (!Number.isFinite(tl) || tl < 0) throw withStatusCode(new Error("Total ligne invalide sur un item"), 400);
    }
  }

  const demande = await prisma.$transaction(async (tx) => {
    const demande = await tx.demandes_paiement.create({
      data: {
        uuid: uuidv4(),
        motif: payload.motif,
        description: payload.description || null,
        montant: String(montantAPayer),
        remise_type: remiseCalc.remise_type,
        remise_valeur: remiseCalc.remise_valeur != null ? String(remiseCalc.remise_valeur) : null,
        montant_net: String(remiseCalc.montant_net),
        devise: payload.devise || null,
        taux_change: payload.taux_change || null,
        montant_base: payload.montant_base || null,
        beneficiaire: payload.beneficiaire,
        remarque: payload.remarque || null,
        demandeur_id: agent.id,
        direction_id: payload.direction_id || agent.direction_id || null,
        departement_id: payload.departement_id || agent.departement_id || null,
        service_id: payload.service_id || agent.service_id || null,
        statut: "soumise",
        budget_prevu: payload.budget_prevu ?? null,
        budget_disponible: payload.budget_disponible ?? null,
        paiement_immediat: payload.paiement_immediat ?? null,
        daf_critere4: normalizeDafCritere4(payload.daf_critere4),
        ajournee: false,
        ajournee_le: null,
        ajournee_par_id: null,
        validation_flow_id: flow.id,
      },
    });

    if (items.length > 0) {
      for (const it of items) {
        const designation = String(it?.designation ?? "").trim();
        if (!designation) continue;
        const quantite = it?.quantite != null && String(it.quantite).trim() !== "" ? Number(it.quantite) : 1;
        const prix_unitaire = it?.prix_unitaire != null && String(it.prix_unitaire).trim() !== "" ? Number(it.prix_unitaire) : null;
        const total_ligne =
          Number.isFinite(quantite) && Number.isFinite(prix_unitaire) ? Number(quantite) * Number(prix_unitaire) : null;

        await tx.demande_items.create({
          data: {
            uuid: uuidv4(),
            demande_id: demande.id,
            designation,
            quantite: quantite || 1,
            prix_unitaire: prix_unitaire != null ? String(prix_unitaire) : null,
            unite: it?.unite ? String(it.unite).trim() : null,
            specifications: it?.specifications ? String(it.specifications).trim() : null,
            total_ligne: total_ligne != null ? String(total_ligne) : null,
          },
        });
      }
    }

    const paiementMode = normalizePaiementMode(payload.conditions_paiement_mode);
    const totalForConditions = demande.montant_net != null ? demande.montant_net : demande.montant;
    const conditions = customTranches
      ? buildCustomPaiementConditions({ total: totalForConditions, tranches: customTranches })
      : buildPaiementConditions({ total: totalForConditions, mode: paiementMode || "100/100" });

    if (conditions.length > 0) {
      await tx.conditions_paiement.createMany({
        data: conditions.map((c, idx) => ({
          uuid: uuidv4(),
          demande_id: demande.id,
          label: c.label || `Tranche ${idx + 1}`,
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
    }

    await buildValidationStepsForDemande(tx, flow, demande);

    return demande;
  });

  try {
    const first = await prisma.validation_steps.findFirst({
      where: { demande_id: demande.id },
      orderBy: { level: "asc" },
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
    // ignore notification errors
  }

  return demande;
};

exports.listDemandes = async (user, query) => {
  const whereBase = { deleted_at: null };

  const agent = await getAgentFromUser(user);
  const roles = userEffectiveRoles(user, agent);

  const where = applyListScopeForUser({ where: whereBase, roles, agent });

  if (query.statut) {
    const raw = Array.isArray(query.statut) ? query.statut : String(query.statut).split(",");
    const list = raw.map((s) => String(s || "").trim()).filter(Boolean);
    if (list.length === 1) where.statut = list[0];
    else if (list.length > 1) where.statut = { in: list };
  }
  if (query.demandeur_id) where.demandeur_id = Number(query.demandeur_id);
  if (query.beneficiaire) {
    where.beneficiaire = { contains: String(query.beneficiaire), mode: "insensitive" };
  }

  if (query.roleView) {
    const roleViewNormalized = String(query.roleView).toUpperCase();
    switch (roleViewNormalized) {
      case "DEMANDEUR":
        if (agent) where.demandeur_id = Number(agent.id);
        break;
      case "RESPONSABLE":
        if (agent?.direction_id) where.direction_id = Number(agent.direction_id);
        break;
      case "DIRECTION":
        if (query.direction_id) where.direction_id = Number(query.direction_id);
        break;
      case "GLOBAL":
        if (!hasAnyRole(roles, ["ADMIN", "DG", "DGA", "DAF", "COMPTABLE", "CAISSE"])) {
          // keep scoped where
        }
        break;
      default:
        break;
    }
  }

  return prisma.demandes_paiement.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      conditions_paiement: { orderBy: { id: "asc" } },
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
      conditions_paiement: { orderBy: { id: "asc" } },
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
      conditions_paiement: { orderBy: { id: "asc" } },
      validation_steps: { orderBy: { level: "asc" } },
      demande_items: true,
      documents: true,
    },
  });
};
exports.getOne = async (user, idOrUuid) => {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };

  const demande = await prisma.demandes_paiement.findFirst({
    where: { ...where, deleted_at: null },
    include: {
      agents_demandes_paiement_demandeur_idToagents: {
        include: { users: true, directions: true, departements: true, services: true, roles: true },
      },
      demande_items: true,
      conditions_paiement: { orderBy: { id: "asc" } },
      validation_steps: {
        orderBy: { level: "asc" },
        include: {
          agents_validation_steps_validator_idToagents: { include: { users: true } },
          agents_validation_steps_validated_by_idToagents: { include: { users: true } },
        },
      },
      documents: true,
      receptions: true,
      paiements: true,
    },
  });

  const agent = await getAgentFromUser(user);
  const roles = userEffectiveRoles(user, agent);
  assertCanReadDemande({ demande, roles, agent });

  return demande;
};
exports.update = async (user, idOrUuid, payload) => {
  const demande = await exports.getOne(user, idOrUuid);

  await assertCanEditDemande({ user, demande, action: "Modification" });

  const anyValidated = await prisma.validation_steps.count({
    where: { demande_id: demande.id, status: { in: ["valide", "rejete", "rejetee", "rejete"] } },
  });

  const statut = String(demande.statut || "").toLowerCase();
  const isEditableStage = statut === "a_modifier";

  if (!isEditableStage) throw withStatusCode(new Error("Demande verrouillee (soumise)"), 409);
  if (statut !== "a_modifier" && anyValidated > 0) throw withStatusCode(new Error("Demande verrouillee (engagee)"), 409);

  const items = Array.isArray(payload.items) ? payload.items : [];
  let itemsSummary = { totalItems: 0, hasPricedItems: false };

  let nextMontantBrut = payload.montant !== undefined ? payload.montant : demande.montant;
  if (items.length > 0) {
    const { total: totalItems, hasPricedItems } = computeItemsTotal(items);
    itemsSummary = { totalItems, hasPricedItems };
    if (hasPricedItems) nextMontantBrut = totalItems;
  }

  const nextRemiseType = payload.remise_type !== undefined ? payload.remise_type : demande.remise_type;
  const nextRemiseValeur = payload.remise_valeur !== undefined ? payload.remise_valeur : demande.remise_valeur;
  const remiseCalc = computeMontantNet({
    montantBrut: nextMontantBrut,
    remise_type: nextRemiseType,
    remise_valeur: nextRemiseValeur,
  });

  if (payload.conditions_paiement_custom !== undefined && payload.conditions_paiement_mode !== undefined) {
    throw withStatusCode(new Error("Fournir soit conditions_paiement_mode, soit conditions_paiement_custom"), 400);
  }

  const nextDafCritere4 =
    payload.daf_critere4 !== undefined ? normalizeDafCritere4(payload.daf_critere4) : demande.daf_critere4;

  const beneficiaireFinal = payload.beneficiaire ?? demande.beneficiaire;
  if (!beneficiaireFinal) throw new Error("beneficiaire requis");

  const updated = await prisma.$transaction(async (tx) => {
    const updatedDemande = await tx.demandes_paiement.update({
      where: { id: demande.id },
      data: {
        motif: payload.motif ?? demande.motif,
        description: payload.description ?? demande.description,
        montant: String(nextMontantBrut),
        remise_type: remiseCalc.remise_type,
        remise_valeur: remiseCalc.remise_valeur != null ? String(remiseCalc.remise_valeur) : null,
        montant_net: String(remiseCalc.montant_net),
        devise: payload.devise ?? demande.devise,
        taux_change: payload.taux_change ?? demande.taux_change,
        montant_base: payload.montant_base ?? demande.montant_base,
        beneficiaire: beneficiaireFinal,
        remarque: payload.remarque ?? demande.remarque,
        direction_id: payload.direction_id ?? demande.direction_id,
        departement_id: payload.departement_id ?? demande.departement_id,
        service_id: payload.service_id ?? demande.service_id,
        budget_prevu: payload.budget_prevu ?? demande.budget_prevu,
        budget_disponible: payload.budget_disponible ?? demande.budget_disponible,
        paiement_immediat: payload.paiement_immediat ?? demande.paiement_immediat,
        daf_critere4: nextDafCritere4,
        updated_at: new Date(),
      },
    });

    if (Array.isArray(payload.items)) {
      const existingItems = await tx.demande_items.findMany({
        where: { demande_id: demande.id },
        select: { id: true },
      });

      const incomingIds = new Set(items.filter((it) => it.id).map((it) => Number(it.id)));
      const toDelete = existingItems.filter((it) => !incomingIds.has(Number(it.id)));

      if (toDelete.length > 0) {
        await tx.demande_items.deleteMany({
          where: { id: { in: toDelete.map((it) => it.id) } },
        });
      }

      for (const it of items) {
        const designation = String(it?.designation ?? "").trim();
        if (!designation) continue;
        const quantite = it?.quantite != null && String(it.quantite).trim() !== "" ? Number(it.quantite) : 1;
        const prix_unitaire = it?.prix_unitaire != null && String(it.prix_unitaire).trim() !== "" ? Number(it.prix_unitaire) : null;
        const total_ligne =
          Number.isFinite(quantite) && Number.isFinite(prix_unitaire) ? Number(quantite) * Number(prix_unitaire) : null;

        if (it.id) {
          await tx.demande_items.update({
            where: { id: Number(it.id) },
            data: {
              designation,
              quantite: quantite || 1,
              prix_unitaire: prix_unitaire != null ? String(prix_unitaire) : null,
              unite: it?.unite ? String(it.unite).trim() : null,
              specifications: it?.specifications ? String(it.specifications).trim() : null,
              total_ligne: total_ligne != null ? String(total_ligne) : null,
            },
          });
        } else {
          await tx.demande_items.create({
            data: {
              uuid: uuidv4(),
              demande_id: demande.id,
              designation,
              quantite: quantite || 1,
              prix_unitaire: prix_unitaire != null ? String(prix_unitaire) : null,
              unite: it?.unite ? String(it.unite).trim() : null,
              specifications: it?.specifications ? String(it.specifications).trim() : null,
              total_ligne: total_ligne != null ? String(total_ligne) : null,
            },
          });
        }
      }
    }
    if (statut === "a_modifier") {
      const retourStep = await tx.validation_steps.findFirst({
        where: { demande_id: demande.id, status: "retour_modification" },
        orderBy: { level: "desc" },
      });

      if (retourStep?.level) {
        const retourLevel = Number(retourStep.level);

        if (retourLevel > 1) {
          const prev = await tx.validation_steps.findFirst({
            where: { demande_id: demande.id, level: retourLevel - 1 },
          });

          if (prev) {
            await tx.validation_steps.update({
              where: { id: retourStep.id },
              data: { status: "bloque", updated_at: new Date() },
            });

            await tx.validation_steps.update({
              where: { id: prev.id },
              data: { status: "en_attente", updated_at: new Date() },
            });

            if (prev.role_name) {
              await tx.demandes_paiement.update({
                where: { id: demande.id },
                data: { statut: toStageStatus(prev.role_name), updated_at: new Date() },
              });
            }
          }
        } else if (retourLevel === 1) {
          await tx.validation_steps.update({
            where: { id: retourStep.id },
            data: {
              status: "en_attente",
              validated_by_id: null,
              validated_at: null,
              signature_url: null,
              commentaire: null,
              updated_at: new Date(),
            },
          });

          await tx.validation_steps.updateMany({
            where: { demande_id: demande.id, level: { gt: 1 } },
            data: { status: "bloque", updated_at: new Date() },
          });

          if (retourStep.role_name) {
            await tx.demandes_paiement.update({
              where: { id: demande.id },
              data: { statut: toStageStatus(retourStep.role_name), updated_at: new Date() },
            });
          }
        }
      }
    }

    const totalForConditions =
      updatedDemande.montant_net != null ? updatedDemande.montant_net : updatedDemande.montant;

    if (payload.conditions_paiement_mode !== undefined || payload.conditions_paiement_custom !== undefined) {
      const paidOrLinked = await tx.conditions_paiement.count({
        where: {
          demande_id: demande.id,
          OR: [{ paiement_id: { not: null } }, { statut: { in: ["paye", "payee", "regle", "reglee"] } }],
        },
      });
      if (paidOrLinked > 0) throw withStatusCode(new Error("Conditions de paiement deja engagees"), 409);

      const hasCustom = payload.conditions_paiement_custom !== undefined;
      const customTranches = Array.isArray(payload.conditions_paiement_custom) ? payload.conditions_paiement_custom : null;

      let conditions = [];
      if (hasCustom) {
        conditions = buildCustomPaiementConditions({ total: totalForConditions, tranches: customTranches });
      } else {
        const paiementMode = normalizePaiementMode(payload.conditions_paiement_mode);
        if (!paiementMode) {
          throw withStatusCode(
            new Error("Condition de paiement invalide (attendu: 70/30, 50/50, 100/100)"),
            400
          );
        }
        conditions = buildPaiementConditions({ total: totalForConditions, mode: paiementMode });
      }

      await tx.conditions_paiement.deleteMany({
        where: {
          demande_id: demande.id,
          paiement_id: null,
          statut: "prevu",
        },
      });

      if (conditions.length > 0) {
        await tx.conditions_paiement.createMany({
          data: conditions.map((c, idx) => ({
            uuid: uuidv4(),
            demande_id: demande.id,
            label: c.label || `Tranche ${idx + 1}`,
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
      }
    }

    const shouldRecalcConditions =
      payload.montant !== undefined ||
      payload.remise_type !== undefined ||
      payload.remise_valeur !== undefined ||
      Array.isArray(payload.items);

    if (shouldRecalcConditions) {
      const prevus = await tx.conditions_paiement.findMany({
        where: { demande_id: demande.id, statut: "prevu", paiement_id: null },
      });

      for (const c of prevus) {
        if (c.pourcentage != null) {
          const nextMontantPrevu = (Number(totalForConditions) * Number(c.pourcentage)) / 100;
          await tx.conditions_paiement.update({
            where: { id: c.id },
            data: { montant_prevu: nextMontantPrevu, updated_at: new Date() },
          });
        }
      }
    }

    return updatedDemande;
  });

  return updated;
};
exports.softDelete = async (user, idOrUuid) => {
  const demande = await exports.getOne(user, idOrUuid);
  await assertCanEditDemande({ user, demande, action: "Suppression" });

  await prisma.demandes_paiement.update({
    where: { id: demande.id },
    data: { deleted_at: new Date(), updated_at: new Date() },
  });

  return true;
};
