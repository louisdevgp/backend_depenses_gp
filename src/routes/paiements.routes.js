const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/paiements.controllers");
const requireRole = require("../middlewares/requireRole.middleware");

router.post("/pay", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.create);
router.get("/", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.list);

router.get("/uuid/:uuid", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.getByUuid);
router.get("/by-demande/:demandeId", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.listByDemande);

router.get("/:id", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.getById);
router.put("/:id", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.update);
router.delete("/:id", requireAuth, requireRole(["DAF", "COMPTABLE", "ADMIN"]), ctrl.remove);

module.exports = router;
