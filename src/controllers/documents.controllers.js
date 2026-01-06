const documentsService = require("../services/documents.services");
const prisma = require("../config/prisma");
// const { serializeBigInt } = require("../utils/jsonBigInt.utils");
const { jsonSafe } = require("../utils/jsonSafe");

exports.uploadMany = async (req, res) => {
  try {
    const userId = req.user.userId;

    const agent = await prisma.agents.findFirst({
      where: { user_id: userId, deleted_at: null },
    });

    if (!agent) {
      return res.status(400).json({
        success: false,
        message: "Agent non trouvé pour l'utilisateur connecté",
      });
    }

    const files = req.files || [];
    if (!files.length) throw new Error("Aucun fichier reçu (champ 'files')");

    const docs = await documentsService.createDocumentsFromUploads({
      files,
      body: req.body,
      upload_by_id: agent.id,
    });

    res.json({ success: true, data: jsonSafe(docs) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.list = async (req, res) => {
  try {
    const docs = await documentsService.listDocuments(req.query); 
    res.json({ success: true, data: jsonSafe(docs) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }

};

exports.getById = async (req, res) => { 
  try {
    const doc = await documentsService.getDocumentById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    res.json({ success: true, data: jsonSafe(doc) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await documentsService.deleteDocument(req.params.id);
    res.json({ success: true, message: "Document deleted" });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};


