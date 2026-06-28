const otpService = require("../services/otp.services");

async function requestOtp(req, res) {
  try {
    const userId = req.user.userId;
    const result = await otpService.generateOtp(userId);
    const message = result?.disabled
      ? "Verification OTP desactivee."
      : result?.throttled
        ? "Un code OTP a deja ete envoye. Verifiez votre email ou patientez avant de renvoyer."
        : "Code OTP envoye par email.";

    res.json({ message, ...(result?.code ? { code: result.code } : {}) });
  } catch (err) {
    const status = Number(err?.statusCode) || 400;
    res.status(status).json({ success: false, message: err?.message || "Erreur OTP" });
  }
}

async function verifyOtp(req, res) {
  try {
    const userId = req.user.userId;
    const { code } = req.body;

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ message: "Entrez un code a 6 chiffres" });
    }

    const result = await otpService.verifyOtp(userId, code.trim());
    if (!result.success) {
      return res.status(400).json({ message: result.reason });
    }

    res.json({ message: "Code verifie avec succes" });
  } catch (err) {
    const status = Number(err?.statusCode) || 400;
    res.status(status).json({ success: false, message: err?.message || "Erreur OTP" });
  }
}

module.exports = { requestOtp, verifyOtp };
