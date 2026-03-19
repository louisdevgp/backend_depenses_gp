const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/signatures.controllers");

router.get("/sessions/:sessionId/download", auth, ctrl.downloadSessionSignature);

module.exports = router;

