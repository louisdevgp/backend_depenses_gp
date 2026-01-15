const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const ctrl = require("../controllers/bons-commandes.controllers");
const P = require("../constants/permissions");

// Base: /api/bon-commandes
router.post("/", auth, requirePermission(P.BON_COMMANDE_CREATE), ctrl.create);
router.get("/", auth, requirePermission(P.BON_COMMANDE_LIST), ctrl.list);

// utiles dans le flow demande -> BC
router.get("/by-uuid/:uuid", auth, requirePermission(P.BON_COMMANDE_GET), ctrl.getByUuid);
router.get("/:idOrUuid/pdf", auth, requirePermission(P.BON_COMMANDE_PDF), ctrl.pdf);
router.get("/:id", auth, requirePermission(P.BON_COMMANDE_GET), ctrl.getById);

router.put("/:id", auth, requirePermission(P.BON_COMMANDE_UPDATE), ctrl.update);
router.patch("/:id/cancel", auth, requirePermission(P.BON_COMMANDE_CANCEL), ctrl.cancel);

// optionnel
router.delete("/:id", auth, requirePermission(P.BON_COMMANDE_DELETE), ctrl.remove);

module.exports = router;
