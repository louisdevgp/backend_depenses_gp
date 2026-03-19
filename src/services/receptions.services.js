const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");
const notifications = require("./notifications.services");
const { saveSignaturePngDataUrl } = require("./signatures.services");
const realtime = require("../realtime");
const PDFDocument = require("pdfkit");
const firma = require("./firma.services");
const signatureSessions = require("./signatureSessions.services");
const {
  normalizePermissionCode,
  getScopesForPermissionFromUser,
  buildOrgScopeWhere,
} = require("../utils/permissionScopes");

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function normalizeReceptionPhase(value) {
  if (value == null) return null;
  const v = String(value).trim().toUpperCase();
  if (!v) return null;
  if (v === "AVANT" || v === "AVANT_PAIEMENT") return "AVANT_PAIEMENT";
  if (v === "APRES" || v === "APRES_PAIEMENT") return "APRES_PAIEMENT";
  return null;
}

function candidateScopesForDemandeOrg(org) {
  const scopes = ["GLOBAL"];
  if (!org) return scopes;
  if (org.direction_id) scopes.push(`DIRECTION:${Number(org.direction_id)}`);
  if (org.departement_id) scopes.push(`DEPARTEMENT:${Number(org.departement_id)}`);
  if (org.service_id) scopes.push(`SERVICE:${Number(org.service_id)}`);
  return scopes;
}

async function getAgentById(tx, agentId) {
  const client = tx || prisma;
  if (!agentId) return null;
  return client.agents.findUnique({
    where: { id: Number(agentId) },
    select: {
      id: true,
      direction_id: true,
      deleted_at: true,
      roles: { select: { name: true } },
      users: {
        select: {
          user_roles: { select: { roles: { select: { name: true } } } },
        },
      },
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

function isDirectRoleForDemande(agent, roleName, demandeOrg) {
  if (!agent) return false;
  const target = normalizeRoleName(roleName);
  if (!target) return false;
  const roles = agentRoleSet(agent);
  if (!roles.has(target)) return false;
  if (target === "DIRECTEUR") {
    if (!agent.direction_id || !demandeOrg?.direction_id) return false;
    return Number(agent.direction_id) === Number(demandeOrg.direction_id);
  }
  return true;
}

async function isDelegatedRoleForDemande(agent, roleName, demandeOrg) {
  if (!agent?.id) return false;
  const target = normalizeRoleName(roleName);
  if (!target) return false;
  const roles = agentRoleSet(agent);
  if (roles.has("ADMIN")) return false;
  if (isDirectRoleForDemande(agent, target, demandeOrg)) return false;

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await prisma.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: target,
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

const RECEPTION_AGENT_SELECT = {
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
};

async function canActAsDirectorForDemande(tx, agentId, demandeOrg, { allowAdmin = true } = {}) {
  const client = tx || prisma;
  const agent = await getAgentById(client, agentId);
  if (!agent || agent.deleted_at) return false;

  const roles = agentRoleSet(agent);
  if (allowAdmin && roles.has("ADMIN")) return true;

  if (roles.has("DIRECTEUR")) {
    if (!agent.direction_id || !demandeOrg?.direction_id) return false;
    return Number(agent.direction_id) === Number(demandeOrg.direction_id);
  }

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await client.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: "DIRECTEUR",
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

async function canActAsResponsableForDemande(tx, agentId, demandeOrg) {
  const client = tx || prisma;
  const agent = await getAgentById(client, agentId);
  if (!agent || agent.deleted_at) return false;

  const roles = agentRoleSet(agent);
  if (roles.has("ADMIN")) return true;

  if (roles.has("RESPONSABLE")) {
    if (!agent.direction_id || !demandeOrg?.direction_id) return false;
    return Number(agent.direction_id) === Number(demandeOrg.direction_id);
  }

  const candidateScopes = candidateScopesForDemandeOrg(demandeOrg);
  const now = new Date();
  const delegation = await client.delegations.findFirst({
    where: {
      delegate_id: Number(agent.id),
      is_active: true,
      start_at: { lte: now },
      end_at: { gte: now },
      role_name: "RESPONSABLE",
      OR: [{ scope: null }, { scope: { in: candidateScopes } }],
    },
    select: { id: true },
  });

  return !!delegation;
}

async function getAgentFromAuthUser(user) {
  const userId = user?.userId ?? user?.id;
  if (!userId) return null;
  return prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { id: true, direction_id: true },
  });
}

async function getAgentWithUser(agentId) {
  if (!agentId) return null;
  return prisma.agents.findUnique({
    where: { id: Number(agentId) },
    include: { users: true, roles: true },
  });
}

function hasPermission(user, code) {
  const perm = normalizePermissionCode(code);
  if (!perm) return false;
  const list = Array.isArray(user?.permissions) ? user.permissions : [];
  return list.map(normalizePermissionCode).includes(perm);
}

async function receptionScopeWhereForUser(user) {
  const agent = await getAgentFromAuthUser(user);
  if (!agent) {
    const err = new Error("Accès interdit");
    err.statusCode = 403;
    throw err;
  }

  const filters = [];
  const listScopes = [];
  if (hasPermission(user, "RECEPTION_LIST")) {
    listScopes.push(...getScopesForPermissionFromUser(user, "RECEPTION_LIST"));
  }
  if (hasPermission(user, "RECEPTION_LIST_ALL")) {
    listScopes.push(...getScopesForPermissionFromUser(user, "RECEPTION_LIST_ALL"));
  }

  if (listScopes.length) {
    const scopeWhere = buildOrgScopeWhere(listScopes, {
      wrap: (base) => ({ demandes_paiement: { is: base } }),
    });
    if (scopeWhere === null) return null;
    if (scopeWhere) filters.push(scopeWhere);
  }

  if (hasPermission(user, "RECEPTION_LIST_SELF")) {
    filters.push({ demandes_paiement: { is: { demandeur_id: Number(agent.id) } } });
  }

  if (!filters.length) {
    const err = new Error("Accès interdit");
    err.statusCode = 403;
    throw err;
  }

  if (filters.length === 1) return filters[0];
  return { OR: filters };
}

function userDisplayNameFromAgent(agent) {
  const prenom = agent?.users?.prenom ? String(agent.users.prenom).trim() : "";
  const nom = agent?.users?.nom ? String(agent.users.nom).trim() : "";
  const full = `${prenom} ${nom}`.trim();
  return full || null;
}

function withReceptionDisplayNames(row) {
  if (!row) return row;
  return {
    ...row,
    receveur_nom: userDisplayNameFromAgent(row.agents_receptions_recu_par_idToagents) || row.receveur_nom || null,
    visa_directeur_nom: userDisplayNameFromAgent(row.agents_receptions_visa_directeur_idToagents) || null,
    visa_daf_nom: userDisplayNameFromAgent(row.agents_receptions_visa_daf_idToagents) || null,
  };
}

async function withReceptionDelegationFlags(row) {
  if (!row) return row;
  const demandeOrg = {
    direction_id: row?.demandes_paiement?.direction_id ?? null,
    departement_id: row?.demandes_paiement?.departement_id ?? null,
    service_id: row?.demandes_paiement?.service_id ?? null,
  };

  const visaDirecteurDelegated = row.visa_directeur_id
    ? await isDelegatedRoleForDemande(row.agents_receptions_visa_directeur_idToagents, "DIRECTEUR", demandeOrg)
    : false;
  const visaDafDelegated = row.visa_daf_id
    ? await isDelegatedRoleForDemande(row.agents_receptions_visa_daf_idToagents, "DAF", demandeOrg)
    : false;

  return {
    ...row,
    visa_directeur_delegated: Boolean(visaDirecteurDelegated),
    visa_daf_delegated: Boolean(visaDafDelegated),
  };
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

function buildReceptionCreationSignaturePdf({ payload, demande, paiement, receveur }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text("Creation de reception", { align: "center" });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10);

    const devise = demande?.devise ? String(demande.devise) : "FCFA";
    const montantDemande = demande?.montant_net != null ? demande.montant_net : demande?.montant;

    const rows = [
      ["Demande", demande?.uuid || demande?.id || "-"],
      ["Paiement", paiement?.uuid || paiement?.id || "-"],
      ["Motif", demande?.motif || "-"],
      ["Beneficiaire", demande?.beneficiaire || "-"],
      [
        "Montant demande",
        montantDemande != null ? `${formatMoneyValue(montantDemande)} ${devise}` : "-",
      ],
      ["Phase", payload?.phase || "-"],
      ["Conforme", payload?.conforme ? "Oui" : "Non"],
      ["Receveur", agentDisplayName(receveur)],
      ["Date reception", formatDateTime(payload?.date_reception || new Date())],
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

function buildReceptionVisaSignaturePdf({ kind, reception, demande, signer, commentaire }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const title = kind === "daf" ? "Visa DAF" : "Visa Directeur";
    doc.font("Helvetica-Bold").fontSize(16).text(title, { align: "center" });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10);

    const devise = demande?.devise ? String(demande.devise) : "FCFA";
    const montantDemande = demande?.montant_net != null ? demande.montant_net : demande?.montant;

    const rows = [
      ["Reception", reception?.uuid || reception?.id || "-"],
      ["Demande", demande?.uuid || demande?.id || "-"],
      ["Motif", demande?.motif || "-"],
      ["Beneficiaire", demande?.beneficiaire || "-"],
      [
        "Montant demande",
        montantDemande != null ? `${formatMoneyValue(montantDemande)} ${devise}` : "-",
      ],
      ["Conforme", reception?.conforme ? "Oui" : "Non"],
      ["Receveur", reception?.receveur_nom || agentDisplayName(reception?.agents_receptions_recu_par_idToagents)],
      ["Signataire", agentDisplayName(signer)],
      ["Commentaire", commentaire ? String(commentaire) : "-"],
      ["Date", formatDateTime(new Date())],
    ];

    rows.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(String(value ?? "-"));
    });

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(9).text(
      "Ce document sert uniquement de preuve de signature electronique pour le visa."
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

async function findUserIdByAgentId(agentId) {
  if (!agentId) return null;
  const a = await prisma.agents.findUnique({
    where: { id: Number(agentId) },
    select: { users: { select: { id: true } } },
  });
  return a?.users?.id || null;
}

async function resolveDemandeurUserIdByDemandeId(demandeId) {
  if (!demandeId) return null;
  const d = await prisma.demandes_paiement.findUnique({
    where: { id: Number(demandeId) },
    select: {
      agents_demandes_paiement_demandeur_idToagents: { select: { users: { select: { id: true } } } },
      uuid: true,
    },
  });
  return d?.agents_demandes_paiement_demandeur_idToagents?.users?.id || null;
}

async function resolveRoleUserId(roleName) {
  const role = await prisma.roles.findFirst({ where: { name: String(roleName).toUpperCase(), is_active: true } });
  if (!role) return null;
  const agent = await prisma.agents.findFirst({
    where: { role_id: role.id, deleted_at: null },
    select: { users: { select: { id: true } } },
    orderBy: { id: "asc" },
  });
  return agent?.users?.id || null;
}

async function createReception(payload, userAgentId, options = {}) {
  const {
    paiement_id,
    demande_id,
    phase: phaseRaw,
    date_reception,
    conforme,
    description,
    reference_facture,
    montant,
    observations,
  } = payload;

  const requestedPhase = normalizeReceptionPhase(phaseRaw);
  if (phaseRaw != null && !requestedPhase) {
    const err = new Error("Phase de réception invalide");
    err.statusCode = 400;
    throw err;
  }

  const phase = requestedPhase || (paiement_id ? "APRES_PAIEMENT" : "AVANT_PAIEMENT");

  if (!paiement_id && !demande_id) {
    const err = new Error("paiement_id ou demande_id obligatoire");
    err.statusCode = 400;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    let demande;
    let paiement = null;

    if (paiement_id) {
      paiement = await tx.paiements.findUnique({
        where: { id: Number(paiement_id) },
        include: {
          demandes_paiement: {
            include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
          },
        },
      });

      if (!paiement) {
        const err = new Error("Paiement introuvable");
        err.statusCode = 404;
        throw err;
      }

      demande = paiement.demandes_paiement;

      if (demande_id && Number(demande_id) !== Number(paiement.demande_id)) {
        const err = new Error("paiement_id et demande_id ne correspondent pas");
        err.statusCode = 400;
        throw err;
      }
    } else {
      if (!demande_id) {
        const err = new Error("demande_id obligatoire pour une réception avant paiement");
        err.statusCode = 400;
        throw err;
      }
      demande = await tx.demandes_paiement.findUnique({
        where: { id: Number(demande_id) },
        include: { agents_demandes_paiement_demandeur_idToagents: { include: { users: true } } },
      });

      if (!demande) {
        const err = new Error("Demande introuvable");
        err.statusCode = 404;
        throw err;
      }
    }

    const demandeOrg = {
      direction_id: demande?.direction_id ?? null,
      departement_id: demande?.departement_id ?? null,
      service_id: demande?.service_id ?? null,
    };

    const isOwner = Number(demande.demandeur_id) === Number(userAgentId);
    const canDirector = await canActAsDirectorForDemande(tx, userAgentId, demandeOrg);
    const canResponsable = await canActAsResponsableForDemande(tx, userAgentId, demandeOrg);
    if (!isOwner && !canDirector && !canResponsable) {
      const err = new Error("Seul le Directeur de la direction, le responsable ou le demandeur peut créer une réception");
      err.statusCode = 403;
      throw err;
    }
    if ((isOwner || canResponsable) && !canDirector) {
      const pending = await tx.validation_steps.count({
        where: {
          demande_id: Number(demande.id),
          status: { not: "valide" },
        },
      });
      if (pending > 0) {
        const err = new Error("Demande non eligible: validations incomplètes");
        err.statusCode = 409;
        throw err;
      }

      const statut = String(demande?.statut || "").toLowerCase();
      const allowedStatuts = new Set(["approuvee", "en_attente_paiement", "paye", "payee"]);
      if (!allowedStatuts.has(statut)) {
        const err = new Error("Demande non eligible pour réception");
        err.statusCode = 409;
        throw err;
      }
    }



    let hasPaiement = Boolean(paiement_id);
    if (!hasPaiement) {
      const paiementCount = await tx.paiements.count({ where: { demande_id: Number(demande.id) } });
      hasPaiement = paiementCount > 0;
    }

    if (phase === "APRES_PAIEMENT" && !hasPaiement) {
      const err = new Error("Aucun paiement enregistré pour cette demande");
      err.statusCode = 400;
      throw err;
    }

    if (phase === "AVANT_PAIEMENT" && hasPaiement) {
      const err = new Error("Paiement déjà effectué pour cette demande");
      err.statusCode = 400;
      throw err;
    }

    const existingReception = await tx.receptions.findFirst({
      where: { demande_id: Number(demande.id), phase },
      select: { id: true },
    });
    if (existingReception) {
      const err = new Error("Réception déjà créée pour cette phase");
      err.statusCode = 409;
      throw err;
    }

    const demandeurAgentId = demande?.demandeur_id ? Number(demande.demandeur_id) : null;
    const demandeurCanDirector = demandeurAgentId
      ? await canActAsDirectorForDemande(tx, demandeurAgentId, demandeOrg, { allowAdmin: false })
      : false;
    const autoVisaDirecteur = demandeurCanDirector && (conforme != null ? Boolean(conforme) : false);

    const reception = await tx.receptions.create({
      data: {
        uuid: uuidv4(),
        demande_id: Number(demande.id),
        paiement_id: phase === "APRES_PAIEMENT" && paiement_id ? Number(paiement_id) : null,
        phase,
        date_reception: date_reception ? new Date(date_reception) : new Date(),
        conforme: conforme != null ? Boolean(conforme) : false,
        recu_par_id: Number(userAgentId),
        visa_directeur_id: autoVisaDirecteur ? Number(demandeurAgentId) : null,
        created_at: new Date(),
        description: description ? String(description) : "",
        fournisseur: "",
        reference_facture: reference_facture ? String(reference_facture) : null,
        montant: montant != null && String(montant).trim() !== "" ? Number(montant) : null,
        observations: observations ? String(observations) : null,
      },
      include: { demandes_paiement: true },
    });

    // ✅ statut demande:
    // - si en attente paiement, on conserve
    // - sinon -> receptionnee (la cloture est manuelle)
    const currentStatut = String(demande?.statut || "").toLowerCase();
    const keepStatuts = new Set(["en_attente_paiement", "paye", "payee", "cloture", "cloturee", "receptionnee"]);
    const nextStatut = keepStatuts.has(currentStatut) ? currentStatut : "receptionnee";

    await tx.demandes_paiement.update({
      where: { id: Number(demande.id) },
      data: { statut: nextStatut, updated_at: new Date() },
    });

    const demandeurUser = demande?.agents_demandes_paiement_demandeur_idToagents?.users;
    return {
      reception,
      demandeurUserId: demandeurUser?.id || null,
      demandeId: Number(demande.id),
      nextStatut,
      paiementId: paiement ? paiement.id : null,
      autoVisaDirecteur,
    };
  });

  try {
    if (result?.demandeurUserId) {
      await notifications.createNotification({
        user_id: result.demandeurUserId,
        type: "reception_creee",
        demande_id: result.demandeId,
        message: `Réception créée pour votre demande. Statut: ${result.nextStatut}.`,
        meta: {
          receptionId: result.reception.id,
          receptionUuid: result.reception.uuid,
          ...(result.paiementId ? { paiementId: result.paiementId } : {}),
        },
        sendEmailNow: true,
      });
    }

    if (result?.autoVisaDirecteur) {
      const dafUserId = await resolveRoleUserId("DAF");
      if (dafUserId) {
        await notifications.createNotification({
          user_id: dafUserId,
          type: "reception_visa_pending",
          demande_id: result.demandeId,
          message: "Une réception attend votre Visa DAF.",
          meta: {
            receptionId: result.reception.id,
            receptionUuid: result.reception.uuid,
            ...(result.paiementId ? { paiementId: result.paiementId } : {}),
          },
          sendEmailNow: true,
        });
      }
    }
  } catch {
    // ignore email errors
  }

  try {
    const actorUserId = await findUserIdByAgentId(result?.reception?.recu_par_id);
    if (actorUserId) {
      await realtime.emitReceptionPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return result.reception;
}

async function startCreateSignature(payload, userAgentId, userId) {
  if (!payload?.paiement_id && !payload?.demande_id) {
    const err = new Error("paiement_id ou demande_id obligatoire");
    err.statusCode = 400;
    throw err;
  }

  const requestedPhase = normalizeReceptionPhase(payload.phase);
  if (payload.phase != null && !requestedPhase) {
    const err = new Error("Phase de reception invalide");
    err.statusCode = 400;
    throw err;
  }
  const phase = requestedPhase || (payload.paiement_id ? "APRES_PAIEMENT" : "AVANT_PAIEMENT");

  let demande = null;
  let paiement = null;

  if (payload.paiement_id) {
    paiement = await prisma.paiements.findUnique({
      where: { id: Number(payload.paiement_id) },
      include: { demandes_paiement: true },
    });
    if (!paiement) {
      const err = new Error("Paiement introuvable");
      err.statusCode = 404;
      throw err;
    }
    demande = paiement.demandes_paiement;
  } else if (payload.demande_id) {
    demande = await prisma.demandes_paiement.findUnique({
      where: { id: Number(payload.demande_id) },
    });
    if (!demande) {
      const err = new Error("Demande introuvable");
      err.statusCode = 404;
      throw err;
    }
  }

  const signer = await getAgentWithUser(userAgentId);
  if (!signer || !signer.users?.email) {
    const err = new Error("Email du signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  const pdfBuffer = await buildReceptionCreationSignaturePdf({
    payload: { ...(payload || {}), phase },
    demande,
    paiement,
    receveur: signer,
  });

  const { first_name, last_name } = splitAgentName(signer);
  const email = String(signer.users.email).trim();
  const recipientId = "temp_signer_1";

  const signingRequest = await firma.createSigningRequest({
    name: `Creation reception ${demande?.uuid || demande?.id || ""}`,
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

  const signerUserId = userId != null ? Number(userId) : await findUserIdByAgentId(userAgentId);
  if (!signerUserId) {
    const err = new Error("Utilisateur signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  const signaturePayload = {
    signer_user_id: signerUserId,
    signer_agent_id: Number(userAgentId),
    signer_email: email,
    created_at: new Date().toISOString(),
    phase,
  };

  const sessionPayload = {
    ...(payload || {}),
    phase,
    date_reception: payload?.date_reception || new Date().toISOString(),
  };

  const session = await signatureSessions.createSignatureSession({
    entity_type: "reception",
    action: "create",
    entity_id: null,
    signer_user_id: signerUserId,
    signer_agent_id: Number(userAgentId),
    signature_provider: "firma",
    signature_request_id: String(signingRequestId),
    signature_request_user_id: firmaSignerUserId != null ? String(firmaSignerUserId) : null,
    signature_status: "pending",
    payload: sessionPayload,
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
  if (session.entity_type !== "reception" || session.action !== "create") {
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
      const existing = await prisma.receptions.findUnique({ where: { id: Number(session.entity_id) } });
      return existing || { alreadyCompleted: true };
    }
    return { alreadyCompleted: true };
  }
  if (!session.signature_request_id) {
    throw new Error("Signature non initialisee");
  }

  const signer = await getAgentWithUser(session.signer_agent_id);
  const fallbackEmail = signer?.users?.email ? String(signer.users.email).trim() : "";
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
  const reception = await createReception(payload, Number(session.signer_agent_id), { signatureValidated: true });

  await signatureSessions.updateSignatureSession(session.id, {
    signature_status: "completed",
    signature_url: finalDocumentUrl || null,
    entity_id: Number(reception.id),
    signature_payload: {
      ...(session.signature_payload || {}),
      completed_at: new Date().toISOString(),
      final_document_url: finalDocumentUrl || null,
    },
  });

  return { ...reception, signature_url: finalDocumentUrl || null };
}

async function startVisaSignature(kind, receptionId, payload, agentId, userId) {
  const reception = await prisma.receptions.findUnique({
    where: { id: Number(receptionId) },
    include: {
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
    },
  });
  if (!reception) {
    const err = new Error("Reception introuvable");
    err.statusCode = 404;
    throw err;
  }

  if (kind === "directeur") {
    if (reception.visa_directeur_id) {
      const err = new Error("Reception deja visee par le Directeur");
      err.statusCode = 409;
      throw err;
    }
    const demandeOrg = {
      direction_id: reception?.demandes_paiement?.direction_id ?? null,
      departement_id: reception?.demandes_paiement?.departement_id ?? null,
      service_id: reception?.demandes_paiement?.service_id ?? null,
    };
    const canVisa = await canActAsDirectorForDemande(prisma, agentId, demandeOrg);
    if (!canVisa) {
      const err = new Error("Visa Directeur non autorise pour cette direction");
      err.statusCode = 403;
      throw err;
    }
  } else if (kind === "daf") {
    if (!reception.visa_directeur_id) {
      const err = new Error("Visa Directeur requis avant le Visa DAF");
      err.statusCode = 409;
      throw err;
    }
    if (reception.visa_daf_id) {
      const err = new Error("Reception deja visee par le DAF");
      err.statusCode = 409;
      throw err;
    }
  } else {
    const err = new Error("Type de visa invalide");
    err.statusCode = 400;
    throw err;
  }

  const signer = await getAgentWithUser(agentId);
  if (!signer || !signer.users?.email) {
    const err = new Error("Email du signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  const commentaireTrimmed = payload?.commentaire != null ? String(payload.commentaire).trim() : "";
  const pdfBuffer = await buildReceptionVisaSignaturePdf({
    kind,
    reception,
    demande: reception.demandes_paiement,
    signer,
    commentaire: commentaireTrimmed,
  });

  const { first_name, last_name } = splitAgentName(signer);
  const email = String(signer.users.email).trim();
  const recipientId = "temp_signer_1";

  const signingRequest = await firma.createSigningRequest({
    name: `${kind === "daf" ? "Visa DAF" : "Visa Directeur"} ${reception.uuid || reception.id}`,
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

  const signerUserId = userId != null ? Number(userId) : await findUserIdByAgentId(agentId);
  if (!signerUserId) {
    const err = new Error("Utilisateur signataire introuvable");
    err.statusCode = 400;
    throw err;
  }

  const signaturePayload = {
    signer_user_id: signerUserId,
    signer_agent_id: Number(agentId),
    signer_email: email,
    created_at: new Date().toISOString(),
    kind,
  };

  const session = await signatureSessions.createSignatureSession({
    entity_type: "reception",
    action: kind === "daf" ? "visa_daf" : "visa_directeur",
    entity_id: Number(reception.id),
    signer_user_id: signerUserId,
    signer_agent_id: Number(agentId),
    signature_provider: "firma",
    signature_request_id: String(signingRequestId),
    signature_request_user_id: firmaSignerUserId != null ? String(firmaSignerUserId) : null,
    signature_status: "pending",
    payload: { commentaire: commentaireTrimmed || null },
    signature_payload: signaturePayload,
  });

  return {
    sessionId: session.id,
    signingRequestId: String(signingRequestId),
    signingRequestUserId: firmaSignerUserId != null ? String(firmaSignerUserId) : null,
    signingUrl,
  };
}

async function completeVisaSignature(kind, sessionId, userId, receptionId = null) {
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
  const expectedAction = kind === "daf" ? "visa_daf" : "visa_directeur";
  if (session.entity_type !== "reception" || session.action !== expectedAction) {
    const err = new Error("Session de signature invalide");
    err.statusCode = 400;
    throw err;
  }
  if (receptionId != null && session.entity_id != null && Number(session.entity_id) !== Number(receptionId)) {
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
      const existing = await prisma.receptions.findUnique({ where: { id: Number(session.entity_id) } });
      return existing || { alreadyCompleted: true };
    }
    return { alreadyCompleted: true };
  }
  if (!session.signature_request_id) {
    throw new Error("Signature non initialisee");
  }

  const signer = await getAgentWithUser(session.signer_agent_id);
  const fallbackEmail = signer?.users?.email ? String(signer.users.email).trim() : "";
  const waitResult = await firma.waitForSignerFinished(session.signature_request_id, {
    signerUserId: session.signature_request_user_id,
    email: fallbackEmail,
    attempts: 6,
    delayMs: 600,
  });
  const signerUser = waitResult.signerUser;
  if (!signerUser) throw new Error("Signature introuvable");
  if (!firma.isSignerFinished(signerUser)) {
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
  const reception =
    kind === "daf"
      ? await visaDaf(session.entity_id, payload, Number(session.signer_agent_id), { signatureValidated: true })
      : await visaDirecteur(session.entity_id, payload, Number(session.signer_agent_id), { signatureValidated: true });

  await signatureSessions.updateSignatureSession(session.id, {
    signature_status: "completed",
    signature_url: finalDocumentUrl || null,
    entity_id: Number(reception.id),
    signature_payload: {
      ...(session.signature_payload || {}),
      completed_at: new Date().toISOString(),
      final_document_url: finalDocumentUrl || null,
    },
  });

  return { ...reception, signature_url: finalDocumentUrl || null };
}

async function startVisaDirecteurSignature(receptionId, payload, agentId, userId) {
  return startVisaSignature("directeur", receptionId, payload, agentId, userId);
}

async function startVisaDafSignature(receptionId, payload, agentId, userId) {
  return startVisaSignature("daf", receptionId, payload, agentId, userId);
}

async function completeVisaDirecteurSignature(sessionId, userId, receptionId = null) {
  return completeVisaSignature("directeur", sessionId, userId, receptionId);
}

async function completeVisaDafSignature(sessionId, userId, receptionId = null) {
  return completeVisaSignature("daf", sessionId, userId, receptionId);
}

async function listReceptions(query = {}, authUser = null) {
  const where = {};

  if (query.demande_id) where.demande_id = Number(query.demande_id);
  if (query.conforme != null) where.conforme = query.conforme === "true";
  if (query.phase) {
    const phase = normalizeReceptionPhase(query.phase);
    if (phase) where.phase = phase;
  }

  if (query.date_debut || query.date_fin) {
    where.date_reception = {};
    if (query.date_debut) where.date_reception.gte = new Date(query.date_debut);
    if (query.date_fin) where.date_reception.lte = new Date(query.date_fin);
  }

  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const scopedWhere = scopeWhere ? { AND: [where, scopeWhere] } : where;

  const rows = await prisma.receptions.findMany({
    where: scopedWhere,
    orderBy: { created_at: "desc" },
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_directeur_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_daf_idToagents: { select: RECEPTION_AGENT_SELECT },
    },
  });

  return Promise.all(
    (rows || []).map(async (row) => withReceptionDelegationFlags(withReceptionDisplayNames(row)))
  );
}

async function getReceptionById(id, authUser = null) {
  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const where = scopeWhere
    ? { AND: [{ id: Number(id) }, scopeWhere] }
    : { id: Number(id) };
  const row = await prisma.receptions.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_directeur_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_daf_idToagents: { select: RECEPTION_AGENT_SELECT },
    },
  });
  return withReceptionDelegationFlags(withReceptionDisplayNames(row));
}

async function getReceptionByUuid(uuid, authUser = null) {
  const scopeWhere = await receptionScopeWhereForUser(authUser);
  const where = scopeWhere
    ? { AND: [{ uuid: String(uuid) }, scopeWhere] }
    : { uuid: String(uuid) };
  const row = await prisma.receptions.findFirst({
    where,
    include: {
      documents: true,
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_directeur_idToagents: { select: RECEPTION_AGENT_SELECT },
      agents_receptions_visa_daf_idToagents: { select: RECEPTION_AGENT_SELECT },
    },
  });
  return withReceptionDelegationFlags(withReceptionDisplayNames(row));
}

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

async function getReceptionByIdOrUuid(idOrUuid, authUser = null) {
  return isNumericId(idOrUuid)
    ? getReceptionById(idOrUuid, authUser)
    : getReceptionByUuid(idOrUuid, authUser);
}

async function assertCanReadReception(idOrUuid, authUser = null) {
  const row = await getReceptionByIdOrUuid(idOrUuid, authUser);
  if (!row) {
    const err = new Error("Réception introuvable");
    err.statusCode = 404;
    throw err;
  }
  return true;
}

async function updateReception(id, payload, actorAgentId) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) return null;
  if (existing.visa_directeur_id) throw new Error("Réception déjà visée par le Directeur");

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["ADMIN"]);
  const isOwner = Number(existing.recu_par_id) === Number(actorAgentId);
  if (!isOwner && !privileged.has(role)) throw new Error("Modification non autorisée");

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      description: payload.description ?? undefined,
      reference_facture: payload.reference_facture ?? undefined,
      montant: payload.montant ?? undefined,
      date_reception: payload.date_reception ? new Date(payload.date_reception) : undefined,
      conforme: payload.conforme != null ? Boolean(payload.conforme) : undefined,
      observations: payload.observations ?? undefined,
      updated_at: new Date(),
    },
  });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_updated",
        demande_id: existing.demande_id,
        message: "Une réception liée à votre demande a été modifiée.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    if (actorUserId) {
      await realtime.emitReceptionPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return updated;
}

async function visaDirecteur(
  id,
  { signature_directeur_url, signature_data_url, commentaire } = {},
  directeurAgentId,
  options = {}
) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (existing.visa_directeur_id) throw new Error("Réception déjà visée par le Directeur");

  const demandeOrg = await prisma.demandes_paiement.findUnique({
    where: { id: Number(existing.demande_id) },
    select: { direction_id: true, departement_id: true, service_id: true },
  });

  const canVisa = await canActAsDirectorForDemande(prisma, directeurAgentId, demandeOrg);
  if (!canVisa) {
    const err = new Error("Visa Directeur non autorisé pour cette direction");
    err.statusCode = 403;
    throw err;
  }

  // On ignore les signatures car on ne les gère plus
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_directeur_id: Number(directeurAgentId),
      // Plus de signature_directeur_url
      visa_directeur_commentaire: commentaireTrimmed ? commentaireTrimmed : null,
      updated_at: new Date(),
    },
  });

  // Notifications after commit (emails non-bloquants)
  try {
    const actorUserId = await findUserIdByAgentId(directeurAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);
    const dafUserId = await resolveRoleUserId("DAF");

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_visa_directeur",
        demande_id: existing.demande_id,
        message: "La réception a été visée par le Directeur.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }

    if (dafUserId && Number(dafUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: dafUserId,
        type: "reception_visa_pending",
        demande_id: existing.demande_id,
        message: "Une réception attend votre Visa DAF.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  try {
    const actorUserId = await findUserIdByAgentId(directeurAgentId);
    if (actorUserId) {
      await realtime.emitReceptionPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return updated;
}

async function visaDaf(id, { signature_daf_url, signature_data_url, commentaire } = {}, dafAgentId, options = {}) {
  const existing = await prisma.receptions.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Reception introuvable");
  if (!existing.visa_directeur_id) throw new Error("Visa Directeur requis avant le Visa DAF");
  if (existing.visa_daf_id) throw new Error("Réception déjà visée par le DAF");

  // On ignore les signatures car on ne les gère plus
  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";

  const updated = await prisma.receptions.update({
    where: { id: Number(id) },
    data: {
      visa_daf_id: Number(dafAgentId),
      // Plus de signature_daf_url
      visa_daf_commentaire: commentaireTrimmed ? commentaireTrimmed : null,
      updated_at: new Date(),
    },
  });

  try {
    const actorUserId = await findUserIdByAgentId(dafAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_visa_daf",
        demande_id: existing.demande_id,
        message: "La réception a été visée par le DAF. Tous les visas sont faits, vous pouvez clôturer votre demande.",
        meta: { receptionId: updated.id, receptionUuid: updated.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  try {
    const actorUserId = await findUserIdByAgentId(dafAgentId);
    if (actorUserId) {
      await realtime.emitReceptionPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return updated;
}

async function deleteReception(id, actorAgentId) {
  const existing = await prisma.receptions.findUnique({
    where: { id: Number(id) },
    select: { id: true, uuid: true, demande_id: true, recu_par_id: true, visa_directeur_id: true },
  });
  if (!existing) {
    const err = new Error("Reception introuvable");
    err.statusCode = 404;
    throw err;
  }
  if (existing.visa_directeur_id) {
    const err = new Error("Réception déjà visée par le Directeur");
    err.statusCode = 409;
    throw err;
  }

  // Autorisation: le receveur ou rôles privilégiés
  const actor = await prisma.agents.findUnique({
    where: { id: Number(actorAgentId) },
    include: { roles: true },
  });
  const role = String(actor?.roles?.name || "").toUpperCase();
  const privileged = new Set(["ADMIN"]);
  const isOwner = Number(existing.recu_par_id) === Number(actorAgentId);
  if (!isOwner && !privileged.has(role)) {
    const err = new Error("Suppression non autorisée");
    err.statusCode = 403;
    throw err;
  }

  await prisma.receptions.delete({ where: { id: Number(id) } });

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    const demandeurUserId = await resolveDemandeurUserIdByDemandeId(existing.demande_id);

    if (demandeurUserId && Number(demandeurUserId) !== Number(actorUserId)) {
      await notifications.createNotification({
        user_id: demandeurUserId,
        type: "reception_deleted",
        demande_id: existing.demande_id,
        message: "Une réception liée à votre demande a été supprimée.",
        meta: { receptionId: existing.id, receptionUuid: existing.uuid },
        sendEmailNow: true,
      });
    }
  } catch {
    // ignore
  }

  try {
    const actorUserId = await findUserIdByAgentId(actorAgentId);
    if (actorUserId) {
      await realtime.emitReceptionPendingStatus(actorUserId);
    }
  } catch {
    // ignore realtime errors
  }

  return true;
}

module.exports = {
  createReception,
  startCreateSignature,
  completeCreateSignature,
  startVisaDirecteurSignature,
  startVisaDafSignature,
  completeVisaDirecteurSignature,
  completeVisaDafSignature,
  listReceptions,
  getReceptionById,
  getReceptionByUuid,
  getReceptionByIdOrUuid,
  assertCanReadReception,
  updateReception,
  visaDirecteur,
  visaDaf,
  deleteReception,
};
