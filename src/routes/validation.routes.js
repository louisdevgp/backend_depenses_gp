const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/validation.controllers");
const requireRole = require("../middlewares/requireRole.middleware");

// seuls les validateurs
const VALIDATORS = ["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG"];

router.get("/pending", auth, requireRole(VALIDATORS), ctrl.listMyPendingValidations);
router.post("/:stepId/approve", auth, requireRole(VALIDATORS), ctrl.approveStep);
router.post("/:stepId/reject", auth, requireRole(VALIDATORS), ctrl.rejectStep);

// lecture steps (utile au demandeur aussi)
router.get("/demande/:demandeId", auth, ctrl.listByDemande);

router.get("/done", auth, requireRole(VALIDATORS), ctrl.validationDone);
router.get("/uuid/:uuid", auth, requireRole(VALIDATORS), ctrl.getByUuid);
router.get("/done-by-demande/:demandeIdOrUuid", auth, requireRole(VALIDATORS), ctrl.getValidationsDoneBydemande);

module.exports = router;
