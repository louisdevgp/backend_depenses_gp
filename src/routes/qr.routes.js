const router = require("express").Router();
const optionalAuth = require("../middlewares/optionalAuth.middleware");
const ctrl = require("../controllers/qr.controllers");

router.get("/verify", optionalAuth, ctrl.verify);

module.exports = router;
