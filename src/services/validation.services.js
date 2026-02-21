const prisma = require("../config/prisma");
const notifications = require("./notifications.services");
const auditLogs = require("./auditLogs.services");
const { saveSignaturePngDataUrl } = require("./signatures.services");

function withStatusCode(err, statusCode) {
  err.statusCode = Number(statusCode);
  return err;
}

function isBoolean(v) {
  return typeof v === "boolean";
}

function normalizeBooleanLikeString(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (["true", "1", "oui", "yes"].includes(v)) return true;
  if (["false", "0", "non", "no"].includes(v)) return false;
  return null;
}

function normalizeDafCritere4(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const boolLike = normalizeBooleanLikeString(trimmed);
    if (boolLike === true) return "Oui";
    if (boolLike === false) return "Non";
    return trimmed;
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return value ? "Oui" : "Non";
  const fallback = String(value).trim();
  return fallback || null;
}

function getEnvAny(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function parseCsvUpper(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .map((s) => s.toUpperCase());
}

async function getPayeurUserIds() {
  const roleNames =
    parseCsvUpper(getEnvAny(["PAYEUR_NOTIFY_ROLES", "PAYEUR_ROLES_NOTIFY"])) || [];
  const roles = roleNames.length ? roleNames : ["DAF", "COMPTABLE", "CAISSE"];

  const rows = await prisma.user_roles.findMany({
    where: {
      roles: { name: { in: roles }, deleted_at: null, is_active: true },
      users: { is_active: true, deleted_at: null },
    },
    select: { user_id: true },
  });

  return Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
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

function candidateScopesForDemandeOrg(org) {
  const scopes = ["GLOBAL"];
  if (!org) return scopes;
  if (org.direction_id) scopes.push(`DIRECTION:${Number(org.direction_id)}`);
  if (org.departement_id) scopes.push(`DEPARTEMENT:${Number(org.departement_id)}`);
  if (org.service_id) scopes.push(`SERVICE:${Number(org.service_id)}`);
  return scopes;
}

function demandeWhereForScope(scopeRaw) {
  const parsed = parseScope(scopeRaw);
  if (!parsed || parsed.level === "GLOBAL") return null;
  if (parsed.level === "DIRECTION") return { direction_id: Number(parsed.id) };
  if (parsed.level === "DEPARTEMENT") return { departement_id: Number(parsed.id) };
  if (parsed.level === "SERVICE") return { service_id: Number(parsed.id) };
  return null;
}

function buildDemandeSnapshot(demande) {
  if (!demande) return null;
  const toPlainNumber = (value) => {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : String(value);
  };
  return {
    id: demande.id ?? null,
    uuid: demande.uuid ?? null,
    motif: demande.motif ?? null,
    montant: toPlainNumber(demande.montant),
    montant_net: toPlainNumber(demande.montant_net),
    beneficiaire: demande.beneficiaire ?? null,
  };
}

function normalizeCancelAction(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v || ["cancel", "annuler", "annulation"].includes(v)) return "cancel";
  if (
    [
      "return",
      "retour",
      "retour_modification",
      "return_for_modification",
      "modification",
      "a_modifier",
    ].includes(v)
  ) {
    return "return_for_modification";
  }
  if (
    [
      "cancel_demande",
      "annuler_demande",
      "annulation_demande",
      "demande_cancel",
      "delete_demande",
    ].includes(v)
  ) {
    return "cancel_demande";
  }
  return "cancel";
}

function statusFromAuditAction(action) {
  const a = String(action || "").toLowerCase();
  if (a === "validation_approved") return "valide";
  if (a === "validation_rejected") return "rejete";
  if (a === "validation_returned") return "retour_modification";
  if (a === "validation_cancelled") return "annulee";
  return null;
}

function toStageStatus(roleName) {
  return `validation_${String(roleName).toLowerCase()}`;
}

async function getAgentFromUserId(userId) {
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    include: { roles: true, users: true },
  });
}

async function canActByDelegation(tx, step, agent) {
  // agent peut agir si:
  // - il est validator_id
  // - OU il a une délégation active du principal validator_id sur le même role
  if (Number(step.validator_id) === Number(agent.id)) return true;

  // Scope (portée): la délégation doit couvrir la demande (GLOBAL, ou DIRECTION/DEPARTEMENT/SERVICE correspondants)
  const demandeOrg = await tx.demandes_paiement.findUnique({
    where: { id: Number(step.demande_id) },
    select: { direction_id: true, departement_id: true, service_id: true },
  });
  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);

  const now = new Date();
  const delegation = await tx.delegations.findFirst({
    where: {
      principal_id: Number(step.validator_id),
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: step.role_name,
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

async function setDemandeStageFromCurrentStep(tx, demandeId) {
  const current = await tx.validation_steps.findFirst({
    where: { demande_id: Number(demandeId), status: "en_attente" },
    orderBy: { level: "asc" },
  });

  if (!current) {
    await tx.demandes_paiement.update({
      where: { id: Number(demandeId) },
      data: { statut: "approuvee" },
    });
    return { statut: "approuvee" };
  }

  const newStatut = toStageStatus(current.role_name);
  await tx.demandes_paiement.update({
    where: { id: Number(demandeId) },
    data: { statut: newStatut },
  });

  return { statut: newStatut, current_role: current.role_name, current_level: current.level };
}

async function getPendingForUser(userId) {
  const agent = await getAgentFromUserId(userId);
  if (!agent) return [];

  // ✅ visibilité: steps "en_attente" où il est validator OU où il a une délégation active
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

  return prisma.validation_steps.findMany({
    where,
    include: {
      demandes_paiement: true,
      agents_validation_steps_validator_idToagents: { include: { users: { select: { email: true } } } },
      agents_validation_steps_validated_by_idToagents: { include: { users: { select: { email: true } } } },
    },
    orderBy: { id: "desc" },
  });
}


async function approveStep(stepId, userId, commentaire, signatureDataUrl = null, extra = {}) {
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";
  // On ignore la signatureDataUrl car on ne gère plus les signatures électroniques

  const result = await prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
      include: {
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    if (!step || step.status !== "en_attente") throw new Error("Étape invalide");

    const roleUpper = String(step.role_name || "").toUpperCase();

    const agent = await tx.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      include: { roles: true, users: true },
    });
    if (!agent || !agent.roles?.name) throw new Error("Non autorisé");

    // ✅ autorisation : validator_id OU délégation active
    const ok = await canActByDelegation(tx, step, agent);
    if (!ok) throw new Error("Non autorisé");

    // ✅ Contrôle DAF: champs obligatoires au moment de la validation DAF
    if (roleUpper === "DAF") {
      const { budget_prevu, budget_disponible, paiement_immediat, daf_critere4 } = extra || {};
      if (!isBoolean(budget_prevu) || !isBoolean(budget_disponible) || !isBoolean(paiement_immediat)) {
        throw withStatusCode(
          new Error(
            "Contrôle DAF incomplet: renseignez 'budget_prevu', 'budget_disponible', 'paiement_immediat' (booléens)"
          ),
          400
        );
      }

      // Pour le 4e critère, on accepte maintenant une chaîne (moyen de paiement) ou un booléen (legacy)
      const dafCritere4Value = normalizeDafCritere4(daf_critere4);
      if (!dafCritere4Value) {
        throw withStatusCode(
          new Error("Contrôle DAF incomplet: renseignez le moyen de paiement (critère 4)"),
          400
        );
      }

      await tx.demandes_paiement.update({
        where: { id: Number(step.demande_id) },
        data: {
          budget_prevu: Boolean(budget_prevu),
          budget_disponible: Boolean(budget_disponible),
          paiement_immediat: Boolean(paiement_immediat),
          daf_critere4: dafCritere4Value,
          updated_at: new Date(),
        },
      });
    }

    // Mise à jour de l'étape de validation sans signature
    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "valide",
        validated_by_id: agent.id,
        validated_at: new Date(),
        commentaire: commentaireTrimmed || null,
        // Plus de signature_url
        updated_at: new Date(),
      },
    });

    // ✅ débloquer le next step
    const next = await tx.validation_steps.findFirst({
      where: { demande_id: step.demande_id, level: step.level + 1 },
    });

    if (next && next.status === "bloque") {
      await tx.validation_steps.update({
        where: { id: next.id },
        data: { status: "en_attente", updated_at: new Date() },
      });
    }

    const stage = await setDemandeStageFromCurrentStep(tx, step.demande_id);

    const demandeurUser = step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;

    let nextValidatorUserId = null;
    let nextStepId = null;
    let nextStepUuid = null;
    let nextRole = null;
    let nextValidatorAgentId = null;

    if (next) {
      const unlocked = await tx.validation_steps.findUnique({ where: { id: next.id } });
      if (unlocked?.status === "en_attente" && unlocked.validator_id) {
        nextStepId = unlocked.id;
        nextStepUuid = unlocked.uuid || null;
        nextRole = unlocked.role_name;
        nextValidatorAgentId = unlocked.validator_id;
        const nextValidator = await tx.agents.findUnique({
          where: { id: unlocked.validator_id },
          include: { users: true },
        });
        if (nextValidator?.users?.id) nextValidatorUserId = nextValidator.users.id;
      }
    }

    return {
      stepId: step.id,
      demandeId: step.demande_id,
      demandeUuid: step.demandes_paiement?.uuid || null,
      demandeOrg: {
        direction_id: step.demandes_paiement?.direction_id || null,
        departement_id: step.demandes_paiement?.departement_id || null,
        service_id: step.demandes_paiement?.service_id || null,
      },
      demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
      validationUuid: step.uuid || null,
      stage,
      demandeurUserId: demandeurUser?.id || null,
      role: step.role_name,
      commentaire: commentaireTrimmed || null,
      nextValidatorUserId,
      nextValidatorAgentId,
      nextRole,
      nextStepId,
      nextStepUuid,
    };
  });

  try {
    await auditLogs.logAudit({
      userId,
      entity_type: "validation_steps",
      entity_id: result.stepId,
      action: "validation_approved",
      old_value: null,
      new_value: {
        action: "approved",
        status: "valide",
        step_id: result.stepId,
        step_uuid: result.validationUuid || null,
        role_name: result.role || null,
        demande_id: result.demandeId,
        demande_uuid: result.demandeUuid || null,
        commentaire: result.commentaire || null,
        demande_motif: result.demandeSnapshot?.motif ?? null,
        demande_montant: result.demandeSnapshot?.montant ?? null,
        demande_montant_net: result.demandeSnapshot?.montant_net ?? null,
        demande_beneficiaire: result.demandeSnapshot?.beneficiaire ?? null,
      },
    });
  } catch {
    // ignore audit errors
  }

  // Notifications after commit (safe for email)
  try {
    if (result?.demandeurUserId) {
      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "validation_step_approved",
        demande_id: result.demandeId,
        message: `Votre demande a été validée (${result.role}). Statut: ${result.stage?.statut}`,
        meta: { stepId: result.stepId, role: result.role, demandeUuid: result.demandeUuid, validationUuid: result.validationUuid },
        sendEmailNow: true,
      });
    }

    if (result?.nextValidatorUserId) {
      await notifications.createNotification({
        user_id: result.nextValidatorUserId,
        type: "validation_pending",
        demande_id: result.demandeId,
        message: `Une demande est en attente de votre validation (${result.nextRole}).`,
        meta: { stepId: result.nextStepId, role: result.nextRole, demandeUuid: result.demandeUuid, validationUuid: result.nextStepUuid },
        sendEmailNow: true,
      });
    }

    // ✅ notifier aussi les délégués actifs du prochain validateur (même role)
    if (result?.nextValidatorAgentId && result?.nextRole) {
      const now = new Date();
      const candidateScopes = candidateScopesForDemandeOrg(result?.demandeOrg);
      const delegates = await prisma.delegations.findMany({
        where: {
          principal_id: Number(result.nextValidatorAgentId),
          is_active: true,
          start_at: { lte: now },
          end_at: { gte: now },
          role_name: String(result.nextRole),
          OR: [{ scope: null }, { scope: { in: candidateScopes } }],
        },
        select: { delegate_id: true },
      });

      const delegateIds = Array.from(new Set(delegates.map((d) => d.delegate_id).filter(Boolean)));
      if (delegateIds.length > 0) {
        const delegateAgents = await prisma.agents.findMany({
          where: { id: { in: delegateIds } },
          select: { users: { select: { id: true } } },
        });
        const delegateUserIds = Array.from(
          new Set(delegateAgents.map((a) => a?.users?.id).filter(Boolean))
        ).filter((id) => id !== result.nextValidatorUserId);

        for (const uid of delegateUserIds) {
          await notifications.createNotification({
            user_id: uid,
            type: "validation_pending",
            demande_id: result.demandeId,
            message: `Une demande est en attente de validation (délégation: ${result.nextRole}).`,
            meta: { stepId: result.nextStepId, role: result.nextRole, delegated: true, demandeUuid: result.demandeUuid, validationUuid: result.nextStepUuid },
            sendEmailNow: true,
          });
        }
      }
    }

    // ✅ Demande entièrement approuvée => informer les payeurs (DAF/COMPTABLE)
    if (result?.stage?.statut === "approuvee" && result?.demandeId) {
      const payeurUserIds = await getPayeurUserIds();
      if (payeurUserIds.length > 0) {
        const demande = await prisma.demandes_paiement.findUnique({
          where: { id: Number(result.demandeId) },
          select: { uuid: true, motif: true, montant: true, devise: true, beneficiaire: true },
        });

        const demandeUuid = demande?.uuid || result.demandeUuid || null;
        const labelMontant = demande?.montant != null ? String(demande.montant) : "";
        const devise = demande?.devise ? String(demande.devise) : "";
        const message = `Une demande est maintenant approuvée et peut être payée.${demandeUuid ? ` UUID: ${demandeUuid}.` : ""}${
          demande?.motif ? ` Motif: ${String(demande.motif)}` : ""
        }${labelMontant ? ` — Montant: ${labelMontant}${devise ? ` ${devise}` : ""}` : ""}`;

        for (const uid of payeurUserIds) {
          if (uid === result.demandeurUserId) continue;
          await notifications.createNotification({
            user_id: uid,
            type: "paiement_pending",
            demande_id: result.demandeId,
            message,
            meta: {
              demandeUuid,
              motif: demande?.motif || null,
              montant: demande?.montant != null ? String(demande.montant) : null,
              devise: demande?.devise || null,
              beneficiaire: demande?.beneficiaire || null,
            },
            sendEmailNow: true,
          });
        }
      }
    }
  } catch {
    // ignore email errors
  }

  return { stepId: result.stepId, demandeId: result.demandeId, stage: result.stage };
}

async function rejectStep(stepId, userId, commentaire) {
  const result = await prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
      include: {
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    if (!step || step.status !== "en_attente") throw new Error("Étape invalide");

    const agent = await tx.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      include: { roles: true, users: true },
    });
    if (!agent || !agent.roles?.name) throw new Error("Non autorisé");

    const ok = await canActByDelegation(tx, step, agent);
    if (!ok) throw new Error("Non autorisé");

    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "rejete",
        validated_by_id: agent.id,
        commentaire,
        validated_at: new Date(),
        updated_at: new Date(),
      },
    });

    await tx.demandes_paiement.update({
      where: { id: step.demande_id },
      data: { statut: "rejete" },
    });

    const demandeurUser = step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;
    return {
      rejected: true,
      stepId: step.id,
      demandeId: step.demande_id,
      demandeUuid: step.demandes_paiement?.uuid || null,
      validationUuid: step.uuid || null,
      demandeurUserId: demandeurUser?.id || null,
      role: step.role_name,
      demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
      commentaire,
    };
  });

  try {
    await auditLogs.logAudit({
      userId,
      entity_type: "validation_steps",
      entity_id: result.stepId,
      action: "validation_rejected",
      old_value: null,
      new_value: {
        action: "rejected",
        status: "rejete",
        step_id: result.stepId,
        step_uuid: result.validationUuid || null,
        role_name: result.role || null,
        demande_id: result.demandeId,
        demande_uuid: result.demandeUuid || null,
        commentaire: result.commentaire || null,
        demande_motif: result.demandeSnapshot?.motif ?? null,
        demande_montant: result.demandeSnapshot?.montant ?? null,
        demande_montant_net: result.demandeSnapshot?.montant_net ?? null,
        demande_beneficiaire: result.demandeSnapshot?.beneficiaire ?? null,
      },
    });
  } catch {
    // ignore audit errors
  }

  try {
    if (result?.demandeurUserId) {
      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "validation_rejected",
        demande_id: result.demandeId,
        message: `Votre demande a été rejetée par ${result.role}. Motif: ${result.commentaire}`,
        meta: { stepId: result.stepId, role: result.role, demandeUuid: result.demandeUuid, validationUuid: result.validationUuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  return { rejected: true, stepId: result.stepId, demandeId: result.demandeId };
}

async function returnForModification(stepId, userId, commentaire) {
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";
  if (!commentaireTrimmed) throw withStatusCode(new Error("Commentaire obligatoire"), 400);

  const result = await prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
      include: {
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    if (!step || step.status !== "en_attente") throw withStatusCode(new Error("Étape invalide"), 400);
    const stepLevel = Number(step.level || 0);
    if (!stepLevel) {
      throw withStatusCode(new Error("Étape invalide"), 400);
    }

    const agent = await tx.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      include: { roles: true, users: true },
    });
    if (!agent || !agent.roles?.name) throw withStatusCode(new Error("Non autorisé"), 403);

    const ok = await canActByDelegation(tx, step, agent);
    if (!ok) throw withStatusCode(new Error("Non autorisé"), 403);

    const previous =
      stepLevel > 1
        ? await tx.validation_steps.findFirst({
            where: { demande_id: Number(step.demande_id), level: stepLevel - 1 },
          })
        : null;
    if (stepLevel > 1 && !previous) throw withStatusCode(new Error("Étape précédente introuvable"), 400);

    // 1) Marquer l'étape courante comme "retour_modification" (on garde le motif)
    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "retour_modification",
        commentaire: commentaireTrimmed,
        updated_at: new Date(),
      },
    });

    // 2) Forcer la re-validation de l'étape N-1 (elle sera rouverte après correction)
    if (previous) {
      await tx.validation_steps.update({
        where: { id: previous.id },
        data: {
          status: "bloque",
          validated_by_id: null,
          validated_at: null,
          signature_url: null,
          commentaire: null,
          updated_at: new Date(),
        },
      });
    }

    // 3) Bloquer les étapes suivantes (sécurité)
    await tx.validation_steps.updateMany({
      where: { demande_id: Number(step.demande_id), level: { gt: Number(step.level) } },
      data: { status: "bloque", updated_at: new Date() },
    });

    // 4) Passer la demande en "a_modifier" (éditable par le demandeur)
    await tx.demandes_paiement.update({
      where: { id: Number(step.demande_id) },
      data: { statut: "a_modifier", updated_at: new Date() },
    });

    const demandeurUser = step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;
    return {
      returned: true,
      stepId: step.id,
      demandeId: step.demande_id,
      demandeUuid: step.demandes_paiement?.uuid || null,
      validationUuid: step.uuid || null,
      demandeurUserId: demandeurUser?.id || null,
      role: step.role_name,
      demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
      commentaire: commentaireTrimmed,
      previousRole: previous?.role_name || null,
      previousLevel: previous?.level || null,
    };
  });

  try {
    await auditLogs.logAudit({
      userId,
      entity_type: "validation_steps",
      entity_id: result.stepId,
      action: "validation_returned",
      old_value: null,
      new_value: {
        action: "return_for_modification",
        status: "retour_modification",
        step_id: result.stepId,
        step_uuid: result.validationUuid || null,
        role_name: result.role || null,
        demande_id: result.demandeId,
        demande_uuid: result.demandeUuid || null,
        commentaire: result.commentaire || null,
        demande_motif: result.demandeSnapshot?.motif ?? null,
        demande_montant: result.demandeSnapshot?.montant ?? null,
        demande_montant_net: result.demandeSnapshot?.montant_net ?? null,
        demande_beneficiaire: result.demandeSnapshot?.beneficiaire ?? null,
      },
    });
  } catch {
    // ignore audit errors
  }

  try {
    if (result?.demandeurUserId) {
      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "demande_returned_for_modification",
        demande_id: result.demandeId,
        message: `Votre demande a été retournée pour modification (${result.role}). Motif: ${result.commentaire}`,
        meta: {
          demandeUuid: result.demandeUuid,
          fromRole: result.role,
          previousRole: result.previousRole,
          previousLevel: result.previousLevel,
          commentaire: result.commentaire,
        },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  return { returned: true, stepId: result.stepId, demandeId: result.demandeId };
}

async function getStepsByDemande(demandeId) {
  return prisma.validation_steps.findMany({
    where: { demande_id: Number(demandeId) },
    orderBy: { level: "asc" },
    include: {
      agents_validation_steps_validator_idToagents: { include: { users: { select: { email: true } } } },
      agents_validation_steps_validated_by_idToagents: { include: { users: { select: { email: true } } } },
    },
  });
}

async function getValidationsDoneBydemande(demandeIdOrUuid) {
  const demande = await prisma.demandes_paiement.findFirst({
    where: {
      OR: [{ id: Number(demandeIdOrUuid) || -1 }, { uuid: String(demandeIdOrUuid) }],
    },
    select: { id: true },
  });
  if (!demande) return [];

  return prisma.validation_steps.findMany({
    where: { demande_id: demande.id, status: "valide", demandes_paiement: { is: { deleted_at: null } } },
    include: {
      demandes_paiement: true,
      agents_validation_steps_validator_idToagents: { include: { users: { select: { email: true } } } },
      agents_validation_steps_validated_by_idToagents: { include: { users: { select: { email: true } } } },
    },
    orderBy: { validated_at: "desc" },
  });
}

async function validationDone(userId) {
  const agent = await getAgentFromUserId(userId);
  if (!agent) return [];

  return prisma.validation_steps.findMany({
    where: { validated_by_id: agent.id, status: "valide", demandes_paiement: { is: { deleted_at: null } } },
    orderBy: { validated_at: "desc" },
    include: {
      demandes_paiement: true,
      agents_validation_steps_validator_idToagents: { include: { users: { select: { email: true } } } },
      agents_validation_steps_validated_by_idToagents: { include: { users: { select: { email: true } } } },
    },
  });
}

async function getByUuid(uuid) {
  return prisma.validation_steps.findFirst({
    where: { uuid: String(uuid), demandes_paiement: { is: { deleted_at: null } } },
    include: {
      demandes_paiement: { include: { documents: true } },
      agents_validation_steps_validator_idToagents: { include: { users: { select: { email: true } } } },
      agents_validation_steps_validated_by_idToagents: { include: { users: { select: { email: true } } } },
    },
  });
}

async function validationHistory(userId, options = {}) {
  const takeRaw = options?.take;
  const take = Number.isFinite(Number(takeRaw)) ? Number(takeRaw) : 200;

  const logs = await prisma.audit_logs.findMany({
    where: {
      user_id: Number(userId),
      entity_type: "validation_steps",
    },
    orderBy: { created_at: "desc" },
    take,
  });

  if (!logs.length) return [];

  let entries = logs.map((log) => {
    const nv = log?.new_value && typeof log.new_value === "object" ? log.new_value : {};
    const stepIdRaw = nv.step_id ?? log.entity_id;
    const stepId = stepIdRaw != null ? Number(stepIdRaw) : null;
    const status = nv.status || statusFromAuditAction(log.action) || null;
    const demande =
      nv.demande_uuid || nv.demande_motif || nv.demande_montant != null
        ? {
            uuid: nv.demande_uuid ?? null,
            motif: nv.demande_motif ?? null,
            montant: nv.demande_montant ?? null,
            montant_net: nv.demande_montant_net ?? null,
            beneficiaire: nv.demande_beneficiaire ?? null,
          }
        : null;

    return {
      audit_id: log.id,
      step_id: stepId,
      id: stepId,
      uuid: nv.step_uuid ?? null,
      role_name: nv.role_name ?? null,
      status,
      action: nv.action ?? log.action ?? null,
      cancel_mode: nv.cancel_mode ?? null,
      commentaire: nv.commentaire ?? null,
      validated_at: log.created_at,
      demande_id: nv.demande_id != null ? Number(nv.demande_id) : null,
      demande_uuid: nv.demande_uuid ?? null,
      demande,
    };
  });

  const stepIdsRaw = Array.from(new Set(entries.map((e) => e.step_id).filter(Boolean)));
  if (stepIdsRaw.length > 0) {
    const steps = await prisma.validation_steps.findMany({
      where: { id: { in: stepIdsRaw }, demandes_paiement: { is: { deleted_at: null } } },
      select: { id: true, demande_id: true, level: true, status: true },
    });
    const stepMap = new Map(steps.map((s) => [Number(s.id), s]));
    const existingIds = new Set(Array.from(stepMap.keys()));
    const demandeIds = Array.from(new Set(steps.map((s) => s.demande_id).filter((v) => v != null)));
    const demandes =
      demandeIds.length > 0
        ? await prisma.demandes_paiement.findMany({
            where: { id: { in: demandeIds }, deleted_at: null },
            select: { id: true, uuid: true },
          })
        : [];
    const demandeUuidById = new Map(demandes.map((d) => [Number(d.id), String(d.uuid)]));

    entries = entries.filter((e) => {
      if (!e.step_id || !existingIds.has(Number(e.step_id))) return false;
      const step = stepMap.get(Number(e.step_id));
      if (!step) return false;
      if (e.demande_id == null) return false;
      if (Number(e.demande_id) !== Number(step.demande_id)) return false;
      const expectedUuid = demandeUuidById.get(Number(step.demande_id));
      if (!expectedUuid) return false;
      if (!e.demande_uuid) return false;
      return String(e.demande_uuid) === String(expectedUuid);
    });
    if (!entries.length) return [];

    const validatedSteps =
      demandeIds.length > 0
        ? await prisma.validation_steps.findMany({
            where: { demande_id: { in: demandeIds }, status: "valide" },
            select: { demande_id: true, level: true },
          })
        : [];

    const maxValidatedLevelByDemande = new Map();
    for (const vs of validatedSteps) {
      const did = Number(vs.demande_id);
      const lvl = Number(vs.level);
      if (!Number.isFinite(lvl)) continue;
      const current = maxValidatedLevelByDemande.get(did);
      if (current == null || lvl > current) {
        maxValidatedLevelByDemande.set(did, lvl);
      }
    }

    for (const entry of entries) {
      const step = entry.step_id ? stepMap.get(Number(entry.step_id)) : null;
      if (!step) continue;
      const maxLevel = maxValidatedLevelByDemande.get(Number(step.demande_id));
      const isCurrent =
        String(step.status || "").toLowerCase() === "valide" &&
        Number.isFinite(Number(maxLevel)) &&
        Number(step.level) === Number(maxLevel);
      entry.can_cancel = !!isCurrent;
      entry.current_status = step.status || null;
    }
  }

  return entries;
}

async function validationHistoryByDemandeId(demandeId, options = {}) {
  const takeRaw = options?.take;
  const take = Number.isFinite(Number(takeRaw)) ? Number(takeRaw) : 500;
  const demandeIdNum = Number(demandeId);
  const demandeUuid =
    options?.demandeUuid != null && String(options.demandeUuid).trim()
      ? String(options.demandeUuid).trim()
      : null;

  const steps = await prisma.validation_steps.findMany({
    where: { demande_id: demandeIdNum },
    select: { id: true, level: true, status: true, role_name: true },
  });

  if (!steps.length) return [];

  const stepMap = new Map(steps.map((s) => [Number(s.id), s]));
  const stepIds = steps.map((s) => Number(s.id)).filter(Boolean);

  const logsRaw = await prisma.audit_logs.findMany({
    where: {
      entity_type: "validation_steps",
      entity_id: { in: stepIds },
    },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take,
  });

  const logs = logsRaw.filter((log) => {
    const nv = log?.new_value && typeof log.new_value === "object" ? log.new_value : null;
    if (!nv) return false;
    if (demandeUuid && nv.demande_uuid && String(nv.demande_uuid) === demandeUuid) return true;
    return false;
  });

  if (!logs.length) return [];

  const actorUserIds = Array.from(
    new Set(logs.map((l) => (l.user_id != null ? Number(l.user_id) : null)).filter(Boolean))
  );

  const actors =
    actorUserIds.length > 0
      ? await prisma.agents.findMany({
          where: { user_id: { in: actorUserIds } },
          include: { users: true },
        })
      : [];

  const actorByUserId = new Map(actors.map((a) => [Number(a.user_id), a]));

  const actorNameFromAgent = (agent) => {
    if (!agent) return null;
    const prenom = agent?.prenom ? String(agent.prenom).trim() : "";
    const nom = agent?.nom ? String(agent.nom).trim() : "";
    const full = `${prenom} ${nom}`.trim();
    if (full) return full;
    const email = agent?.users?.email ? String(agent.users.email).trim() : "";
    return email || null;
  };

  return logs.map((log) => {
    const nv = log?.new_value && typeof log.new_value === "object" ? log.new_value : {};
    const stepIdRaw = nv.step_id ?? log.entity_id;
    const stepId = stepIdRaw != null ? Number(stepIdRaw) : null;
    const step = stepId != null ? stepMap.get(Number(stepId)) : null;
    const status = nv.status || statusFromAuditAction(log.action) || null;
    const roleName = nv.role_name || step?.role_name || null;
    const actorUserId = log?.user_id != null ? Number(log.user_id) : null;
    const actorAgent = actorUserId != null ? actorByUserId.get(actorUserId) : null;
    const actorName = actorNameFromAgent(actorAgent);

    return {
      audit_id: log.id,
      step_id: stepId,
      uuid: nv.step_uuid ?? null,
      role_name: roleName,
      level: step?.level ?? null,
      status,
      action: nv.action ?? log.action ?? null,
      cancel_mode: nv.cancel_mode ?? null,
      commentaire: nv.commentaire ?? null,
      actor_user_id: actorUserId,
      actor_name: actorName,
      created_at: log.created_at,
    };
  });
}

async function cancelStep(stepId, userId, payload = {}) {
  const action = normalizeCancelAction(payload?.action ?? payload?.mode ?? payload?.type);
  const commentaireTrimmed = payload?.commentaire != null ? String(payload.commentaire).trim() : "";

  if (!commentaireTrimmed) {
    throw withStatusCode(new Error("Commentaire obligatoire"), 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const step = await tx.validation_steps.findUnique({
      where: { id: Number(stepId) },
      include: {
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    if (!step) throw withStatusCode(new Error("Etape introuvable"), 404);
    if (step.status !== "valide") throw withStatusCode(new Error("Etape non annulable"), 409);

    const laterValidated = await tx.validation_steps.count({
      where: {
        demande_id: Number(step.demande_id),
        level: { gt: Number(step.level) },
        status: "valide",
      },
    });
    if (laterValidated > 0) {
      throw withStatusCode(new Error("Annulation impossible: validation superieure deja effectuee"), 409);
    }

    const agent = await getAgentFromUserId(userId);
    if (!agent || !agent.roles?.name) throw withStatusCode(new Error("Non autorise"), 403);

    const canSelf = await canActByDelegation(tx, step, agent);
    let canByNext = false;
    let nextStep = null;

    if (!canSelf) {
      nextStep = await tx.validation_steps.findFirst({
        where: { demande_id: Number(step.demande_id), level: Number(step.level) + 1 },
      });
      if (nextStep && String(nextStep.status || "").toLowerCase() !== "valide") {
        canByNext = await canActByDelegation(tx, nextStep, agent);
      }
    }

    if (!canSelf && !canByNext) {
      throw withStatusCode(new Error("Non autorise"), 403);
    }

    await tx.validation_steps.updateMany({
      where: { demande_id: Number(step.demande_id), level: { gt: Number(step.level) } },
      data: { status: "bloque", updated_at: new Date() },
    });

    if (action === "return_for_modification") {
      await tx.validation_steps.update({
        where: { id: step.id },
        data: {
          status: "retour_modification",
          commentaire: commentaireTrimmed,
          updated_at: new Date(),
        },
      });

      if (Number(step.level) > 1) {
        const previous = await tx.validation_steps.findFirst({
          where: { demande_id: Number(step.demande_id), level: Number(step.level) - 1 },
        });
        if (previous) {
          await tx.validation_steps.update({
            where: { id: previous.id },
            data: {
              status: "bloque",
              validated_by_id: null,
              validated_at: null,
              signature_url: null,
              commentaire: null,
              updated_at: new Date(),
            },
          });
        }
      }

      await tx.demandes_paiement.update({
        where: { id: Number(step.demande_id) },
        data: { statut: "a_modifier", updated_at: new Date() },
      });

      return {
        action,
        stepId: step.id,
        demandeId: step.demande_id,
        demandeUuid: step.demandes_paiement?.uuid || null,
        demandeurUserId: step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null,
        validationUuid: step.uuid || null,
        role: step.role_name,
        demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
        commentaire: commentaireTrimmed,
      };
    }

    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "en_attente",
        validated_by_id: null,
        validated_at: null,
        signature_url: null,
        commentaire: commentaireTrimmed,
        updated_at: new Date(),
      },
    });

    if (action === "cancel_demande") {
      await tx.demandes_paiement.update({
        where: { id: Number(step.demande_id) },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });

      return {
        action,
        stepId: step.id,
        demandeId: step.demande_id,
        demandeUuid: step.demandes_paiement?.uuid || null,
        demandeurUserId: step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null,
        validationUuid: step.uuid || null,
        role: step.role_name,
        demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
        commentaire: commentaireTrimmed,
      };
    }

    const stage = await setDemandeStageFromCurrentStep(tx, step.demande_id);

    return {
      action,
      stepId: step.id,
      demandeId: step.demande_id,
      demandeUuid: step.demandes_paiement?.uuid || null,
      demandeurUserId: step.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null,
      stage,
      validationUuid: step.uuid || null,
      role: step.role_name,
      demandeSnapshot: buildDemandeSnapshot(step.demandes_paiement),
      commentaire: commentaireTrimmed,
    };
  });

  try {
    const status =
      result.action === "return_for_modification"
        ? "retour_modification"
        : "annulee";
    await auditLogs.logAudit({
      userId,
      entity_type: "validation_steps",
      entity_id: result.stepId,
      action: "validation_cancelled",
      old_value: null,
      new_value: {
        action: "cancel",
        cancel_mode: result.action,
        status,
        step_id: result.stepId,
        step_uuid: result.validationUuid || null,
        role_name: result.role || null,
        demande_id: result.demandeId,
        demande_uuid: result.demandeUuid || null,
        commentaire: result.commentaire || null,
        demande_motif: result.demandeSnapshot?.motif ?? null,
        demande_montant: result.demandeSnapshot?.montant ?? null,
        demande_montant_net: result.demandeSnapshot?.montant_net ?? null,
        demande_beneficiaire: result.demandeSnapshot?.beneficiaire ?? null,
      },
    });
  } catch {
    // ignore audit errors
  }

  try {
    if (result?.demandeurUserId) {
      const commentaireInfo = result?.commentaire ? ` Motif: ${result.commentaire}` : "";
      const message =
        result.action === "cancel_demande"
          ? `Une validation a ete annulee et la demande a ete annulee.${commentaireInfo}`
          : result.action === "return_for_modification"
            ? `Une validation a ete annulee et la demande est retournee pour modification.${commentaireInfo}`
            : `Une validation a ete annulee.${commentaireInfo}`;

      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "validation_cancelled",
        demande_id: result.demandeId,
        message,
        meta: {
          stepId: result.stepId,
          demandeUuid: result.demandeUuid,
          action: result.action,
          commentaire: result.commentaire || null,
        },
        sendEmailNow: false,
      });
    }
  } catch {
    // ignore notification errors
  }

  return result;
}

module.exports = {
  getPendingForUser,
  approveStep,
  rejectStep,
  returnForModification,
  getStepsByDemande,
  validationDone,
  validationHistory,
  validationHistoryByDemandeId,
  getByUuid,
  getValidationsDoneBydemande,
  cancelStep,
};
