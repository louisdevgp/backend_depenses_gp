const prisma = require("../config/prisma");

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

      let ok = allowedArr.length === 0 ? true : allowedArr.some((r) => roleNames.includes(r));

      // ✅ Support délégations: un user sans le rôle peut accéder si une délégation active lui donne un rôle autorisé.
      // (utile pour les profils qui valident via délégation)
      let delegatedRoles = [];
      if (!ok && allowedArr.length > 0) {
        const agent = await prisma.agents.findFirst({
          where: { user_id: Number(userId), deleted_at: null },
          select: { id: true },
        });

        if (agent?.id) {
          const now = new Date();
          const dels = await prisma.delegations.findMany({
            where: {
              delegate_id: Number(agent.id),
              is_active: true,
              start_at: { lte: now },
              end_at: { gte: now },
              role_name: { in: allowedArr },
            },
            select: { role_name: true },
          });

          delegatedRoles = Array.from(new Set(dels.map((d) => d.role_name).filter(Boolean)));
          ok = delegatedRoles.length > 0;
        }
      }

      if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

      req.user.roles = Array.from(new Set([...roleNames, ...delegatedRoles]));
      req.user.delegatedRoles = delegatedRoles;
      next();
    } catch (e) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  };
};
