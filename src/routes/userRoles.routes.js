const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/userRoles.controllers");

router.use(auth, requirePermission([P.USER_ROLES_MANAGE]));

// remplacer tous les rôles d’un user (mode SET)
router.put("/users/:idOrUuid/roles", ctrl.setRoles);

// ajouter / retirer un rôle
router.post("/users/:idOrUuid/roles", ctrl.addRole);
router.delete("/users/:idOrUuid/roles/:roleName", ctrl.removeRole);

module.exports = router;
