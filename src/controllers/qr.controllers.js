const { ok } = require("../utils/response");
const qrService = require("../services/qr.services");

async function verify(req, res) {
  const token = req.query.token;
  const data = await qrService.verifyToken({ token, user: req.user || null });
  return ok(res, data);
}

module.exports = { verify };
