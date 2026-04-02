const prisma = require("../config/prisma");
const crypto = require("crypto");

function mustGetEnv(name, fallbacks = []) {
  const candidates = [name, ...fallbacks];
  for (const key of candidates) {
    const v = process.env[key];
    if (v) return v;
  }
  return null;
}

function signatureSecret() {
  return mustGetEnv("SIGNATURE_SECRET", ["JWT_ACCESS_SECRET", "JWT_SECRET"]);
}

function hmacSignature(text) {
  const secret = signatureSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(String(text), "utf8").digest("base64url");
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function asIsoDateTime(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function demandeFinalizedAt(d) {
  const times = (d?.validation_steps || [])
    .map((s) => (s?.validated_at ? new Date(s.validated_at) : null))
    .filter((x) => x && !Number.isNaN(x.getTime()));
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((t) => t.getTime())));
}

function isDemandeFullyValidated(d) {
  const statutOk = normalizeStatus(d?.statut) === "approuvee";
  const steps = Array.isArray(d?.validation_steps) ? d.validation_steps : [];
  const allValid = steps.length > 0 && steps.every((s) => normalizeStatus(s?.status) === "valide");
  return statutOk && allValid;
}

function isReceptionFullyVised(r) {
  return Boolean(r?.visa_directeur_id) && Boolean(r?.visa_daf_id);
}

function parseQrToken(token) {
  const raw = String(token || "").trim();
  const parts = raw.split("|");
  if (parts.length !== 5) return null;
  const [prefix, type, uuid, finalizedIso, sig] = parts;
  if (prefix !== "GP") return null;
  if (!type || !uuid || !finalizedIso || !sig) return null;
  if (type !== "demande" && type !== "reception" && type !== "validation") return null;

  const dt = new Date(finalizedIso);
  if (Number.isNaN(dt.getTime())) return null;

  return { prefix, type, uuid, finalizedIso, sig };
}

function rolesFromReqUser(user) {
  const roles = user?.roles;
  if (Array.isArray(roles)) return roles.map((r) => String(r).toUpperCase());
  return [];
}

function canViewDemandeDetails({ user, demande }) {
  if (!user) return false;
  const roles = rolesFromReqUser(user);
  if (roles.includes("ADMIN")) return true;
  if (user?.agentId && Number(demande?.demandeur_id) === Number(user.agentId)) return true;
  const allow = ["RESPONSABLE", "DIRECTEUR", "DG", "DGA", "DAF", "COMPTABLE", "ADMIN"];
  return roles.some((r) => allow.includes(r));
}

function canViewReceptionDetails({ user }) {
  if (!user) return false;
  const roles = rolesFromReqUser(user);
  const allow = ["COMPTABLE", "DAF", "DIRECTEUR", "ADMIN"];
  return roles.some((r) => allow.includes(r));
}

async function verifyToken({ token, user = null }) {
  const parsed = parseQrToken(token);
  if (!parsed) {
    return { valid: false, reason: "BAD_FORMAT" };
  }

  const tokenBase = `GP|${parsed.type}|${parsed.uuid}|${parsed.finalizedIso}`;
  const expectedSig = hmacSignature(tokenBase);
  if (!expectedSig) {
    return { valid: false, reason: "SERVER_MISSING_SECRET" };
  }
  if (!timingSafeEqual(expectedSig, parsed.sig)) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  if (parsed.type === "demande") {
    const demande = await prisma.demandes_paiement.findFirst({
      where: { uuid: parsed.uuid, deleted_at: null },
      include: {
        validation_steps: {
          orderBy: { level: "asc" },
          include: { agents_validation_steps_validated_by_idToagents: { include: { users: true } } },
        },
        agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
      },
    });

    if (!demande) {
      return { valid: false, reason: "NOT_FOUND", type: parsed.type, uuid: parsed.uuid };
    }

    const isFinal = isDemandeFullyValidated(demande);
    const finalizedAt = isFinal ? demandeFinalizedAt(demande) : null;
    const expectedIso = asIsoDateTime(finalizedAt) || "";
    if (String(parsed.finalizedIso) !== String(expectedIso)) {
      return { valid: false, reason: "MISMATCH_FINALIZED_AT", type: parsed.type, uuid: parsed.uuid };
    }

    const publicApprovals = (demande.validation_steps || []).map((s) => ({
      role: s.role_name,
      status: s.status,
      validated_at: s.validated_at ? asIsoDateTime(s.validated_at) : null,
    }));

    const showDetails = canViewDemandeDetails({ user, demande });
    const approvals = showDetails
      ? (demande.validation_steps || []).map((s) => ({
          role: s.role_name,
          status: s.status,
          validated_at: s.validated_at ? asIsoDateTime(s.validated_at) : null,
          signature_id: s.signature_request_id || s.signature_request_user_id || null,
          signature_status: s.signature_status || null,
          validated_by: s.validated_by_id
            ? {
                id: s.validated_by_id,
                nom: s.agents_validation_steps_validated_by_idToagents?.nom || null,
                prenom: s.agents_validation_steps_validated_by_idToagents?.prenom || null,
                email: s.agents_validation_steps_validated_by_idToagents?.users?.email || null,
              }
            : null,
          commentaire: s.commentaire || null,
        }))
      : publicApprovals;

    return {
      valid: true,
      type: parsed.type,
      uuid: parsed.uuid,
      isFinal,
      finalizedAt: expectedIso,
      ref: String(parsed.sig).slice(0, 16),
      document: showDetails
        ? {
            motif: demande.motif,
            montant: demande.montant,
            beneficiaire: demande.beneficiaire,
            statut: demande.statut,
            created_at: asIsoDateTime(demande.created_at),
            demandeur: {
              id: demande.demandeur_id,
              nom: demande.agents_demandes_paiement_demandeur_idToagents?.nom || null,
              prenom: demande.agents_demandes_paiement_demandeur_idToagents?.prenom || null,
              email: demande.agents_demandes_paiement_demandeur_idToagents?.users?.email || null,
            },
          }
        : { statut: demande.statut },
      approvals,
      scope: showDetails ? "private" : "public",
    };
  }

  if (parsed.type === "validation") {
    const step = await prisma.validation_steps.findFirst({
      where: { uuid: parsed.uuid },
      include: {
        demandes_paiement: {
          include: {
            agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
          },
        },
        agents_validation_steps_validated_by_idToagents: { include: { users: true } },
      },
    });

    if (!step) {
      return { valid: false, reason: "NOT_FOUND", type: parsed.type, uuid: parsed.uuid };
    }

    const validatedIso = step.validated_at ? asIsoDateTime(step.validated_at) : "";
    if (!validatedIso || String(parsed.finalizedIso) !== String(validatedIso)) {
      return { valid: false, reason: "MISMATCH_VALIDATED_AT", type: parsed.type, uuid: parsed.uuid };
    }

    const demande = step.demandes_paiement || null;
    const showDetails = demande ? canViewDemandeDetails({ user, demande }) : false;

    const validatedBy = step.validated_by_id
      ? {
          id: step.validated_by_id,
          nom: step.agents_validation_steps_validated_by_idToagents?.nom || null,
          prenom: step.agents_validation_steps_validated_by_idToagents?.prenom || null,
          email: step.agents_validation_steps_validated_by_idToagents?.users?.email || null,
        }
      : null;

    return {
      valid: true,
      type: parsed.type,
      uuid: parsed.uuid,
      isFinal: true,
      finalizedAt: validatedIso,
      validatedAt: validatedIso,
      ref: String(parsed.sig).slice(0, 16),
      role: step.role_name,
      status: step.status,
      signature_id: step.signature_request_id || step.signature_request_user_id || null,
      signature_status: step.signature_status || null,
      validated_by: showDetails ? validatedBy : null,
      document: demande
        ? showDetails
          ? {
              uuid: demande.uuid,
              motif: demande.motif,
              montant: demande.montant,
              beneficiaire: demande.beneficiaire,
              statut: demande.statut,
              created_at: asIsoDateTime(demande.created_at),
            }
          : { statut: demande.statut, uuid: demande.uuid }
        : null,
      scope: showDetails ? "private" : "public",
    };
  }

  const reception = await prisma.receptions.findFirst({
    where: { uuid: parsed.uuid },
    include: {
      demandes_paiement: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });

  if (!reception) {
    return { valid: false, reason: "NOT_FOUND", type: parsed.type, uuid: parsed.uuid };
  }

  const isFinal = isReceptionFullyVised(reception);

  // Backward-compatible: accept tokens generated with created_at OR updated_at.
  const candidates = [asIsoDateTime(reception.created_at), asIsoDateTime(reception.updated_at)].filter(Boolean);
  if (!candidates.includes(String(parsed.finalizedIso))) {
    return { valid: false, reason: "MISMATCH_FINALIZED_AT", type: parsed.type, uuid: parsed.uuid };
  }

  const showDetails = canViewReceptionDetails({ user });

  const visasPublic = {
    visa_directeur: Boolean(reception.visa_directeur_id),
    visa_daf: Boolean(reception.visa_daf_id),
  };

  const visas = showDetails
    ? {
        visa_directeur: reception.visa_directeur_id
          ? {
              id: reception.visa_directeur_id,
              nom: reception.agents_receptions_visa_directeur_idToagents?.nom || null,
              prenom: reception.agents_receptions_visa_directeur_idToagents?.prenom || null,
              email: reception.agents_receptions_visa_directeur_idToagents?.users?.email || null,
            }
          : null,
        visa_daf: reception.visa_daf_id
          ? {
              id: reception.visa_daf_id,
              nom: reception.agents_receptions_visa_daf_idToagents?.nom || null,
              prenom: reception.agents_receptions_visa_daf_idToagents?.prenom || null,
              email: reception.agents_receptions_visa_daf_idToagents?.users?.email || null,
            }
          : null,
        recu_par: reception.recu_par_id
          ? {
              id: reception.recu_par_id,
              nom: reception.agents_receptions_recu_par_idToagents?.nom || null,
              prenom: reception.agents_receptions_recu_par_idToagents?.prenom || null,
              email: reception.agents_receptions_recu_par_idToagents?.users?.email || null,
            }
          : null,
      }
    : visasPublic;

  return {
    valid: true,
    type: parsed.type,
    uuid: parsed.uuid,
    isFinal,
    finalizedAt: String(parsed.finalizedIso),
    ref: String(parsed.sig).slice(0, 16),
        document: showDetails
      ? {
          description: reception.description,
          conforme: reception.conforme,
          date_reception: asIsoDateTime(reception.date_reception),
          demande_uuid: reception.demandes_paiement?.uuid || null,
        }
      : null,
    visas,
    scope: showDetails ? "private" : "public",
  };
}

module.exports = {
  verifyToken,
};
