const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = (allowed = []) => {
  const allowedArr = Array.isArray(allowed) ? allowed : [allowed];

  return async (req, res, next) => {
    try {
      const { userId } = req.user;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const user = await prisma.users.findUnique({
        where: { id: Number(userId) },
        include: { user_roles: { include: { roles: true } } },
      });

      if (!user || user.deleted_at || !user.is_active) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const roleNames = (user.user_roles || []).map((ur) => ur.roles?.name).filter(Boolean);

      const ok = allowedArr.length === 0 ? true : allowedArr.some((r) => roleNames.includes(r));
      if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

      req.user.roles = roleNames;
      next();
    } catch (e) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  };
};
