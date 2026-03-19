const paiementsService = require("../services/paiements.services");
const prisma = require("../config/prisma");

exports.create = async (req, res) => {
  try {
    const agent = await prisma.agents.findFirst({
      where: { user_id: req.user.userId, deleted_at: null },
      select: { id: true },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouvé pour l'utilisateur connecté",
      });
    }

    const paiement = await paiementsService.createPaiement(req.body, agent.id);
    return res.status(201).json({ success: true, data: paiement });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur paiement",
    });
  }
};

exports.list = async (req, res) => {
  try {
    const data = await paiementsService.listPaiements(req.query, req.user);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.startSignature = async (req, res) => {
  try {
    const agent = await prisma.agents.findFirst({
      where: { user_id: req.user.userId, deleted_at: null },
      select: { id: true },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouve pour l'utilisateur connecte",
      });
    }

    const data = await paiementsService.startCreateSignature(req.body, agent.id, req.user.userId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur signature",
    });
  }
};

exports.completeSignature = async (req, res) => {
  try {
    const sessionId = req?.body?.session_id || req?.body?.sessionId;
    const data = await paiementsService.completeCreateSignature(sessionId, req.user.userId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur signature",
    });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await paiementsService.getPaiementById(req.params.id, req.user);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.getByUuid = async (req, res) => {
  try {
    const data = await paiementsService.getPaiementByUuid(req.params.uuid, req.user);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.listByDemande = async (req, res) => {
  try {
    const data = await paiementsService.listByDemande(req.params.demandeId, req.user);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const agent = await prisma.agents.findFirst({
      where: { user_id: req.user.userId, deleted_at: null },
      select: { id: true },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouvé pour l'utilisateur connecté",
      });
    }

    const data = await paiementsService.updatePaiement(req.params.id, req.body, agent.id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const agent = await prisma.agents.findFirst({
      where: { user_id: req.user.userId, deleted_at: null },
      select: { id: true },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouvé pour l'utilisateur connecté",
      });
    }

    await paiementsService.deletePaiement(req.params.id, agent.id);
    return res.json({ success: true, message: "Paiement supprimé" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
