const rolesService = require("../services/roles.services");

exports.list = async (req, res) => {
  try {
    const data = await rolesService.list(req.query);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await rolesService.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Role not found" });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await rolesService.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const data = await rolesService.update(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.softDelete = async (req, res) => {
  try {
    await rolesService.softDelete(req.params.id);
    res.json({ success: true, message: "Role disabled" });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.restore = async (req, res) => {
  try {
    await rolesService.restore(req.params.id);
    res.json({ success: true, message: "Role restored" });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
