const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const c = require("../controllers/receptions.controllers");
const P = require("../constants/permissions");

// CRUD
router.post("/", auth, requirePermission(P.RECEPTION_CREATE), c.create);
router.post("/signature/start", auth, requirePermission(P.RECEPTION_CREATE), c.startSignature);
router.post("/signature/complete", auth, requirePermission(P.RECEPTION_CREATE), c.completeSignature);
router.get("/", auth, requirePermission([P.RECEPTION_LIST_SELF, P.RECEPTION_LIST_ALL, P.RECEPTION_LIST]), c.list);
router.get("/:idOrUuid/pdf", auth, requirePermission([P.RECEPTION_LIST_SELF, P.RECEPTION_LIST_ALL, P.RECEPTION_LIST]), c.pdf);
router.get("/uuid/:uuid", auth, requirePermission([P.RECEPTION_LIST_SELF, P.RECEPTION_LIST_ALL, P.RECEPTION_LIST]), c.getByUuid);
router.get("/:id", auth, requirePermission([P.RECEPTION_LIST_SELF, P.RECEPTION_LIST_ALL, P.RECEPTION_LIST]), c.getById);
router.put("/:id", auth, requirePermission(P.RECEPTION_UPDATE), c.update);
router.delete("/:id", auth, requirePermission(P.RECEPTION_DELETE), c.remove);

// Visas
router.post("/:id/visa-directeur", auth, requirePermission(P.RECEPTION_VISA_DIRECTEUR), c.visaDirecteur);
router.post("/:id/visa-daf", auth, requirePermission(P.RECEPTION_VISA_DAF), c.visaDaf);
router.post(
  "/:id/visa-directeur/signature/start",
  auth,
  requirePermission(P.RECEPTION_VISA_DIRECTEUR),
  c.startVisaDirecteurSignature
);
router.post(
  "/:id/visa-directeur/signature/complete",
  auth,
  requirePermission(P.RECEPTION_VISA_DIRECTEUR),
  c.completeVisaDirecteurSignature
);
router.post(
  "/:id/visa-daf/signature/start",
  auth,
  requirePermission(P.RECEPTION_VISA_DAF),
  c.startVisaDafSignature
);
router.post(
  "/:id/visa-daf/signature/complete",
  auth,
  requirePermission(P.RECEPTION_VISA_DAF),
  c.completeVisaDafSignature
);

module.exports = router;
