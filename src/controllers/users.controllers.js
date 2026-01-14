const usersService = require("../services/users.services");
const { ok } = require("../utils/response");

async function me(req, res) {
  const data = await usersService.me(req.user.userId);
  return ok(res, data);
}

async function list(req, res) {
  const data = await usersService.list(req.query);
  return ok(res, data);
}

async function create(req, res) {
  const data = await usersService.create(req.body, req.user.userId);
  return res.status(201).json({ success: true, data });
}

async function getById(req, res) {
  const data = await usersService.getById(req.params.idOrUuid);
  return ok(res, data);
}

async function update(req, res) {
  const data = await usersService.update(req.params.idOrUuid, req.body);
  return ok(res, data);
}

async function softDelete(req, res) {
  const data = await usersService.softDelete(req.params.idOrUuid, req.user.userId);
  return ok(res, data);
}

async function adminResetPassword(req, res) {
  const data = await usersService.adminResetPassword(req.params.idOrUuid, req.user.userId);
  return ok(res, data);
}

module.exports = { me, list, create, getById, update, adminResetPassword, softDelete };
