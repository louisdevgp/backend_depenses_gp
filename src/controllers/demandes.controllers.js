const service = require("../services/demandes.services");

exports.create = async (req, res) => {
  try {
    const result = await service.createDemande(req.user, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    console.error("createDemande error:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const result = await service.listDemandes(req.query);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.listMine = async (req, res) => {
  try {
    const result = await service.listMyDemandes(req.user);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.listByDemandeur = async (req, res) => {
  try {
    const demandeurId = Number(req.params.demandeurId);
    const result = await service.listByDemandeur(demandeurId);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const result = await service.getOne(req.params.idOrUuid);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(404).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.update(req.user, req.params.idOrUuid, req.body);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.softDelete = async (req, res) => {
  try {
    await service.softDelete(req.user, req.params.idOrUuid);
    return res.json({ success: true, message: "Demande désactivée (soft delete) ✅" });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
