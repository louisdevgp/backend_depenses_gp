const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const ctrl = require("../controllers/directions.controllers");

router.use(auth);

router.get("/", ctrl.list);
router.get("/:idOrUuid", ctrl.getOne);

// admin only
router.post("/", requireRole(["ADMIN"]), ctrl.create);
router.put("/:idOrUuid", requireRole(["ADMIN"]), ctrl.update);
router.delete("/:idOrUuid", requireRole(["ADMIN"]), ctrl.remove);

module.exports = router;
