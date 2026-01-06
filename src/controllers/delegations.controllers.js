const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function whereIdOrUuid(idOrUuid) {
  const n = Number(idOrUuid);
  return Number.isFinite(n) ? { id: n } : { uuid: idOrUuid };
}

async function resolveAgentId(agentIdOrUuid) {
  const a = await prisma.agents.findFirst({ where: { ...whereIdOrUuid(agentIdOrUuid), deleted_at: null } });
  return a?.id || null;
}

exports.list = async (req, res) => {
  const { principalIdOrUuid, delegateIdOrUuid, activeNow } = req.query;
  const where = {};

  if (principalIdOrUuid) {
    const id = await resolveAgentId(principalIdOrUuid);
    if (!id) return res.status(400).json({ success: false, message: "Invalid principalIdOrUuid" });
    where.principal_id = id;
  }

  if (delegateIdOrUuid) {
    const id = await resolveAgentId(delegateIdOrUuid);
    if (!id) return res.status(400).json({ success: false, message: "Invalid delegateIdOrUuid" });
    where.delegate_id = id;
  }

  if (String(activeNow) === "1") {
    const now = new Date();
    where.is_active = true;
    where.start_at = { lte: now };
    where.end_at = { gte: now };
  }

  const rows = await prisma.delegations.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      agents_delegations_principal_idToagents: true,
      agents_delegations_delegate_idToagents: true,
      agents_delegations_created_by_idToagents: true,
    },
  });

  res.json({ success: true, data: rows });
};

exports.getOne = async (req, res) => {
  const row = await prisma.delegations.findFirst({
    where: whereIdOrUuid(req.params.idOrUuid),
    include: {
      agents_delegations_principal_idToagents: true,
      agents_delegations_delegate_idToagents: true,
      agents_delegations_created_by_idToagents: true,
    },
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.create = async (req, res) => {
  const { principalIdOrUuid, delegateIdOrUuid, role_name, scope, start_at, end_at } = req.body;
  const created_by_id = req.user.agentId; // si tu stockes agentId dans token, sinon à resolver

  if (!principalIdOrUuid || !delegateIdOrUuid || !role_name || !start_at || !end_at) {
    return res.status(400).json({ success: false, message: "principal, delegate, role_name, start_at, end_at required" });
  }

  const principal_id = await resolveAgentId(principalIdOrUuid);
  const delegate_id = await resolveAgentId(delegateIdOrUuid);
  if (!principal_id || !delegate_id) {
    return res.status(400).json({ success: false, message: "Principal/delegate not found" });
  }

  const row = await prisma.delegations.create({
    data: {
      uuid: req.body.uuid,
      principal_id,
      delegate_id,
      role_name,
      scope: scope || null,
      start_at: new Date(start_at),
      end_at: new Date(end_at),
      is_active: true,
      created_by_id: created_by_id || principal_id,
    },
  });

  res.status(201).json({ success: true, data: row });
};

exports.update = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const data = {};
  if (req.body.role_name) data.role_name = req.body.role_name;
  if (req.body.scope !== undefined) data.scope = req.body.scope;
  if (req.body.start_at) data.start_at = new Date(req.body.start_at);
  if (req.body.end_at) data.end_at = new Date(req.body.end_at);

  const row = await prisma.delegations.update({
    where: { id: existing.id },
    data,
  });

  res.json({ success: true, data: row });
};

exports.toggleActive = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const row = await prisma.delegations.update({
    where: { id: existing.id },
    data: { is_active: !existing.is_active },
  });

  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  const existing = await prisma.delegations.findFirst({ where: whereIdOrUuid(req.params.idOrUuid) });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  await prisma.delegations.delete({ where: { id: existing.id } });
  res.json({ success: true, message: "Deleted" });
};
