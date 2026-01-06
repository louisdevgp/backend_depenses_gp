const svc = require("../services/userRoles.services");
const { ok } = require("../utils/response");

async function setRoles(req, res) {
  const data = await svc.setRoles(req.params.idOrUuid, req.body.roles || []);
  return ok(res, data);
}

async function addRole(req, res) {
  const data = await svc.addRole(req.params.idOrUuid, req.body.role);
  return ok(res, data);
}

async function removeRole(req, res) {
  const data = await svc.removeRole(req.params.idOrUuid, req.params.roleName);
  return ok(res, data);
}

module.exports = { setRoles, addRole, removeRole };
