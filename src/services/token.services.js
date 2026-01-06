const jwt = require("jsonwebtoken");
require("dotenv").config();

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function signAccessToken(payload) {
  return jwt.sign(payload, mustGetEnv("JWT_ACCESS_SECRET"), {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "1h",
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, mustGetEnv("JWT_REFRESH_SECRET"), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d",
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, mustGetEnv("JWT_ACCESS_SECRET"));
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken };
