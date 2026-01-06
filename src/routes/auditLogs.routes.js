const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const c = require("../controllers/auditLogs.controllers");

// TODO: si tu as un middleware requireRole('ADMIN') tu le mets ici
router.use(requireAuth);

router.get("/", c.list);
router.get("/:id", c.getById);

module.exports = router;
