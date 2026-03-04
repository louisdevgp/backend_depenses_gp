const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");
const { sendMail } = require("../config/mailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { resolveUploadsPathFromUrl } = require("./signatures.services");

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

async function findUserIdByAgentId(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { users: { select: { id: true } } },
  });
  return a?.users?.id || null;
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
    select: { id: true, montant: true },
  });
  if (!d) {
    const err = new Error("Demande introuvable");
    err.statusCode = 404;
    throw err;
  }

  await tx.conditions_paiement.create({
    data: {
      uuid: uuidv4(),
      demande_id: Number(demandeId),
      source: "DEMANDEUR",
      label: "Tranche 1",
      pourcentage: 100,
      montant_prevu: round2(d.montant),
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

async function createPaiement(payload, comptableAgentId) {
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
      select: { id: true, uuid: true, montant: true },
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
      where: { demande_id: Number(demande_id), source: effectiveSource, paiement_id: null },
    });
    const fullyPaid = stillUnpaid === 0;

    // Règle: un paiement partiel ne doit jamais "bloquer" la capacité à payer.
    // Donc tant que ce n'est pas totalement payé => en_attente_paiement (même si réception existe).
    const nextStatut = fullyPaid ? "paye" : "en_attente_paiement";

    await tx.demandes_paiement.update({
      where: { id: Number(demande_id) },
      data: { statut: nextStatut, updated_at: new Date() },
    });

    return paiement;
  });

  // notif demandeur after commit (safe for email)
  try {
    const demandeurUser = result.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents?.users;
    if (demandeurUser?.id) {
      const source = normalizeConditionsSource(result?.conditions_source) || "DEMANDEUR";
      const stillUnpaid = await prisma.conditions_paiement.count({
        where: { demande_id: Number(demande_id), source, paiement_id: null },
      });
      const fullyPaid = stillUnpaid === 0;
      const nextStatut = fullyPaid ? "paye" : "en_attente_paiement";

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

  // ✅ Email récap paiement + pièces jointes: documents de la demande
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
      const subject = `GP Achats — Paiement effectué (Demande ${demande?.uuid || Number(demande_id)})`;

      const validatorsLine = (steps || [])
        .map((s) => (s?.role_name ? String(s.role_name) : null))
        .filter(Boolean)
        .join(" → ");

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

          <p style="margin-top:16px;color:#777">— GP Achats</p>
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

async function listPaiements({ demande_id, from, to, moyen_paiement }) {
  return prisma.paiements.findMany({
    where: {
      ...(demande_id ? { demande_id: Number(demande_id) } : {}),
      ...(moyen_paiement ? { moyen_paiement } : {}),
      ...(from || to
        ? { date_paiement: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    orderBy: { id: "desc" },
    include: { documents: true },
  });
}

async function getPaiementById(id) {
  const paiement = await prisma.paiements.findUnique({
    where: { id: Number(id) },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function getPaiementByUuid(uuid) {
  const paiement = await prisma.paiements.findFirst({
    where: { uuid },
    include: { documents: true, demandes_paiement: true },
  });
  if (!paiement) {
    const err = new Error("Paiement introuvable");
    err.statusCode = 404;
    throw err;
  }
  return paiement;
}

async function listByDemande(demandeId) {
  return prisma.paiements.findMany({
    where: { demande_id: Number(demandeId) },
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
      where: { demande_id: demandeId, source: activeSource, paiement_id: null },
    });
    const fullyPaid = stillUnpaid === 0;
    const hasAnyPaiement = await tx.paiements.count({ where: { demande_id: demandeId } });

    const nextStatut = fullyPaid
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

  return true;
}

module.exports = {
  createPaiement,
  listPaiements,
  getPaiementById,
  getPaiementByUuid,
  listByDemande,
  updatePaiement,
  deletePaiement,
};
