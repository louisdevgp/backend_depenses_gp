const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/fournisseurs.controllers");

// Fournisseurs
router.post("/", auth, ctrl.create);
router.get("/", auth, ctrl.list);
router.get("/:idOrUuid", auth, ctrl.getOne);
router.put("/:idOrUuid", auth, ctrl.update);
router.delete("/:idOrUuid", auth, ctrl.remove);

module.exports = router;
