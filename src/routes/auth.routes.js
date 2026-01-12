const router = require("express").Router();
const validate = require("../middlewares/validate.middleware");
const ctrl = require("../controllers/auth.controllers");
const v = require("../validators/auth.validators");
const auth = require("../middlewares/auth.middleware");



router.post("/register", validate(v.registerSchema), ctrl.register);
router.post("/login", validate(v.loginSchema), ctrl.login);
router.post("/forgot-password", validate(v.forgotPasswordSchema), ctrl.forgotPassword);
router.post("/reset-password", validate(v.resetPasswordSchema), ctrl.resetPassword);

// Authenticated password change (used for first-login enforcement too)
router.patch("/change-password", auth, validate(v.changePasswordSchema), ctrl.changePassword);



module.exports = router;
