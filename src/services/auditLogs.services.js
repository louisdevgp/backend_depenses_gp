const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { randomUUID: uuidv4 } = require("crypto");

async function logAudit({ userId, entity_type, entity_id, action, old_value, new_value }) {
  return prisma.audit_logs.create({
    data: {
      uuid: uuidv4(),
      user_id: userId ? Number(userId) : null,
      entity_type,
      entity_id: Number(entity_id),
      action,
      old_value: old_value ?? null,
      new_value: new_value ?? null,
    },
  });
}

async function listAudit(filters = {}) {
  const where = {};
  if (filters.entity_type) where.entity_type = String(filters.entity_type);
  if (filters.entity_id) where.entity_id = Number(filters.entity_id);
  if (filters.user_id) where.user_id = Number(filters.user_id);

  return prisma.audit_logs.findMany({
    where,
    orderBy: [{ created_at: "desc" }],
    take: filters.take ? Number(filters.take) : 100,
  });
}

async function getAuditById(id) {
  return prisma.audit_logs.findUnique({ where: { id: Number(id) } });
}

module.exports = { logAudit, listAudit, getAuditById };

