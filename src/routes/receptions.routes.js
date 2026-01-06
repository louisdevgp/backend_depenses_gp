const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const c = require("../controllers/receptions.controllers");

// CRUD
router.post("/", auth, c.create);
router.get("/", auth, c.list);
router.get("/:id", auth, c.getById);
router.get("/uuid/:uuid", auth, c.getByUuid);
router.put("/:id", auth, c.update);
router.delete("/:id", auth, c.remove);

// Visas
router.post("/:id/visa-directeur", auth, c.visaDirecteur);
router.post("/:id/visa-daf", auth, c.visaDaf);

module.exports = router;
