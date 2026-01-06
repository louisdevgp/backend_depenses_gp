const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function listMyNotifications(userId, filters = {}) {
  const where = { user_id: Number(userId) };
  if (filters.unread === "true") where.read_at = null;
  if (filters.type) where.type = String(filters.type);

  return prisma.notifications.findMany({
    where,
    orderBy: [{ created_at: "desc" }],
  });
}

async function markRead(userId, id) {
  // sécurité: update uniquement si notification appartient au user
  return prisma.notifications.updateMany({
    where: { id: Number(id), user_id: Number(userId) },
    data: { read_at: new Date() },
  });
}

async function markReadAll(userId) {
  return prisma.notifications.updateMany({
    where: { user_id: Number(userId), read_at: null },
    data: { read_at: new Date() },
  });
}

async function deleteMyNotification(userId, id) {
  return prisma.notifications.deleteMany({
    where: { id: Number(id), user_id: Number(userId) },
  });
}

module.exports = { listMyNotifications, markRead, markReadAll, deleteMyNotification };
