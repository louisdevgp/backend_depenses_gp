const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { v4: uuidv4 } = require("uuid");

/**
 * Helpers
 */
function toInt(v, name) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} invalide`);
  return n;
}

function parseDateTime(v, name) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} invalide (DateTime)`);
  return d;
}

/**
 * Create Agent
 * - user_id obligatoire
 * - nom/prenom obligatoires
 * - matricule optionnel mais unique
 */
async function createAgent(payload, userCtx) {
  const user_id = toInt(payload.user_id, "user_id");
  if (!user_id) throw new Error("user_id est obligatoire");

  const nom = (payload.nom || "").trim();
  const prenom = (payload.prenom || "").trim();
  if (!nom) throw new Error("nom est obligatoire");
  if (!prenom) throw new Error("prenom est obligatoire");

  const matricule = payload.matricule ? String(payload.matricule).trim() : null;

  const direction_id = toInt(payload.direction_id, "direction_id");
  const departement_id = toInt(payload.departement_id, "departement_id");
  const service_id = toInt(payload.service_id, "service_id");
  const role_id = toInt(payload.role_id, "role_id");
  const manager_id = toInt(payload.manager_id, "manager_id"); // manager direct “actuel” (snapshot)

  // Vérifs existence (robustes)
  const user = await prisma.users.findFirst({ where: { id: user_id, deleted_at: null } });
  if (!user) throw new Error("Utilisateur (user_id) introuvable ou supprimé");

  if (direction_id) {
    const dir = await prisma.directions.findFirst({ where: { id: direction_id, deleted_at: null } });
    if (!dir) throw new Error("direction_id introuvable");
  }
  if (departement_id) {
    const dep = await prisma.departements.findFirst({ where: { id: departement_id, deleted_at: null } });
    if (!dep) throw new Error("departement_id introuvable");
  }
  if (service_id) {
    const srv = await prisma.services.findFirst({ where: { id: service_id, deleted_at: null } });
    if (!srv) throw new Error("service_id introuvable");
  }
  if (role_id) {
    const role = await prisma.roles.findFirst({ where: { id: role_id } });
    if (!role) throw new Error("role_id introuvable");
  }
  if (manager_id) {
    const mgr = await prisma.agents.findFirst({ where: { id: manager_id, deleted_at: null } });
    if (!mgr) throw new Error("manager_id introuvable");
  }

  const created = await prisma.agents.create({
    data: {
      uuid: uuidv4(),
      user_id,
      matricule,
      nom,
      prenom,
      direction_id,
      departement_id,
      service_id,
      role_id,
      manager_id,
    },
    include: {
      users: { select: { id: true, email: true, nom: true, prenom: true } },
      roles: true,
      directions: true,
      departements: true,
      services: true,
      agents: true, // manager (self relation)
    },
  });

  // Optionnel: si manager_id fourni, on crée une ligne d’historique “active”
  if (manager_id) {
    const actorAgentId = userCtx?.agent?.id; // si dispo
    if (actorAgentId) {
      await prisma.agent_reporting_lines.create({
        data: {
          uuid: uuidv4(),
          agent_id: created.id,
          manager_id,
          start_at: new Date(),
          end_at: null,
          created_by_id: actorAgentId,
        },
      });
    }
  }

  return created;
}

/**
 * List Agents (pagination + filtres)
 * query: search, direction_id, departement_id, service_id, role_id, is_deleted, page, limit
 */
async function listAgents(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  const skip = (page - 1) * limit;

  const search = query.search ? String(query.search).trim() : null;

  const where = {
    ...(query.is_deleted === "true"
      ? { deleted_at: { not: null } }
      : query.is_deleted === "false"
      ? { deleted_at: null }
      : { deleted_at: null }),
    ...(query.direction_id ? { direction_id: toInt(query.direction_id, "direction_id") } : {}),
    ...(query.departement_id ? { departement_id: toInt(query.departement_id, "departement_id") } : {}),
    ...(query.service_id ? { service_id: toInt(query.service_id, "service_id") } : {}),
    ...(query.role_id ? { role_id: toInt(query.role_id, "role_id") } : {}),
    ...(search
      ? {
          OR: [
            { nom: { contains: search } },
            { prenom: { contains: search } },
            { matricule: { contains: search } },
            { users: { email: { contains: search } } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.agents.count({ where }),
    prisma.agents.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ id: "desc" }],
      include: {
        users: { select: { id: true, email: true, nom: true, prenom: true, is_active: true } },
        roles: true,
        directions: true,
        departements: true,
        services: true,
        agents: { select: { id: true, nom: true, prenom: true } }, // manager snapshot
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    items,
  };
}

/**
 * Get Agent
 */
async function getAgentById(id) {
  const agentId = toInt(id, "id");
  const agent = await prisma.agents.findFirst({
    where: { id: agentId },
    include: {
      users: { select: { id: true, email: true, nom: true, prenom: true, is_active: true } },
      roles: true,
      directions: true,
      departements: true,
      services: true,
      agents: { select: { id: true, nom: true, prenom: true } }, // manager snapshot
      agent_reporting_lines_agent_reporting_lines_agent_idToagents: {
        orderBy: [{ start_at: "desc" }],
        take: 10, // historique récent
        include: {
          agents_agent_reporting_lines_manager_idToagents: { select: { id: true, nom: true, prenom: true } },
        },
      },
    },
  });
  if (!agent) throw new Error("Agent introuvable");
  return agent;
}

/**
 * Update Agent (hors password user)
 */
async function updateAgent(id, payload) {
  const agentId = toInt(id, "id");

  const existing = await prisma.agents.findFirst({ where: { id: agentId } });
  if (!existing) throw new Error("Agent introuvable");

  const data = {};
  if (payload.matricule !== undefined) data.matricule = payload.matricule ? String(payload.matricule).trim() : null;
  if (payload.nom !== undefined) data.nom = String(payload.nom).trim();
  if (payload.prenom !== undefined) data.prenom = String(payload.prenom).trim();

  if (payload.direction_id !== undefined) data.direction_id = toInt(payload.direction_id, "direction_id");
  if (payload.departement_id !== undefined) data.departement_id = toInt(payload.departement_id, "departement_id");
  if (payload.service_id !== undefined) data.service_id = toInt(payload.service_id, "service_id");
  if (payload.role_id !== undefined) data.role_id = toInt(payload.role_id, "role_id");

  // manager_id = snapshot (si tu veux l’ajuster direct sans historique, autorise; sinon force via endpoint /manager)
  if (payload.manager_id !== undefined) data.manager_id = toInt(payload.manager_id, "manager_id");

  // mini validations
  if (data.nom !== undefined && !data.nom) throw new Error("nom ne peut pas être vide");
  if (data.prenom !== undefined && !data.prenom) throw new Error("prenom ne peut pas être vide");

  const updated = await prisma.agents.update({
    where: { id: agentId },
    data,
    include: {
      users: { select: { id: true, email: true, nom: true, prenom: true } },
      roles: true,
      directions: true,
      departements: true,
      services: true,
      agents: { select: { id: true, nom: true, prenom: true } },
    },
  });

  return updated;
}

/**
 * Soft delete
 */
async function softDeleteAgent(id) {
  const agentId = toInt(id, "id");
  const existing = await prisma.agents.findFirst({ where: { id: agentId } });
  if (!existing) throw new Error("Agent introuvable");

  await prisma.agents.update({
    where: { id: agentId },
    data: { deleted_at: new Date() },
  });
}

/**
 * Set manager "proprement" (snapshot + historique)
 * - clôture la ligne active précédente
 * - crée une nouvelle ligne active (si managerId != null)
 */
async function setAgentManager({ agentId, managerId, startAt, endAt, actorAgentId }) {
  const aId = toInt(agentId, "agentId");
  const mId = managerId === null ? null : toInt(managerId, "managerId");

  const agent = await prisma.agents.findFirst({ where: { id: aId, deleted_at: null } });
  if (!agent) throw new Error("Agent introuvable ou supprimé");

  if (mId) {
    const mgr = await prisma.agents.findFirst({ where: { id: mId, deleted_at: null } });
    if (!mgr) throw new Error("Manager introuvable ou supprimé");
    if (mId === aId) throw new Error("Un agent ne peut pas être son propre manager");
  }

  if (!actorAgentId) throw new Error("actorAgentId manquant (req.user.agent.id).");

  const sAt = parseDateTime(startAt, "start_at") || new Date();
  const eAt = parseDateTime(endAt, "end_at"); // optionnel

  // Transaction: close active line + create new line + update snapshot manager_id
  const result = await prisma.$transaction(async (tx) => {
    // close active line (end_at null)
    await tx.agent_reporting_lines.updateMany({
      where: { agent_id: aId, end_at: null },
      data: { end_at: sAt },
    });

    if (mId !== null) {
      await tx.agent_reporting_lines.create({
        data: {
          uuid: uuidv4(),
          agent_id: aId,
          manager_id: mId,
          start_at: sAt,
          end_at: eAt ?? null,
          created_by_id: actorAgentId,
        },
      });
    }

    const updated = await tx.agents.update({
      where: { id: aId },
      data: { manager_id: mId },
      include: {
        agents: { select: { id: true, nom: true, prenom: true } },
      },
    });

    return updated;
  });

  return result;
}

async function getCurrentManager(id) {
  const agentId = parseId(id);

  // 1) Essaye d’abord via reporting line active
  const now = new Date();
  const line = await prisma.agent_reporting_lines.findFirst({
    where: {
      agent_id: agentId,
      start_at: { lte: now },
      OR: [{ end_at: null }, { end_at: { gte: now } }],
    },
    orderBy: { start_at: "desc" },
    include: {
      agents_agent_reporting_lines_manager_idToagents: {
        select: { id: true, uuid: true, nom: true, prenom: true, role_id: true },
      },
    },
  });

  if (line?.agents_agent_reporting_lines_manager_idToagents) {
    return { source: "reporting_line", manager: line.agents_agent_reporting_lines_manager_idToagents };
  }

  // 2) fallback sur manager_id direct
  const agent = await prisma.agents.findFirst({
    where: { id: agentId, deleted_at: null },
    select: {
      id: true,
      manager_id: true,
      agents: { select: { id: true, uuid: true, nom: true, prenom: true, role_id: true } },
    },
  });
  if (!agent) throw new Error("Agent not found");

  return { source: "agents.manager_id", manager: agent.agents || null };
};

module.exports = {
  createAgent,
  listAgents,
  getAgentById,
  updateAgent,
  softDeleteAgent,
  setAgentManager,
  getCurrentManager
};
