const { verifyAccessToken } = require("../services/token.services");

function isAllowedWhenPasswordChangeRequired(req) {
  const url = String(req.originalUrl || "");
  // allow: password change endpoint + fetching current user identity
  if (url.startsWith("/api/auth/change-password")) return true;
  if (url.startsWith("/api/users/me")) return true;
  return false;
}

module.exports = (req, res, next) => {
    try {
    const auth = req.headers.authorization || "";
    const [type, token] = auth.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ message: "Unauthorized: missing Bearer token" });
    }

    const payload = verifyAccessToken(token);

    // payload recommandé: { userId, email, roles, agentId? }
    req.user = payload;

    if (payload?.mustChangePassword && !isAllowedWhenPasswordChangeRequired(req)) {
      return res.status(403).json({
        message: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: invalid/expired token" });
  }
};
