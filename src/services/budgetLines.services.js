const { randomUUID: uuidv4 } = require("crypto");
const prisma = require("../config/prisma");

function withStatusCode(err, statusCode) {
  err.statusCode = Number(statusCode);
  return err;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStatut(value) {
  const v = String(value || "active").trim().toLowerCase();
  return ["active", "suspendue", "cloturee"].includes(v) ? v : "active";
}

function normalizeControleMode(value) {
  const v = normalizeUpper(value || "SOUPLE");
  return v === "STRICT" ? "STRICT" : "SOUPLE";
}

function normalizeScopeType(value) {
  const v = normalizeUpper(value || "GLOBAL");
  return ["GLOBAL", "DIRECTION", "DEPARTEMENT", "SERVICE"].includes(v) ? v : "GLOBAL";
}

function isNumericId(value) {
  return /^[0-9]+$/.test(String(value || ""));
}

function montantDemande(demande) {
  return round2(demande?.montant_net != null ? demande.montant_net : demande?.montant);
}

function soldeDisponible(line) {
  return round2(toNumber(line?.montant_initial) - toNumber(line?.montant_engage) - toNumber(line?.montant_paye));
}

function buildBudgetSnapshot(line, amount) {
  const montant = round2(amount);
  const available = soldeDisponible(line);
  const depassement = round2(Math.max(0, montant - available));
  return {
    ligne_budgetaire_id: line?.id != null ? Number(line.id) : null,
    code: line?.code || null,
    libelle: line?.libelle || null,
    exercice: line?.exercice ?? null,
    devise: line?.devise || "FCFA",
    montant_initial: round2(line?.montant_initial),
    montant_engage: round2(line?.montant_engage),
    montant_paye: round2(line?.montant_paye),
    solde_disponible: available,
    montant_demande: montant,
    depassement_montant: depassement,
    depassement: depassement > 0,
    controle_mode: normalizeControleMode(line?.controle_mode),
    bloquant: normalizeControleMode(line?.controle_mode) === "STRICT" && depassement > 0,
  };
}

function decorateLine(line) {
  if (!line) return null;
  const solde = soldeDisponible(line);
  return {
    ...line,
    solde_disponible: solde,
    est_en_depassement: solde < 0,
  };
}

async function getActorAgent(client, actorAgentId) {
  if (!actorAgentId) return null;
  return client.agents.findFirst({
    where: { id: Number(actorAgentId), deleted_at: null },
    include: {
      roles: true,
      users: { include: { user_roles: { include: { roles: true } } } },
    },
  });
}

function agentHasRole(agent, roleName) {
  const expected = normalizeUpper(roleName);
  const roles = new Set();
  if (agent?.roles?.name) roles.add(normalizeUpper(agent.roles.name));
  for (const ur of agent?.users?.user_roles || []) {
    if (ur?.roles?.name) roles.add(normalizeUpper(ur.roles.name));
  }
  return roles.has(expected);
}

async function ensureDafAgent(client, actorAgentId) {
  const agent = await getActorAgent(client, actorAgentId);
  if (!agent || (!agentHasRole(agent, "DAF") && !agentHasRole(agent, "ADMIN"))) {
    throw withStatusCode(new Error("Action reservee au DAF"), 403);
  }
  return agent;
}

async function findLine(client, idOrUuid, extraWhere = {}) {
  const where = isNumericId(idOrUuid)
    ? { id: Number(idOrUuid), ...extraWhere }
    : { uuid: String(idOrUuid), ...extraWhere };
  return client.lignes_budgetaires.findFirst({ where });
}

async function listBudgetLines(query = {}) {
  const where = { deleted_at: null };
  if (query.exercice) where.exercice = Number(query.exercice);
  if (query.statut) where.statut = normalizeStatut(query.statut);
  if (query.activeOnly === true || String(query.activeOnly || "").toLowerCase() === "true") {
    where.statut = "active";
  }
  if (query.q) {
    const q = String(query.q).trim();
    where.OR = [{ code: { contains: q } }, { libelle: { contains: q } }];
  }

  const rows = await prisma.lignes_budgetaires.findMany({
    where,
    orderBy: [{ exercice: "desc" }, { code: "asc" }],
    include: {
      agents_lignes_budgetaires_created_by_idToagents: { include: { users: true } },
      agents_lignes_budgetaires_updated_by_idToagents: { include: { users: true } },
    },
  });
  return rows.map(decorateLine);
}

async function getBudgetLine(idOrUuid) {
  const line = await prisma.lignes_budgetaires.findFirst({
    where: {
      ...(isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) }),
      deleted_at: null,
    },
    include: {
      mouvements_budgetaires: { orderBy: { created_at: "desc" }, take: 100 },
      agents_lignes_budgetaires_created_by_idToagents: { include: { users: true } },
      agents_lignes_budgetaires_updated_by_idToagents: { include: { users: true } },
    },
  });
  if (!line) throw withStatusCode(new Error("Ligne budgetaire introuvable"), 404);
  return decorateLine(line);
}

async function createBudgetLine(payload = {}, actorAgentId) {
  await ensureDafAgent(prisma, actorAgentId);
  const exercice = Number(payload.exercice || new Date().getFullYear());
  const code = String(payload.code || `LB-${exercice}-${Date.now()}`).trim().toUpperCase();
  const libelle = String(payload.libelle || "").trim();
  const montantInitial = round2(payload.montant_initial);
  if (!libelle) throw withStatusCode(new Error("Libelle requis"), 400);
  if (!Number.isFinite(montantInitial) || montantInitial < 0) {
    throw withStatusCode(new Error("Montant initial invalide"), 400);
  }

  const line = await prisma.lignes_budgetaires.create({
    data: {
      uuid: uuidv4(),
      code,
      libelle,
      description: payload.description ? String(payload.description).trim() : null,
      exercice,
      devise: payload.devise ? String(payload.devise).trim().toUpperCase() : "FCFA",
      montant_initial: montantInitial,
      montant_engage: 0,
      montant_paye: 0,
      controle_mode: normalizeControleMode(payload.controle_mode),
      scope_type: normalizeScopeType(payload.scope_type),
      scope_id: payload.scope_id != null ? Number(payload.scope_id) : null,
      statut: normalizeStatut(payload.statut),
      created_by_id: Number(actorAgentId),
      updated_by_id: Number(actorAgentId),
    },
  });
  return decorateLine(line);
}

async function updateBudgetLine(idOrUuid, payload = {}, actorAgentId) {
  await ensureDafAgent(prisma, actorAgentId);
  const existing = await findLine(prisma, idOrUuid, { deleted_at: null });
  if (!existing) throw withStatusCode(new Error("Ligne budgetaire introuvable"), 404);

  const data = { updated_by_id: Number(actorAgentId), updated_at: new Date() };
  if (payload.code !== undefined) data.code = String(payload.code || "").trim().toUpperCase();
  if (payload.libelle !== undefined) data.libelle = String(payload.libelle || "").trim();
  if (payload.description !== undefined) {
    data.description = payload.description ? String(payload.description).trim() : null;
  }
  if (payload.exercice !== undefined) data.exercice = Number(payload.exercice);
  if (payload.devise !== undefined) data.devise = String(payload.devise || "FCFA").trim().toUpperCase();
  if (payload.montant_initial !== undefined) data.montant_initial = round2(payload.montant_initial);
  if (payload.controle_mode !== undefined) data.controle_mode = normalizeControleMode(payload.controle_mode);
  if (payload.scope_type !== undefined) data.scope_type = normalizeScopeType(payload.scope_type);
  if (payload.scope_id !== undefined) data.scope_id = payload.scope_id != null ? Number(payload.scope_id) : null;
  if (payload.statut !== undefined) data.statut = normalizeStatut(payload.statut);

  if (data.libelle !== undefined && !data.libelle) throw withStatusCode(new Error("Libelle requis"), 400);
  if (data.montant_initial !== undefined && data.montant_initial < 0) {
    throw withStatusCode(new Error("Montant initial invalide"), 400);
  }

  const updated = await prisma.lignes_budgetaires.update({
    where: { id: existing.id },
    data,
  });
  return decorateLine(updated);
}

async function deleteBudgetLine(idOrUuid, actorAgentId) {
  const agent = await getActorAgent(prisma, actorAgentId);
  if (!agentHasRole(agent, "ADMIN")) {
    throw withStatusCode(new Error("Suppression reservee a l'Admin"), 403);
  }
  const existing = await findLine(prisma, idOrUuid, { deleted_at: null });
  if (!existing) throw withStatusCode(new Error("Ligne budgetaire introuvable"), 404);
  await prisma.lignes_budgetaires.update({
    where: { id: existing.id },
    data: { deleted_at: new Date(), statut: "cloturee", updated_by_id: Number(actorAgentId), updated_at: new Date() },
  });
  return true;
}

async function calculateBudgetWarning(ligneBudgetaireId, amount, client = prisma) {
  if (!ligneBudgetaireId) return null;
  const line = await client.lignes_budgetaires.findFirst({
    where: { id: Number(ligneBudgetaireId), deleted_at: null },
  });
  if (!line) throw withStatusCode(new Error("Ligne budgetaire introuvable"), 404);
  if (line.statut !== "active") throw withStatusCode(new Error("Ligne budgetaire inactive"), 409);
  return buildBudgetSnapshot(line, amount);
}

async function assignLineToDemande(client, { demandeId, ligneBudgetaireId, actorAgentId }) {
  const demande = await client.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: { id: true, montant: true, montant_net: true },
  });
  if (!demande) throw withStatusCode(new Error("Demande introuvable"), 404);
  const snapshot = await calculateBudgetWarning(ligneBudgetaireId, montantDemande(demande), client);
  if (snapshot?.bloquant) {
    throw withStatusCode(new Error("Solde budgetaire insuffisant pour cette ligne"), 409);
  }
  await client.demandes_paiement.update({
    where: { id: Number(demande.id) },
    data: {
      ligne_budgetaire_id: Number(ligneBudgetaireId),
      ligne_budgetaire_assignee_par_id: Number(actorAgentId),
      ligne_budgetaire_assignee_at: new Date(),
      budget_depassement_montant: snapshot.depassement_montant,
      budget_warning_snapshot: snapshot,
      updated_at: new Date(),
    },
  });
  return snapshot;
}

async function ensureEngagementForDemande(client, { demandeId, actorAgentId }) {
  const demande = await client.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: { id: true, montant: true, montant_net: true, ligne_budgetaire_id: true },
  });
  if (!demande?.ligne_budgetaire_id) return null;

  const existing = await client.mouvements_budgetaires.findFirst({
    where: {
      demande_id: Number(demande.id),
      ligne_budgetaire_id: Number(demande.ligne_budgetaire_id),
      type_mouvement: "ENGAGEMENT",
    },
    select: { id: true },
  });
  if (existing) return null;

  const amount = montantDemande(demande);
  const line = await client.lignes_budgetaires.findUnique({
    where: { id: Number(demande.ligne_budgetaire_id) },
  });
  if (!line) return null;
  const before = soldeDisponible(line);
  const nextEngage = round2(toNumber(line.montant_engage) + amount);
  const after = round2(toNumber(line.montant_initial) - nextEngage - toNumber(line.montant_paye));
  await client.lignes_budgetaires.update({
    where: { id: Number(line.id) },
    data: { montant_engage: nextEngage, updated_at: new Date() },
  });
  return client.mouvements_budgetaires.create({
    data: {
      uuid: uuidv4(),
      ligne_budgetaire_id: Number(line.id),
      demande_id: Number(demande.id),
      type_mouvement: "ENGAGEMENT",
      sens: "DEBIT",
      montant: amount,
      solde_avant: before,
      solde_apres: after,
      commentaire: "Engagement automatique a l'approbation de la demande",
      created_by_id: actorAgentId ? Number(actorAgentId) : null,
    },
  });
}

async function changeDemandeLineBeforePayment(client, { demandeId, newLineId, actorAgentId }) {
  const actor = await ensureDafAgent(client, actorAgentId);
  const demande = await client.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: { id: true, ligne_budgetaire_id: true, montant: true, montant_net: true },
  });
  if (!demande) throw withStatusCode(new Error("Demande introuvable"), 404);
  if (Number(demande.ligne_budgetaire_id) === Number(newLineId)) return null;

  const existingPayments = await client.paiements.count({ where: { demande_id: Number(demande.id) } });
  if (existingPayments > 0) {
    throw withStatusCode(new Error("Changement de ligne budgetaire impossible apres un premier paiement"), 409);
  }

  if (demande.ligne_budgetaire_id) {
    const movement = await client.mouvements_budgetaires.findFirst({
      where: {
        demande_id: Number(demande.id),
        ligne_budgetaire_id: Number(demande.ligne_budgetaire_id),
        type_mouvement: "ENGAGEMENT",
      },
    });
    if (movement) {
      const oldLine = await client.lignes_budgetaires.findUnique({
        where: { id: Number(demande.ligne_budgetaire_id) },
      });
      if (oldLine) {
        const amount = round2(movement.montant);
        const before = soldeDisponible(oldLine);
        const nextEngage = round2(Math.max(0, toNumber(oldLine.montant_engage) - amount));
        const after = round2(toNumber(oldLine.montant_initial) - nextEngage - toNumber(oldLine.montant_paye));
        await client.lignes_budgetaires.update({
          where: { id: Number(oldLine.id) },
          data: { montant_engage: nextEngage, updated_at: new Date() },
        });
        await client.mouvements_budgetaires.create({
          data: {
            uuid: uuidv4(),
            ligne_budgetaire_id: Number(oldLine.id),
            demande_id: Number(demande.id),
            type_mouvement: "ANNULATION_ENGAGEMENT",
            sens: "CREDIT",
            montant: amount,
            solde_avant: before,
            solde_apres: after,
            commentaire: "Annulation engagement suite changement de ligne budgetaire par le DAF payeur",
            created_by_id: Number(actor.id),
          },
        });
      }
    }
  }

  await assignLineToDemande(client, {
    demandeId: Number(demande.id),
    ligneBudgetaireId: Number(newLineId),
    actorAgentId: Number(actor.id),
  });
  await ensureEngagementForDemande(client, { demandeId: Number(demande.id), actorAgentId: Number(actor.id) });
  return true;
}

async function recordPaymentMovement(client, { paiementId, demandeId, ligneBudgetaireId, amount, actorAgentId }) {
  if (!ligneBudgetaireId) return null;
  const line = await client.lignes_budgetaires.findUnique({ where: { id: Number(ligneBudgetaireId) } });
  if (!line) return null;

  const engagementAgg = await client.mouvements_budgetaires.aggregate({
    where: { demande_id: Number(demandeId), ligne_budgetaire_id: Number(ligneBudgetaireId), type_mouvement: "ENGAGEMENT" },
    _sum: { montant: true },
  });
  const paymentAgg = await client.mouvements_budgetaires.aggregate({
    where: { demande_id: Number(demandeId), ligne_budgetaire_id: Number(ligneBudgetaireId), type_mouvement: "PAIEMENT" },
    _sum: { montant: true },
  });
  const engagementAmount = round2(engagementAgg?._sum?.montant || 0);
  const alreadyPaid = round2(paymentAgg?._sum?.montant || 0);
  const remainingEngagement = round2(Math.max(0, engagementAmount - alreadyPaid));
  const paymentAmount = round2(amount);
  const reduceEngage = round2(Math.min(remainingEngagement, paymentAmount));
  const before = soldeDisponible(line);
  const nextEngage = round2(Math.max(0, toNumber(line.montant_engage) - reduceEngage));
  const nextPaye = round2(toNumber(line.montant_paye) + paymentAmount);
  const after = round2(toNumber(line.montant_initial) - nextEngage - nextPaye);
  await client.lignes_budgetaires.update({
    where: { id: Number(line.id) },
    data: { montant_engage: nextEngage, montant_paye: nextPaye, updated_at: new Date() },
  });
  return client.mouvements_budgetaires.create({
    data: {
      uuid: uuidv4(),
      ligne_budgetaire_id: Number(line.id),
      demande_id: Number(demandeId),
      paiement_id: Number(paiementId),
      type_mouvement: "PAIEMENT",
      sens: "DEBIT",
      montant: paymentAmount,
      solde_avant: before,
      solde_apres: after,
      commentaire: "Paiement impute a la ligne budgetaire",
      created_by_id: actorAgentId ? Number(actorAgentId) : null,
    },
  });
}

async function reversePaymentMovement(client, { paiement, actorAgentId }) {
  if (!paiement?.ligne_budgetaire_id) return null;
  const amount = round2(paiement.montant);
  const line = await client.lignes_budgetaires.findUnique({
    where: { id: Number(paiement.ligne_budgetaire_id) },
  });
  if (!line) return null;
  const before = soldeDisponible(line);
  const nextPaye = round2(Math.max(0, toNumber(line.montant_paye) - amount));
  const nextEngage = round2(toNumber(line.montant_engage) + amount);
  const after = round2(toNumber(line.montant_initial) - nextEngage - nextPaye);
  await client.lignes_budgetaires.update({
    where: { id: Number(line.id) },
    data: { montant_engage: nextEngage, montant_paye: nextPaye, updated_at: new Date() },
  });
  return client.mouvements_budgetaires.create({
    data: {
      uuid: uuidv4(),
      ligne_budgetaire_id: Number(line.id),
      demande_id: Number(paiement.demande_id),
      paiement_id: Number(paiement.id),
      type_mouvement: "ANNULATION_PAIEMENT",
      sens: "CREDIT",
      montant: amount,
      solde_avant: before,
      solde_apres: after,
      commentaire: "Annulation budgetaire suite suppression du paiement",
      created_by_id: actorAgentId ? Number(actorAgentId) : null,
    },
  });
}

module.exports = {
  listBudgetLines,
  getBudgetLine,
  createBudgetLine,
  updateBudgetLine,
  deleteBudgetLine,
  calculateBudgetWarning,
  assignLineToDemande,
  ensureEngagementForDemande,
  changeDemandeLineBeforePayment,
  recordPaymentMovement,
  reversePaymentMovement,
  decorateLine,
  buildBudgetSnapshot,
  agentHasRole,
  getActorAgent,
};
