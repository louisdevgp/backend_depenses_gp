const paiementsService = require("../services/paiements.services");
const {PrismaClient} = require("@prisma/client");
const prisma = new PrismaClient();

exports.create = async (req, res) => {
  try {
    // req.user vient de ton auth.middleware -> { userId, email, ... }
    // Ici on doit récupérer l'agent lié au user connecté.
    // Si dans ton projet tu as déjà req.agentId, utilise-le.
    const agent = await prisma.agents.findMany({ where: { user_id: req.user.userId } });
    if (!agent) {
      return res.status(400).json({ success: false, message: "Agent non trouvé pour l'utilisateur connecté" });
    }

    const comptableAgentId = agent[0].id;

    console.log("Comptable Agent ID:", comptableAgentId);

    const paiement = await paiementsService.createPaiement(req.body, comptableAgentId);
    return res.status(201).json({ success: true, data: paiement });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message || "Erreur paiement" });
  }
};


exports.list = async (req, res) => {
  try {
    const data = await paiementsService.listPaiements(req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await paiementsService.getPaiementById(req.params.id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.getByUuid = async (req, res) => {
  try {
    const data = await paiementsService.getPaiementByUuid(req.params.uuid);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};


exports.listByDemande = async (req, res) => {
  try {
    const data = await paiementsService.listByDemande(req.params.demandeId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};


exports.update = async (req, res) => {
  try {
    const data = await paiementsService.updatePaiement(req.params.id, req.body);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await paiementsService.deletePaiement(req.params.id);
    return res.json({ success: true, message: "Paiement supprimé" });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
