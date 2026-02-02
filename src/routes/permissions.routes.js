const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/permissions.controllers");

router.use(auth, requirePermission([P.PERMISSIONS_MANAGE]));

// list all permissions
router.get("/", ctrl.list);

// get/set permissions for a role
router.get("/roles/:roleId", ctrl.getRolePermissions);
router.put("/roles/:roleId", ctrl.setRolePermissions);

module.exports = router;
