const {uuid} = require("uuid")
const service = require("../services/conditionsPaiement.services");

exports.create = async (req, res) => {
  try {
    const payload = {
      uuid: uuid(),
      ...req.body,
      demande_id: Number(req.body.demande_id),
      paiement_id: req.body.paiement_id ? Number(req.body.paiement_id) : null,
      date_echeance: req.body.date_echeance ? new Date(req.body.date_echeance) : null,
    };
    const row = await service.createConditionPaiement(payload);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur create condition", error: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const rows = await service.listConditionsPaiement(req.query);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list conditions", error: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const row = await service.getConditionPaiementById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur get condition", error: e.message });
  }
};

exports.listByDemande = async (req, res) => {
  try {
    const rows = await service.listConditionsPaiement({ demande_id: req.params.demandeId });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur list conditions demande", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      paiement_id: req.body.paiement_id ? Number(req.body.paiement_id) : null,
      date_echeance: req.body.date_echeance ? new Date(req.body.date_echeance) : null,
    };
    const row = await service.updateConditionPaiement(req.params.id, payload);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur update condition", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await service.deleteConditionPaiement(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur delete condition", error: e.message });
  }
};
