const service = require("../services/notifications.services");

exports.listMine = async (req, res) => {
  try {
    const data = await service.listMyNotifications(req.user.userId, req.query);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.readOne = async (req, res) => {
  try {
    const data = await service.markAsRead(req.user.userId, req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await service.createNotification(req.body);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
