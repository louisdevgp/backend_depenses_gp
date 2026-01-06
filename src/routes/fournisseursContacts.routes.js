const router = require("express").Router({ mergeParams: true });
const auth = require("../middlewares/auth.middleware");
const ctrl = require("../controllers/fournisseursContacts.controllers");

router.post("/", auth, ctrl.create);
router.get("/", auth, ctrl.list);
router.get("/:contactIdOrUuid", auth, ctrl.getOne);
router.put("/:contactIdOrUuid", auth, ctrl.update);
router.delete("/:contactIdOrUuid", auth, ctrl.remove);

module.exports = router;
