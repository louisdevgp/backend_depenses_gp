const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/demandes.controllers");

// CRUD
router.post("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), ctrl.create);
// Liste globale (encadrement): rôles de validation + compta + admin
router.get("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), ctrl.list);
router.get("/my", auth, ctrl.listMine);
router.get("/by-demandeur/:demandeurId", auth, requireRole(["ADMIN"]), ctrl.listByDemandeur);
router.get("/:idOrUuid/pdf", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), ctrl.pdf);
router.get("/:idOrUuid", auth, ctrl.getOne);
router.put("/:idOrUuid", auth, requireRole(["DEMANDEUR", "ADMIN"]), ctrl.update);
router.delete("/:idOrUuid", auth, requireRole(["DEMANDEUR", "ADMIN"]), ctrl.softDelete);

module.exports = router;
