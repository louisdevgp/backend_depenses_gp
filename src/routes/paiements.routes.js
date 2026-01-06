const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware"); // ton middleware existant
const ctrl = require("../controllers/paiements.controllers");
const requireRole = require("../middlewares/requireRole.middleware");



router.post("/pay", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.create);
router.get("/", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.list);
router.get("/uuid/:uuid", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.getByUuid);
router.get("/by-demande/:demandeId", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.listByDemande);
router.get("/:id", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.getById);
router.put("/:id", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.update);
router.delete("/:id", requireAuth, requireRole(["DAF", "COMPTABLE"]) ,ctrl.remove);

module.exports = router;
