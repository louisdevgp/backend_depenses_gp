const prisma = require("../config/prisma");
const permissionMap = require("../config/permissions");

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
  if (msg.includes("does not exist") && (msg.includes("permissions") || msg.includes("role_permissions"))) return true;
  if (msg.includes("unknown table") && (msg.includes("permissions") || msg.includes("role_permissions"))) return true;
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

      // DB-driven permissions (any-of semantics + overrides utilisateur)
      let ok = false;
      let allowed = new Set();
      try {
        const roleNames = (effectiveRoles || []).map(normalizeRoleName).filter(Boolean);
        const permCodes = permissions.map((p) => String(p).trim()).filter(Boolean);

        if (permCodes.length) {
          const [roleRows, permRows] = await Promise.all([
            prisma.roles.findMany({
              where: { deleted_at: null, is_active: true, name: { in: roleNames } },
              select: { id: true },
            }),
            prisma.permissions.findMany({
              where: { deleted_at: null, is_active: true, code: { in: permCodes } },
              select: { id: true, code: true },
            }),
          ]);

          const roleIds = roleRows.map((r) => r.id).filter(Boolean);
          const permIds = permRows.map((p) => p.id).filter(Boolean);
          if (DEBUG_PERMISSIONS) {
            // eslint-disable-next-line no-console
            console.log("[perm] roles", roleIds, "permIds", permIds, "permCodes", permCodes);
          }

          if (!permIds.length) {
            allowed = new Set();
            for (const perm of permCodes) {
              const allowedRoles = (permissionMap[perm] || []).map(normalizeRoleName).filter(Boolean);
              if (allowedRoles.some((r) => effectiveRoles.includes(r))) allowed.add(perm);
            }
            ok = permCodes.some((c) => allowed.has(c));
          } else {
            const rolePermTotal = roleIds.length
              ? await prisma.role_permissions.count({
                  where: { deleted_at: null, role_id: { in: roleIds } },
                })
              : 0;

            if (rolePermTotal === 0) {
              allowed = new Set();
              for (const perm of permCodes) {
                const allowedRoles = (permissionMap[perm] || []).map(normalizeRoleName).filter(Boolean);
                if (allowedRoles.some((r) => effectiveRoles.includes(r))) allowed.add(perm);
              }
              if (DEBUG_PERMISSIONS) {
                // eslint-disable-next-line no-console
                console.log("[perm] fallback allowed before overrides", Array.from(allowed));
              }

              try {
                const overrides = await prisma.user_permissions.findMany({
                  where: { user_id: Number(userId), deleted_at: null, permission_id: { in: permIds } },
                  select: { permission_id: true, is_allowed: true },
                });

                if (overrides.length) {
                  const idToCode = new Map(permRows.map((p) => [p.id, p.code]));
                  for (const row of overrides) {
                    const code = idToCode.get(row.permission_id);
                    if (!code) continue;
                    if (row.is_allowed) allowed.add(code);
                    else allowed.delete(code);
                  }
                }
              } catch (e) {
                const msg = String(e?.message || "").toLowerCase();
                const missingUserPerms =
                  msg.includes("user_permissions") && (msg.includes("does not exist") || msg.includes("unknown table"));
                if (!missingUserPerms && !isMissingPermissionsTables(e)) throw e;
              }

              ok = permCodes.some((c) => allowed.has(c));
              if (DEBUG_PERMISSIONS) {
                // eslint-disable-next-line no-console
                console.log("[perm] fallback ok", ok);
              }
            } else {
            const roleHits = roleIds.length
              ? await prisma.role_permissions.findMany({
                  where: {
                    deleted_at: null,
                    role_id: { in: roleIds },
                    permission_id: { in: permIds },
                  },
                  select: { permission_id: true },
                })
              : [];

            const idToCode = new Map(permRows.map((p) => [p.id, p.code]));
            allowed = new Set(roleHits.map((r) => idToCode.get(r.permission_id)).filter(Boolean));
            if (DEBUG_PERMISSIONS) {
              // eslint-disable-next-line no-console
              console.log("[perm] roleHits", roleHits, "allowed pre-override", Array.from(allowed));
            }

            try {
              const overrides = await prisma.user_permissions.findMany({
                where: { user_id: Number(userId), deleted_at: null, permission_id: { in: permIds } },
                select: { permission_id: true, is_allowed: true },
              });

              if (overrides.length) {
                const allow = new Set();
                const deny = new Set();
                for (const row of overrides) {
                  const code = idToCode.get(row.permission_id);
                  if (!code) continue;
                  if (row.is_allowed) allow.add(code);
                  else deny.add(code);
                }
                allow.forEach((c) => allowed.add(c));
                deny.forEach((c) => allowed.delete(c));
              }
            } catch (e) {
              const msg = String(e?.message || "").toLowerCase();
              const missingUserPerms =
                msg.includes("user_permissions") && (msg.includes("does not exist") || msg.includes("unknown table"));
              if (!missingUserPerms && !isMissingPermissionsTables(e)) throw e;
            }

            ok = permCodes.some((c) => allowed.has(c));
            if (DEBUG_PERMISSIONS) {
              // eslint-disable-next-line no-console
              console.log("[perm] role ok", ok, "allowed final", Array.from(allowed));
            }
            }
          }
        }
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
            break;
          }
        }
      }

      if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

      req.user.roles = effectiveRoles;
      req.user.delegatedRoles = delegatedRoles;
      req.user.permissions = Array.from(allowed);
      return next();
    } catch (e) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  };
};
