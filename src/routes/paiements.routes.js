const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/paiements.controllers");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

router.post("/pay", requireAuth, requirePermission(P.PAIEMENT_CREATE), ctrl.create);
router.get("/", requireAuth, requirePermission(P.PAIEMENT_LIST), ctrl.list);

router.get("/uuid/:uuid", requireAuth, requirePermission(P.PAIEMENT_GET), ctrl.getByUuid);
router.get("/by-demande/:demandeId", requireAuth, requirePermission(P.PAIEMENT_LIST), ctrl.listByDemande);

router.get("/:id", requireAuth, requirePermission(P.PAIEMENT_GET), ctrl.getById);
router.put("/:id", requireAuth, requirePermission(P.PAIEMENT_UPDATE), ctrl.update);
router.delete("/:id", requireAuth, requirePermission(P.PAIEMENT_DELETE), ctrl.remove);

module.exports = router;
