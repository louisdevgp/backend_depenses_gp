const jwt = require("jsonwebtoken");
require("dotenv").config();

function mustGetEnv(name, fallbacks = []) {
  const candidates = [name, ...fallbacks];
  for (const key of candidates) {
    const v = process.env[key];
    if (v) return v;
  }
  throw new Error(`Missing env var: ${candidates.join(" or ")}`);
}

function accessSecret() {
  return mustGetEnv("JWT_ACCESS_SECRET", ["JWT_SECRET"]);
}

function refreshSecret() {
  return mustGetEnv("JWT_REFRESH_SECRET", ["JWT_SECRET"]);
}

function signAccessToken(payload) {
  return jwt.sign(payload, accessSecret(), {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || process.env.JWT_EXPIRES_IN || "1h",
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, refreshSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d",
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken };
