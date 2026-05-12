const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const upload = require("../middlewares/upload.middleware");
const ctrl = require("../controllers/demandes.controllers");
const P = require("../constants/permissions");

// CRUD
router.post("/", auth, requirePermission(P.DEMANDE_CREATE), ctrl.create);
router.post("/signature/start", auth, requirePermission(P.DEMANDE_CREATE), ctrl.startSignature);
router.post("/signature/complete", auth, requirePermission(P.DEMANDE_CREATE), ctrl.completeSignature);
// Liste globale (encadrement): rôles de validation + compta + admin
router.get("/", auth, requirePermission([P.DEMANDE_LIST, P.DEMANDE_LIST_ALL, P.DEMANDE_LIST_ASSIGNED_ACHETEUR]), ctrl.list);
router.get("/my", auth, requirePermission(P.DEMANDE_LIST_SELF), ctrl.listMine);
router.get("/by-demandeur/:demandeurId", auth, requirePermission(P.DEMANDE_LIST_BY_DEMANDEUR), ctrl.listByDemandeur);
router.get(
  "/:idOrUuid/pdf",
  auth,
  requirePermission([P.DEMANDE_PDF, P.DEMANDE_LIST_ASSIGNED_ACHETEUR, P.VALIDATION_LIST_PENDING, P.VALIDATION_LIST_DONE]),
  ctrl.pdf
);
router.get(
  "/:idOrUuid/validation-history",
  auth,
  requirePermission([P.DEMANDE_LIST, P.DEMANDE_LIST_SELF, P.DEMANDE_LIST_ASSIGNED_ACHETEUR, P.VALIDATION_LIST_PENDING, P.VALIDATION_LIST_DONE]),
  ctrl.validationHistory
);
router.get("/:idOrUuid/acheteurs-candidats", auth, requirePermission(P.DEMANDE_ASSIGN_ACHETEUR), ctrl.listAcheteurCandidates);
router.patch("/:idOrUuid/acheteur", auth, requirePermission(P.DEMANDE_ASSIGN_ACHETEUR), ctrl.assignAcheteur);
router.post(
  "/:idOrUuid/achat/confirm",
  auth,
  requirePermission(P.DEMANDE_LIST_ASSIGNED_ACHETEUR),
  upload.array("files", 10),
  ctrl.confirmAchat
);
router.get(
  "/:idOrUuid",
  auth,
  requirePermission([P.DEMANDE_LIST, P.DEMANDE_LIST_SELF, P.DEMANDE_LIST_ASSIGNED_ACHETEUR, P.VALIDATION_LIST_PENDING, P.VALIDATION_LIST_DONE]),
  ctrl.getOne
);
router.put("/:idOrUuid", auth, requirePermission(P.DEMANDE_UPDATE), ctrl.update);
router.delete("/:idOrUuid", auth, requirePermission(P.DEMANDE_DELETE), ctrl.softDelete);
router.patch("/:idOrUuid/close", auth, requirePermission(P.DEMANDE_CLOSE), ctrl.close);

module.exports = router;
