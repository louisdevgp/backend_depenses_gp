const { verifyAccessToken } = require("../services/token.services");

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

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: invalid/expired token" });
  }
};
