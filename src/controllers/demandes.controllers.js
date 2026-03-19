const service = require("../services/demandes.services");
const validationService = require("../services/validation.services");
const pdfService = require("../services/pdf.services");

exports.create = async (req, res) => {
  try {
    const result = await service.createDemande(req.user, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    console.error("createDemande error:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.startSignature = async (req, res) => {
  try {
    const result = await service.startCreateSignature(req.user, req.body);
    return res.json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.completeSignature = async (req, res) => {
  try {
    const sessionId = req?.body?.session_id || req?.body?.sessionId;
    const result = await service.completeCreateSignature(req.user, sessionId);
    return res.json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const result = await service.listDemandes(req.user, req.query);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.listMine = async (req, res) => {
  try {
    const result = await service.listMyDemandes(req.user);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.listByDemandeur = async (req, res) => {
  try {
    const demandeurId = Number(req.params.demandeurId);
    const result = await service.listByDemandeur(demandeurId);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const result = await service.getOne(req.user, req.params.idOrUuid);
    return res.json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 404;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.pdf = async (req, res) => {
  try {
    // ✅ même contrôle d'accès que le détail (ex: assistante technique par direction)
    await service.assertCanReadDemandeByIdOrUuid(req.user, req.params.idOrUuid);
    await pdfService.streamDemandePdf(res, req.params.idOrUuid, { req });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 404;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.validationHistory = async (req, res) => {
  try {
    const demande = await service.getDemandeHeader(req.user, req.params.idOrUuid);
    const data = await validationService.validationHistoryByDemandeId(demande.id, {
      ...(req.query || {}),
      demandeUuid: demande.uuid,
    });
    return res.json({ success: true, data });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.update(req.user, req.params.idOrUuid, req.body);
    return res.json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.softDelete = async (req, res) => {
  try {
    await service.softDelete(req.user, req.params.idOrUuid);
    return res.json({ success: true, message: "Demande désactivée (soft delete) ✅" });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};

exports.close = async (req, res) => {
  try {
    const result = await service.closeDemande(req.user, req.params.idOrUuid);
    return res.json({ success: true, data: result });
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message });
  }
};
