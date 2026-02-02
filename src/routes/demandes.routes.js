const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const ctrl = require("../controllers/demandes.controllers");
const P = require("../constants/permissions");

// CRUD
router.post("/", auth, requirePermission(P.DEMANDE_CREATE), ctrl.create);
// Liste globale (encadrement): rôles de validation + compta + admin
router.get("/", auth, requirePermission(P.DEMANDE_LIST), ctrl.list);
router.get("/my", auth, ctrl.listMine);
router.get("/by-demandeur/:demandeurId", auth, requirePermission(P.DEMANDE_LIST_BY_DEMANDEUR), ctrl.listByDemandeur);
router.get("/:idOrUuid/pdf", auth, requirePermission(P.DEMANDE_PDF), ctrl.pdf);
router.get("/:idOrUuid", auth, requirePermission(P.DEMANDE_LIST), ctrl.getOne);
router.put("/:idOrUuid", auth, requirePermission(P.DEMANDE_UPDATE), ctrl.update);
router.delete("/:idOrUuid", auth, requirePermission(P.DEMANDE_DELETE), ctrl.softDelete);

module.exports = router;
