const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const rolesController = require("../controllers/roles.controllers")
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

router.use(auth, requirePermission([P.ROLES_MANAGE]));

router.get("/", rolesController.list);
router.get("/:id", rolesController.getById);
router.post("/", rolesController.create);
router.put("/:id", rolesController.update);
router.delete("/:id", rolesController.softDelete);
router.patch("/:id/restore", rolesController.restore);


module.exports = router;
