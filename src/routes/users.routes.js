const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/users.controllers");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

router.use(auth);

// utilisateur connecté
router.get("/me", ctrl.me);

// admin/users management
router.get("/", requirePermission([P.USERS_MANAGE]), ctrl.list); // ?q=&is_active=&page=&limit=
router.post("/", requirePermission([P.USERS_MANAGE]), ctrl.create); // create user (admin)
router.get("/:idOrUuid", requirePermission([P.USERS_MANAGE]), ctrl.getById);
router.patch("/:idOrUuid", requirePermission([P.USERS_MANAGE]), ctrl.update); // nom, prenom, is_active
router.post("/:idOrUuid/reset-password", requirePermission([P.USERS_MANAGE]), ctrl.adminResetPassword);
router.delete("/:idOrUuid", requirePermission([P.USERS_MANAGE]), ctrl.softDelete);

module.exports = router;
