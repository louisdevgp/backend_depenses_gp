const statsService = require("../services/stats.services");

exports.dashboard = async (req, res) => {
  try {
    const data = await statsService.dashboard(req.user.userId, req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message || "Erreur stats" });
  }
};
