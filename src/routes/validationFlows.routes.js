const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/validationFlows.controllers");

router.use(requireAuth);

router.post("/", requireRole(["ADMIN"]), ctrl.createFlow);
router.get("/", ctrl.listFlows);
router.get("/:id", ctrl.getFlowById);
router.put("/:id", requireRole(["ADMIN"]), ctrl.updateFlow);
router.delete("/:id", requireRole(["ADMIN"]), ctrl.disableFlow);

// steps
router.post("/:id/steps", requireRole(["ADMIN"]), ctrl.addStep);
router.put("/:id/steps/:stepId", requireRole(["ADMIN"]), ctrl.updateStep);
router.delete("/:id/steps/:stepId", requireRole(["ADMIN"]), ctrl.deleteStep);
router.post("/:id/steps/reorder", requireRole(["ADMIN"]), ctrl.reorderSteps);

module.exports = router;
