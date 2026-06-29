const archivesV1Service = require("../services/archivesV1.services");

exports.listDemandes = async (req, res) => {
  try {
    const data = await archivesV1Service.listDemandes(req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur archives V1",
    });
  }
};

exports.getDemande = async (req, res) => {
  try {
    const data = await archivesV1Service.getDemande(req.params.id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur archive V1",
    });
  }
};

exports.stats = async (req, res) => {
  try {
    const data = await archivesV1Service.getStats();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Erreur statistiques archives V1",
    });
  }
};
