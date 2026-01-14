const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/users.controllers");
const requireRole = require("../middlewares/requireRole.middleware");

router.use(auth);

// utilisateur connecté
router.get("/me", ctrl.me);

// admin/users management
router.get("/", requireRole(["ADMIN"]), ctrl.list); // ?q=&is_active=&page=&limit=
router.post("/", requireRole(["ADMIN"]), ctrl.create); // create user (admin)
router.get("/:idOrUuid", requireRole(["ADMIN"]), ctrl.getById);
router.patch("/:idOrUuid", requireRole(["ADMIN"]), ctrl.update); // nom, prenom, is_active
router.post("/:idOrUuid/reset-password", requireRole(["ADMIN"]), ctrl.adminResetPassword);
router.delete("/:idOrUuid", requireRole(["ADMIN"]), ctrl.softDelete);

module.exports = router;
