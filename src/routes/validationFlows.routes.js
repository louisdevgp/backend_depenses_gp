const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/validationFlows.controllers");

router.use(requireAuth);

router.post("/", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.createFlow);
router.get("/", ctrl.listFlows);
router.get("/:id", ctrl.getFlowById);
router.put("/:id", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.updateFlow);
router.delete("/:id", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.disableFlow);

// steps
router.post("/:id/steps", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.addStep);
router.put("/:id/steps/:stepId", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.updateStep);
router.delete("/:id/steps/:stepId", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.deleteStep);
router.post("/:id/steps/reorder", requirePermission([P.VALIDATION_FLOWS_MANAGE]), ctrl.reorderSteps);

module.exports = router;
