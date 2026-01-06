const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/userRoles.controllers");

// remplacer tous les rôles d’un user (mode SET)
router.put("/users/:idOrUuid/roles", auth, ctrl.setRoles);

// ajouter / retirer un rôle
router.post("/users/:idOrUuid/roles", auth, ctrl.addRole);
router.delete("/users/:idOrUuid/roles/:roleName", auth, ctrl.removeRole);

module.exports = router;
