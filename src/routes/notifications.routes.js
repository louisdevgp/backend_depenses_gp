const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const c = require("../controllers/notifications.controllers");

router.use(requireAuth);

router.get("/", c.listMine);
router.get("/unread", c.listUnread);
router.patch("/:id/read", c.readOne);
router.patch("/read-all", c.readAll);
router.delete("/:id", c.remove);

module.exports = router;
