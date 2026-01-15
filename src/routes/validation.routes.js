const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/validation.controllers");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

router.get("/pending", auth, requirePermission(P.VALIDATION_LIST_PENDING), ctrl.listMyPendingValidations);
router.post("/:stepId/approve", auth, requirePermission(P.VALIDATION_APPROVE), ctrl.approveStep);
router.post("/:stepId/reject", auth, requirePermission(P.VALIDATION_REJECT), ctrl.rejectStep);

router.get("/demande/:demandeId", auth, ctrl.listByDemande);
router.get("/done", auth, requirePermission(P.VALIDATION_LIST_DONE), ctrl.validationDone);
router.get("/uuid/:uuid", auth, requirePermission(P.VALIDATION_GET), ctrl.getByUuid);
router.get("/done-by-demande/:demandeUuid", auth, requirePermission(P.VALIDATION_LIST_DONE), ctrl.getValidationsDoneBydemande);

module.exports = router;
