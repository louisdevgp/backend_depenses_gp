const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/delegations.controllers");

router.use(auth);
router.use(requirePermission([P.DELEGATIONS_MANAGE]));

// helper: liste d'agents pour choix (utilisé par l'UI délégations)
router.get("/agents", ctrl.listAgentsForDelegation);

router.get("/", ctrl.list); // filters: ?principalIdOrUuid= &delegateIdOrUuid= &activeNow=1
router.get("/:idOrUuid", ctrl.getOne);
router.post("/", ctrl.create);
router.put("/:idOrUuid", ctrl.update);
router.patch("/:idOrUuid/toggle", ctrl.toggleActive);
router.delete("/:idOrUuid", ctrl.remove);

module.exports = router;
