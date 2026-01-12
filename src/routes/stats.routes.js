const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/stats.controllers");

router.get("/dashboard", auth, ctrl.dashboard);

module.exports = router;
