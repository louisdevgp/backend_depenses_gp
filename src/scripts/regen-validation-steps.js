require('dotenv').config({ path: '.env' });
const prisma = require('../config/prisma');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

function resolveHierarchyLevel(agent) {
  if (agent?.service_id) return 'SERVICE';
  if (agent?.departement_id) return 'DEPARTEMENT';
  if (agent?.direction_id) return 'DIRECTION';
  return 'UNKNOWN';
}

function flowCodeForHierarchy(level) {
  if (level === 'SERVICE') return 'FLOW_DEMANDEUR_LAMBDA';
  if (level === 'DEPARTEMENT') return 'FLOW_RESPONSABLE';
  if (level === 'DIRECTION') return 'FLOW_DIRECTEUR';
  return 'FLOW_DEMANDEUR_LAMBDA';
}

function flowCodeForAgent(agent) {
  const role = String(agent?.roles?.name || '').trim().toUpperCase();
  if (role === 'ASSISTANTE_TECHNIQUE') return 'FLOW_ASSISTANTE_TECHNIQUE';
  const level = resolveHierarchyLevel(agent);
  return flowCodeForHierarchy(level);
}

async function resolveValidationFlowForAgent(tx, agent) {
  const code = flowCodeForAgent(agent);

  let flow = await tx.validation_flows.findFirst({
    where: { code, is_active: true },
    include: { validation_flow_steps: { orderBy: { step_order: 'asc' } } },
  });
  if (flow) return flow;

  flow = await tx.validation_flows.findFirst({
    where: { is_active: true },
    include: { validation_flow_steps: { orderBy: { step_order: 'asc' } } },
  });
  if (!flow) throw new Error('Validation flow introuvable');
  return flow;
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
    if (!demandeur.manager_id) {
      throw new Error("Responsable manquant: le demandeur n'a pas de manager.");
    }
    const manager = await tx.agents.findFirst({
      where: { id: Number(demandeur.manager_id), deleted_at: null },
      select: { id: true, service_id: true, departement_id: true, direction_id: true, manager_id: true },
    });
    if (!manager) throw new Error('Responsable manquant: manager introuvable.');

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
      throw new Error('Responsable invalide: manager au niveau service.');
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
    const demandeurRole = String(demandeur?.roles?.name || '').trim().toUpperCase();
    if (demandeurRole === 'DIRECTEUR') directeur = demandeur;
  }

  return { demandeur, responsable, directeur };
}

async function resolveValidatorForRole(tx, roleName, demande) {
  const role = String(roleName || '').trim().toUpperCase();
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
      orderBy: { id: 'asc' },
    });
  }

  return tx.agents.findFirst({
    where: baseWhere,
    orderBy: { id: 'asc' },
  });
}

async function buildValidationSteps(tx, flow, demande) {
  const steps = await tx.validation_flow_steps.findMany({
    where: { flow_id: Number(flow.id) },
    orderBy: { step_order: 'asc' },
  });

  const hierarchy = await resolveHierarchyChain(tx, demande);

  const created = [];
  let isFirst = true;

  for (const s of steps) {
    const role = String(s.role_name || '').trim().toUpperCase();
    let validator = null;

    if (role === 'RESPONSABLE') {
      validator = hierarchy.responsable || null;
      if (!validator) continue;
    } else if (role === 'DIRECTEUR') {
      validator = hierarchy.directeur || (await resolveValidatorForRole(tx, role, demande));
    } else {
      validator = await resolveValidatorForRole(tx, role, demande);
    }

    const validator_id = validator?.id || null;
    if (!validator_id) {
      if (s.required === false) continue;
      throw new Error(`Aucun validateur trouve pour le role ${role}`);
    }

    const row = await tx.validation_steps.create({
      data: {
        uuid: require('uuid').v4(),
        demande_id: demande.id,
        level: s.step_order,
        role_name: s.role_name,
        validator_id,
        status: isFirst ? 'en_attente' : 'bloque',
        validated_by_id: null,
        commentaire: null,
        signature_url: null,
        validated_at: null,
      },
    });

    created.push(row);
    if (isFirst) isFirst = false;
  }

  if (!created.length) throw new Error('Aucun validateur disponible pour cette demande');
  return created;
}

function isEngaged(steps) {
  return (steps || []).some((s) => {
    const status = String(s.status || '').toLowerCase();
    const engagedStatus = status && !['en_attente', 'bloque'].includes(status);
    return engagedStatus || s.validated_by_id != null || s.validated_at != null;
  });
}

(async () => {
  const demandes = await prisma.demandes_paiement.findMany({
    where: { deleted_at: null },
    include: { validation_steps: true },
    orderBy: { id: 'asc' },
    take: LIMIT || undefined,
  });

  const summary = { total: demandes.length, processed: 0, skipped: 0, errors: 0 };
  for (const d of demandes) {
    if (!FORCE && isEngaged(d.validation_steps)) {
      summary.skipped += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const demandeur = await tx.agents.findFirst({
          where: { id: Number(d.demandeur_id), deleted_at: null },
          select: {
            id: true,
            service_id: true,
            departement_id: true,
            direction_id: true,
            manager_id: true,
            roles: { select: { name: true } },
          },
        });
        if (!demandeur) throw new Error('Demandeur introuvable');

        const flow = await resolveValidationFlowForAgent(tx, demandeur);

        if (!DRY_RUN) {
          await tx.validation_steps.deleteMany({ where: { demande_id: d.id } });
          if (d.validation_flow_id !== flow.id) {
            await tx.demandes_paiement.update({
              where: { id: d.id },
              data: { validation_flow_id: flow.id, updated_at: new Date() },
            });
          }
          await buildValidationSteps(tx, flow, d);
        }
      });
      summary.processed += 1;
    } catch (e) {
      summary.errors += 1;
      console.error('Erreur demande', d.id, d.uuid, e.message);
    }
  }

  console.log('Done', summary);
  await prisma.$disconnect();
})();
