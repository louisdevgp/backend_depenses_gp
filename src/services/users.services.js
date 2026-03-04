const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { v4: uuidv4 } = require("uuid");
const { hashPassword } = require("../utils/password");
const permissionMap = require("../config/permissions");

const ROLE_IMPLICATIONS = {
  DG: ["DIRECTEUR"],
  DGA: ["DIRECTEUR"],
  DAF: ["DIRECTEUR"],
};

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

function uniqRoles(list) {
  return Array.from(new Set((list || []).map(normalizeRoleName).filter(Boolean)));
}

function buildRoleBreakdown({ baseRoles = [], primaryRole = null, delegatedRoles = [] }) {
  const primary = normalizeRoleName(primaryRole) || null;
  const base = uniqRoles(baseRoles);
  const baseWithPrimary = primary ? Array.from(new Set([...base, primary])) : base;
  const secondaryRoles = primary ? baseWithPrimary.filter((r) => r !== primary) : baseWithPrimary.slice();
  const roles = Array.from(new Set(expandRoles([...baseWithPrimary, ...delegatedRoles])));
  return { primaryRole: primary, secondaryRoles, roles, baseWithPrimary };
}

function isMissingPermissionsTables(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();
  if (code === "P2021") return true;
  if (msg.includes("does not exist") && (msg.includes("permissions") || msg.includes("role_permissions"))) return true;
  if (msg.includes("unknown table") && (msg.includes("permissions") || msg.includes("role_permissions"))) return true;
  return false;
}

function generateTemporaryPassword() {
  // Simple, readable, avoids ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function idWhere(idOrUuid) {
  const asNumber = Number(idOrUuid);
  if (!Number.isNaN(asNumber)) return { id: asNumber };
  return { uuid: idOrUuid };
}

async function me(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      user_roles: { include: { roles: true } },
      agents: {
        where: { deleted_at: null },
        take: 1,
        include: {
          roles: true,
          directions: true,
          departements: true,
          services: true,
          agents: { select: { id: true, nom: true, prenom: true, roles: { select: { name: true } } } },
        },
      },
    },
  });

  if (!user || user.deleted_at) throw new Error("User not found");

  const baseRoles = user.user_roles.map((ur) => normalizeRoleName(ur.roles.name)).filter(Boolean);

  // ✅ délégations actives: ajout au /me pour que le frontend puisse autoriser l'accès
  const agentRecord = user.agents?.[0] || null;
  const primaryRole = agentRecord?.roles?.name || null;
  const agentId = agentRecord?.id;
  let delegatedRoles = [];
  let delegated = [];
  if (agentId) {
    const now = new Date();
    const dels = await prisma.delegations.findMany({
      where: {
        delegate_id: Number(agentId),
        is_active: true,
        start_at: { lte: now },
        end_at: { gte: now },
      },
      select: { id: true, uuid: true, role_name: true, principal_id: true, start_at: true, end_at: true, is_active: true },
    });
    delegatedRoles = Array.from(new Set(dels.map((d) => normalizeRoleName(d.role_name)).filter(Boolean)));
    delegated = dels;
  }

  const roleBreakdown = buildRoleBreakdown({
    baseRoles,
    primaryRole,
    delegatedRoles,
  });

  // ✅ permissions effectives (DB-first, fallback mapping)
  let permissions = [];
  try {
    const roleNames = (roleBreakdown.roles || []).map(normalizeRoleName).filter(Boolean);
    if (!roleNames.length) {
      permissions = [];
    } else {
      const roleRows = await prisma.roles.findMany({
        where: { deleted_at: null, is_active: true, name: { in: roleNames } },
        select: { id: true },
      });
      const roleIds = roleRows.map((r) => r.id).filter(Boolean);
      if (!roleIds.length) {
        permissions = [];
      } else {
        const rpRows = await prisma.role_permissions.findMany({
          where: { deleted_at: null, role_id: { in: roleIds } },
          select: { permission_id: true },
        });
        const permIds = Array.from(new Set(rpRows.map((r) => r.permission_id).filter(Boolean)));
        if (!permIds.length) {
          permissions = [];
        } else {
          const permRows = await prisma.permissions.findMany({
            where: { id: { in: permIds }, deleted_at: null, is_active: true },
            select: { code: true },
          });
          permissions = Array.from(new Set(permRows.map((p) => p.code).filter(Boolean)));
        }
      }
    }

    if (permissions.length === 0 && roleBreakdown.roles?.length) {
      const [permCount, rolePermCount] = await prisma.$transaction([
        prisma.permissions.count({ where: { deleted_at: null, is_active: true } }),
        prisma.role_permissions.count({ where: { deleted_at: null } }),
      ]);

      if (permCount === 0 || rolePermCount === 0) {
        const out = new Set();
        for (const [code, allowedRoles] of Object.entries(permissionMap || {})) {
          const allowed = (allowedRoles || []).map(normalizeRoleName).filter(Boolean);
          if (allowed.some((r) => roleBreakdown.roles.includes(r))) out.add(String(code));
        }
        permissions = Array.from(out);
      }
    }
  } catch (e) {
    if (!isMissingPermissionsTables(e)) throw e;

    const out = new Set();
    for (const [code, allowedRoles] of Object.entries(permissionMap || {})) {
      const allowed = (allowedRoles || []).map(normalizeRoleName).filter(Boolean);
      if (allowed.some((r) => roleBreakdown.roles.includes(r))) out.add(String(code));
    }
    permissions = Array.from(out);
  }

  // ✅ overrides utilisateur (allow/deny)
  try {
    const rows = await prisma.user_permissions.findMany({
      where: { user_id: Number(user.id), deleted_at: null },
      select: { permission_id: true, is_allowed: true },
    });
    if (rows.length) {
      const permIds = Array.from(new Set(rows.map((r) => r.permission_id).filter(Boolean)));
      if (permIds.length) {
        const permRows = await prisma.permissions.findMany({
          where: { id: { in: permIds }, deleted_at: null, is_active: true },
          select: { id: true, code: true },
        });
        const idToCode = new Map(permRows.map((p) => [p.id, p.code]));
        const allow = new Set();
        const deny = new Set();
        for (const row of rows) {
          const code = idToCode.get(row.permission_id);
          if (!code) continue;
          if (row.is_allowed) allow.add(code);
          else deny.add(code);
        }
        const set = new Set(permissions);
        allow.forEach((c) => set.add(c));
        deny.forEach((c) => set.delete(c));
        permissions = Array.from(set);
      }
    }
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    const missingUserPerms =
      msg.includes("user_permissions") && (msg.includes("does not exist") || msg.includes("unknown table"));
    if (!missingUserPerms && !isMissingPermissionsTables(e)) throw e;
  }

  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    is_active: user.is_active,
    roles: roleBreakdown.roles,
    primaryRole: roleBreakdown.primaryRole,
    secondaryRoles: roleBreakdown.secondaryRoles,
    delegatedRoles,
    permissions,
    agent: agentRecord ? { ...agentRecord, delegations: delegated } : null,
  };
}

async function list(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  const skip = (page - 1) * limit;

  const q = (query.q || "").trim();
  const is_active = query.is_active === undefined ? undefined : query.is_active === "true";

  const where = {
    deleted_at: null,
    ...(is_active === undefined ? {} : { is_active }),
    ...(q
      ? {
          OR: [
            { email: { contains: q } },
            { nom: { contains: q } },
            { prenom: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.users.count({ where }),
    prisma.users.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: "desc" },
      include: {
        user_roles: { include: { roles: true } },
        agents: {
          where: { deleted_at: null },
          take: 1,
          include: { roles: true },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    items: items.map((u) => {
      const baseRoles = u.user_roles.map((ur) => normalizeRoleName(ur.roles.name)).filter(Boolean);
      const primaryRole = u.agents?.[0]?.roles?.name || null;
      const roleBreakdown = buildRoleBreakdown({ baseRoles, primaryRole, delegatedRoles: [] });
      return {
        id: u.id,
        uuid: u.uuid,
        email: u.email,
        nom: u.nom,
        prenom: u.prenom,
        is_active: u.is_active,
        roles: roleBreakdown.baseWithPrimary,
        primaryRole: roleBreakdown.primaryRole,
        secondaryRoles: roleBreakdown.secondaryRoles,
        created_at: u.created_at,
      };
    }),
  };
}

async function create(payload, performedByUserId) {
  const email = String(payload?.email || "").trim().toLowerCase();
  const nom = String(payload?.nom || "").trim();
  const prenom = String(payload?.prenom || "").trim();
  const is_active = payload?.is_active === undefined ? true : !!payload.is_active;

  if (!email) throw new Error("email required");
  if (!nom) throw new Error("nom required");
  if (!prenom) throw new Error("prenom required");

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing && !existing.deleted_at) throw new Error("EMAIL_ALREADY_USED");
  if (existing && existing.deleted_at) throw new Error("EMAIL_ALREADY_USED");

  const temporaryPassword = generateTemporaryPassword();
  const password_hash = await hashPassword(temporaryPassword);

  const created = await prisma.users.create({
    data: {
      uuid: uuidv4(),
      email,
      nom,
      prenom,
      password_hash,
      is_active,
      last_login_at: null,
    },
  });

  return {
    id: created.id,
    uuid: created.uuid,
    email: created.email,
    temporaryPassword,
  };
}

async function getById(idOrUuid) {
  const user = await prisma.users.findFirst({
    where: { ...idWhere(idOrUuid), deleted_at: null },
    include: {
      user_roles: { include: { roles: true } },
      agents: {
        where: { deleted_at: null },
        take: 1,
        include: { roles: true },
      },
    },
  });
  if (!user) throw new Error("User not found");
  const baseRoles = user.user_roles.map((ur) => normalizeRoleName(ur.roles.name)).filter(Boolean);
  const primaryRole = user.agents?.[0]?.roles?.name || null;
  const roleBreakdown = buildRoleBreakdown({ baseRoles, primaryRole, delegatedRoles: [] });
  return {
    ...user,
    roles: roleBreakdown.baseWithPrimary,
    primaryRole: roleBreakdown.primaryRole,
    secondaryRoles: roleBreakdown.secondaryRoles,
    agent: user.agents?.[0] || null,
  };
}

async function update(idOrUuid, payload) {
  const data = {};
  if (payload.nom !== undefined) data.nom = payload.nom;
  if (payload.prenom !== undefined) data.prenom = payload.prenom;
  if (payload.is_active !== undefined) data.is_active = !!payload.is_active;

  const updated = await prisma.users.update({
    where: idWhere(idOrUuid),
    data,
  });
  return { id: updated.id, uuid: updated.uuid };
}

async function softDelete(idOrUuid, performedByUserId) {
  // soft delete user + audit optionnel
  const updated = await prisma.users.update({
    where: idWhere(idOrUuid),
    data: { deleted_at: new Date(), is_active: false },
  });

  // si tu veux logger dans audit_logs ici (optionnel)
  // await prisma.audit_logs.create({ data: {...} });

  return { id: updated.id, uuid: updated.uuid, deleted: true };
}

async function adminResetPassword(idOrUuid, performedByUserId) {
  const user = await prisma.users.findFirst({ where: { ...idWhere(idOrUuid), deleted_at: null } });
  if (!user) throw new Error("User not found");

  const temporaryPassword = generateTemporaryPassword();
  const password_hash = await hashPassword(temporaryPassword);

  await prisma.users.update({
    where: { id: user.id },
    data: {
      password_hash,
      last_login_at: null, // force change-password flow next login
      is_active: true,
    },
  });

  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    temporaryPassword,
    mustChangePassword: true,
  };
}

module.exports = { me, list, create, getById, update, adminResetPassword, softDelete };
