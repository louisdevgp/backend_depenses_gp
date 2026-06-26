const prisma = require("../config/prisma");
const service = require("../services/budgetLines.services");

async function getActorAgentId(user) {
  const userId = Number(user?.userId || user?.id);
  if (!userId) return null;
  const agent = await prisma.agents.findFirst({
    where: { user_id: userId, deleted_at: null },
    select: { id: true },
  });
  return agent?.id || null;
}

exports.list = async (req, res) => {
  try {
    const data = await service.listBudgetLines(req.query || {});
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getBudgetLine(req.params.idOrUuid);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const actorAgentId = await getActorAgentId(req.user);
    if (!actorAgentId) return res.status(400).json({ success: false, message: "Agent introuvable" });
    const data = await service.createBudgetLine(req.body || {}, actorAgentId);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const actorAgentId = await getActorAgentId(req.user);
    if (!actorAgentId) return res.status(400).json({ success: false, message: "Agent introuvable" });
    const data = await service.updateBudgetLine(req.params.idOrUuid, req.body || {}, actorAgentId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const actorAgentId = await getActorAgentId(req.user);
    if (!actorAgentId) return res.status(400).json({ success: false, message: "Agent introuvable" });
    await service.deleteBudgetLine(req.params.idOrUuid, actorAgentId);
    return res.json({ success: true, message: "Ligne budgetaire supprimee" });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.preview = async (req, res) => {
  try {
    const ligneBudgetaireId = req.query.ligne_budgetaire_id || req.query.id || req.body?.ligne_budgetaire_id;
    const montant = req.query.montant || req.body?.montant;
    const data = await service.calculateBudgetWarning(ligneBudgetaireId, montant);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};
