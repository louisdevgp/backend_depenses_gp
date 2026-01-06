const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const c = require("../controllers/documents.controllers");

router.post("/upload", auth, upload.array("files", 10), c.uploadMany);
router.get("/", auth, c.list);
router.get("/:id", auth, c.getById);
router.delete("/:id", auth, c.remove);

module.exports = router;
