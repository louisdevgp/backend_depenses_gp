const prisma = require("../config/prisma");
const { randomUUID: uuidv4 } = require("crypto");
const notifications = require("./notifications.services");
const { sendMail } = require("../config/mailer");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const realtime = require("../realtime");
const { resolveUploadsPathFromUrl } = require("./signatures.services");
const firma = require("./firma.services");
const signatureSessions = require("./signatureSessions.services");
const permissionMap = require("../config/permissions");
const P = require("../constants/permissions");
const {
  normalizePermissionCode,
  getScopesForPermissionFromUser,
  buildOrgScopeWhere,
} = require("../utils/permissionScopes");

function getEnvAny(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function bytesFromMb(mb, fallback) {
  const n = Number(mb);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 1024 * 1024);
}

function safeFilename(doc) {
  const name = doc?.nom_fichier ? String(doc.nom_fichier).trim() : "";
  if (name) return name;
  const url = doc?.url ? String(doc.url) : "document";
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname || "") || "document";
    return base;
  } catch {
    const base = path.basename(url || "") || "document";
    return base;
  }
}

function normalizeUploadsUrlToLocalPath(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  // already relative
  if (raw.startsWith("/uploads/")) return resolveUploadsPathFromUrl(raw);

  // absolute URL that points to /uploads/...
  try {
    const u = new URL(raw);
    if (String(u.pathname || "").startsWith("/uploads/")) return resolveUploadsPathFromUrl(u.pathname);
  } catch {
    // ignore
  }

  return null;
}

async function buildAttachmentsFromDocuments(docs) {
  const maxTotalBytes = bytesFromMb(getEnvAny(["MAIL_ATTACHMENTS_MAX_MB", "EMAIL_ATTACHMENTS_MAX_MB"]), 15 * 1024 * 1024);
  const maxOneBytes = bytesFromMb(getEnvAny(["MAIL_ATTACHMENT_MAX_MB", "EMAIL_ATTACHMENT_MAX_MB"]), 10 * 1024 * 1024);

  const attachments = [];
  const skipped = [];
  let total = 0;

  for (const doc of docs || []) {
    const url = doc?.url ? String(doc.url).trim() : "";
    const filename = safeFilename(doc);
    const contentType = doc?.format ? String(doc.format) : undefined;

    try {
      const localPath = normalizeUploadsUrlToLocalPath(url);
      if (localPath && fs.existsSync(localPath)) {
        const stat = fs.statSync(localPath);
        const size = Number(stat.size || 0);
        if (size <= 0) {
          skipped.push({ filename, url, reason: "empty" });
          continue;
        }
        if (size > maxOneBytes) {
          skipped.push({ filename, url, reason: `too_large_single(${size})` });
          continue;
        }
        if (total + size > maxTotalBytes) {
          skipped.push({ filename, url, reason: `too_large_total(${total + size})` });
          continue;
        }

        const content = await fs.promises.readFile(localPath);
        attachments.push({ filename, content, ...(contentType ? { contentType } : {}) });
        total += size;
        continue;
      }

      // try remote fetch for http(s)
      if (/^https?:\/\//i.test(url)) {
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30_000,
          maxContentLength: maxOneBytes,
        });
        const buf = Buffer.from(res.data);
        const size = buf.length;

        if (size <= 0) {
          skipped.push({ filename, url, reason: "empty" });
          continue;
        }
        if (size > maxOneBytes) {
          skipped.push({ filename, url, reason: `too_large_single(${size})` });
          continue;
        }
        if (total + size > maxTotalBytes) {
          skipped.push({ filename, url, reason: `too_large_total(${total + size})` });
          continue;
        }

        attachments.push({ filename, content: buf, ...(contentType ? { contentType } : {}) });
        total += size;
        continue;
      }

      skipped.push({ filename, url, reason: "unhandled_url" });
    } catch (e) {
      skipped.push({ filename, url, reason: e?.message ? String(e.message) : "fetch_failed" });
    }
  }

  return { attachments, skipped, totalBytes: total, maxTotalBytes };
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function amountsEqual(a, b, tolerance = 0.01) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= tolerance;
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

function buildPaiementSignaturePdf({ payload, demande, comptable }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text("Creation de paiement", { align: "center" });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10);

    const devise = demande?.devise ? String(demande.devise) : "FCFA";
    const montantDemande = demande?.montant_net != null ? demande.montant_net : demande?.montant;

    const rows = [
      ["Demande", demande?.uuid || demande?.id || "-"],
      ["Motif", demande?.motif || "-"],
      ["Beneficiaire", demande?.beneficiaire || "-"],
      [
        "Montant demande",
        montantDemande != null ? `${formatMoneyValue(montantDemande)} ${devise}` : "-",
      ],
      [
        "Montant paiement",
        payload?.montant != null ? `${formatMoneyValue(payload.montant)} ${devise}` : "-",
      ],
      ["Type paiement", payload?.type_paiement || "-"],
      ["Moyen paiement", payload?.moyen_paiement || "-"],
      ["Comptable", agentDisplayName(comptable)],
      ["Date", formatDateTime(payload?.date_paiement || new Date())],
    ];

    rows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(String(value ?? "-"));
    });

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(9).text(
      "Ce document sert uniquement de preuve de signature electronique pour la creation."
    );

    const pageHeight = doc.page.height;
    const sigHeight = 50;
    const sigY = 140;
    const sigTop = pageHeight - sigY - sigHeight;

    doc.font("Helvetica-Bold").fontSize(10).text("Signature", 50, sigTop - 18);
    doc.rect(50, sigTop, 250, sigHeight).stroke();

    doc.font("Helvetica-Bold").fontSize(10).text("Date", 320, sigTop - 18);
    doc.rect(320, sigTop, 120, sigHeight).stroke();

    doc.end();
  });
}

function deriveModeFromConditions(conds) {
  const list = Array.isArray(conds) ? conds : [];
  const pcts = list.map((c) => Number(c?.pourcentage)).filter((n) => Number.isFinite(n));
  if (pcts.length === 1 && amountsEqual(pcts[0], 100, 0.01)) return "100/100";
  if (pcts.length === 2) {
    const a = round2(pcts[0]);
    const b = round2(pcts[1]);
    if (amountsEqual(a, 70, 0.01) && amountsEqual(b, 30, 0.01)) return "70/30";
    if (amountsEqual(a, 50, 0.01) && amountsEqual(b, 50, 0.01)) return "50/50";
  }
  return null;
}

function normalizeConditionsSource(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  if (v === "DAF") return "DAF";
  if (v === "DEMANDEUR") return "DEMANDEUR";
  return null;
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function candidateScopesForDemandeOrg(demande) {
  const scopes = ["GLOBAL"];
  if (!demande) return scopes;
  if (demande.direction_id) scopes.push(`DIRECTION:${Number(demande.direction_id)}`);
  if (demande.departement_id) scopes.push(`DEPARTEMENT:${Number(demande.departement_id)}`);
  if (demande.service_id) scopes.push(`SERVICE:${Number(demande.service_id)}`);
  return scopes;
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

const PAIEMENT_ACTOR_ROLES = new Set(
  (permissionMap?.[P.PAIEMENT_CREATE] || []).map(normalizeRoleName).filter(Boolean)
);

async function isPaiementDelegated(agent, demandeOrg) {
  if (!agent?.id) return false;
  if (!PAIEMENT_ACTOR_ROLES.size) return false;

  const roles = agentRoleSet(agent);
  if (roles.has("ADMIN")) return false;
  if (Array.from(PAIEMENT_ACTOR_ROLES).some((r) => roles.has(r))) return false;

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await prisma.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: { in: Array.from(PAIEMENT_ACTOR_ROLES) },
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

async function withPaiementDelegationFlags(paiement) {
  if (!paiement) return paiement;
  const demandeOrg = {
    direction_id: paiement?.demandes_paiement?.direction_id ?? null,
    departement_id: paiement?.demandes_paiement?.departement_id ?? null,
    service_id: paiement?.demandes_paiement?.service_id ?? null,
  };
  const comptable = paiement?.agents || null;
  const delegated = comptable ? await isPaiementDelegated(comptable, demandeOrg) : false;
  return {
    ...paiement,
    comptable_nom: comptable ? agentDisplayName(comptable) : null,
    paiement_delegated: Boolean(delegated),
  };
}

function hasPermission(user, code) {
  const perm = normalizePermissionCode(code);
  if (!perm) return false;
  const list = Array.isArray(user?.permissions) ? user.permissions : [];
  return list.map(normalizePermissionCode).includes(perm);
}

function paiementScopeWhereForUser(user, permissionCodes = []) {
  if (!user) {
    const err = new Error("Accès interdit");
    err.statusCode = 403;
    throw err;
  }

  const codes = Array.isArray(permissionCodes) && permissionCodes.length ? permissionCodes : ["PAIEMENT_LIST"];
  const scopes = [];
  for (const code of codes) {
    if (hasPermission(user, code)) {
      scopes.push(...getScopesForPermissionFromUser(user, code));
    }
  }

  if (!scopes.length) {
    const err = new Error("Accès interdit");
    err.statusCode = 403;
    throw err;
  }

  const scopeWhere = buildOrgScopeWhere(scopes, {
    wrap: (base) => ({ demandes_paiement: { is: base } }),
  });

  if (scopeWhere === null) return null;
  if (scopeWhere && scopeWhere.id !== -1) return scopeWhere;

  const err = new Error("Accès interdit");
  err.statusCode = 403;
  throw err;
}

async function findUserIdByAgentId(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { users: { select: { id: true } } },
  });
  return a?.users?.id || null;
}

async function getAgentById(agentId) {
  if (!agentId) return null;
  return prisma.agents.findUnique({
    where: { id: Number(agentId) },
    include: { users: true },
  });
}

async function assertDemandePayable(demandeId) {
  const demande = await prisma.demandes_paiement.findFirst({
    where: { id: Number(demandeId), deleted_at: null },
    select: { id: true },
  });

  if (!demande) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const pending = await prisma.validation_steps.count({
    where: {
      demande_id: Number(demandeId),
      status: { in: ["en_attente", "bloque", "rejete"] },
    },
  });

  if (pending > 0) {
    const err = new Error("Demande non payable : validations incomplètes ou rejetée");
    err.statusCode = 400;
    throw err;
  }

  return true;
}

async function ensureConditionsForDemande(tx, demandeId, source) {
  const src = normalizeConditionsSource(source) || "DEMANDEUR";
  const conds = await tx.conditions_paiement.findMany({
    where: { demande_id: Number(demandeId), source: src },
    orderBy: { id: "asc" },
  });

  if (conds.length > 0) return conds;

  if (src !== "DEMANDEUR") return [];

  // Compat: anciennes demandes sans échéancier -> créer 100/100
  const d = await tx.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: { id: true, montant: true, montant_net: true },
  });
  if (!d) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const montantReference = d.montant_net != null ? d.montant_net : d.montant;
  await tx.conditions_paiement.create({
    data: {
      uuid: uuidv4(),
      demande_id: Number(demandeId),
      source: "DEMANDEUR",
      label: "Tranche 1",
      pourcentage: 100,
      montant_prevu: round2(montantReference),
      date_echeance: null,
      condition_texte: "100/100",
      statut: "prevu",
      paiement_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  return tx.conditions_paiement.findMany({
    where: { demande_id: Number(demandeId), source: "DEMANDEUR" },
    orderBy: { id: "asc" },
  });
}

async function createPaiement(payload, comptableAgentId, options = {}) {
  const {
    demande_id,
    type_paiement,
    montant,
    date_paiement,
    moyen_paiement,
    conditions_source,
    reference_piece,
    compte_debite,
    commentaire,
    documents = [],
  } = payload;

  await assertDemandePayable(demande_id);

  const result = await prisma.$transaction(async (tx) => {
    const demande = await tx.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      select: { id: true, uuid: true, montant: true, statut: true },
    });
    if (!demande) {
      const err = new Error("Demande introuvable");
      err.statusCode = 404;
      throw err;
    }

    const normalizedSource = normalizeConditionsSource(conditions_source) || "DEMANDEUR";
    const existingPayments = await tx.paiements.findMany({
      where: { demande_id: Number(demande_id) },
      select: { id: true, conditions_source: true },
      orderBy: { id: "asc" },
    });
    const lockedSource = existingPayments.find((p) => p.conditions_source)?.conditions_source || null;
    if (lockedSource && normalizedSource && normalizeConditionsSource(lockedSource) !== normalizedSource) {
      const err = new Error(`Source conditions invalide: paiement deja base sur ${lockedSource}`);
      err.statusCode = 409;
      throw err;
    }
    const effectiveSource = normalizeConditionsSource(lockedSource) || normalizedSource;

    const conditions = await ensureConditionsForDemande(tx, demande.id, effectiveSource);
    if (effectiveSource === "DAF" && conditions.length === 0) {
      const err = new Error("Conditions DAF introuvables pour cette demande");
      err.statusCode = 409;
      throw err;
    }
    const mode = deriveModeFromConditions(conditions) || "100/100";

    const unpaid = conditions.filter((c) => !c.paiement_id && String(c.statut || "").toLowerCase() !== "paye");
    if (unpaid.length === 0) {
      const err = new Error("Demande déjà payée");
      err.statusCode = 409;
      throw err;
    }

    const montantNum = Number(montant);
    if (!Number.isFinite(montantNum) || montantNum <= 0) {
      const err = new Error("Montant paiement invalide");
      err.statusCode = 400;
      throw err;
    }

    const remainingTotal = round2(unpaid.reduce((acc, c) => acc + Number(c.montant_prevu || 0), 0));

    if (String(type_paiement).toLowerCase() === "partiel") {
      if (mode === "100/100") {
        const err = new Error("Condition 100/100 : paiement en une seule fois (type total)");
        err.statusCode = 400;
        throw err;
      }

      // Règle: une seule fois par tranche, et ordre imposé (montant le plus élevé en premier)
      const nextTranche = [...unpaid].sort((a, b) => {
        const diff = Number(b.montant_prevu || 0) - Number(a.montant_prevu || 0);
        if (diff !== 0) return diff;
        return Number(a.id || 0) - Number(b.id || 0);
      })[0];
      if (!nextTranche) {
        const err = new Error("Aucune tranche à payer");
        err.statusCode = 400;
        throw err;
      }

      if (!amountsEqual(montantNum, nextTranche.montant_prevu)) {
        const err = new Error(`Paiement partiel invalide : montant attendu = ${nextTranche.montant_prevu}`);
        err.statusCode = 400;
        throw err;
      }
    } else {
      // type total
      if (!amountsEqual(montantNum, remainingTotal)) {
        const err = new Error(`Paiement total invalide : montant attendu = ${remainingTotal}`);
        err.statusCode = 400;
        throw err;
      }
    }

    const paiement = await tx.paiements.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande_id),
        type_paiement,
        montant: montantNum,
        date_paiement: date_paiement ? new Date(date_paiement) : new Date(),
        moyen_paiement,
        conditions_source: effectiveSource,
        reference_piece: reference_piece || null,
        compte_debite: compte_debite || null,
        commentaire: commentaire || null,
        comptable_id: Number(comptableAgentId),
        documents: documents?.length
          ? {
              create: documents.map((d) => ({
                uuid: uuidv4(),
                type_document: d.type_document,
                url: d.url,
                nom_fichier: d.nom_fichier || "document",
                format: d.format || null,
                taille: d.taille ? BigInt(d.taille) : null,
                upload_by_id: Number(comptableAgentId),
                created_at: new Date(),
              })),
            }
          : undefined,
      },
      include: {
        documents: true,
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
      },
    });

    // Appliquer paiement -> conditions
    const unpaidAfterCreate = await tx.conditions_paiement.findMany({
      where: { demande_id: Number(demande_id), source: effectiveSource, paiement_id: null },
      orderBy: { id: "asc" },
    });
    const remainingAfterCreate = unpaidAfterCreate;

    if (String(type_paiement).toLowerCase() === "partiel") {
      const nextTranche = [...remainingAfterCreate].sort((a, b) => {
        const diff = Number(b.montant_prevu || 0) - Number(a.montant_prevu || 0);
        if (diff !== 0) return diff;
        return Number(a.id || 0) - Number(b.id || 0);
      })[0];
      if (!nextTranche) {
        const err = new Error("Aucune tranche à payer");
        err.statusCode = 400;
        throw err;
      }

      await tx.conditions_paiement.update({
        where: { id: Number(nextTranche.id) },
        data: { paiement_id: paiement.id, statut: "paye", updated_at: new Date() },
      });
    } else {
      // total: marque toutes les tranches restantes comme payées par ce paiement
      await tx.conditions_paiement.updateMany({
        where: { demande_id: Number(demande_id), source: effectiveSource, paiement_id: null },
        data: { paiement_id: paiement.id, statut: "paye", updated_at: new Date() },
      });
    }

    const stillUnpaid = await tx.conditions_paiement.count({
      where: {
        demande_id: Number(demande_id),
        source: effectiveSource,
        paiement_id: null,
        statut: { notIn: ["paye", "payee", "regle", "reglee"] },
      },
    });
    const fullyPaid = stillUnpaid === 0;

    // Règle: un paiement partiel ne doit jamais "bloquer" la capacité à payer.
    // Donc tant que ce n'est pas totalement payé => en_attente_paiement (même si réception existe).
    const currentDemandeStatut = String(demande?.statut || "").toLowerCase();
    const keepAchatStatut = currentDemandeStatut === "achat_effectue";
    const nextStatut = keepAchatStatut ? "achat_effectue" : (fullyPaid ? "paye" : "en_attente_paiement");

    await tx.demandes_paiement.update({
      where: { id: Number(demande_id) },
      data: { statut: nextStatut, updated_at: new Date() },
    });

    return {
      ...paiement,
      demande_statut_after_paiement: nextStatut,
    };
  });

  // notif demandeur after commit (safe for email)
  try {
    const demandeurUser = result.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;
    if (demandeurUser?.id) {
      const source = normalizeConditionsSource(result?.conditions_source) || "DEMANDEUR";
      const stillUnpaid = await prisma.conditions_paiement.count({
        where: {
          demande_id: Number(demande_id),
          source,
          paiement_id: null,
          statut: { notIn: ["paye", "payee", "regle", "reglee"] },
        },
      });
      const fullyPaid = stillUnpaid === 0;
      const nextStatut = result?.demande_statut_after_paiement || (fullyPaid ? "paye" : "en_attente_paiement");

      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_effectue",
        demande_id: Number(demande_id),
        message: fullyPaid
          ? `Votre demande a été payée. Montant: ${montant}. Moyen: ${moyen_paiement}. Statut: ${nextStatut}.`
          : `Un paiement partiel a été enregistré. Montant: ${montant}. Moyen: ${moyen_paiement}. Statut: ${nextStatut}.`,
        meta: { paiementId: result.id, paiementUuid: result.uuid },
        sendEmailNow: false,
      });
    }

  } catch {
    // ignore email errors
  }

  try {
    const actorUserId = await findUserIdByAgentId(comptableAgentId);
    if (actorUserId) {
      await realtime.emitPaiementPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  // ? Email récap paiement + pièces jointes: documents de la demande
  try {
    const demande = await prisma.demandes_paiement.findUnique({
      where: { id: Number(demande_id) },
      select: {
        id: true,
        uuid: true,
        motif: true,
        montant: true,
        devise: true,
        beneficiaire: true,
        agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { email: true } } } },
      },
    });

    const demandeurEmail = demande?.agents_demandes_paiement_demandeur_idToagents?.users?.email
      ? String(demande.agents_demandes_paiement_demandeur_idToagents.users.email)
      : null;

    const steps = await prisma.validation_steps.findMany({
      where: { demande_id: Number(demande_id), status: "valide" },
      select: {
        role_name: true,
        validated_by_id: true,
        agents_validation_steps_validated_by_idToagents: { select: { users: { select: { email: true } } } },
      },
      orderBy: { level: "asc" },
    });

    const validatorEmails = Array.from(
      new Set(
        (steps || [])
          .map((s) => s?.agents_validation_steps_validated_by_idToagents?.users?.email)
          .filter(Boolean)
          .map((e) => String(e).trim())
      )
    ).filter(Boolean);

    // docs liés à la demande
    const docs = await prisma.documents.findMany({
      where: { demande_id: Number(demande_id) },
      orderBy: { created_at: "asc" },
      select: { id: true, url: true, nom_fichier: true, format: true, taille: true, type_document: true },
    });

    const { attachments, skipped, totalBytes, maxTotalBytes } = await buildAttachmentsFromDocuments(docs);

    const recipients = [];
    if (demandeurEmail) recipients.push(demandeurEmail);
    for (const e of validatorEmails) recipients.push(e);
    const uniqueRecipients = Array.from(new Set(recipients.map((x) => String(x).trim()).filter(Boolean)));

    if (uniqueRecipients.length > 0) {
      const subject = `E-Dépenses — Paiement effectué (Demande ${demande?.uuid || Number(demande_id)})`;

      const validatorsLine = (steps || [])
        .map((s) => (s?.role_name ? String(s.role_name) : null))
        .filter(Boolean)
        .join(" ? ");

      const montantLabel = demande?.montant != null ? String(demande.montant) : "";
      const devise = demande?.devise ? String(demande.devise) : "XOF";

      const docsListHtml = (docs || [])
        .map((d) => {
          const n = safeFilename(d);
          const u = d?.url ? String(d.url) : "";
          const t = d?.type_document ? String(d.type_document) : "document";
          return `<li><b>${t}</b> — ${n}${u ? ` <span style=\"color:#666\">(${u})</span>` : ""}</li>`;
        })
        .join("");

      const skippedHtml = skipped.length
        ? `
          <p style="margin-top:12px;color:#b45309"><b>Note:</b> certains documents n'ont pas pu être joints (taille/URL). Ils sont listés ci-dessus avec leurs liens.</p>
          <p style="margin-top:6px;color:#666;font-size:12px">Taille jointe: ${(totalBytes / 1024 / 1024).toFixed(1)}MB / ${(maxTotalBytes / 1024 / 1024).toFixed(1)}MB</p>
        `
        : "";

      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2 style="margin:0 0 8px">Paiement effectué</h2>
          <p style="margin:0 0 12px">Un paiement a été enregistré pour la demande <b>${demande?.uuid || Number(demande_id)}</b>.</p>
          <ul style="margin:0 0 12px;padding-left:18px">
            <li><b>Motif:</b> ${demande?.motif ? String(demande.motif) : "-"}</li>
            <li><b>Bénéficiaire:</b> ${demande?.beneficiaire ? String(demande.beneficiaire) : "-"}</li>
            <li><b>Montant demande:</b> ${montantLabel ? `${montantLabel} ${devise}` : "-"}</li>
            <li><b>Type paiement:</b> ${payload?.type_paiement ? String(payload.type_paiement) : "-"}</li>
            <li><b>Montant payé:</b> ${payload?.montant != null ? String(payload.montant) : "-"}</li>
            <li><b>Moyen:</b> ${payload?.moyen_paiement ? String(payload.moyen_paiement) : "-"}</li>
          </ul>
          ${validatorsLine ? `<p style="margin:0 0 12px;color:#111"><b>Chaîne de validation:</b> ${validatorsLine}</p>` : ""}

          <div style="margin-top:14px">
            <div style="font-weight:700;margin-bottom:6px">Documents de la demande</div>
            <ul style="margin:0;padding-left:18px">${docsListHtml || "<li>Aucun document</li>"}</ul>
            ${skippedHtml}
          </div>

          <p style="margin-top:16px;color:#777">— E-Dépenses</p>
        </div>
      `;

      // To = demandeur si dispo, sinon 1er validateur; CC = le reste
      const to = demandeurEmail || uniqueRecipients[0];
      const ccList = uniqueRecipients.filter((e) => e !== to);
      await sendMail({
        to,
        ...(ccList.length ? { cc: ccList.join(",") } : {}),
        subject,
        text: `Paiement effectué pour la demande ${demande?.uuid || Number(demande_id)}.`,
        html,
        attachments,
      });
    }
  } catch {
    // ignore email errors
  }

  return result;
}

async function startCreateSignature(payload, comptableAgentId, userId) {
  const signerUserId = userId != null ? Number(userId) : await findUserIdByAgentId(comptableAgentId);
  if (!signerUserId) {
    const err = new Error("Utilisateur signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  if (!payload?.demande_id) {
    const err = new Error("demande_id requis");
    err.statusCode = 400;
    throw err;
  }

  await assertDemandePayable(payload.demande_id);

  const demande = await prisma.demandes_paiement.findUnique({
    where: { id: Number(payload.demande_id) },
    select: {
      id: true,
      uuid: true,
      motif: true,
      montant: true,
      montant_net: true,
      devise: true,
      beneficiaire: true,
    },
  });
  if (!demande) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  const comptable = await getAgentById(comptableAgentId);
  if (!comptable || !comptable.users?.email) {
    const err = new Error("Email du signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  const pdfBuffer = await buildPaiementSignaturePdf({
    payload,
    demande,
    comptable,
  });

  const { first_name, last_name } = splitAgentName(comptable);
  const email = String(comptable.users.email).trim();
  const recipientId = "temp_signer_1";

  const signingRequest = await firma.createSigningRequest({
    name: `Creation paiement ${demande.uuid || demande.id}`,
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
    if (e?.statusCode && Number(e.statusCode) !== 404) throw e;
  }

  const resolved = await firma.resolveSignerUser(signingRequestId, email, {
    attempts: 5,
    delayMs: 350,
  });
  const firmaSignerUserId = resolved.signerUserId;
  const signingUrl =
    resolved.signingUrl || (firmaSignerUserId ? `https://app.firma.dev/signing/${String(firmaSignerUserId)}` : "");
  if (!firmaSignerUserId && !signingUrl) throw new Error("Firma: signataire introuvable");

  const signaturePayload = {
    signer_user_id: signerUserId,
    signer_agent_id: Number(comptableAgentId),
    signer_email: email,
    created_at: new Date().toISOString(),
    demande_id: Number(payload.demande_id),
  };

  const session = await signatureSessions.createSignatureSession({
    entity_type: "paiement",
    action: "create",
    entity_id: null,
    signer_user_id: signerUserId,
    signer_agent_id: Number(comptableAgentId),
    signature_provider: "firma",
    signature_request_id: String(signingRequestId),
    signature_request_user_id: firmaSignerUserId != null ? String(firmaSignerUserId) : null,
    signature_status: "pending",
    payload: payload || {},
    signature_payload: signaturePayload,
  });

  return {
    sessionId: session.id,
    signingRequestId: String(signingRequestId),
    signingRequestUserId: firmaSignerUserId != null ? String(firmaSignerUserId) : null,
    signingUrl,
  };
}

async function completeCreateSignature(sessionId, userId) {
  if (!sessionId) {
    const err = new Error("Session de signature manquante");
    err.statusCode = 400;
    throw err;
  }

  const session = await signatureSessions.getSignatureSessionById(sessionId);
  if (!session) {
    const err = new Error("Session de signature introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (session.entity_type !== "paiement" || session.action !== "create") {
    const err = new Error("Session de signature invalide");
    err.statusCode = 400;
    throw err;
  }
  if (session.signer_user_id && userId != null && Number(session.signer_user_id) !== Number(userId)) {
    const err = new Error("Non autorise");
    err.statusCode = 403;
    throw err;
  }
  if (session.signature_status === "completed") {
    if (session.entity_id) {
      const existing = await prisma.paiements.findUnique({ where: { id: Number(session.entity_id) } });
      return existing || { alreadyCompleted: true };
    }
    return { alreadyCompleted: true };
  }
  if (!session.signature_request_id) {
    throw new Error("Signature non initialisee");
  }

  const fallbackAgent = await getAgentById(session.signer_agent_id);
  const fallbackEmail = fallbackAgent?.users?.email ? String(fallbackAgent.users.email).trim() : "";
  const waitResult = await firma.waitForSignerFinished(session.signature_request_id, {
    signerUserId: session.signature_request_user_id,
    email: fallbackEmail,
  });
  const signerUser = waitResult.signerUser;
  if (!signerUser) throw new Error("Signature introuvable");
  if (!firma.isSignerFinished(signerUser) && !waitResult.requestFinished) {
    const err = new Error("Signature non terminee");
    err.statusCode = 409;
    throw err;
  }

  const signerUserId = firma.extractUserId(signerUser);
  if (!session.signature_request_user_id && signerUserId) {
    await signatureSessions.updateSignatureSession(session.id, {
      signature_request_user_id: String(signerUserId),
    });
  }

  let finalDocumentUrl = null;
  try {
    const request = await firma.getSigningRequest(session.signature_request_id);
    finalDocumentUrl = firma.extractFinalDocumentUrl(request) || null;
  } catch {
    // ignore download url errors
  }

  const payload = session.payload || {};
  const paiement = await createPaiement(payload, Number(session.signer_agent_id), { signatureValidated: true });

  await signatureSessions.updateSignatureSession(session.id, {
    signature_status: "completed",
    signature_url: finalDocumentUrl || null,
    entity_id: Number(paiement.id),
    signature_payload: {
      ...(session.signature_payload || {}),
      completed_at: new Date().toISOString(),
      final_document_url: finalDocumentUrl || null,
    },
  });

  return { ...paiement, signature_url: finalDocumentUrl || null };
}

async function listPaiements({ demande_id, from, to, moyen_paiement }, authUser = null) {
  const filters = {
    ...(demande_id ? { demande_id: Number(demande_id) } : {}),
    ...(moyen_paiement ? { moyen_paiement } : {}),
    ...(from || to
      ? { date_paiement: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {}),
  };

  const scopeWhere = paiementScopeWhereForUser(authUser, ["PAIEMENT_LIST"]);
  const where = scopeWhere ? { AND: [filters, scopeWhere] } : filters;

  return prisma.paiements.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      documents: true,
      demandes_paiement: { select: { id: true, uuid: true, beneficiaire: true } },
    },
  });
}

async function getPaiementById(id, authUser = null) {
  const scopeWhere = paiementScopeWhereForUser(authUser, ["PAIEMENT_GET", "PAIEMENT_LIST"]);
  const where = scopeWhere ? { AND: [{ id: Number(id) }, scopeWhere] } : { id: Number(id) };

  const paiement = await prisma.paiements.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents: {
        select: {
          id: true,
          direction_id: true,
          roles: { select: { name: true } },
          users: {
            select: {
              prenom: true,
              nom: true,
              email: true,
              user_roles: { select: { roles: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return withPaiementDelegationFlags(paiement);
}

async function getPaiementByUuid(uuid, authUser = null) {
  const scopeWhere = paiementScopeWhereForUser(authUser, ["PAIEMENT_GET", "PAIEMENT_LIST"]);
  const where = scopeWhere ? { AND: [{ uuid: String(uuid) }, scopeWhere] } : { uuid: String(uuid) };

  const paiement = await prisma.paiements.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents: {
        select: {
          id: true,
          direction_id: true,
          roles: { select: { name: true } },
          users: {
            select: {
              prenom: true,
              nom: true,
              email: true,
              user_roles: { select: { roles: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return withPaiementDelegationFlags(paiement);
}

async function listByDemande(demandeId, authUser = null) {
  const scopeWhere = paiementScopeWhereForUser(authUser, ["PAIEMENT_LIST", "PAIEMENT_GET"]);
  const where = scopeWhere
    ? { AND: [{ demande_id: Number(demandeId) }, scopeWhere] }
    : { demande_id: Number(demandeId) };

  return prisma.paiements.findMany({
    where,
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function updatePaiement(id, payload, actorAgentId) {
  const existing = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: {
      demandes_paiement: {
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      },
    },
  });

  if (!existing) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }

  const updated = await prisma.paiements.update({
    where: { id: Number(id) },
    data: {
      type_paiement: payload.type_paiement ?? undefined,
      montant: payload.montant != null ? Number(payload.montant) : undefined,
      date_paiement: payload.date_paiement ? new Date(payload.date_paiement) : undefined,
      moyen_paiement: payload.moyen_paiement ?? undefined,
      reference_piece: payload.reference_piece ?? undefined,
      compte_debite: payload.compte_debite ?? undefined,
      commentaire: payload.commentaire ?? undefined,
    },
    include: { documents: true },
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUser = existing.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;

    if (demandeurUser?.id && Number(demandeurUser.id) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_updated",
        demande_id: Number(existing.demande_id),
        message: "Un paiement lié à votre demande a été modifié.",
        meta: {
          paiementId: updated.id,
          paiementUuid: updated.uuid,
          changes: {
            type_paiement: payload.type_paiement ?? undefined,
            montant: payload.montant != null ? Number(payload.montant) : undefined,
            date_paiement: payload.date_paiement ? new Date(payload.date_paiement).toISOString() : undefined,
            moyen_paiement: payload.moyen_paiement ?? undefined,
            reference_piece: payload.reference_piece ?? undefined,
            compte_debite: payload.compte_debite ?? undefined,
            commentaire: payload.commentaire ?? undefined,
          },
        },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    if (actorUserId) {
      await realtime.emitPaiementPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return updated;
}

async function deletePaiement(id, actorAgentId) {
  const snapshot = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: {
      demandes_paiement: {
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      },
    },
  });

  if (!snapshot) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    // 1) Détacher les tranches liées à ce paiement
    await tx.conditions_paiement.updateMany({
      where: { paiement_id: Number(id) },
      data: { paiement_id: null, statut: "prevu", updated_at: new Date() },
    });

    // 2) Supprimer documents + paiement
    await tx.documents.deleteMany({ where: { paiement_id: Number(id) } });
    await tx.paiements.delete({ where: { id: Number(id) } });

    // 3) Recalcul statut demande
    const demandeId = Number(snapshot.demande_id);
    const remainingPayments = await tx.paiements.findMany({
      where: { demande_id: demandeId },
      select: { conditions_source: true },
      orderBy: { id: "asc" },
    });
    const activeSource =
      normalizeConditionsSource(remainingPayments.find((p) => p.conditions_source)?.conditions_source) || "DEMANDEUR";
    const stillUnpaid = await tx.conditions_paiement.count({
      where: {
        demande_id: demandeId,
        source: activeSource,
        paiement_id: null,
        statut: { notIn: ["paye", "payee", "regle", "reglee"] },
      },
    });
    const fullyPaid = stillUnpaid === 0;
    const hasAnyPaiement = await tx.paiements.count({ where: { demande_id: demandeId } });
    const currentStatut = String(snapshot?.demandes_paiement?.statut || "").toLowerCase();
    const keepAchatStatut = currentStatut === "achat_effectue" && hasAnyPaiement > 0;
    const nextStatut = keepAchatStatut
      ? "achat_effectue"
      : fullyPaid
        ? "paye"
        : (hasAnyPaiement > 0 ? "en_attente_paiement" : "approuvee");

    await tx.demandes_paiement.update({
      where: { id: demandeId },
      data: { statut: nextStatut, updated_at: new Date() },
    });
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUser = snapshot.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;

    if (demandeurUser?.id && Number(demandeurUser.id) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUser.id,
        type: "paiement_deleted",
        demande_id: Number(snapshot.demande_id),
        message: "Un paiement lié à votre demande a été supprimé.",
        meta: { paiementId: snapshot.id, paiementUuid: snapshot.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore email errors
  }

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    if (actorUserId) {
      await realtime.emitPaiementPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return true;
}

module.exports = {
  createPaiement,
  startCreateSignature,
  completeCreateSignature,
  listPaiements,
  getPaiementById,
  getPaiementByUuid,
  listByDemande,
  updatePaiement,
  deletePaiement,
};

