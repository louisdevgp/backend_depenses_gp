const service = require("../services/validation.services");
const prisma = require("../config/prisma");
const firma = require("../services/firma.services");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function tokenHasRole(user, role) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.map(normalizeRoleName).includes(normalizeRoleName(role));
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\\/]/g, "_")
    .replace(/["']/g, "")
    .trim();
}

function filenameFromContentDisposition(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const matchStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(raw);
  if (matchStar?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(matchStar[1]));
    } catch {
      return sanitizeFilename(matchStar[1]);
    }
  }
  const match = /filename\s*=\s*"?([^\";]+)"?/i.exec(raw);
  if (match?.[1]) return sanitizeFilename(match[1]);
  return "";
}

exports.listMyPendingValidations = async (req, res) => {
  const data = await service.getPendingForUser(req.user.userId);
  res.json({ success: true, data });
};

exports.approveStep = async (req, res) => {
  const { stepId } = req.params;
  const {
    commentaire,
    budget_prevu,
    budget_disponible,
    paiement_immediat,
    daf_critere4,
    conditions_paiement_mode,
    conditions_paiement_custom,
    conditions_paiement_use_demandeur,
    validation_stop_role,
  } = req.body || {};
  // On ignore signature_data_url car on ne gère plus les signatures électroniques
  const result = await service.approveStep(stepId, req.user.userId, commentaire, null, {
    budget_prevu,
    budget_disponible,
    paiement_immediat,
    daf_critere4,
    conditions_paiement_mode,
    conditions_paiement_custom,
    conditions_paiement_use_demandeur,
    validation_stop_role,
  });
  res.json({ success: true, message: "Étape validée", data: result });
};

exports.startSignature = async (req, res) => {
  const { stepId } = req.params;
  const payload = req.body || {};
  try {
    const data = await service.startSignature(stepId, req.user.userId, payload);
    return res.json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.completeSignature = async (req, res) => {
  const { stepId } = req.params;
  try {
    const data = await service.completeSignature(stepId, req.user.userId);
    return res.json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.downloadSignature = async (req, res) => {
  try {
    const stepId = toNumber(req.params.stepId);
    if (!stepId) {
      return res.status(400).json({ success: false, message: "Validation invalide" });
    }

    const step = await prisma.validation_steps.findUnique({
      where: { id: Number(stepId) },
      select: {
        id: true,
        demande_id: true,
        validator_id: true,
        validated_by_id: true,
        signature_url: true,
        signature_request_id: true,
      },
    });
    if (!step) {
      return res.status(404).json({ success: false, message: "Validation introuvable" });
    }

    const userId = toNumber(req.user?.userId ?? req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const agent = await prisma.agents.findFirst({
      where: { user_id: Number(userId), deleted_at: null },
      select: { id: true, roles: { select: { name: true } } },
    });

    const roleName = agent?.roles?.name || "";
    const isAdmin = tokenHasRole(req.user, "ADMIN") || normalizeRoleName(roleName) === "ADMIN";
    const isSigner =
      agent?.id != null &&
      (Number(step.validator_id) === Number(agent.id) ||
        Number(step.validated_by_id) === Number(agent.id));

    if (!isSigner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Acces refuse" });
    }

    let signatureUrl = step.signature_url;
    if (!signatureUrl && step.signature_request_id) {
      try {
        const wait = await firma.waitForProofUrl(step.signature_request_id, { attempts: 4, delayMs: 900 });
        signatureUrl = wait?.url || "";
        if (signatureUrl) {
          await prisma.validation_steps.update({
            where: { id: Number(step.id) },
            data: { signature_url: signatureUrl },
          });
        }
      } catch {
        // ignore fetch errors
      }
    }

    if (!signatureUrl) {
      return res.status(409).json({ success: false, message: "Document de preuve indisponible" });
    }

    const file = await firma.downloadSignedDocument(signatureUrl);
    const suggested =
      filenameFromContentDisposition(file.contentDisposition) ||
      sanitizeFilename(`signature_validation_${step.id}.pdf`);

    res.setHeader("Content-Type", file.contentType || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${suggested}"`);
    if (file.contentLength) {
      res.setHeader("Content-Length", String(file.contentLength));
    }

    return res.send(file.data);
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message || "Telechargement impossible" });
  }
};

exports.rejectStep = async (req, res) => {
  const { stepId } = req.params;
  const { commentaire } = req.body;

  if (!commentaire) {
    return res.status(400).json({ success: false, message: "Commentaire obligatoire" });
  }

  const result = await service.rejectStep(stepId, req.user.userId, commentaire);
  res.json({ success: true, message: "Demande rejetée", data: result });
};

exports.returnForModification = async (req, res) => {
  const { stepId } = req.params;
  const { commentaire } = req.body || {};

  const commentaireTrimmed = commentaire != null ? String(commentaire).trim() : "";
  if (!commentaireTrimmed) {
    return res.status(400).json({ success: false, message: "Commentaire obligatoire" });
  }

  try {
    const result = await service.returnForModification(stepId, req.user.userId, commentaireTrimmed);
    return res.json({ success: true, message: "Demande retournée pour modification", data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.cancelStep = async (req, res) => {
  const { stepId } = req.params;
  const { commentaire, action, mode, type } = req.body || {};

  try {
    const result = await service.cancelStep(stepId, req.user.userId, {
      commentaire,
      action,
      mode,
      type,
    });
    return res.json({ success: true, message: "Validation annulee", data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.listByDemande = async (req, res) => {
  const data = await service.getStepsByDemande(req.params.demandeId);
  res.json({ success: true, data });
};

exports.validationDone = async (req, res) => {
  const data = await service.validationDone(req.user.userId);
  res.json({ success: true, data });
};

exports.validationHistory = async (req, res) => {
  const data = await service.validationHistory(req.user.userId, req.query || {});
  res.json({ success: true, data });
};

exports.getByUuid = async (req, res) => {
  const data = await service.getByUuid(req.params.uuid);
  res.json({ success: true, data });
};

exports.getValidationsDoneBydemande = async (req, res) => {
  const data = await service.getValidationsDoneBydemande(req.params.demandeUuid);
  res.json({ success: true, data });
};
