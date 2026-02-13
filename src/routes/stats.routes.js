const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const ctrl = require("../controllers/stats.controllers");
const P = require("../constants/permissions");

router.get(
  "/dashboard",
  auth,
  requirePermission([P.DASHBOARD_VIEW_SELF, P.DASHBOARD_VIEW_ALL]),
  ctrl.dashboard
);

module.exports = router;
