const permissionsService = require("../services/permissions.services");

exports.list = async (req, res) => {
  try {
    const data = await permissionsService.listPermissions();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getRolePermissions = async (req, res) => {
  try {
    const codes = await permissionsService.getRolePermissionCodes(req.params.roleId);
    res.json({ success: true, data: { roleId: req.params.roleId, permissionCodes: codes } });
  } catch (e) {
    const status = String(e.message || "").includes("ROLE_NOT_FOUND") ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

exports.setRolePermissions = async (req, res) => {
  try {
    const { permissionCodes } = req.body || {};
    const data = await permissionsService.setRolePermissions(req.params.roleId, permissionCodes || []);
    res.json({ success: true, data });
  } catch (e) {
    const status = String(e.message || "").includes("ROLE_NOT_FOUND") ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};
