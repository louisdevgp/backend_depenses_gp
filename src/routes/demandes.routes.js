const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/demandes.controllers");

// CRUD
router.post("/", requireAuth, ctrl.create);
router.get("/", requireAuth, ctrl.list);
router.get("/my", requireAuth, ctrl.listMine);
router.get("/by-demandeur/:demandeurId", requireAuth, ctrl.listByDemandeur);
router.get("/:idOrUuid", requireAuth, ctrl.getOne);
router.put("/:idOrUuid", requireAuth, ctrl.update);
router.delete("/:idOrUuid", requireAuth, ctrl.softDelete);

module.exports = router;
