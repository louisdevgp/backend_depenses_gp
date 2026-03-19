const receptionsService = require("../services/receptions.services");
const prisma = require("../config/prisma");
const pdfService = require("../services/pdf.services");

async function resolveAgentIdFromAuth(req) {
  if (req?.user?.agentId) return Number(req.user.agentId);

  const userId = req?.user?.userId;
  if (!userId) throw new Error("Token invalide: userId manquant");

  const agent = await prisma.agents.findFirst({
    where: { user_id: Number(userId), deleted_at: null },
    select: { id: true },
  });

  if (!agent) throw new Error("Agent non trouvé");
  return Number(agent.id);
}

exports.create = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const reception = await receptionsService.createReception(req.body, agentId);

    return res.status(201).json({ success: true, data: reception });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.startSignature = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const data = await receptionsService.startCreateSignature(req.body, agentId, authUserId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.completeSignature = async (req, res) => {
  try {
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const sessionId = req?.body?.session_id || req?.body?.sessionId;
    const data = await receptionsService.completeCreateSignature(sessionId, authUserId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};


exports.list = async (req, res) => {
  try {
    const rows = await receptionsService.listReceptions(req.query, req.user);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const row = await receptionsService.getReceptionById(req.params.id, req.user);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.getByUuid = async (req, res) => {
  try {
    const row = await receptionsService.getReceptionByUuid(req.params.uuid, req.user);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};

exports.pdf = async (req, res) => {
  try {
    await receptionsService.assertCanReadReception(req.params.idOrUuid, req.user);
    await pdfService.streamReceptionPdf(res, req.params.idOrUuid, { req });
  } catch (e) {
    return res.status(e.statusCode || 404).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const row = await receptionsService.updateReception(req.params.id, req.body, agentId);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.visaDirecteur = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const row = await receptionsService.visaDirecteur(req.params.id, req.body, agentId);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.startVisaDirecteurSignature = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const data = await receptionsService.startVisaDirecteurSignature(req.params.id, req.body, agentId, authUserId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.statusCode || 400).json({ success: false, message: e.message });
  }
};

exports.completeVisaDirecteurSignature = async (req, res) => {
  try {
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const sessionId = req?.body?.session_id || req?.body?.sessionId;
    const data = await receptionsService.completeVisaDirecteurSignature(sessionId, authUserId, req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.statusCode || 400).json({ success: false, message: e.message });
  }
};

exports.visaDaf = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const row = await receptionsService.visaDaf(req.params.id, req.body, agentId);
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.startVisaDafSignature = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const data = await receptionsService.startVisaDafSignature(req.params.id, req.body, agentId, authUserId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.statusCode || 400).json({ success: false, message: e.message });
  }
};

exports.completeVisaDafSignature = async (req, res) => {
  try {
    const authUserId = req?.user?.userId ?? req?.user?.id;
    const sessionId = req?.body?.session_id || req?.body?.sessionId;
    const data = await receptionsService.completeVisaDafSignature(sessionId, authUserId, req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.statusCode || 400).json({ success: false, message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const agentId = await resolveAgentIdFromAuth(req);
    await receptionsService.deleteReception(req.params.id, agentId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
