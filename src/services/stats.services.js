const prisma = require("../config/prisma");

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRoleName(roleName) {
  if (!roleName) return "DEMANDEUR";
  return String(roleName).trim().toUpperCase();
}

function parseDirectionId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePeriod({ from, to } = {}) {
  const now = new Date();

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultFrom = startOfMonth;
  const defaultTo = now;

  const parsedFrom = from ? new Date(String(from)) : defaultFrom;
  const parsedTo = to ? new Date(String(to)) : defaultTo;

  const safeFrom = Number.isNaN(parsedFrom.getTime()) ? defaultFrom : parsedFrom;
  const safeTo = Number.isNaN(parsedTo.getTime()) ? defaultTo : parsedTo;

  return {
    from: safeFrom,
    to: safeTo,
  };
}

function computeAgingBuckets(items, now = new Date()) {
  const buckets = {
    "0_2": 0,
    "3_7": 0,
    "8_plus": 0,
  };

  for (const it of items) {
    const createdAt = it?.created_at ? new Date(it.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

    const days = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
    if (days <= 2) buckets["0_2"] += 1;
    else if (days <= 7) buckets["3_7"] += 1;
    else buckets["8_plus"] += 1;
  }

  return buckets;
}

async function getAgentByUserId(userId) {
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true, users: true, directions: true },
  });
}

async function dashboard(userId, query = {}) {
  const agent = await getAgentByUserId(userId);
  if (!agent) {
    const err = new Error("Agent non trouvé");
    err.statusCode = 400;
    throw err;
  }

  const role = normalizeRoleName(agent?.roles?.name);
  const period = parsePeriod(query);
  const globalRoles = new Set(["ADMIN", "DG", "DGA", "DAF"]);
  const isGlobalRole = globalRoles.has(role);
  const directionIdParam = parseDirectionId(query?.direction_id ?? query?.directionId ?? query?.direction);
  const agentDirectionId = agent?.direction_id != null ? Number(agent.direction_id) : null;
  const scopeDirectionId = isGlobalRole ? directionIdParam : agentDirectionId;
  const denyAll = !isGlobalRole && !scopeDirectionId;
  const directionScopeWhere = denyAll
    ? { direction_id: -1 }
    : scopeDirectionId
      ? { direction_id: Number(scopeDirectionId) }
      : {};
  const paiementsScopeWhere =
    Object.keys(directionScopeWhere).length > 0
      ? { demandes_paiement: { is: directionScopeWhere } }
      : {};

  let directions = null;
  if (isGlobalRole) {
    directions = await prisma.directions.findMany({
      where: { deleted_at: null },
      select: { id: true, nom: true },
      orderBy: { nom: "asc" },
    });
  }

  let direction = null;
  if (scopeDirectionId) {
    if (Array.isArray(directions) && directions.length) {
      direction = directions.find((d) => Number(d.id) === Number(scopeDirectionId)) || null;
    } else if (agent?.directions && Number(agent.direction_id) === Number(scopeDirectionId)) {
      direction = { id: agent.directions.id, nom: agent.directions.nom };
    } else {
      const found = await prisma.directions.findUnique({
        where: { id: Number(scopeDirectionId) },
        select: { id: true, nom: true },
      });
      direction = found || null;
    }
  } else if (!isGlobalRole && agent?.directions) {
    direction = { id: agent.directions.id, nom: agent.directions.nom };
  }

  const base = {
    role,
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    direction,
    directions,
  };

  // ---------------- GLOBAL (léger, utile à tous) ----------------
  const globalDemandesAgg = await prisma.demandes_paiement.aggregate({
    where: { deleted_at: null, created_at: { gte: period.from, lte: period.to }, ...directionScopeWhere },
    _count: { _all: true },
    _sum: { montant: true },
  });

  const globalByStatutRaw = await prisma.demandes_paiement.groupBy({
    by: ["statut"],
    where: { deleted_at: null, created_at: { gte: period.from, lte: period.to }, ...directionScopeWhere },
    _count: { _all: true },
    _sum: { montant: true },
  });

  const globalByStatut = [...globalByStatutRaw]
    .sort((a, b) => (b._count?._all || 0) - (a._count?._all || 0))
    .map((r) => ({
      statut: r.statut,
      count: r._count?._all || 0,
      montant: toNumber(r._sum?.montant),
    }));

  // validations en attente (global) via SQL join pour éviter de charger des lignes
  const pendingValidationsGlobal = denyAll
    ? [{ count: 0, montant: 0 }]
    : scopeDirectionId
      ? await prisma.$queryRaw`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(dp.montant), 0) AS montant
        FROM validation_steps vs
        JOIN demandes_paiement dp ON dp.id = vs.demande_id
        WHERE vs.status = 'en_attente'
          AND dp.deleted_at IS NULL
          AND dp.direction_id = ${scopeDirectionId}
      `
      : await prisma.$queryRaw`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(dp.montant), 0) AS montant
        FROM validation_steps vs
        JOIN demandes_paiement dp ON dp.id = vs.demande_id
        WHERE vs.status = 'en_attente'
          AND dp.deleted_at IS NULL
      `;

  const pendingGlobalRow = Array.isArray(pendingValidationsGlobal) ? pendingValidationsGlobal[0] : null;
  const global = {
    demandes: {
      count: globalDemandesAgg._count?._all || 0,
      montant: toNumber(globalDemandesAgg._sum?.montant),
    },
    demandesByStatut: globalByStatut,
    validationsPending: {
      count: Number(pendingGlobalRow?.count || 0),
      montant: toNumber(pendingGlobalRow?.montant),
    },
  };

  // ---------------- ADMIN (vue globale par profil) ----------------
  let admin = null;
  if (role === "ADMIN") {
    const demandesByProfil = denyAll
      ? []
      : scopeDirectionId
        ? await prisma.$queryRaw`
          SELECT
            COALESCE(r.name, 'SANS_ROLE') AS role,
            COUNT(*) AS count,
            COALESCE(SUM(dp.montant), 0) AS montant
          FROM demandes_paiement dp
          JOIN agents a ON a.id = dp.demandeur_id
          LEFT JOIN roles r ON r.id = a.role_id
          WHERE dp.deleted_at IS NULL
            AND dp.created_at >= ${period.from}
            AND dp.created_at <= ${period.to}
            AND dp.direction_id = ${scopeDirectionId}
          GROUP BY r.name
          ORDER BY count DESC
        `
        : await prisma.$queryRaw`
          SELECT
            COALESCE(r.name, 'SANS_ROLE') AS role,
            COUNT(*) AS count,
            COALESCE(SUM(dp.montant), 0) AS montant
          FROM demandes_paiement dp
          JOIN agents a ON a.id = dp.demandeur_id
          LEFT JOIN roles r ON r.id = a.role_id
          WHERE dp.deleted_at IS NULL
            AND dp.created_at >= ${period.from}
            AND dp.created_at <= ${period.to}
          GROUP BY r.name
          ORDER BY count DESC
        `;

    admin = {
      demandesByProfil: (Array.isArray(demandesByProfil) ? demandesByProfil : []).map((r) => ({
        role: String(r.role || "SANS_ROLE"),
        count: Number(r.count || 0),
        montant: toNumber(r.montant),
      })),
    };
  }

  // ---------------- DEMANDEUR ----------------
  if (role === "DEMANDEUR") {
    const rowsRaw = await prisma.demandes_paiement.groupBy({
      by: ["statut"],
      where: {
        deleted_at: null,
        demandeur_id: Number(agent.id),
        created_at: { gte: period.from, lte: period.to },
      },
      _count: { _all: true },
      _sum: { montant: true },
    });

    // Prisma ne supporte pas forcément orderBy: { _count: { _all } } selon versions.
    // On trie donc côté JS.
    const rows = [...rowsRaw].sort((a, b) => (b._count?._all || 0) - (a._count?._all || 0));

    const total = rows.reduce(
      (acc, r) => {
        acc.count += r._count?._all || 0;
        acc.montant += toNumber(r._sum?.montant);
        return acc;
      },
      { count: 0, montant: 0 }
    );

    return {
      ...base,
      global,
      admin,
      demandeur: {
        demandesByStatut: rows.map((r) => ({
          statut: r.statut,
          count: r._count?._all || 0,
          montant: toNumber(r._sum?.montant),
        })),
        total,
      },
    };
  }

  // ---------------- VALIDATEURS (RESPONSABLE/DIRECTEUR/DAF/DGA/DG) ----------------
  const isValidator = ["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "ADMIN"].includes(role);

  let validator = [];
  if (isValidator) {
    // inclure aussi les validations reçues via délégation active
    const now = new Date();
    const dels = await prisma.delegations.findMany({
      where: {
        delegate_id: Number(agent.id),
        is_active: true,
        start_at: { lte: now },
        end_at: { gte: now },
      },
      select: { principal_id: true, role_name: true },
    });

    const delegatedOr = dels
      .filter((d) => d?.principal_id && d?.role_name)
      .map((d) => ({ validator_id: Number(d.principal_id), role_name: String(d.role_name) }));

    const where = {
      status: "en_attente",
      demandes_paiement: { is: { deleted_at: null, ...directionScopeWhere } },
      ...(delegatedOr.length > 0
        ? { OR: [{ validator_id: Number(agent.id) }, ...delegatedOr] }
        : { validator_id: Number(agent.id) }),
    };

    validator = await prisma.validation_steps.findMany({
      where,
      select: {
        id: true,
        demandes_paiement: { select: { id: true, uuid: true, montant: true, created_at: true, statut: true } },
      },
      orderBy: { id: "desc" },
    });
  }

  const pendingDemandes = validator
    .map((s) => s?.demandes_paiement)
    .filter(Boolean);

  const pending = {
    count: pendingDemandes.length,
    montant: pendingDemandes.reduce((acc, d) => acc + toNumber(d?.montant), 0),
    aging: computeAgingBuckets(pendingDemandes),
  };

  // ---------------- COMPTA (COMPTABLE + DAF) ----------------
  const isCompta = ["COMPTABLE", "DAF", "ADMIN"].includes(role);

  let compta = null;
  if (isCompta) {
    const payableWhere = {
      deleted_at: null,
      statut: { in: ["approuvee", "receptionnee"] },
      paiements: { none: {} },
      validation_steps: {
        none: {
          status: { in: ["en_attente", "bloque", "rejete"] },
        },
      },
      ...directionScopeWhere,
    };

    const payableAgg = await prisma.demandes_paiement.aggregate({
      where: payableWhere,
      _count: { _all: true },
      _sum: { montant: true },
    });

    const paiementsByMoyen = await prisma.paiements.groupBy({
      by: ["moyen_paiement"],
      where: { date_paiement: { gte: period.from, lte: period.to }, ...paiementsScopeWhere },
      _count: { _all: true },
      _sum: { montant: true },
      orderBy: { _sum: { montant: "desc" } },
    });

    compta = {
      payable: {
        count: payableAgg._count?._all || 0,
        montant: toNumber(payableAgg._sum?.montant),
      },
      paiementsByMoyen: paiementsByMoyen.map((r) => ({
        moyen_paiement: r.moyen_paiement || "(inconnu)",
        count: r._count?._all || 0,
        montant: toNumber(r._sum?.montant),
      })),
      exceptions: {
        payeSansReception: await prisma.demandes_paiement.count({
          where: { deleted_at: null, statut: "paye", ...directionScopeWhere },
        }),
        receptionSansPaiement: await prisma.demandes_paiement.count({
          where: { deleted_at: null, statut: "receptionnee", ...directionScopeWhere },
        }),
      },
    };
  }

  // ---------------- EXEC (DG/DGA) ----------------
  const isExec = ["DG", "DGA", "ADMIN"].includes(role);
  let exec = null;
  if (isExec) {
    const demandesAgg = await prisma.demandes_paiement.aggregate({
      where: { deleted_at: null, created_at: { gte: period.from, lte: period.to }, ...directionScopeWhere },
      _count: { _all: true },
      _sum: { montant: true },
    });

    const paiementsAgg = await prisma.paiements.aggregate({
      where: { date_paiement: { gte: period.from, lte: period.to }, ...paiementsScopeWhere },
      _count: { _all: true },
      _sum: { montant: true },
    });

    const topBeneficiaires = await prisma.demandes_paiement.groupBy({
      by: ["beneficiaire"],
      where: { deleted_at: null, created_at: { gte: period.from, lte: period.to }, ...directionScopeWhere },
      _count: { _all: true },
      _sum: { montant: true },
      orderBy: { _sum: { montant: "desc" } },
      take: 10,
    });

    exec = {
      demandes: {
        count: demandesAgg._count?._all || 0,
        montant: toNumber(demandesAgg._sum?.montant),
      },
      paiements: {
        count: paiementsAgg._count?._all || 0,
        montant: toNumber(paiementsAgg._sum?.montant),
      },
      topBeneficiaires: topBeneficiaires.map((r) => ({
        beneficiaire: r.beneficiaire,
        count: r._count?._all || 0,
        montant: toNumber(r._sum?.montant),
      })),
    };
  }

  return {
    ...base,
    global,
    admin,
    validator: isValidator ? { pending } : null,
    compta,
    exec,
  };
}

module.exports = {
  dashboard,
};
