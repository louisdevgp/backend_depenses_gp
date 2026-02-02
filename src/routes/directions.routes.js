const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");
const ctrl = require("../controllers/directions.controllers");

router.use(auth);

router.get("/", ctrl.list);
router.get("/:idOrUuid", ctrl.getOne);

// admin only
router.post("/", requirePermission([P.DIRECTIONS_MANAGE]), ctrl.create);
router.put("/:idOrUuid", requirePermission([P.DIRECTIONS_MANAGE]), ctrl.update);
router.delete("/:idOrUuid", requirePermission([P.DIRECTIONS_MANAGE]), ctrl.remove);
module.exports = router;
