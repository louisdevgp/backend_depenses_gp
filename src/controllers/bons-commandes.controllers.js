const bonCommandesService = require("../services/bons-commandes.services");
const prisma = require("../config/prisma"); // adapte selon ton projet

exports.create = async (req, res) => {
  try {
    // req.user vient de ton auth.middleware (payload jwt)
    // il nous faut l'agent_id -> soit tu le mets dans le token, soit tu le retrouves via user_id
    // ici je suppose que tu as req.user.userId et qu'un user a 1 agent principal.
    const userId = req.user.userId;

    const agent = await prisma.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      select: { id: true },
    });
    if (!agent) return res.status(400).json({ success: false, message: "Agent introuvable pour ce user" });

    const bc = await bonCommandesService.createBonCommande(prisma, req.body, agent.id);
    return res.status(201).json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const data = await bonCommandesService.listBonCommandes(prisma, req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const bc = await bonCommandesService.getBonCommandeById(prisma, req.params.id);
    if (!bc) return res.status(404).json({ success: false, message: "Bon de commande introuvable" });
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getByUuid = async (req, res) => {
  try {
    const bc = await bonCommandesService.getBonCommandeByUuid(prisma, req.params.uuid);
    if (!bc) return res.status(404).json({ success: false, message: "Bon de commande introuvable" });
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const bc = await bonCommandesService.updateBonCommande(prisma, req.params.id, req.body);
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.cancel = async (req, res) => {
  try {
    const bc = await bonCommandesService.cancelBonCommande(prisma, req.params.id);
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const bc = await bonCommandesService.deleteBonCommande(prisma, req.params.id);
    return res.json({ success: true, data: bc });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
