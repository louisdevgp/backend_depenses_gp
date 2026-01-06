const service = require("../services/auditLogs.services");

exports.list = async (req, res) => {
  try {
    const rows = await service.listAudit(req.query);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list audit", error: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const row = await service.getAuditById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur get audit", error: e.message });
  }
};
