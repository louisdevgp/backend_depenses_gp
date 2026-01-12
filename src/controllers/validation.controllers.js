const service = require("../services/validation.services");

exports.listMyPendingValidations = async (req, res) => {
  const data = await service.getPendingForUser(req.user.userId);
  res.json({ success: true, data });
};

exports.approveStep = async (req, res) => {
  const { stepId } = req.params;
  const result = await service.approveStep(stepId, req.user.userId);
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

exports.listByDemande = async (req, res) => {
  const data = await service.getStepsByDemande(req.params.demandeId);
  res.json({ success: true, data });
};

exports.validationDone = async (req, res) => {
  const data = await service.validationDone(req.user.userId);
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
