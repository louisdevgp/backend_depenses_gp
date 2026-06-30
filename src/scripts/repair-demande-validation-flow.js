const { PrismaClient } = require("@prisma/client");
const { randomUUID: uuidv4 } = require("crypto");

const prisma = new PrismaClient();

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeValidationStopRole(value) {
  const role = normalizeRoleName(value);
  return ["DAF", "DGA", "DG"].includes(role) ? role : null;
}

function toStageStatus(roleName) {
  return `validation_${String(roleName || "").trim().toLowerCase()}`;
}

function resolveHierarchyLevel(agent) {
  if (agent?.service_id) return "SERVICE";
  if (agent?.departement_id) return "DEPARTEMENT";
  if (agent?.direction_id) return "DIRECTION";
  return "UNKNOWN";
}

function flowCodeForHierarchy(level) {
  if (level === "SERVICE") return "FLOW_DEMANDEUR_LAMBDA";
  if (level === "DEPARTEMENT") return "FLOW_RESPONSABLE";
  if (level === "DIRECTION") return "FLOW_DIRECTEUR";
  return "FLOW_DEMANDEUR_LAMBDA";
}

function flowCodeForAgent(agent) {
  const role = normalizeRoleName(agent?.roles?.name);
  if (role === "ASSISTANTE_TECHNIQUE") return "FLOW_ASSISTANTE_TECHNIQUE";
  return flowCodeForHierarchy(resolveHierarchyLevel(agent));
}

async function resolveHierarchyChain(tx, demande) {
  const demandeurId = demande?.demandeur_id ? Number(demande.demandeur_id) : null;
  if (!demandeurId) return { demandeur: null, responsable: null, directeur: null };

  const demandeur = await tx.agents.findFirst({
    where: { id: demandeurId, deleted_at: null },
    select: {
      id: true,
      service_id: true,
      departement_id: true,
      direction_id: true,
      manager_id: true,
      roles: { select: { name: true } },
    },
  });
  if (!demandeur) return { demandeur: null, responsable: null, directeur: null };

  let responsable = null;
  let directeur = null;

  if (demandeur.service_id) {
    if (!demandeur.manager_id) throw new Error("Responsable manquant: le demandeur n'a pas de manager.");
    const manager = await tx.agents.findFirst({
      where: { id: Number(demandeur.manager_id), deleted_at: null },
      select: { id: true, service_id: true, departement_id: true, direction_id: true, manager_id: true },
    });
    if (!manager) throw new Error("Responsable manquant: manager introuvable.");

    if (manager.departement_id) {
      responsable = manager;
      if (manager.manager_id) {
        directeur = await tx.agents.findFirst({
          where: { id: Number(manager.manager_id), deleted_at: null },
          select: { id: true, service_id: true, departement_id: true, direction_id: true, manager_id: true },
        });
      }
    } else if (manager.direction_id) {
      directeur = manager;
    } else if (manager.service_id) {
      throw new Error("Responsable invalide: manager au niveau service.");
    }
  } else if (demandeur.departement_id) {
    responsable = demandeur;
    if (demandeur.manager_id) {
      directeur = await tx.agents.findFirst({
        where: { id: Number(demandeur.manager_id), deleted_at: null },
        select: { id: true, service_id: true, departement_id: true, direction_id: true, manager_id: true },
      });
    }
  } else if (demandeur.direction_id) {
    if (normalizeRoleName(demandeur?.roles?.name) === "DIRECTEUR") directeur = demandeur;
  }

  return { demandeur, responsable, directeur };
}

async function resolveValidatorForRole(tx, roleName, demande) {
  const role = normalizeRoleName(roleName);
  const baseWhere = {
    deleted_at: null,
    OR: [
      { roles: { is: { name: role } } },
      { users: { user_roles: { some: { roles: { name: role } } } } },
    ],
  };

  if (["DIRECTEUR", "ASSISTANTE_TECHNIQUE"].includes(role)) {
    if (!demande?.direction_id) return null;
    return tx.agents.findFirst({
      where: { ...baseWhere, direction_id: Number(demande.direction_id) },
      orderBy: { id: "asc" },
    });
  }

  return tx.agents.findFirst({ where: baseWhere, orderBy: { id: "asc" } });
}

async function buildDesiredSteps(tx, demande, flow) {
  const flowSteps = await tx.validation_flow_steps.findMany({
    where: { flow_id: Number(flow.id) },
    orderBy: [{ step_order: "asc" }, { id: "asc" }],
  });

  const stopRole = normalizeValidationStopRole(demande.validation_stop_role);
  const filteredSteps =
    stopRole && flowSteps.length
      ? (() => {
          const idx = flowSteps.findIndex((s) => normalizeRoleName(s.role_name) === stopRole);
          return idx >= 0 ? flowSteps.slice(0, idx + 1) : flowSteps;
        })()
      : flowSteps;

  const hierarchy = await resolveHierarchyChain(tx, demande);
  const desired = [];

  for (const s of filteredSteps) {
    const role = normalizeRoleName(s.role_name);
    let validator = null;

    if (role === "RESPONSABLE") {
      validator = hierarchy.responsable || null;
      if (!validator) continue;
    } else if (role === "DIRECTEUR") {
      validator = hierarchy.directeur || (await resolveValidatorForRole(tx, role, demande));
    } else {
      validator = await resolveValidatorForRole(tx, role, demande);
    }

    if (!validator?.id) {
      if (s.required === false) continue;
      throw new Error(`Aucun validateur trouve pour le role ${role}`);
    }

    desired.push({
      level: desired.length + 1,
      role_name: role,
      validator_id: Number(validator.id),
      status: desired.length === 0 ? "en_attente" : "bloque",
    });
  }

  if (!desired.length) throw new Error("Aucune etape de validation calculee.");
  return desired;
}

function printSteps(title, steps) {
  console.log(`\n${title}`);
  console.table(
    (steps || []).map((s) => ({
      id: s.id || "-",
      level: s.level,
      role: s.role_name,
      status: s.status,
      validator_id: s.validator_id,
      validated_by_id: s.validated_by_id || "-",
      validated_at: s.validated_at || "-",
    }))
  );
}

async function main() {
  const idRaw = argValue("--id");
  const uuid = argValue("--uuid");
  const apply = hasFlag("--apply");
  const force = hasFlag("--force");

  if (!idRaw && !uuid) {
    throw new Error("Usage: npm run repair:validation-flow -- --uuid <demandeUuid> [--apply] [--force]");
  }

  const where = uuid ? { uuid: String(uuid) } : { id: Number(idRaw) };
  const demande = await prisma.demandes_paiement.findFirst({
    where,
    include: {
      agents_demandes_paiement_demandeur_idToagents: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          direction_id: true,
          departement_id: true,
          service_id: true,
          manager_id: true,
          roles: { select: { name: true } },
        },
      },
    },
  });

  if (!demande) throw new Error("Demande introuvable.");

  const currentSteps = await prisma.validation_steps.findMany({
    where: { demande_id: Number(demande.id) },
    orderBy: [{ level: "asc" }, { id: "asc" }],
  });

  const demandeur = demande.agents_demandes_paiement_demandeur_idToagents;
  const flowCode = flowCodeForAgent(demandeur);
  const flow = await prisma.validation_flows.findFirst({
    where: { code: flowCode, is_active: true },
    include: { validation_flow_steps: { orderBy: [{ step_order: "asc" }, { id: "asc" }] } },
  });
  if (!flow) throw new Error(`Flow introuvable: ${flowCode}`);

  const desiredSteps = await buildDesiredSteps(prisma, demande, flow);

  console.log("[repair-validation-flow] demande", {
    id: demande.id,
    uuid: demande.uuid,
    statut: demande.statut,
    demandeur_id: demande.demandeur_id,
    flowCode,
    flow_id: flow.id,
    apply,
    force,
  });
  printSteps("Etapes actuelles", currentSteps);
  printSteps("Etapes recalculees", desiredSteps);

  const engaged = currentSteps.some((s) => {
    const status = String(s.status || "").toLowerCase();
    return (
      !["en_attente", "bloque"].includes(status) ||
      s.validated_by_id ||
      s.validated_at ||
      s.signature_request_id ||
      s.signature_status ||
      s.signature_url
    );
  });

  const [paiementsCount, receptionsCount] = await Promise.all([
    prisma.paiements.count({ where: { demande_id: Number(demande.id) } }),
    prisma.receptions.count({ where: { demande_id: Number(demande.id) } }),
  ]);

  if ((engaged || paiementsCount > 0 || receptionsCount > 0) && !force) {
    throw new Error(
      `Reparation refusee: demande deja engagee (validated=${engaged}, paiements=${paiementsCount}, receptions=${receptionsCount}). Utiliser --force seulement apres validation metier.`
    );
  }

  if (!apply) {
    console.log("\nDRY-RUN uniquement. Pour appliquer:");
    console.log(`npm run repair:validation-flow -- --uuid ${demande.uuid} --apply`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.validation_steps.deleteMany({ where: { demande_id: Number(demande.id) } });
    await tx.validation_steps.createMany({
      data: desiredSteps.map((s) => ({
        uuid: uuidv4(),
        demande_id: Number(demande.id),
        level: Number(s.level),
        role_name: String(s.role_name),
        validator_id: Number(s.validator_id),
        status: String(s.status),
        validated_by_id: null,
        commentaire: null,
        signature_url: null,
        signature_provider: null,
        signature_request_id: null,
        signature_request_user_id: null,
        signature_status: null,
        signature_payload: null,
        validated_at: null,
      })),
    });

    await tx.demandes_paiement.update({
      where: { id: Number(demande.id) },
      data: {
        validation_flow_id: Number(flow.id),
        statut: toStageStatus(desiredSteps[0].role_name),
        updated_at: new Date(),
      },
    });
  });

  const after = await prisma.validation_steps.findMany({
    where: { demande_id: Number(demande.id) },
    orderBy: [{ level: "asc" }, { id: "asc" }],
  });
  printSteps("Etapes apres reparation", after);
  console.log("[repair-validation-flow] OK");
}

main()
  .catch((err) => {
    console.error("[repair-validation-flow] ERROR", err?.message || err);
    if (err?.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
