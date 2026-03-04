const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/permissions.controllers");

// Auth for all permission endpoints
router.use(auth);

// list all permissions (needed by sidebar to know menu/action)
router.get("/", ctrl.list);

// get/set permissions for a role (admin only)
router.use(requirePermission([P.PERMISSIONS_MANAGE]));
router.get("/roles/:roleId", ctrl.getRolePermissions);
router.put("/roles/:roleId", ctrl.setRolePermissions);
router.get("/users/:userId", ctrl.getUserPermissionOverrides);
router.put("/users/:userId", ctrl.setUserPermissionOverrides);

module.exports = router;
