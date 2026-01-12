const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
const c = require("../controllers/receptions.controllers");

// CRUD
router.post("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "COMPTABLE", "ADMIN"]), c.create);
router.get("/", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), c.list);
router.get("/:idOrUuid/pdf", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), c.pdf);
router.get("/uuid/:uuid", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), c.getByUuid);
router.get("/:id", auth, requireRole(["DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE", "ADMIN"]), c.getById);
router.put("/:id", auth, requireRole(["DEMANDEUR", "COMPTABLE", "DAF", "ADMIN"]), c.update);
router.delete("/:id", auth, requireRole(["DEMANDEUR", "COMPTABLE", "DAF", "ADMIN"]), c.remove);

// Visas
router.post("/:id/visa-directeur", auth, requireRole(["DIRECTEUR", "ADMIN"]), c.visaDirecteur);
router.post("/:id/visa-daf", auth, requireRole(["DAF", "ADMIN"]), c.visaDaf);

module.exports = router;
