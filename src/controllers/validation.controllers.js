const service = require("../services/validation.services");

exports.listMyPendingValidations = async (req, res) => {
  const data = await service.getPendingForUser(req.user.userId);
  res.json({ success: true, data });
};

exports.approveStep = async (req, res) => {
  const { stepId } = req.params;
  const { commentaire, budget_prevu, budget_disponible, paiement_immediat, daf_critere4 } =
    req.body || {};
  // On ignore signature_data_url car on ne gère plus les signatures électroniques
  const result = await service.approveStep(stepId, req.user.userId, commentaire, null, {
    budget_prevu,
    budget_disponible,
    paiement_immediat,
    daf_critere4,
  });
  res.json({ success: true, message: "Étape validée", data: result });
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
