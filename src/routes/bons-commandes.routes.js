const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/bons-commandes.controllers");

// Base: /api/bon-commandes
router.post("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.create);
router.get("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.list);

// utiles dans le flow demande -> BC
router.get("/by-uuid/:uuid", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.getByUuid);
router.get("/:idOrUuid/pdf", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.pdf);
router.get("/:id", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.getById);

router.put("/:id", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.update);
router.patch("/:id/cancel", auth, requireRole(["DAF", "DGA", "DG", "ADMIN"]), ctrl.cancel);

// optionnel
router.delete("/:id", auth, requireRole(["ADMIN"]), ctrl.remove);

module.exports = router;
