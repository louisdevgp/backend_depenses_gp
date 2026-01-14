const { verifyAccessToken } = require("../services/token.services");

// Like auth.middleware, but does NOT reject when missing/invalid token.
// If a Bearer token is present and valid, sets req.user.
module.exports = (req, _res, next) => {
  try {
    const auth = req.headers.authorization || "";
    const [type, token] = String(auth).split(" ");
    if (type !== "Bearer" || !token) return next();

    const payload = verifyAccessToken(token);
    req.user = payload;
    return next();
  } catch {
    return next();
  }
};
