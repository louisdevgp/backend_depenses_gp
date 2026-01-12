const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/validation.controllers");
const requireRole = require("../middlewares/requireRole.middleware");

router.get("/pending", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.listMyPendingValidations);
router.post("/:stepId/approve", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.approveStep);
router.post("/:stepId/reject", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.rejectStep);

router.get("/demande/:demandeId", auth, ctrl.listByDemande);
router.get("/done", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.validationDone);
router.get("/uuid/:uuid", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.getByUuid);
router.get("/done-by-demande/:demandeUuid", auth, requireRole(["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"]), ctrl.getValidationsDoneBydemande);

module.exports = router;
