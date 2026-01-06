const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/departements.controllers");

router.use(auth);

router.get("/", ctrl.list); // filters: ?directionIdOrUuid=
router.get("/:idOrUuid", ctrl.getOne);

router.post("/", requireRole(["ADMIN"]), ctrl.create);
router.put("/:idOrUuid", requireRole(["ADMIN"]), ctrl.update);
router.delete("/:idOrUuid", requireRole(["ADMIN"]), ctrl.remove);

module.exports = router;
