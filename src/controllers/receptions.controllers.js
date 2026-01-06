const receptionsService = require("../services/receptions.services");

exports.create = async (req, res) => {
  try {
    const agentId = req.user.agentId;
    const reception = await receptionsService.createReception(req.body, agentId);
    res.json({ success: true, data: reception });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
  
};

exports.list = async (req, res) => {
  const rows = await receptionsService.listReceptions(req.query);
  res.json({ success: true, data: rows });
};

exports.getById = async (req, res) => {
  const row = await receptionsService.getReceptionById(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.getByUuid = async (req, res) => {
  const row = await receptionsService.getReceptionByUuid(req.params.uuid);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.update = async (req, res) => {
  try {
    const row = await receptionsService.updateReception(req.params.id, req.body);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.visaDirecteur = async (req, res) => {
  try {
    const agentId = req.user.agentId;
    const row = await receptionsService.visaDirecteur(req.params.id, req.body, agentId);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.visaDaf = async (req, res) => {
  try {
    const agentId = req.user.agentId;
    const row = await receptionsService.visaDaf(req.params.id, req.body, agentId);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await receptionsService.deleteReception(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
