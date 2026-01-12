const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/notifications.controllers");
const requireRole = require("../middlewares/requireRole.middleware");

router.use(auth);

router.get("/my", ctrl.listMine);
router.patch("/:id/read", ctrl.readOne);

// (optionnel) endpoint admin/test
router.post("/", requireRole(["ADMIN"]), ctrl.create);

module.exports = router;
