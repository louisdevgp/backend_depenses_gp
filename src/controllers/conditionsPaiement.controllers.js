const { randomUUID: uuidv4 } = require("crypto");
const prisma = require("../config/prisma");
const service = require("../services/conditionsPaiement.services");

async function isAdminUserId(userId) {
  const u = await prisma.users.findUnique({
    where: { id: Number(userId) },
    include: { user_roles: { include: { roles: true } } },
  });
  const roleNames = (u?.user_roles || []).map((ur) => ur?.roles?.name).filter(Boolean);
  return roleNames.includes("ADMIN");
}

async function assertCanMutateDemande({ req, demandeId, actionLabel }) {
  const userId = req.user?.userId;
  if (!userId) return { ok: false, status: 401, message: "Unauthorized" };
  if (!demandeId) return { ok: false, status: 400, message: "demande_id requis" };

  if (await isAdminUserId(userId)) return { ok: true };

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      id: true,
      demandeur_id: true,
      agents_demandes_paiement_demandeur_idToagents: { select: { user_id: true } },
    },
  });
  if (!demande) return { ok: false, status: 404, message: "Demande introuvable" };

  const demandeurUserId = demande?.agents_demandes_paiement_demandeur_idToagents?.user_id;
  if (demandeurUserId != null && Number(demandeurUserId) === Number(userId)) return { ok: true };

  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { id: true },
  });
  if (agent?.id && Number(demande.demandeur_id) === Number(agent.id)) return { ok: true };

  return { ok: false, status: 403, message: `${actionLabel || "Action"} non autorisée` };
}

exports.create = async (req, res) => {
  try {
    const authz = await assertCanMutateDemande({
      req,
      demandeId: req.body?.demande_id,
      actionLabel: "Création condition paiement",
    });
    if (!authz.ok) return res.status(authz.status).json({ success: false, message: authz.message });

    const payload = {
      uuid: uuidv4(),
      ...req.body,
      demande_id: Number(req.body.demande_id),
      paiement_id: req.body.paiement_id ? Number(req.body.paiement_id) : null,
      date_echeance: req.body.date_echeance ? new Date(req.body.date_echeance) : null,
    };
    const row = await service.createConditionPaiement(payload);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur create condition", error: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const rows = await service.listConditionsPaiement(req.query);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list conditions", error: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const row = await service.getConditionPaiementById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur get condition", error: e.message });
  }
};

exports.listByDemande = async (req, res) => {
  try {
    const rows = await service.listConditionsPaiement({ demande_id: req.params.demandeId });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list conditions demande", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await service.getConditionPaiementById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    const authz = await assertCanMutateDemande({
      req,
      demandeId: existing.demande_id,
      actionLabel: "Modification condition paiement",
    });
    if (!authz.ok) return res.status(authz.status).json({ success: false, message: authz.message });

    const payload = {
      ...req.body,
      paiement_id: req.body.paiement_id ? Number(req.body.paiement_id) : null,
      date_echeance: req.body.date_echeance ? new Date(req.body.date_echeance) : null,
    };
    const row = await service.updateConditionPaiement(req.params.id, payload);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur update condition", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await service.getConditionPaiementById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });

    const authz = await assertCanMutateDemande({
      req,
      demandeId: existing.demande_id,
      actionLabel: "Suppression condition paiement",
    });
    if (!authz.ok) return res.status(authz.status).json({ success: false, message: authz.message });

    await service.deleteConditionPaiement(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur delete condition", error: e.message });
  }
};

