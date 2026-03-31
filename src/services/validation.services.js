const prisma = require("../config/prisma");
const notifications = require("./notifications.services");
const auditLogs = require("./auditLogs.services");
const { v4: uuidv4 } = require("uuid");
const realtime = require("../realtime");
const PDFDocument = require("pdfkit");
const firma = require("./firma.services");

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

function normalizePaiementMode(value) {
  if (!value) return null;
  const v = String(value).replace(/\s/g, "");
  if (["70/30", "50/50", "100/100"].includes(v)) return v;
  return null;
}

function buildPaiementConditions({ total, mode }) {
  const totalNum = Number(total) || 0;
  const normalized = normalizePaiementMode(mode) || "100/100";

  let parts = [100];
  if (normalized === "70/30") parts = [70, 30];
  if (normalized === "50/50") parts = [50, 50];

  return parts.map((p, idx) => {
    const montant_prevu = (totalNum * p) / 100;
    return {
      label: `Tranche ${idx + 1}`,
      pourcentage: p,
      montant_prevu,
      condition_texte: null,
    };
  });
}

function buildCustomPaiementConditions({ total, tranches = [] }) {
  const totalNum = Number(total) || 0;
  const out = [];

  for (const [idx, t] of tranches.entries()) {
    const label = t?.label ? String(t.label) : `Tranche ${idx + 1}`;
    const p = t?.pourcentage != null ? Number(t.pourcentage) : null;
    const m = t?.montant_prevu != null ? Number(t.montant_prevu) : null;

    if (Number.isFinite(p)) {
      out.push({
        label,
        pourcentage: p,
        montant_prevu: (totalNum * p) / 100,
        condition_texte: t?.condition_texte ? String(t.condition_texte) : null,
      });
      continue;
    }

    if (Number.isFinite(m)) {
      out.push({
        label,
        pourcentage: totalNum ? (m / totalNum) * 100 : null,
        montant_prevu: m,
        condition_texte: t?.condition_texte ? String(t.condition_texte) : null,
      });
      continue;
    }
  }

  return out;
}

function computeTranchesPourcentageSum(total, tranches = []) {
  const totalNum = Number(total);
  let sum = 0;
  let hasAny = false;

  for (const t of tranches) {
    const p = t?.pourcentage != null ? Number(t.pourcentage) : null;
    if (Number.isFinite(p)) {
      sum += p;
      hasAny = true;
      continue;
    }
    const m = t?.montant_prevu != null ? Number(t.montant_prevu) : null;
    if (Number.isFinite(m) && Number.isFinite(totalNum) && totalNum > 0) {
      sum += (m / totalNum) * 100;
      hasAny = true;
    }
  }

  return { sum, hasAny };
}

function assertTranchesSumTo100(total, tranches, label = "Conditions de paiement") {
  const { sum, hasAny } = computeTranchesPourcentageSum(total, tranches);
  if (!hasAny) {
    throw withStatusCode(new Error(`${label}: au moins une tranche est requise`), 400);
  }
  if (Math.abs(sum - 100) > 0.01) {
    throw withStatusCode(new Error(`${label}: la somme des pourcentages doit etre 100%`), 400);
  }
}

function formatMoneyValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const formatted = new Intl.NumberFormat("fr-FR").format(n);
  return formatted.replace(/[\u202F\u00A0]/g, " ");
}

function formatDateTime(value) {
  if (!value) return "-";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function agentDisplayName(agent) {
  const prenom = agent?.prenom ? String(agent.prenom).trim() : "";
  const nom = agent?.nom ? String(agent.nom).trim() : "";
  const full = `${prenom} ${nom}`.trim();
  if (full) return full;
  const email = agent?.users?.email ? String(agent.users.email).trim() : "";
  return email || "-";
}

function splitAgentName(agent) {
  const prenom = agent?.prenom ? String(agent.prenom).trim() : "";
  const nom = agent?.nom ? String(agent.nom).trim() : "";
  if (prenom || nom) return { first_name: prenom || nom || "Signataire", last_name: nom || "" };

  const email = agent?.users?.email ? String(agent.users.email).trim() : "";
  if (!email) return { first_name: "Signataire", last_name: "" };
  const [user] = email.split("@");
  return { first_name: user || "Signataire", last_name: "" };
}

function buildValidationSignaturePdf({ demande, step, signer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text("Validation de demande", { align: "center" });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10);

    const montant = demande?.montant_net != null ? demande.montant_net : demande?.montant;
    const devise = demande?.devise ? String(demande.devise) : "FCFA";

    const rows = [
      ["Référence demande", demande?.uuid || demande?.id || "-"],
      ["Motif", demande?.motif || "-"],
      ["Bénéficiaire", demande?.beneficiaire || "-"],
      ["Montant", montant != null ? `${formatMoneyValue(montant)} ${devise}` : "-"],
      ["Demandeur", agentDisplayName(demande?.agents_demandes_paiement_demandeur_idToagents)],
      ["Rôle validation", step?.role_name || "-"],
      ["Validateur", agentDisplayName(signer)],
      ["Date", formatDateTime(new Date())],
    ];

    rows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(String(value ?? "-"));
    });

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(9).text(
      "Ce document sert uniquement de preuve de signature électronique pour la validation."
    );

    // Zones visuelles pour la signature (repère)
    const pageHeight = doc.page.height;
    const sigHeight = 50;
    const sigY = 140; // position depuis le bas (coordonnées Firma)
    const sigTop = pageHeight - sigY - sigHeight;

    doc.font("Helvetica-Bold").fontSize(10).text("Signature", 50, sigTop - 18);
    doc.rect(50, sigTop, 250, sigHeight).stroke();

    doc.font("Helvetica-Bold").fontSize(10).text("Date", 320, sigTop - 18);
    doc.rect(320, sigTop, 120, sigHeight).stroke();

    doc.end();
  });
}

function buildSignatureFields({ recipientId }) {
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const toPct = (value, total) => Math.round((Number(value) / total) * 10000) / 100;

  const signatureRect = { x: 50, y: 140, width: 250, height: 50 };
  const dateRect = { x: 320, y: 140, width: 120, height: 50 };

  const toField = (type, rect) => ({
    recipient_id: recipientId,
    type,
    page_number: 1,
    position: {
      x: toPct(rect.x, A4_WIDTH),
      y: toPct(rect.y, A4_HEIGHT),
      width: toPct(rect.width, A4_WIDTH),
      height: toPct(rect.height, A4_HEIGHT),
    },
  });

  return [
    toField("signature", signatureRect),
    toField("date", dateRect),
  ];
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

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeValidationStopRole(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  if (["DAF", "DGA", "DG"].includes(v)) return v;
  return null;
}

const PAID_STATUTS = new Set([
  "paye",
  "payee",
  "en_attente_paiement",
  "receptionnee",
  "cloture",
  "cloturee",
]);

function isPaidStatut(value) {
  return PAID_STATUTS.has(String(value || "").toLowerCase());
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
      demandes_paiement: {
        include: {
          conditions_paiement: { where: { source: "DEMANDEUR" }, orderBy: { id: "asc" } },
          agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
        },
      },
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
      const {
        budget_prevu,
        budget_disponible,
        paiement_immediat,
        validation_oci,
        daf_critere4,
        conditions_paiement_mode,
        conditions_paiement_custom,
        conditions_paiement_use_demandeur,
        validation_stop_role,
      } = extra || {};
      const useDemandeurRaw = isBoolean(conditions_paiement_use_demandeur)
        ? conditions_paiement_use_demandeur
        : normalizeBooleanLikeString(conditions_paiement_use_demandeur);
      const useDemandeur = useDemandeurRaw === true;
      const validationStopRole = normalizeValidationStopRole(validation_stop_role);
      if (validation_stop_role != null && !validationStopRole) {
        throw withStatusCode(new Error("Categorie de validation invalide (attendu: DAF, DGA, DG)"), 400);
      }
      if (
        !isBoolean(budget_prevu) ||
        !isBoolean(budget_disponible) ||
        !isBoolean(paiement_immediat) ||
        !isBoolean(validation_oci)
      ) {
        throw withStatusCode(
          new Error(
            "Controle DAF incomplet: renseignez 'budget_prevu', 'budget_disponible', 'paiement_immediat', 'validation_oci' (booleens)"
          ),
          400
        );
      }

      // Pour le 4e critere, on accepte maintenant une chaine (moyen de paiement) ou un booleen (legacy)
      const dafCritere4Value = normalizeDafCritere4(daf_critere4);
      if (!dafCritere4Value) {
        throw withStatusCode(
          new Error("Controle DAF incomplet: renseignez le moyen de paiement (critere 4)"),
          400
        );
      }

      if (validation_oci === false && !commentaireTrimmed) {
        throw withStatusCode(new Error("Commentaire obligatoire si validation OCI = non"), 400);
      }

      if (paiement_immediat === false) {
        if (!commentaireTrimmed) {
          throw withStatusCode(new Error("Commentaire obligatoire si paiement non immediat"), 400);
        }
        const hasCustom = conditions_paiement_custom !== undefined;
        const hasMode = conditions_paiement_mode !== undefined;
        if (useDemandeur && (hasCustom || hasMode)) {
          throw withStatusCode(
            new Error(
              "Choisir soit les conditions du demandeur, soit un mode ou des conditions personnalisees"
            ),
            400
          );
        }
        if (!useDemandeur && !hasCustom && !hasMode) {
          throw withStatusCode(new Error("Definir les conditions de paiement (mode ou personnalise)"), 400);
        }
      }

      await tx.demandes_paiement.update({
        where: { id: Number(step.demande_id) },
        data: {
          budget_prevu: Boolean(budget_prevu),
          budget_disponible: Boolean(budget_disponible),
          paiement_immediat: Boolean(paiement_immediat),
          validation_oci: Boolean(validation_oci),
          daf_critere4: dafCritere4Value,
          ...(validationStopRole ? { validation_stop_role: validationStopRole } : {}),
          updated_at: new Date(),
        },
      });

      if (paiement_immediat === false) {
        const totalForConditions =
          step?.demandes_paiement?.montant_net != null
            ? step.demandes_paiement.montant_net
            : step?.demandes_paiement?.montant;

        const hasCustom = conditions_paiement_custom !== undefined;
        if (hasCustom && !Array.isArray(conditions_paiement_custom)) {
          throw withStatusCode(new Error("conditions_paiement_custom invalide"), 400);
        }
        const customTranches = Array.isArray(conditions_paiement_custom) ? conditions_paiement_custom : null;

        let conditions = [];
        if (useDemandeur) {
          const demandeurConditions = await tx.conditions_paiement.findMany({
            where: { demande_id: Number(step.demande_id), source: "DEMANDEUR" },
            orderBy: { id: "asc" },
          });
          if (!demandeurConditions.length) {
            throw withStatusCode(
              new Error(
                "Conditions du demandeur introuvables: definir un mode ou des conditions personnalisees"
              ),
              400
            );
          }
          assertTranchesSumTo100(totalForConditions, demandeurConditions, "Conditions du demandeur");
          const tranches = demandeurConditions.map((c, idx) => ({
            label: c?.label || `Tranche ${idx + 1}`,
            pourcentage: c?.pourcentage != null ? Number(c.pourcentage) : null,
            montant_prevu: c?.montant_prevu != null ? Number(c.montant_prevu) : null,
            condition_texte: c?.condition_texte ? String(c.condition_texte) : null,
          }));
          conditions = buildCustomPaiementConditions({ total: totalForConditions, tranches });
        } else if (hasCustom) {
          if (!customTranches) {
            throw withStatusCode(new Error("conditions_paiement_custom invalide"), 400);
          }
          assertTranchesSumTo100(totalForConditions, customTranches);
          conditions = buildCustomPaiementConditions({ total: totalForConditions, tranches: customTranches });
        } else {
          const paiementMode = normalizePaiementMode(conditions_paiement_mode);
          if (!paiementMode) {
            throw withStatusCode(
              new Error("Condition de paiement invalide (attendu: 70/30, 50/50, 100/100)"),
              400
            );
          }
          conditions = buildPaiementConditions({ total: totalForConditions, mode: paiementMode });
        }

        const paidOrLinked = await tx.conditions_paiement.count({
          where: { demande_id: Number(step.demande_id), source: "DAF", paiement_id: { not: null } },
        });
        if (paidOrLinked > 0) {
          throw withStatusCode(new Error("Conditions DAF deja engagees"), 409);
        }

        await tx.conditions_paiement.deleteMany({
          where: { demande_id: Number(step.demande_id), source: "DAF" },
        });

        if (conditions.length > 0) {
          await tx.conditions_paiement.createMany({
            data: conditions.map((c, idx) => ({
              uuid: uuidv4(),
              demande_id: Number(step.demande_id),
              source: "DAF",
              label: c.label || `Tranche ${idx + 1}`,
              pourcentage: c.pourcentage,
              montant_prevu: c.montant_prevu,
              date_echeance: null,
              condition_texte: c.condition_texte,
              statut: "prevu",
              paiement_id: null,
              created_at: new Date(),
              updated_at: new Date(),
            })),
          });
        }
      }
    }

    // Mise à jour de l'étape de validation sans signature
    await tx.validation_steps.update({
      where: { id: step.id },
      data: {
        status: "valide",
        validated_at: new Date(),
        commentaire: commentaireTrimmed || null,
        agents_validation_steps_validated_by_idToagents: { connect: { id: agent.id } },
        // Plus de signature_url
        updated_at: new Date(),
      },
    });

    const stopRole = normalizeValidationStopRole(
      extra?.validation_stop_role || step?.demandes_paiement?.validation_stop_role
    );
    const shouldStopAfterCurrent = stopRole && normalizeRoleName(step.role_name) === stopRole;

    let next = null;

    if (shouldStopAfterCurrent) {
      // Stop role reached: remove downstream steps to avoid blocking payment/reception.
      await tx.validation_steps.deleteMany({
        where: { demande_id: step.demande_id, level: { gt: step.level } },
      });
    } else {
      // ✅ débloquer le next step
      next = await tx.validation_steps.findFirst({
        where: { demande_id: step.demande_id, level: step.level + 1 },
      });

      if (next && next.status === "bloque") {
        await tx.validation_steps.update({
          where: { id: next.id },
          data: { status: "en_attente", updated_at: new Date() },
        });
      }
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

  try {
    await realtime.emitPendingStatus(userId);
  } catch {
    // ignore realtime errors
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
        commentaire,
        validated_at: new Date(),
        agents_validation_steps_validated_by_idToagents: { connect: { id: agent.id } },
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

  try {
    await realtime.emitPendingStatus(userId);
  } catch {
    // ignore realtime errors
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
          validated_at: null,
          signature_url: null,
          commentaire: null,
          agents_validation_steps_validated_by_idToagents: { disconnect: true },
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

  try {
    await realtime.emitPendingStatus(userId);
  } catch {
    // ignore realtime errors
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
    where: {
      agents_validation_steps_validated_by_idToagents: { is: { id: agent.id } },
      status: "valide",
      demandes_paiement: { is: { deleted_at: null } },
    },
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
      demandes_paiement: {
        include: {
          documents: true,
          conditions_paiement: { where: { source: "DEMANDEUR" }, orderBy: { id: "asc" } },
          agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
        },
      },
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
      select: { id: true, demande_id: true, level: true, status: true, role_name: true },
    });
    const stepMap = new Map(steps.map((s) => [Number(s.id), s]));
    const existingIds = new Set(Array.from(stepMap.keys()));
    const demandeIds = Array.from(new Set(steps.map((s) => s.demande_id).filter((v) => v != null)));
    const demandes =
      demandeIds.length > 0
        ? await prisma.demandes_paiement.findMany({
            where: { id: { in: demandeIds }, deleted_at: null },
            select: { id: true, uuid: true, statut: true, validation_stop_role: true },
          })
        : [];
    const demandeUuidById = new Map(demandes.map((d) => [Number(d.id), String(d.uuid)]));
    const demandeMetaById = new Map(demandes.map((d) => [Number(d.id), d]));
    const stopRoleByDemande = new Map();
    for (const d of demandes) {
      const stopRole = normalizeValidationStopRole(d?.validation_stop_role);
      if (stopRole) stopRoleByDemande.set(Number(d.id), stopRole);
    }

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

    const stopLevelByDemande = new Map();
    for (const s of steps) {
      const did = Number(s.demande_id);
      const stopRole = stopRoleByDemande.get(did);
      if (!stopRole) continue;
      if (normalizeRoleName(s.role_name) !== stopRole) continue;
      const lvl = Number(s.level);
      if (!Number.isFinite(lvl)) continue;
      const current = stopLevelByDemande.get(did);
      if (current == null || lvl > current) {
        stopLevelByDemande.set(did, lvl);
      }
    }

    for (const entry of entries) {
      const step = entry.step_id ? stepMap.get(Number(entry.step_id)) : null;
      if (!step) continue;
      const maxLevel = maxValidatedLevelByDemande.get(Number(step.demande_id));
      const stopLevel = stopLevelByDemande.get(Number(step.demande_id));
      const effectiveMaxLevel =
        Number.isFinite(Number(maxLevel)) && Number.isFinite(Number(stopLevel))
          ? Math.min(Number(maxLevel), Number(stopLevel))
          : Number(maxLevel);
      const isCurrent =
        String(step.status || "").toLowerCase() === "valide" &&
        Number.isFinite(Number(effectiveMaxLevel)) &&
        Number(step.level) === Number(effectiveMaxLevel);
      const demandeMeta = demandeMetaById.get(Number(step.demande_id));
      const isPaid = isPaidStatut(demandeMeta?.statut);
      entry.can_cancel = !!isCurrent && !isPaid;
      entry.current_status = step.status || null;
      if (demandeMeta) {
        entry.demande = {
          ...(entry.demande || {}),
          uuid: demandeMeta.uuid ?? entry.demande?.uuid ?? null,
          statut: demandeMeta.statut ?? null,
          validation_stop_role: demandeMeta.validation_stop_role ?? null,
        };
      }
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

    const demandeStatut = String(step?.demandes_paiement?.statut || "").toLowerCase();
    if (isPaidStatut(demandeStatut)) {
      throw withStatusCode(new Error("Annulation impossible: demande deja payee"), 409);
    }

    const paiementCount = await tx.paiements.count({
      where: { demande_id: Number(step.demande_id) },
    });
    if (paiementCount > 0) {
      throw withStatusCode(new Error("Annulation impossible: demande deja payee"), 409);
    }

    const paidConditionCount = await tx.conditions_paiement.count({
      where: {
        demande_id: Number(step.demande_id),
        OR: [
          { paiement_id: { not: null } },
          { statut: { in: ["paye", "payee", "regle", "reglee"] } },
        ],
      },
    });
    if (paidConditionCount > 0) {
      throw withStatusCode(new Error("Annulation impossible: demande deja payee"), 409);
    }

    const maxValidated = await tx.validation_steps.aggregate({
      where: { demande_id: Number(step.demande_id), status: "valide" },
      _max: { level: true },
    });
    const maxValidatedLevel = Number(maxValidated?._max?.level);
    const stopRole = normalizeValidationStopRole(step?.demandes_paiement?.validation_stop_role);
    let stopLevel = null;
    if (stopRole) {
      const stopStep = await tx.validation_steps.findFirst({
        where: { demande_id: Number(step.demande_id), role_name: stopRole },
        select: { level: true },
      });
      if (stopStep?.level != null) stopLevel = Number(stopStep.level);
    }
    const effectiveMaxLevel = Number.isFinite(maxValidatedLevel)
      ? Number.isFinite(stopLevel)
        ? Math.min(maxValidatedLevel, stopLevel)
        : maxValidatedLevel
      : null;

    if (!Number.isFinite(effectiveMaxLevel) || Number(step.level) !== Number(effectiveMaxLevel)) {
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
          signature_url: null,
          signature_provider: null,
          signature_request_id: null,
          signature_request_user_id: null,
          signature_status: null,
          signature_payload: null,
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
              validated_at: null,
              agents_validation_steps_validated_by_idToagents: { disconnect: true },
              signature_url: null,
              signature_provider: null,
              signature_request_id: null,
              signature_request_user_id: null,
              signature_status: null,
              signature_payload: null,
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
        validated_at: null,
        agents_validation_steps_validated_by_idToagents: { disconnect: true },
        signature_url: null,
        signature_provider: null,
        signature_request_id: null,
        signature_request_user_id: null,
        signature_status: null,
        signature_payload: null,
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

  try {
    await realtime.emitPendingStatus(userId);
  } catch {
    // ignore realtime errors
  }

  return result;
}

async function startSignature(stepId, userId, payload = {}) {
  const step = await prisma.validation_steps.findUnique({
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

  const agent = await getAgentFromUserId(userId);
  if (!agent || !agent.roles?.name) throw new Error("Non autorisé");

  const ok = await canActByDelegation(prisma, step, agent);
  if (!ok) throw new Error("Non autorisé");

  const roleUpper = String(step.role_name || "").toUpperCase();
  const commentaireTrimmed = payload?.commentaire != null ? String(payload.commentaire).trim() : "";

  if (roleUpper === "DAF") {
    const {
      budget_prevu,
      budget_disponible,
      paiement_immediat,
      validation_oci,
      daf_critere4,
      conditions_paiement_mode,
      conditions_paiement_custom,
      conditions_paiement_use_demandeur,
      validation_stop_role,
    } = payload || {};
    const useDemandeurRaw = isBoolean(conditions_paiement_use_demandeur)
      ? conditions_paiement_use_demandeur
      : normalizeBooleanLikeString(conditions_paiement_use_demandeur);
    const useDemandeur = useDemandeurRaw === true;
    const validationStopRole = normalizeValidationStopRole(validation_stop_role);
    if (validation_stop_role != null && !validationStopRole) {
      throw withStatusCode(new Error("Categorie de validation invalide (attendu: DAF, DGA, DG)"), 400);
    }
    if (
      !isBoolean(budget_prevu) ||
      !isBoolean(budget_disponible) ||
      !isBoolean(paiement_immediat) ||
      !isBoolean(validation_oci)
    ) {
      throw withStatusCode(
        new Error(
          "Controle DAF incomplet: renseignez 'budget_prevu', 'budget_disponible', 'paiement_immediat', 'validation_oci' (booleens)"
        ),
        400
      );
    }
    const dafCritere4Value = normalizeDafCritere4(daf_critere4);
    if (!dafCritere4Value) {
      throw withStatusCode(
        new Error("Controle DAF incomplet: renseignez le moyen de paiement (critere 4)"),
        400
      );
    }
    if (validation_oci === false && !commentaireTrimmed) {
      throw withStatusCode(new Error("Commentaire obligatoire si validation OCI = non"), 400);
    }
    if (paiement_immediat === false) {
      if (!commentaireTrimmed) {
        throw withStatusCode(new Error("Commentaire obligatoire si paiement non immediat"), 400);
      }
      const hasCustom = conditions_paiement_custom !== undefined;
      const hasMode = conditions_paiement_mode !== undefined;
      if (useDemandeur && (hasCustom || hasMode)) {
        throw withStatusCode(
          new Error("Choisir soit les conditions du demandeur, soit un mode ou des conditions personnalisees"),
          400
        );
      }
      if (!useDemandeur && !hasCustom && !hasMode) {
        throw withStatusCode(new Error("Definir les conditions de paiement (mode ou personnalise)"), 400);
      }
    }
  }

  const email = agent?.users?.email ? String(agent.users.email).trim() : "";
  if (!email) throw new Error("Email du signataire introuvable");

  if (step.signature_status === "pending" && step.signature_request_id) {
    const existingPayload = step.signature_payload || {};
    const existingUserId = existingPayload?.signer_user_id;
    if (existingUserId && Number(existingUserId) !== Number(userId)) {
      throw withStatusCode(new Error("Signature dÃ©jÃ  initiÃ©e par un autre utilisateur"), 409);
    }

    if (step.signature_request_user_id) {
      return {
        signingRequestId: step.signature_request_id,
        signingRequestUserId: step.signature_request_user_id,
        signingUrl: `https://app.firma.dev/signing/${step.signature_request_user_id}`,
      };
    }

    const resolved = await firma.resolveSignerUser(step.signature_request_id, email, {
      attempts: 3,
      delayMs: 300,
    });
    const resolvedUrl =
      resolved.signingUrl ||
      (resolved.signerUserId ? `https://app.firma.dev/signing/${String(resolved.signerUserId)}` : "");

    if (resolved.signerUserId) {
      await prisma.validation_steps.update({
        where: { id: step.id },
        data: {
          signature_request_user_id: String(resolved.signerUserId),
          updated_at: new Date(),
        },
      });
    }

    if (resolvedUrl) {
      return {
        signingRequestId: step.signature_request_id,
        signingRequestUserId: resolved.signerUserId ? String(resolved.signerUserId) : null,
        signingUrl: resolvedUrl,
      };
    }
  }

  const pdfBuffer = await buildValidationSignaturePdf({
    demande: step.demandes_paiement,
    step,
    signer: agent,
  });

  const { first_name, last_name } = splitAgentName(agent);

  const recipientId = "temp_signer_1";
  const signingRequest = await firma.createSigningRequest({
    name: `Validation demande ${step.demandes_paiement?.uuid || step.demande_id}`,
    document: pdfBuffer.toString("base64"),
    recipients: [
      {
        id: recipientId,
        first_name,
        last_name,
        email,
        designation: "Signer",
        order: 1,
      },
    ],
    fields: buildSignatureFields({ recipientId }),
    allow_download: true,
    attach_pdf_on_finish: true,
    settings: {
      send_signing_email: false,
      send_finish_email: false,
      allow_download: true,
      attach_pdf_on_finish: true,
    },
  });

  const signingRequestId = signingRequest?.id;
  if (!signingRequestId) throw new Error("Firma: ID de signature introuvable");

  try {
    await firma.sendSigningRequest(signingRequestId);
  } catch (e) {
    // Certains comptes peuvent ne pas exiger l'appel send; on ignore le 404.
    if (e?.statusCode && Number(e.statusCode) !== 404) throw e;
  }

  const resolved = await firma.resolveSignerUser(signingRequestId, email, {
    attempts: 5,
    delayMs: 350,
  });
  const signerUserId = resolved.signerUserId;
  const signingUrl =
    resolved.signingUrl || (signerUserId ? `https://app.firma.dev/signing/${String(signerUserId)}` : "");
  if (!signerUserId && !signingUrl) throw new Error("Firma: signataire introuvable");

  const signaturePayload = {
    commentaire: commentaireTrimmed || null,
    extra: payload || {},
    signer_user_id: Number(userId),
    signer_agent_id: Number(agent.id),
    signer_email: email,
    created_at: new Date().toISOString(),
  };

  await prisma.validation_steps.update({
    where: { id: step.id },
    data: {
      signature_provider: "firma",
      signature_request_id: String(signingRequestId),
      signature_request_user_id: signerUserId != null ? String(signerUserId) : null,
      signature_status: "pending",
      signature_payload: signaturePayload,
      updated_at: new Date(),
    },
  });

  return {
    signingRequestId: String(signingRequestId),
    signingRequestUserId: signerUserId != null ? String(signerUserId) : null,
    signingUrl,
  };
}

async function completeSignature(stepId, userId) {
  const step = await prisma.validation_steps.findUnique({
    where: { id: Number(stepId) },
  });
  if (!step) throw new Error("Étape introuvable");

  if (step.status === "valide") {
    return { alreadyValidated: true };
  }

  if (!step.signature_request_id) {
    throw new Error("Signature non initialisée");
  }

  const agent = await getAgentFromUserId(userId);
  if (!agent || !agent.roles?.name) throw new Error("Non autorisé");

  const ok = await canActByDelegation(prisma, step, agent);
  if (!ok) throw new Error("Non autorisé");

  const fallbackEmail = agent?.users?.email ? String(agent.users.email).trim() : "";
  const waitResult = await firma.waitForSignerFinished(step.signature_request_id, {
    signerUserId: step.signature_request_user_id,
    email: fallbackEmail,
  });
  const signerUser = waitResult.signerUser;
  if (!signerUser) throw new Error("Signature introuvable");
  if (!firma.isSignerFinished(signerUser) && !waitResult.requestFinished) {
    throw withStatusCode(new Error("Signature non terminée"), 409);
  }

  const signerUserId = firma.extractUserId(signerUser);
  if (!step.signature_request_user_id && signerUserId) {
    await prisma.validation_steps.update({
      where: { id: step.id },
      data: {
        signature_request_user_id: String(signerUserId),
        updated_at: new Date(),
      },
    });
  }

  let finalDocumentUrl = null;
  try {
    const request = await firma.getSigningRequest(step.signature_request_id);
    finalDocumentUrl = firma.extractFinalDocumentUrl(request) || null;
  } catch {
    // ignore download url errors
  }

  const payload = step.signature_payload || {};
  const commentaire = payload?.commentaire || null;
  const extra = payload?.extra || {};

  const result = await approveStep(stepId, userId, commentaire, null, {
    ...(extra || {}),
    signature_validated: true,
  });

  await prisma.validation_steps.update({
    where: { id: step.id },
    data: {
      signature_status: "completed",
      signature_url: finalDocumentUrl || step.signature_url,
      signature_payload: {
        ...(payload || {}),
        completed_at: new Date().toISOString(),
        final_document_url: finalDocumentUrl || null,
      },
      updated_at: new Date(),
    },
  });

  return { ...result, signature_url: finalDocumentUrl || null };
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
  startSignature,
  completeSignature,
};
