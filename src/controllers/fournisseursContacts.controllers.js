const service = require("../services/fournisseursContacts.services");

async function create(req, res) {
  try {
    if (!req.body?.nom) return res.status(400).json({ success: false, message: "nom est requis" });

    const result = await service.createContact(req.params.fournisseurIdOrUuid, req.body);
    if (result?.notFound) return res.status(404).json({ success: false, message: "Fournisseur introuvable" });

    return res.status(201).json({ success: true, data: result.created });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function list(req, res) {
  try {
    const data = await service.listContacts(req.params.fournisseurIdOrUuid);
    if (!data) return res.status(404).json({ success: false, message: "Fournisseur introuvable" });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function getOne(req, res) {
  try {
    const data = await service.getContact(req.params.fournisseurIdOrUuid, req.params.contactIdOrUuid);
    if (!data) return res.status(404).json({ success: false, message: "Contact introuvable" });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function update(req, res) {
  try {
    const data = await service.updateContact(req.params.fournisseurIdOrUuid, req.params.contactIdOrUuid, req.body || {});
    if (!data) return res.status(404).json({ success: false, message: "Contact introuvable" });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

async function remove(req, res) {
  try {
    const ok = await service.deleteContact(req.params.fournisseurIdOrUuid, req.params.contactIdOrUuid);
    if (!ok) return res.status(404).json({ success: false, message: "Contact introuvable" });
    return res.json({ success: true, message: "Contact supprimé" });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erreur serveur", error: String(e.message || e) });
  }
}

module.exports = { create, list, getOne, update, remove };
