const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/delegations.controllers");

router.use(auth);
router.use(requireRole(["ADMIN"])); // au début admin-only, après on peut ouvrir

router.get("/", ctrl.list); // filters: ?principalIdOrUuid= &delegateIdOrUuid= &activeNow=1
router.get("/:idOrUuid", ctrl.getOne);
router.post("/", ctrl.create);
router.put("/:idOrUuid", ctrl.update);
router.patch("/:idOrUuid/toggle", ctrl.toggleActive);
router.delete("/:idOrUuid", ctrl.remove);

module.exports = router;
