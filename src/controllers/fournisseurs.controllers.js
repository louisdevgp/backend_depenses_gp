const service = require("../services/fournisseurs.services");

function parseBool(v) {
  if (v === undefined) return undefined;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return undefined;
}

async function create(req, res) {
  try {
    if (!req.body?.nom) {
      return res.status(400).json({ success: false, message: "nom est requis" });
    }
    const fournisseur = await service.createFournisseur(req.body);
    return res.status(201).json({ success: true, data: fournisseur });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function list(req, res) {
  try {
    const q = req.query.q ? String(req.query.q) : undefined;
    const is_active = parseBool(req.query.is_active);
    const include_contacts = parseBool(req.query.include_contacts) ?? false;

    const data = await service.listFournisseurs({ q, is_active, include_contacts });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function getOne(req, res) {
  try {
    const include_contacts = (req.query.include_contacts === "true");
    const data = await service.getFournisseur(req.params.idOrUuid, include_contacts);
    if (!data) return res.status(404).json({ success: false, message: "Fournisseur introuvable" });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function update(req, res) {
  try {
    const data = await service.updateFournisseur(req.params.idOrUuid, req.body || {});
    if (!data) return res.status(404).json({ success: false, message: "Fournisseur introuvable" });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function remove(req, res) {
  try {
    const data = await service.softDeleteFournisseur(req.params.idOrUuid);
    if (!data) return res.status(404).json({ success: false, message: "Fournisseur introuvable" });
    return res.json({ success: true, message: "Fournisseur supprimé (soft delete)", data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

module.exports = { create, list, getOne, update, remove };
