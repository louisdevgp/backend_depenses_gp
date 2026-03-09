const prisma = require("../config/prisma");
const permissionMap = require("../config/permissions");
const {
  getUserPermissionProfile,
  normalizePermissionCode,
} = require("../utils/permissionScopes");

const DEBUG_PERMISSIONS = String(process.env.DEBUG_PERMISSIONS || "") === "1";

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

function isMissingPermissionsTables(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  // Prisma missing table errors can vary by connector/version
  if (code === "P2021") return true;
  if (msg.includes("does not exist") && (msg.includes("permissions") || msg.includes("user_permissions") || msg.includes("user_permission_scopes"))) return true;
  if (msg.includes("unknown table") && (msg.includes("permissions") || msg.includes("user_permissions") || msg.includes("user_permission_scopes"))) return true;
  return false;
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

      const agent = await prisma.agents.findFirst({
        where: { user_id: Number(userId), deleted_at: null },
        select: { id: true, roles: { select: { name: true } } },
      });

      const roleNamesRaw = [
        ...(user.user_roles || []).map((ur) => normalizeRoleName(ur.roles?.name)),
        normalizeRoleName(agent?.roles?.name),
      ].filter(Boolean);
      const roleNames = expandRoles(roleNamesRaw);

      // ✅ Support délégations (lookup once)
      let delegatedRoles = [];
      if (agent?.id) {
        const now = new Date();
        const dels = await prisma.delegations.findMany({
          where: {
            delegate_id: Number(agent.id),
            is_active: true,
            start_at: { lte: now },
            end_at: { gte: now },
          },
          select: { role_name: true },
        });

        delegatedRoles = Array.from(new Set(dels.map((d) => normalizeRoleName(d.role_name)).filter(Boolean)));
        delegatedRoles = expandRoles(delegatedRoles);
      }

      const effectiveRoles = Array.from(new Set([...roleNames, ...delegatedRoles]));
      if (DEBUG_PERMISSIONS) {
        // eslint-disable-next-line no-console
        console.log("[perm] user", userId, "roles", effectiveRoles, "requested", permissions);
      }

      // If no permissions requested, allow.
      if (permissions.length === 0) {
        req.user.roles = effectiveRoles;
        req.user.delegatedRoles = delegatedRoles;
        req.user.permissions = [];
        return next();
      }

      // DB-driven permissions (user-based, no role inheritance)
      let ok = false;
      let allowed = new Set();
      let permissionScopes = {};
      try {
        const profile = await getUserPermissionProfile({ prisma, userId });
        const allowedCodes = profile.allowedCodes || [];
        permissionScopes = profile.scopesByCode || {};
        allowed = new Set(allowedCodes.map(normalizePermissionCode));
        ok = permissions.length === 0 || permissions.some((p) => allowed.has(normalizePermissionCode(p)));
      } catch (e) {
        // Fallback to code mapping if tables are not available yet (local dev / before db push)
        if (!isMissingPermissionsTables(e)) {
          return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        allowed = new Set();
        for (const perm of permissions) {
          const allowedRoles = (permissionMap[perm] || []).map(normalizeRoleName).filter(Boolean);
          if (!allowedRoles.length) continue;
          if (allowedRoles.some((r) => effectiveRoles.includes(r))) {
            ok = true;
            allowed.add(String(perm));
          }
        }
      }

      if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

      req.user.roles = effectiveRoles;
      req.user.delegatedRoles = delegatedRoles;
      req.user.permissions = Array.from(allowed);
      req.user.permissionScopes = permissionScopes;
      return next();
    } catch (e) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  };
};
