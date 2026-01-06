const router = require("express").Router();
const requireAuth = require("../middlewares/auth.middleware");
const c = require("../controllers/conditionsPaiement.controllers");

router.use(requireAuth);

router.post("/", c.create);
router.get("/", c.list);
router.get("/:id", c.getById);
router.get("/by-demande/:demandeId", c.listByDemande);
router.patch("/:id", c.update);
router.delete("/:id", c.remove);

module.exports = router;
