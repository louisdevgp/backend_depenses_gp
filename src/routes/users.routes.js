const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/users.controllers");

// utilisateur connecté
router.get("/me", auth, ctrl.me);

// admin/users management
router.get("/", auth, ctrl.list);                 // ?q=&is_active=&page=&limit=
router.get("/:idOrUuid", auth, ctrl.getById);
router.patch("/:idOrUuid", auth, ctrl.update);    // nom, prenom, is_active
router.delete("/:idOrUuid", auth, ctrl.softDelete);

module.exports = router;
