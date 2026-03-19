const crypto = require("crypto");
const prisma = require("../config/prisma");

const MAX_EVENTS = Math.max(10, Number(process.env.FIRMA_WEBHOOK_MAX_EVENTS || 100));
const APPLY_UPDATES = ["1", "true", "yes"].includes(String(process.env.FIRMA_WEBHOOK_APPLY || "").toLowerCase());
const SKIP_VERIFY = ["1", "true", "yes"].includes(String(process.env.FIRMA_WEBHOOK_SKIP_VERIFY || "").toLowerCase());
const TOLERANCE_SEC = Math.max(0, Number(process.env.FIRMA_WEBHOOK_TOLERANCE_SEC || 300));

const recentEvents = [];

function pushRecent(event) {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
}

function getHeader(req, name) {
  return req.headers?.[name.toLowerCase()] || req.get?.(name) || "";
}

function parseSignatureHeader(value) {
  const out = {};
  const raw = String(value || "").trim();
  if (!raw) return out;
  raw.split(",").forEach((part) => {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && v) out[k] = v;
  });
  return out;
}

function computeSignature(secret, timestamp, payload) {
  const signedPayload = `${timestamp}.${payload}`;
  return crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const abuf = Buffer.from(String(a), "utf8");
    const bbuf = Buffer.from(String(b), "utf8");
    if (abuf.length !== bbuf.length) return false;
    return crypto.timingSafeEqual(abuf, bbuf);
  } catch {
    return false;
  }
}

function verifyWithSecret(secret, headerValue, payload) {
  if (!secret || !headerValue) return { ok: false, reason: "missing" };
  const parts = parseSignatureHeader(headerValue);
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return { ok: false, reason: "invalid_header" };

  if (TOLERANCE_SEC > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };
    const age = Math.abs(nowSec - ts);
    if (age > TOLERANCE_SEC) return { ok: false, reason: "stale_timestamp" };
  }

  const expected = computeSignature(secret, timestamp, payload);
  const ok = safeEqual(expected, signature);
  return { ok, reason: ok ? null : "signature_mismatch", timestamp };
}

function extractEventPayload(req) {
  if (req?.rawBody && Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  if (typeof req?.rawBody === "string") return req.rawBody;
  return JSON.stringify(req?.body || {});
}

function normalizeEventType(event) {
  return String(event?.event_type || event?.type || "").trim();
}

function normalizeStatus(event, fallbackType) {
  const raw = event?.data?.status || event?.status;
  if (raw) return String(raw).toLowerCase();
  if (fallbackType && fallbackType.includes(".")) {
    return String(fallbackType.split(".").pop()).toLowerCase();
  }
  return "";
}

async function updateSignatureSessions(signingRequestId, status, eventInfo) {
  const sessions = await prisma.signature_sessions.findMany({
    where: { signature_request_id: String(signingRequestId) },
  });

  for (const session of sessions) {
    const existingPayload = session.signature_payload && typeof session.signature_payload === "object"
      ? session.signature_payload
      : {};
    const existingWebhook = existingPayload.webhook || {};
    if (existingWebhook.last_event_id && existingWebhook.last_event_id === eventInfo.event_id) {
      continue;
    }

    await prisma.signature_sessions.update({
      where: { id: session.id },
      data: {
        signature_status: status || session.signature_status,
        signature_payload: {
          ...existingPayload,
          webhook: {
            ...existingWebhook,
            last_event_id: eventInfo.event_id || null,
            last_event_type: eventInfo.event_type || null,
            last_event_at: eventInfo.event_at || eventInfo.received_at,
            last_status: status || null,
            delivery_id: eventInfo.delivery_id || null,
            data: eventInfo.data || null,
          },
        },
        updated_at: new Date(),
      },
    });
  }
}

async function updateValidationSteps(signingRequestId, status, eventInfo) {
  const steps = await prisma.validation_steps.findMany({
    where: { signature_request_id: String(signingRequestId) },
  });

  for (const step of steps) {
    const existingPayload = step.signature_payload && typeof step.signature_payload === "object"
      ? step.signature_payload
      : {};
    const existingWebhook = existingPayload.webhook || {};
    if (existingWebhook.last_event_id && existingWebhook.last_event_id === eventInfo.event_id) {
      continue;
    }

    await prisma.validation_steps.update({
      where: { id: step.id },
      data: {
        signature_status: status || step.signature_status,
        signature_payload: {
          ...existingPayload,
          webhook: {
            ...existingWebhook,
            last_event_id: eventInfo.event_id || null,
            last_event_type: eventInfo.event_type || null,
            last_event_at: eventInfo.event_at || eventInfo.received_at,
            last_status: status || null,
            delivery_id: eventInfo.delivery_id || null,
            data: eventInfo.data || null,
          },
        },
        updated_at: new Date(),
      },
    });
  }
}

async function processEvent(eventInfo) {
  if (!APPLY_UPDATES) return;
  const signingRequestId = eventInfo?.signing_request_id;
  if (!signingRequestId) return;

  const status = normalizeStatus(eventInfo.raw_event || {}, eventInfo.event_type);
  if (!status) return;

  await updateSignatureSessions(signingRequestId, status, eventInfo);
  await updateValidationSteps(signingRequestId, status, eventInfo);
}

exports.handleFirmaWebhook = async (req, res) => {
  const payload = extractEventPayload(req);
  const signature = getHeader(req, "x-firma-signature");
  const signatureOld = getHeader(req, "x-firma-signature-old");
  const deliveryId = getHeader(req, "x-firma-delivery");
  const eventHeader = getHeader(req, "x-firma-event");

  const secret = String(process.env.FIRMA_WEBHOOK_SECRET || "");
  const oldSecret = String(process.env.FIRMA_WEBHOOK_SECRET_OLD || "");

  if (!SKIP_VERIFY) {
    if (!secret) {
      return res.status(500).json({ success: false, message: "FIRMA_WEBHOOK_SECRET manquant" });
    }

    const currentCheck = verifyWithSecret(secret, signature, payload);
    let ok = currentCheck.ok;
    if (!ok && signatureOld) {
      const legacyCheck = oldSecret
        ? verifyWithSecret(oldSecret, signatureOld, payload)
        : verifyWithSecret(secret, signatureOld, payload);
      ok = legacyCheck.ok;
    }

    if (!ok) {
      return res.status(401).json({ success: false, message: "Firma webhook signature invalid" });
    }
  }

  const body = req.body || {};
  const eventType = normalizeEventType(body) || String(eventHeader || "").trim();
  const eventId = body.event_id || body.id || null;
  const eventAt = body.event_timestamp || body.created_at || body.event_created_at || null;
  const data = body.data || {};
  const signingRequestId =
    data.signing_request_id ||
    data.signingRequestId ||
    body.signing_request_id ||
    null;

  const eventInfo = {
    received_at: new Date().toISOString(),
    event_id: eventId,
    event_type: eventType,
    event_at: eventAt,
    delivery_id: deliveryId || null,
    signing_request_id: signingRequestId,
    status: normalizeStatus(body, eventType) || null,
    data,
    raw_event: body,
  };

  const recentInfo = { ...eventInfo };
  delete recentInfo.raw_event;
  pushRecent(recentInfo);

  res.json({ success: true });

  setImmediate(() => {
    processEvent(eventInfo).catch(() => {
      // silent failure (webhook already acknowledged)
    });
  });
};

exports.listRecentFirmaEvents = async (_req, res) => {
  return res.json({ success: true, data: recentEvents });
};
