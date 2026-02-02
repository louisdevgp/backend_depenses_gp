const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/services.controllers");

router.use(auth);

router.get("/", ctrl.list); // filters: ?departementIdOrUuid=
router.get("/:idOrUuid", ctrl.getOne);

router.post("/", requirePermission([P.SERVICES_MANAGE]), ctrl.create);
router.put("/:idOrUuid", requirePermission([P.SERVICES_MANAGE]), ctrl.update);
router.delete("/:idOrUuid", requirePermission([P.SERVICES_MANAGE]), ctrl.remove);

module.exports = router;
