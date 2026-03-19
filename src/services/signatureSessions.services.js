const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");

async function createSignatureSession({
  entity_type,
  action,
  entity_id = null,
  signer_user_id = null,
  signer_agent_id = null,
  signature_provider = "firma",
  signature_request_id = null,
  signature_request_user_id = null,
  signature_status = "pending",
  signature_url = null,
  payload = null,
  signature_payload = null,
} = {}) {
  return prisma.signature_sessions.create({
    data: {
      uuid: uuidv4(),
      entity_type,
      action,
      entity_id: entity_id != null ? Number(entity_id) : null,
      signer_user_id: signer_user_id != null ? Number(signer_user_id) : null,
      signer_agent_id: signer_agent_id != null ? Number(signer_agent_id) : null,
      signature_provider,
      signature_request_id: signature_request_id != null ? String(signature_request_id) : null,
      signature_request_user_id: signature_request_user_id != null ? String(signature_request_user_id) : null,
      signature_status,
      signature_url: signature_url != null ? String(signature_url) : null,
      payload,
      signature_payload,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });
}

async function getSignatureSessionById(sessionId) {
  if (!sessionId) return null;
  return prisma.signature_sessions.findUnique({ where: { id: Number(sessionId) } });
}

async function updateSignatureSession(sessionId, data = {}) {
  if (!sessionId) return null;
  return prisma.signature_sessions.update({
    where: { id: Number(sessionId) },
    data: { ...data, updated_at: new Date() },
  });
}

module.exports = {
  createSignatureSession,
  getSignatureSessionById,
  updateSignatureSession,
};
