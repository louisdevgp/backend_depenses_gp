const axios = require("axios");

const DEFAULT_BASE_URL = "https://api.firma.dev/functions/v1/signing-request-api";

function getFirmaBaseUrl() {
  const raw = process.env.FIRMA_API_BASE || DEFAULT_BASE_URL;
  return String(raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getFirmaApiKey() {
  const raw = process.env.FIRMA_API_KEY;
  if (!raw) {
    const err = new Error("FIRMA_API_KEY manquant");
    err.statusCode = 500;
    throw err;
  }
  return String(raw).trim();
}

function normalizeAuthHeader(apiKey) {
  if (!apiKey) return apiKey;
  return apiKey.startsWith("Bearer ") ? apiKey : apiKey;
}

function isFirmaDebugEnabled() {
  const v = String(process.env.FIRMA_DEBUG || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function sanitizeFirmaPayload(data) {
  if (!data || typeof data !== "object") return data;
  const clone = { ...data };

  if (typeof clone.document === "string") {
    clone.document = `[base64:${clone.document.length} chars]`;
  }

  if (Array.isArray(clone.documents)) {
    clone.documents = clone.documents.map((d) => {
      if (!d || typeof d !== "object") return d;
      const doc = { ...d };
      if (typeof doc.content === "string") {
        doc.content = `[base64:${doc.content.length} chars]`;
      }
      if (typeof doc.document === "string") {
        doc.document = `[base64:${doc.document.length} chars]`;
      }
      return doc;
    });
  }

  return clone;
}

function sanitizeFirmaUsersResponse(data) {
  if (!data || typeof data !== "object") return data;
  return data;
}

function maskEmail(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("@");
  if (parts.length < 2) return `${raw.slice(0, 2)}***`;
  const name = parts[0] || "";
  const domain = parts.slice(1).join("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function looksLikeUser(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = Object.keys(obj);
  const hasEmail = keys.some((k) => String(k).toLowerCase().includes("email"));
  const hasId = keys.some((k) => /(id|uuid)$/i.test(k));
  const hasSigning = keys.some((k) => String(k).toLowerCase().includes("sign"));
  return (hasEmail && hasId) || (hasEmail && hasSigning) || (hasId && hasSigning);
}

function findFirstUserArray(root, maxDepth = 4) {
  const queue = [{ value: root, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (Array.isArray(value)) {
      if (value.some((item) => looksLikeUser(item))) return value;
      if (depth >= maxDepth) continue;
      for (const item of value) {
        if (item && typeof item === "object") queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }

    if (isPlainObject(value)) {
      if (depth >= maxDepth) continue;
      for (const v of Object.values(value)) {
        if (v && typeof v === "object") queue.push({ value: v, depth: depth + 1 });
      }
    }
  }
  return [];
}

function wrapFirmaError(e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const msg =
    (data && (data.message || data.error || data.detail)) ||
    e?.message ||
    "Erreur API Firma";
  const err = new Error(`Firma: ${msg}`);
  if (status) err.statusCode = status;
  return err;
}

function normalizeUsersResponse(usersRaw) {
  if (Array.isArray(usersRaw)) return usersRaw;
  if (Array.isArray(usersRaw?.data)) return usersRaw.data;
  if (Array.isArray(usersRaw?.data?.users)) return usersRaw.data.users;
  if (Array.isArray(usersRaw?.data?.results)) return usersRaw.data.results;
  if (Array.isArray(usersRaw?.data?.result)) return usersRaw.data.result;
  if (Array.isArray(usersRaw?.result)) return usersRaw.result;
  if (Array.isArray(usersRaw?.results)) return usersRaw.results;
  if (Array.isArray(usersRaw?.data?.data)) return usersRaw.data.data;
  if (Array.isArray(usersRaw?.data?.data?.users)) return usersRaw.data.data.users;
  if (Array.isArray(usersRaw?.data?.data?.signing_request_users)) return usersRaw.data.data.signing_request_users;
  if (Array.isArray(usersRaw?.data?.data?.signingRequestUsers)) return usersRaw.data.data.signingRequestUsers;
  if (Array.isArray(usersRaw?.data?.data?.items)) return usersRaw.data.data.items;
  if (Array.isArray(usersRaw?.data?.signing_request_users)) return usersRaw.data.signing_request_users;
  if (Array.isArray(usersRaw?.data?.signingRequestUsers)) return usersRaw.data.signingRequestUsers;
  if (Array.isArray(usersRaw?.data?.signers)) return usersRaw.data.signers;
  if (Array.isArray(usersRaw?.data?.recipients)) return usersRaw.data.recipients;
  if (Array.isArray(usersRaw?.data?.items)) return usersRaw.data.items;
  if (Array.isArray(usersRaw?.users)) return usersRaw.users;
  if (Array.isArray(usersRaw?.signing_request_users)) return usersRaw.signing_request_users;
  if (Array.isArray(usersRaw?.signingRequestUsers)) return usersRaw.signingRequestUsers;
  if (Array.isArray(usersRaw?.signers)) return usersRaw.signers;
  if (Array.isArray(usersRaw?.recipients)) return usersRaw.recipients;
  if (Array.isArray(usersRaw?.items)) return usersRaw.items;
  if (Array.isArray(usersRaw?.data?.items)) return usersRaw.data.items;
  return findFirstUserArray(usersRaw);
}

function extractUserId(user) {
  if (!user) return null;
  const direct =
    user.id ??
    user.user_id ??
    user.userId ??
    user.uuid ??
    user.user_uuid ??
    user.userUuid ??
    user.signing_request_user_id ??
    user.signingRequestUserId ??
    user.signing_request_user ??
    user.signingRequestUser ??
    user.signature_request_user_id ??
    user.signatureRequestUserId ??
    user.signature_request_user ??
    user.signatureRequestUser ??
    user.signer_user_id ??
    user.signerUserId ??
    user.signer_id ??
    user.signerId ??
    user.signing_user_id ??
    user.signingUserId ??
    user.recipient_user_id ??
    user.recipient_id ??
    user.recipientId ??
    user.recipient_user ??
    user.recipient_uuid ??
    null;

  if (direct != null) return direct;

  const nested =
    user.user?.id ??
    user.user?.user_id ??
    user.signer?.id ??
    user.signer?.user_id ??
    user.recipient?.id ??
    user.recipient?.user_id ??
    user.profile?.id ??
    user.signing_request_user?.id ??
    user.signing_request_user?.user_id ??
    null;

  return nested;
}

function extractUserEmail(user) {
  if (!user) return "";
  return (
    user.email ??
    user.user_email ??
    user.userEmail ??
    user.email_address ??
    user.emailAddress ??
    user.recipient_email ??
    user.recipientEmail ??
    user.signer_email ??
    user.signerEmail ??
    user.user?.email ??
    user.signer?.email ??
    user.recipient?.email ??
    user.recipient?.email ??
    user.signer?.email ??
    ""
  );
}

function extractFinishedAt(user) {
  if (!user) return null;
  return (
    user.finished_date ??
    user.finished_on ??
    user.finishedDate ??
    user.finished_at ??
    user.finishedAt ??
    user.completed_at ??
    user.completedAt ??
    user.signed_at ??
    user.signedAt ??
    user.signed_on ??
    user.signedOn ??
    user.signed_date ??
    user.signedDate ??
    user.signature_completed_at ??
    user.signatureCompletedAt ??
    user.ended_at ??
    user.endedAt ??
    null
  );
}

function isSignerFinished(user) {
  if (!user) return false;
  if (extractFinishedAt(user)) return true;
  if (user.signed === true || user.is_signed === true || user.isSigned === true) return true;
  if (user.completed === true || user.is_completed === true || user.isCompleted === true) return true;
  if (user.finished === true || user.is_finished === true || user.isFinished === true) return true;
  const rawStatus =
    user.status ?? user.signature_status ?? user.signing_status ?? user.state ?? user.signatureState ?? "";
  if (rawStatus && typeof rawStatus === "object") {
    const obj = rawStatus || {};
    if (obj.signed === true || obj.completed === true || obj.finished === true) return true;
    if (obj.is_signed === true || obj.is_completed === true || obj.is_finished === true) return true;
  }
  const status = String(rawStatus || "").trim().toLowerCase();
  return ["signed", "completed", "finished", "done", "validated"].includes(status);
}

function isRequestFinished(request) {
  if (!request || typeof request !== "object") return false;
  if (extractFinishedAt(request)) return true;
  if (request.signed === true || request.is_signed === true || request.isSigned === true) return true;
  if (request.completed === true || request.is_completed === true || request.isCompleted === true) return true;
  if (request.finished === true || request.is_finished === true || request.isFinished === true) return true;
  if (request.status && typeof request.status === "object") {
    const st = request.status;
    if (st.signed === true || st.completed === true || st.finished === true) return true;
    if (st.is_signed === true || st.is_completed === true || st.is_finished === true) return true;
  }
  if (
    request.final_document_download_url ||
    request.document_only_download_url ||
    request.document_download_url
  ) {
    return true;
  }
  const status = String(
    request.status ?? request.signature_status ?? request.signing_status ?? request.state ?? request.signatureState ?? ""
  )
    .trim()
    .toLowerCase();
  return ["signed", "completed", "finished", "done", "validated"].includes(status);
}

function summarizeSignerForDebug(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: extractUserId(user),
    email: maskEmail(extractUserEmail(user)),
    status:
      user.status ??
      user.signature_status ??
      user.signing_status ??
      user.state ??
      user.signatureState ??
      null,
    finished_at: extractFinishedAt(user),
    signed: user.signed ?? user.is_signed ?? user.isSigned ?? null,
    completed: user.completed ?? user.is_completed ?? user.isCompleted ?? null,
    finished: user.finished ?? user.is_finished ?? user.isFinished ?? null,
    keys: Object.keys(user || {}).slice(0, 20),
  };
}

function summarizeRequestForDebug(request) {
  if (!request || typeof request !== "object") return null;
  const cert = request.certificate;
  const certPreview =
    cert && typeof cert === "object"
      ? {
          keys: Object.keys(cert || {}).slice(0, 10),
          url:
            cert.download_url ||
            cert.downloadUrl ||
            cert.url ||
            cert.pdf_url ||
            cert.pdfUrl ||
            cert.file_url ||
            cert.fileUrl ||
            null,
        }
      : cert || null;
  return {
    id: request.id ?? request.uuid ?? request.request_id ?? null,
    status:
      request.status ??
      request.signature_status ??
      request.signing_status ??
      request.state ??
      request.signatureState ??
      null,
    finished_at: extractFinishedAt(request),
    has_final_doc: Boolean(
      request.final_document_download_url || request.document_only_download_url || request.document_download_url
    ),
    allow_download: request.allow_download ?? request?.settings?.allow_download ?? null,
    attach_pdf_on_finish: request.attach_pdf_on_finish ?? request?.settings?.attach_pdf_on_finish ?? null,
    has_certificate: Boolean(request.certificate),
    certificate: certPreview,
    keys: Object.keys(request || {}).slice(0, 20),
  };
}

function extractCertificateUrl(request) {
  if (!request || typeof request !== "object") return "";
  const cert =
    request.certificate ??
    request.certificate_info ??
    request.certificateInfo ??
    request.certificat ??
    null;
  if (!cert) return "";
  if (typeof cert === "string") return cert;
  return (
    cert.download_url ??
    cert.downloadUrl ??
    cert.url ??
    cert.pdf_url ??
    cert.pdfUrl ??
    cert.file_url ??
    cert.fileUrl ??
    cert.document_url ??
    cert.documentUrl ??
    ""
  );
}

function extractFinalDocumentUrl(request) {
  if (!request || typeof request !== "object") return "";
  const direct =
    request.final_document_download_url ??
    request.finalDocumentDownloadUrl ??
    request.final_document_url ??
    request.finalDocumentUrl ??
    request.document_only_download_url ??
    request.documentOnlyDownloadUrl ??
    request.document_download_url ??
    request.documentDownloadUrl ??
    "";
  if (direct) return direct;
  const certUrl = extractCertificateUrl(request);
  if (certUrl) return certUrl;
  return "";
}

function extractSigningUrl(user) {
  if (!user) return "";
  return (
    user.signing_url ??
    user.signingUrl ??
    user.signing_link ??
    user.signingLink ??
    user.embedded_signing_url ??
    user.embeddedSigningUrl ??
    user.recipient_view_url ??
    user.recipientViewUrl ??
    user.recipient_view ??
    user.url ??
    user.link ??
    user.href ??
    ""
  );
}

function pickSignerUser(users, email) {
  if (!Array.isArray(users) || users.length === 0) return null;
  const target = String(email || "").trim().toLowerCase();
  if (target) {
    const match = users.find((u) => String(extractUserEmail(u) || "").trim().toLowerCase() === target);
    if (match) return match;
  }
  return users[0] || null;
}

function selectSignerUserFromList(users, targetId, targetEmail) {
  if (!Array.isArray(users) || users.length === 0) return null;
  if (targetId) {
    const match = users.find((u) => String(extractUserId(u)) === String(targetId));
    if (match) return match;
  }
  if (targetEmail) {
    const match = users.find(
      (u) => String(extractUserEmail(u) || "").trim().toLowerCase() === String(targetEmail).trim().toLowerCase()
    );
    if (match) return match;
  }
  return pickSignerUser(users, targetEmail);
}

async function resolveSignerUser(signingRequestId, email, options = {}) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  const attempts = Math.max(1, Number(options.attempts || 0) || 4);
  const delayMs = Math.max(0, Number(options.delayMs || 0) || 400);
  const tryRequestFallback = options.requestFallback !== false;

  let lastUsers = [];
  for (let i = 0; i < attempts; i += 1) {
    const usersRaw = await getSigningRequestUsers(signingRequestId);
    const users = normalizeUsersResponse(usersRaw);
    lastUsers = users;

    if (users.length) {
      const signerUser = pickSignerUser(users, email);
      const signerUserId = extractUserId(signerUser);
      const signingUrl = extractSigningUrl(signerUser);
      if (signerUserId || signingUrl) {
        return { signerUser, signerUserId, signingUrl, users };
      }
    }

    if (i < attempts - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (tryRequestFallback) {
    try {
      const request = await getSigningRequest(signingRequestId);
      const usersFromRequest = normalizeUsersResponse(request);
      if (usersFromRequest.length) {
        const signerUser = pickSignerUser(usersFromRequest, email);
        const signerUserId = extractUserId(signerUser);
        const signingUrl = extractSigningUrl(signerUser);
        if (signerUserId || signingUrl) {
          return { signerUser, signerUserId, signingUrl, users: usersFromRequest };
        }
      }
    } catch {
      // ignore fallback errors
    }
  }

  return { signerUser: null, signerUserId: null, signingUrl: null, users: lastUsers };
}

async function waitForSignerFinished(signingRequestId, options = {}) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  const envAttempts = Number(process.env.FIRMA_COMPLETE_POLL_ATTEMPTS || "");
  const envDelay = Number(process.env.FIRMA_COMPLETE_POLL_DELAY_MS || "");
  const attempts = Math.max(
    1,
    Number.isFinite(envAttempts) && envAttempts > 0
      ? envAttempts
      : Number.isFinite(options.attempts)
        ? options.attempts
        : 10
  );
  const delayMs = Math.max(
    0,
    Number.isFinite(envDelay) && envDelay > 0
      ? envDelay
      : Number.isFinite(options.delayMs)
        ? options.delayMs
        : 800
  );
  const tryRequestFallback = options.requestFallback !== false;
  const targetId = options.signerUserId != null ? String(options.signerUserId) : null;
  const targetEmail = options.email ? String(options.email).trim().toLowerCase() : "";

  let lastUsers = [];
  let lastSigner = null;
  let lastRequestFinished = false;

  for (let i = 0; i < attempts; i += 1) {
    const usersRaw = await getSigningRequestUsers(signingRequestId);
    const users = normalizeUsersResponse(usersRaw);
    lastUsers = users;

    const signerUser = selectSignerUserFromList(users, targetId, targetEmail);
    if (signerUser) {
      lastSigner = signerUser;
      if (isSignerFinished(signerUser)) {
        return { signerUser, users };
      }
    }

    if (i < attempts - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (tryRequestFallback) {
    try {
      const request = await getSigningRequest(signingRequestId);
      lastRequestFinished = isRequestFinished(request);
      const usersFromRequest = normalizeUsersResponse(request);
      const signerUser = selectSignerUserFromList(usersFromRequest, targetId, targetEmail) || lastSigner;
      if (signerUser) {
        lastSigner = signerUser;
        if (isSignerFinished(signerUser)) {
          return { signerUser, users: usersFromRequest, requestFinished: lastRequestFinished };
        }
      }
      if (lastRequestFinished) {
        return { signerUser: lastSigner, users: usersFromRequest, requestFinished: true };
      }
    } catch {
      // ignore fallback errors
    }
  }

  return { signerUser: lastSigner, users: lastUsers, requestFinished: lastRequestFinished };
}

async function firmaRequest(method, path, data) {
  const apiKey = normalizeAuthHeader(getFirmaApiKey());
  const baseUrl = getFirmaBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    if (isFirmaDebugEnabled()) {
      console.log("[firma] request", {
        method,
        url,
        data: sanitizeFirmaPayload(data),
      });
    }

    const res = await axios({
      method,
      url,
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      data,
      maxBodyLength: Infinity,
    });

    if (isFirmaDebugEnabled() && String(path).includes("/users")) {
      const users = normalizeUsersResponse(res.data);
      console.log("[firma] response", {
        url,
        data: sanitizeFirmaUsersResponse(res.data),
      });
      if (Array.isArray(users)) {
        console.log("[firma] users summary", {
          count: users.length,
          first: summarizeSignerForDebug(users[0]),
        });
      }
    } else if (isFirmaDebugEnabled() && method === "get" && String(path).includes("/signing-requests/")) {
      console.log("[firma] request summary", summarizeRequestForDebug(res.data));
    }

    return res.data;
  } catch (e) {
    throw wrapFirmaError(e);
  }
}

async function createSigningRequest(payload) {
  return firmaRequest("post", "/signing-requests", payload);
}

async function getSigningRequestUsers(signingRequestId) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  return firmaRequest("get", `/signing-requests/${encodeURIComponent(signingRequestId)}/users`);
}

async function getSigningRequest(signingRequestId) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  return firmaRequest("get", `/signing-requests/${encodeURIComponent(signingRequestId)}`);
}

async function sendSigningRequest(signingRequestId) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  return firmaRequest("post", `/signing-requests/${encodeURIComponent(signingRequestId)}/send`);
}

function normalizeDownloadUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseUrl = getFirmaBaseUrl();
  if (raw.startsWith("/")) return `${baseUrl}${raw}`;
  return `${baseUrl}/${raw}`;
}

function shouldAttachAuthHeader(url) {
  try {
    const u = new URL(url);
    const host = String(u.hostname || "").toLowerCase();
    if (host.endsWith("firma.dev")) return true;
    const baseHost = new URL(getFirmaBaseUrl()).hostname.toLowerCase();
    return host === baseHost;
  } catch {
    return false;
  }
}

async function downloadSignedDocument(rawUrl) {
  const url = normalizeDownloadUrl(rawUrl);
  if (!url) {
    const err = new Error("Firma: url du document manquante");
    err.statusCode = 400;
    throw err;
  }

  const headers = {};
  if (shouldAttachAuthHeader(url)) {
    headers.Authorization = normalizeAuthHeader(getFirmaApiKey());
  }

  try {
    if (isFirmaDebugEnabled()) {
      console.log("[firma] download", {
        url,
        auth: headers.Authorization ? "yes" : "no",
      });
    }

    const res = await axios.get(url, {
      responseType: "arraybuffer",
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (isFirmaDebugEnabled()) {
      console.log("[firma] download response", {
        status: res.status,
        contentType: res.headers?.["content-type"] || null,
        contentLength: res.headers?.["content-length"] || null,
      });
    }

    return {
      data: Buffer.from(res.data),
      contentType: res.headers?.["content-type"] || "application/pdf",
      contentDisposition: res.headers?.["content-disposition"] || "",
      contentLength: res.headers?.["content-length"],
    };
  } catch (e) {
    throw wrapFirmaError(e);
  }
}

async function waitForProofUrl(signingRequestId, options = {}) {
  if (!signingRequestId) throw new Error("signingRequestId manquant");
  const envAttempts = Number(process.env.FIRMA_PROOF_POLL_ATTEMPTS || "");
  const envDelay = Number(process.env.FIRMA_PROOF_POLL_DELAY_MS || "");
  const attempts = Math.max(
    1,
    Number.isFinite(envAttempts) && envAttempts > 0
      ? envAttempts
      : Number.isFinite(options.attempts)
        ? options.attempts
        : 4
  );
  const delayMs = Math.max(
    0,
    Number.isFinite(envDelay) && envDelay > 0
      ? envDelay
      : Number.isFinite(options.delayMs)
        ? options.delayMs
        : 900
  );

  let lastRequest = null;
  for (let i = 0; i < attempts; i += 1) {
    const request = await getSigningRequest(signingRequestId);
    lastRequest = request;
    const url = extractFinalDocumentUrl(request);
    if (url) {
      return { url, request };
    }
    if (i < attempts - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { url: "", request: lastRequest };
}

module.exports = {
  createSigningRequest,
  getSigningRequestUsers,
  getSigningRequest,
  sendSigningRequest,
  downloadSignedDocument,
  waitForProofUrl,
  normalizeUsersResponse,
  extractUserId,
  extractUserEmail,
  extractFinishedAt,
  isSignerFinished,
  isRequestFinished,
  pickSignerUser,
  extractSigningUrl,
  resolveSignerUser,
  waitForSignerFinished,
  normalizeDownloadUrl,
  extractFinalDocumentUrl,
  extractCertificateUrl,
};
