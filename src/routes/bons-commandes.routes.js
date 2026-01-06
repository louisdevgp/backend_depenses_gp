const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/bons-commandes.controllers");

// Base: /api/bon-commandes
router.post("/", auth, ctrl.create);
router.get("/", auth, ctrl.list);

// utiles dans le flow demande -> BC
router.get("/by-uuid/:uuid", auth, ctrl.getByUuid);
router.get("/:id", auth, ctrl.getById);

router.put("/:id", auth, ctrl.update);
router.patch("/:id/cancel", auth, ctrl.cancel);

// optionnel
router.delete("/:id", auth, ctrl.remove);

module.exports = router;
