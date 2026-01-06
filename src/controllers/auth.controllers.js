const authService = require("../services/auth.services");
const { created, ok } = require("../utils/response");

async function register(req, res) {
  try {
    const { body } = req.validated;
    const result = await authService.register(body);
    console.log("User registered:", result);
    return created(res, result, "User registered");
  } catch (e) {
    console.error("Error in register:", e);
    if (e.message === "EMAIL_ALREADY_USED") {
      return res.status(409).json({ success: false, message: "Email already used" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function login(req, res) {
  try {
    const { body } = req.validated;
    const result = await authService.login(body);
    return ok(res, result, "Login success");
  } catch (e) {
    if (e.message === "INVALID_CREDENTIALS") {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    if (e.message === "USER_DISABLED") {
      return res.status(403).json({ success: false, message: "User disabled" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function forgotPassword(req, res) {
  try {
    const { body } = req.validated;
    const result = await authService.forgotPassword(body);
    return ok(res, result, "If the email exists, instructions were sent.");
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function resetPassword(req, res) {
  try {
    const { body } = req.validated;
    const result = await authService.resetPassword(body);
    return ok(res, result, "Password updated");
  } catch (e) {
    if (e.message === "RESET_TOKEN_NOT_IMPLEMENTED") {
      return res.status(501).json({ success: false, message: "Not implemented yet" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { register, login, forgotPassword, resetPassword };
