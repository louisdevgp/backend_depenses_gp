const bcrypt = require("bcrypt");

async function hashPassword(password) {
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  return bcrypt.hash(password, rounds);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, comparePassword };
