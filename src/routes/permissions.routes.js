const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/permissions.controllers");

router.use(auth, requireRole(["ADMIN"]));

// list all permissions
router.get("/", ctrl.list);

// get/set permissions for a role
router.get("/roles/:roleId", ctrl.getRolePermissions);
router.put("/roles/:roleId", ctrl.setRolePermissions);

module.exports = router;
