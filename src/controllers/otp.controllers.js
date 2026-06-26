const otpService = require("../services/otp.services");

async function requestOtp(req, res, next) {
  try {
    const userId = req.user.userId;
    await otpService.generateOtp(userId);
    res.json({ message: "Code OTP envoyé par email" });
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const userId = req.user.userId;
    const { code } = req.body;

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ message: "Entrez un code à 6 chiffres" });
    }

    const result = await otpService.verifyOtp(userId, code.trim());
    if (!result.success) {
      return res.status(400).json({ message: result.reason });
    }

    res.json({ message: "Code vérifié avec succès" });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestOtp, verifyOtp };
