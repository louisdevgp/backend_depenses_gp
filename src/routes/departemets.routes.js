const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/departements.controllers");

router.use(auth);

router.get("/", ctrl.list); // filters: ?directionIdOrUuid=
router.get("/:idOrUuid", ctrl.getOne);

router.post("/", requirePermission([P.DEPARTEMENTS_MANAGE]), ctrl.create);
router.put("/:idOrUuid", requirePermission([P.DEPARTEMENTS_MANAGE]), ctrl.update);
router.delete("/:idOrUuid", requirePermission([P.DEPARTEMENTS_MANAGE]), ctrl.remove);

module.exports = router;
