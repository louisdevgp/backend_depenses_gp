const { Server } = require("socket.io");
const { verifyAccessToken } = require("./services/token.services");
const prisma = require("./config/prisma");
const {
  getUserPermissionProfile,
  getScopesForPermissionFromUser,
  buildOrgScopeWhere,
  normalizePermissionCode,
} = require("./utils/permissionScopes");

let io = null;

function normalizeToken(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  return str.replace(/^Bearer\s+/i, "");
}

function userRoom(userId) {
  return `user:${Number(userId)}`;
}

function parseScope(scopeRaw) {
  if (scopeRaw == null) return null;
  const s = String(scopeRaw).trim();
  if (!s) return null;
  if (s.toUpperCase() === "GLOBAL") return { level: "GLOBAL", id: null, normalized: "GLOBAL" };

  const m = /^([A-Z_]+)\s*:\s*(\d+)$/i.exec(s);
  if (!m) return null;
  const level = String(m[1]).toUpperCase();
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!["DIRECTION", "DEPARTEMENT", "SERVICE"].includes(level)) return null;
  return { level, id, normalized: `${level}:${id}` };
}

function demandeWhereForScope(scopeRaw) {
  const parsed = parseScope(scopeRaw);
  if (!parsed || parsed.level === "GLOBAL") return null;
  if (parsed.level === "DIRECTION") return { direction_id: Number(parsed.id) };
  if (parsed.level === "DEPARTEMENT") return { departement_id: Number(parsed.id) };
  if (parsed.level === "SERVICE") return { service_id: Number(parsed.id) };
  return null;
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function hasPermission(user, code) {
  const perm = normalizePermissionCode(code);
  if (!perm) return false;
  const list = Array.isArray(user?.permissions) ? user.permissions : [];
  return list.map(normalizePermissionCode).includes(perm);
}

function buildScopeWhereForPermissions(user, permissionCodes = [], { wrap } = {}) {
  const codes = Array.isArray(permissionCodes) ? permissionCodes : [];
  const scopes = [];
  for (const code of codes) {
    if (hasPermission(user, code)) {
      scopes.push(...getScopesForPermissionFromUser(user, code));
    }
  }

  if (!scopes.length) return { id: -1 };

  const scopeWhere = buildOrgScopeWhere(scopes, { wrap });
  if (scopeWhere === null) return null; // global access
  return scopeWhere;
}

async function getAgentFromUserId(userId) {
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { id: true, direction_id: true },
  });
}

async function getAgentWithRoles(userId) {
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: {
      id: true,
      roles: { select: { name: true } },
      users: { select: { user_roles: { select: { roles: { select: { name: true } } } } } },
    },
  });
}

function agentRoleSet(agent) {
  const out = new Set();
  const primary = normalizeRoleName(agent?.roles?.name);
  if (primary) out.add(primary);
  const secondary = (agent?.users?.user_roles || [])
    .map((ur) => normalizeRoleName(ur?.roles?.name))
    .filter(Boolean);
  secondary.forEach((r) => out.add(r));
  return out;
}

async function getPermissionContext(userId) {
  const profile = await getUserPermissionProfile({ prisma, userId });
  return {
    permissions: profile.allowedCodes || [],
    permissionScopes: profile.scopesByCode || {},
  };
}

async function computePendingCount(userId) {
  const agent = await getAgentFromUserId(userId);
  if (!agent) return 0;

  const now = new Date();
  const dels = await prisma.delegations.findMany({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    select: { principal_id: true, role_name: true, scope: true },
  });

  const delegatedOr = dels
    .filter((d) => d?.principal_id && d?.role_name)
    .map((d) => {
      const base = { validator_id: Number(d.principal_id), role_name: String(d.role_name) };
      const scopeWhere = demandeWhereForScope(d.scope);
      if (!scopeWhere) return base;
      return { ...base, demandes_paiement: { is: scopeWhere } };
    });

  const where = {
    status: "en_attente",
    demandes_paiement: { is: { deleted_at: null } },
    ...(delegatedOr.length > 0
      ? { OR: [{ validator_id: Number(agent.id) }, ...delegatedOr] }
      : { validator_id: Number(agent.id) }),
  };

  return prisma.validation_steps.count({ where });
}

async function computePaiementPendingCount(userId) {
  const userPerms = await getPermissionContext(userId);
  if (!hasPermission(userPerms, "PAIEMENT_LIST")) return 0;

  const scopeWhere = buildScopeWhereForPermissions(userPerms, ["PAIEMENT_LIST"]);
  if (scopeWhere && scopeWhere.id === -1) return 0;

  const paidStatuses = ["paye", "payee", "regle", "reglee"];
  const unpaidCondition = { paiement_id: null, statut: { notIn: paidStatuses } };

  const baseWhere = {
    deleted_at: null,
    statut: { in: ["approuvee", "en_attente_paiement", "achat_effectue", "receptionnee"] },
  };

  const and = [
    baseWhere,
    {
      OR: [
        { conditions_paiement: { none: {} } },
        { conditions_paiement: { some: unpaidCondition } },
      ],
    },
  ];
  if (scopeWhere) and.push(scopeWhere);

  return prisma.demandes_paiement.count({
    where: and.length === 1 ? and[0] : { AND: and },
  });
}

async function computeReceptionPendingCount(userId) {
  const userPerms = await getPermissionContext(userId);
  if (!hasPermission(userPerms, "RECEPTION_LIST") && !hasPermission(userPerms, "RECEPTION_LIST_ALL")) {
    return 0;
  }

  const agent = await getAgentWithRoles(userId);
  if (!agent) return 0;

  const roles = agentRoleSet(agent);
  const now = new Date();
  const delegations = await prisma.delegations.findMany({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
    },
    select: { role_name: true },
  });
  delegations
    .map((d) => normalizeRoleName(d?.role_name))
    .filter(Boolean)
    .forEach((r) => roles.add(r));

  const wantsDirector = roles.has("DIRECTEUR");
  const wantsDaf = roles.has("DAF");
  if (!wantsDirector && !wantsDaf) return 0;

  const scopeWhere = buildScopeWhereForPermissions(userPerms, ["RECEPTION_LIST", "RECEPTION_LIST_ALL"], {
    wrap: (base) => ({ demandes_paiement: { is: base } }),
  });
  if (scopeWhere && scopeWhere.id === -1) return 0;

  const or = [];
  if (wantsDirector) or.push({ visa_directeur_id: null });
  if (wantsDaf) or.push({ visa_directeur_id: { not: null }, visa_daf_id: null });
  if (!or.length) return 0;

  const and = [{ OR: or }];
  if (scopeWhere) and.push(scopeWhere);

  return prisma.receptions.count({
    where: and.length === 1 ? and[0] : { AND: and },
  });
}

async function computeAchatPendingCount(userId) {
  const userPerms = await getPermissionContext(userId);
  if (!hasPermission(userPerms, "DEMANDE_LIST_ASSIGNED_ACHETEUR")) return 0;

  const agent = await getAgentFromUserId(userId);
  if (!agent?.id || agent?.direction_id == null) return 0;

  return prisma.demandes_paiement.count({
    where: {
      deleted_at: null,
      direction_id: Number(agent.direction_id),
      statut: { in: ["en_attente_paiement", "paye", "payee"] },
    },
  });
}

function initRealtime(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake?.auth?.token ||
        socket.handshake?.headers?.authorization ||
        socket.handshake?.query?.token;
      const cleaned = normalizeToken(token);
      if (!cleaned) return next(new Error("Unauthorized"));
      const payload = verifyAccessToken(cleaned);
      if (!payload?.userId) return next(new Error("Unauthorized"));
      socket.data.user = payload;
      socket.data.userId = Number(payload.userId);
      return next();
    } catch (err) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data?.userId;
    if (userId) {
      socket.join(userRoom(userId));
      Promise.allSettled([
        computePendingCount(userId).then((count) => {
          emitToUser(userId, "validation:pending_status", {
            count,
            hasPending: count > 0,
          });
        }),
        computePaiementPendingCount(userId).then((count) => {
          emitToUser(userId, "paiement:pending_status", {
            count,
            hasPending: count > 0,
          });
        }),
        computeReceptionPendingCount(userId).then((count) => {
          emitToUser(userId, "reception:pending_status", {
            count,
            hasPending: count > 0,
          });
        }),
        computeAchatPendingCount(userId).then((count) => {
          emitToUser(userId, "achat:pending_status", {
            count,
            hasPending: count > 0,
          });
        }),
      ]).catch(() => {
        // ignore
      });
    }
  });

  return io;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return;
  io.to(userRoom(uid)).emit(event, payload);
}

async function emitPendingStatus(userId) {
  const count = await computePendingCount(userId);
  emitToUser(userId, "validation:pending_status", { count, hasPending: count > 0 });
  return count;
}

async function emitPaiementPendingStatus(userId) {
  const count = await computePaiementPendingCount(userId);
  emitToUser(userId, "paiement:pending_status", { count, hasPending: count > 0 });
  return count;
}

async function emitReceptionPendingStatus(userId) {
  const count = await computeReceptionPendingCount(userId);
  emitToUser(userId, "reception:pending_status", { count, hasPending: count > 0 });
  return count;
}

async function emitAchatPendingStatus(userId) {
  const count = await computeAchatPendingCount(userId);
  emitToUser(userId, "achat:pending_status", { count, hasPending: count > 0 });
  return count;
}

module.exports = {
  initRealtime,
  emitToUser,
  emitPendingStatus,
  emitPaiementPendingStatus,
  emitReceptionPendingStatus,
  emitAchatPendingStatus,
};
