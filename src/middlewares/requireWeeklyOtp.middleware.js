const { needsOtp } = require("../services/otp.services");

module.exports = async function requireWeeklyOtp(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Non authentifié" });

    const required = await needsOtp(userId);
    if (required) {
      return res.status(403).json({
        requiresOtp: true,
        message:
          "Vérification hebdomadaire requise. Demandez et validez votre code OTP avant de signer.",
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};
