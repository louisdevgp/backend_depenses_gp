const express = require("express");
const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "OK", message: "GP Achats API running" });
});

// routes modules

router.use("/auth", require("../routes/auth.routes"));
router.use("/users", require("../routes/users.routes"));
router.use("/agents", require("../routes/agents.routes"));
router.use("/roles", require("../routes/roles.routes"));
router.use("/permissions", require("../routes/permissions.routes"));
router.use("/validation-flows", require("../routes/validationFlows.routes"));
router.use("/validations", require("../routes/validation.routes"));
router.use("/demandes", require("../routes/demandes.routes"));
router.use("/bons-commande", require("../routes/bons-commandes.routes"));
router.use("/receptions", require("../routes/receptions.routes"));
router.use("/documents", require("../routes/documents.routes"));
router.use("/paiements", require("../routes/paiements.routes"));
router.use("/qr", require("../routes/qr.routes"));
router.use("/stats", require("../routes/stats.routes"));
router.use("/conditions-paiement", require("../routes/condtionsPaiement.routes"));
router.use("/notifications", require("../routes/notifications.routes"));
router.use("/audit-logs", require("../routes/auditLogs.routes"));
router.use("/fournisseurs", require("../routes/fournisseurs.routes"));
router.use("/fournisseurs/:fournisseurIdOrUuid/contacts", require("../routes/fournisseursContacts.routes"));
router.use("/directions", require("../routes/directions.routes"));
router.use("/departements", require("../routes/departemets.routes"));
router.use("/services", require("../routes/services.routes"));
router.use("/user-roles", require("../routes/userRoles.routes"));
router.use("/delegations", require("../routes/delegations.routes"));




// router.use("/demandes", require("./demandes.routes"));



module.exports = router;
