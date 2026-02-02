const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/notifications.controllers");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

router.use(auth);

router.get("/my", ctrl.listMine);
router.patch("/:id/read", ctrl.readOne);

// (optionnel) endpoint admin/test
router.post("/", requirePermission([P.NOTIFICATIONS_ADMIN_CREATE]), ctrl.create);

module.exports = router;
