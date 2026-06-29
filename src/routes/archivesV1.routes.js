const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const ctrl = require("../controllers/archivesV1.controllers");
const P = require("../constants/permissions");

const canViewArchives = P.ARCHIVES_V1_VIEW;

router.get("/stats", auth, requirePermission(canViewArchives), ctrl.stats);
router.get("/demandes", auth, requirePermission(canViewArchives), ctrl.listDemandes);
router.get("/demandes/:id", auth, requirePermission(canViewArchives), ctrl.getDemande);

module.exports = router;
