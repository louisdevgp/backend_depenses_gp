const agentsService = require("../services/agents.services");

async function createAgent(req, res) {
  try {
    const agent = await agentsService.createAgent(req.body, req.user); // req.user venant du JWT
    return res.status(201).json({ success: true, data: agent });
  } catch (e) {
    console.error("createAgent error:", e);
    return res.status(400).json({ success: false, message: e.message || "Erreur création agent" });
  }
}

async function listAgents(req, res) {
  try {
    const data = await agentsService.listAgents(req.query);
    return res.json({ success: true, ...data });
  } catch (e) {
    console.error("listAgents error:", e);
    return res.status(400).json({ success: false, message: e.message || "Erreur liste agents" });
  }
}

async function getAgentById(req, res) {
  try {
    const agent = await agentsService.getAgentById(req.params.id);
    return res.json({ success: true, data: agent });
  } catch (e) {
    console.error("getAgentById error:", e);
    return res.status(404).json({ success: false, message: e.message || "Agent introuvable" });
  }
}

async function updateAgent(req, res) {
  try {
    const agent = await agentsService.updateAgent(req.params.id, req.body);
    return res.json({ success: true, data: agent });
  } catch (e) {
    console.error("updateAgent error:", e);
    return res.status(400).json({ success: false, message: e.message || "Erreur update agent" });
  }
}

async function softDeleteAgent(req, res) {
  try {
    await agentsService.softDeleteAgent(req.params.id);
    return res.json({ success: true, message: "Agent désactivé (soft delete)" });
  } catch (e) {
    console.error("softDeleteAgent error:", e);
    return res.status(400).json({ success: false, message: e.message || "Erreur suppression agent" });
  }
}

async function setAgentManager(req, res) {
  try {
    const { manager_id, start_at, end_at } = req.body;
    const agent = await agentsService.setAgentManager({
      agentId: req.params.id,
      managerId: manager_id ?? null,
      startAt: start_at,
      endAt: end_at,
      actorAgentId: req.user?.agent?.id, // si tu mets agent dans req.user
    });
    return res.json({ success: true, data: agent });
  } catch (e) {
    console.error("setAgentManager error:", e);
    return res.status(400).json({ success: false, message: e.message || "Erreur changement manager" });
  }
}

async function getCurrentManager(req, res) {
  try {
    const data = await agentsService.getCurrentManager(req.params.id);
    return res.json({ success: true, data });
  } catch (e) {
    console.error("Error getCurrentManager:", e);
    return res.status(404).json({ success: false, message: e.message });
  }
}

module.exports = {
  createAgent,
  listAgents,
  getAgentById,
  updateAgent,
  softDeleteAgent,
  setAgentManager,
  getCurrentManager
};
