const service = require("../services/notifications.services");

exports.listMine = async (req, res) => {
  try {
    const rows = await service.listMyNotifications(req.user.userId, req.query);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list notifications", error: e.message });
  }
};

exports.listUnread = async (req, res) => {
  try {
    const rows = await service.listMyNotifications(req.user.userId, { unread: "true" });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur unread", error: e.message });
  }
};

exports.readOne = async (req, res) => {
  try {
    const r = await service.markRead(req.user.userId, req.params.id);
    if (r.count === 0) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Marked as read" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur read", error: e.message });
  }
};

exports.readAll = async (req, res) => {
  try {
    await service.markReadAll(req.user.userId);
    res.json({ success: true, message: "All marked as read" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur read all", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const r = await service.deleteMyNotification(req.user.userId, req.params.id);
    if (r.count === 0) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur delete notif", error: e.message });
  }
};
