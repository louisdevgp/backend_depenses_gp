const prisma = require("../config/prisma");
const notifications = require("./notifications.services");
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
      validationUuid: step.uuid || null,
      stage,
      demandeurUserId: demandeurUser?.id || null,
      role: step.role_name,
      nextValidatorUserId,
      nextValidatorAgentId,
      nextRole,
      nextStepId,
      nextStepUuid,
    };
  });

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
      commentaire,
    };
  });

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
      demandeurUserId: demandeurUser?.id || null,
      role: step.role_name,
      commentaire: commentaireTrimmed,
      previousRole: previous?.role_name || null,
      previousLevel: previous?.level || null,
    };
  });

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

async function cancelStep(stepId, userId, payload = {}) {
  const action = normalizeCancelAction(payload?.action ?? payload?.mode ?? payload?.type);
  const commentaireTrimmed = payload?.commentaire != null ? String(payload.commentaire).trim() : "";

  if (["return_for_modification", "cancel_demande"].includes(action) && !commentaireTrimmed) {
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
          commentaire: commentaireTrimmed || null,
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
      };
    }

    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "en_attente",
        validated_by_id: null,
        validated_at: null,
        signature_url: null,
        commentaire: commentaireTrimmed || null,
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
    };
  });

  try {
    if (result?.demandeurUserId) {
      const message =
        result.action === "cancel_demande"
          ? "Une validation a ete annulee et la demande a ete annulee."
          : result.action === "return_for_modification"
            ? "Une validation a ete annulee et la demande est retournee pour modification."
            : "Une validation a ete annulee.";

      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "validation_cancelled",
        demande_id: result.demandeId,
        message,
        meta: {
          stepId: result.stepId,
          demandeUuid: result.demandeUuid,
          action: result.action,
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
  getByUuid,
  getValidationsDoneBydemande,
  cancelStep,
};
