const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const ctrl = require("../controllers/budgetLines.controllers");
const P = require("../constants/permissions");

router.get("/", auth, requirePermission(P.BUDGET_LINE_LIST), ctrl.list);
router.get("/preview", auth, requirePermission(P.BUDGET_LINE_USE), ctrl.preview);
router.post("/", auth, requirePermission(P.BUDGET_LINE_CREATE), ctrl.create);
router.get("/:idOrUuid", auth, requirePermission(P.BUDGET_LINE_GET), ctrl.getOne);
router.put("/:idOrUuid", auth, requirePermission(P.BUDGET_LINE_UPDATE), ctrl.update);
router.delete("/:idOrUuid", auth, requirePermission(P.BUDGET_LINE_DELETE), ctrl.remove);

module.exports = router;
