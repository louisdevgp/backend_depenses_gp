const prisma = require("../config/prisma");
const permissionMap = require("../config/permissions");

const ROLE_IMPLICATIONS = {
  DG: ["DIRECTEUR"],
  DGA: ["DIRECTEUR"],
  DAF: ["DIRECTEUR"],
};

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function expandRoles(roleNames) {
  const out = new Set((roleNames || []).map(normalizeRoleName).filter(Boolean));
  for (const r of Array.from(out)) {
    const implied = ROLE_IMPLICATIONS[r] || [];
    for (const ir of implied) out.add(normalizeRoleName(ir));
  }
  return Array.from(out);
}

module.exports = (requiredPermissions = []) => {
  const permissions = asArray(requiredPermissions).map((p) => String(p).trim()).filter(Boolean);

  return async (req, res, next) => {
    try {
      const { userId } = req.user || {};
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const user = await prisma.users.findUnique({
        where: { id: Number(userId) },
        include: { user_roles: { include: { roles: true } } },
      });

      if (!user || user.deleted_at || !user.is_active) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const roleNamesRaw = (user.user_roles || []).map((ur) => normalizeRoleName(ur.roles?.name)).filter(Boolean);
      const roleNames = expandRoles(roleNamesRaw);

      // If no permissions requested, allow.
      if (permissions.length === 0) {
        req.user.roles = Array.from(new Set(roleNames));
        req.user.delegatedRoles = [];
        return next();
      }

      // Check permissions using role mapping (any-of semantics).
      let ok = false;
      let delegatedRoles = [];

      for (const perm of permissions) {
        const allowedRoles = (permissionMap[perm] || []).map(normalizeRoleName).filter(Boolean);

        // Unknown permission => forbid (safer than allowing).
        if (!allowedRoles.length) continue;

        if (allowedRoles.some((r) => roleNames.includes(r))) {
          ok = true;
          break;
        }

        // ✅ Support délégations: si une délégation active donne un rôle autorisé, l'accès est permis.
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
              role_name: { in: allowedRoles },
            },
            select: { role_name: true },
          });

          delegatedRoles = Array.from(new Set(dels.map((d) => normalizeRoleName(d.role_name)).filter(Boolean)));
          delegatedRoles = expandRoles(delegatedRoles);
          if (delegatedRoles.length > 0) {
            ok = true;
            break;
          }
        }
      }

      if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

      req.user.roles = Array.from(new Set([...roleNames, ...delegatedRoles]));
      req.user.delegatedRoles = delegatedRoles;
      return next();
    } catch (e) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  };
};
