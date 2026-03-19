const signatureSessions = require("../services/signatureSessions.services");
const firma = require("../services/firma.services");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRoleName(role) {
  return String(role || "").trim().toUpperCase();
}

function tokenHasRole(user, role) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles.map(normalizeRoleName).includes(normalizeRoleName(role));
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\\/]/g, "_")
    .replace(/["']/g, "")
    .trim();
}

function filenameFromContentDisposition(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const matchStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(raw);
  if (matchStar?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(matchStar[1]));
    } catch {
      return sanitizeFilename(matchStar[1]);
    }
  }
  const match = /filename\s*=\s*"?([^\";]+)"?/i.exec(raw);
  if (match?.[1]) return sanitizeFilename(match[1]);
  return "";
}

exports.downloadSessionSignature = async (req, res) => {
  try {
    const sessionId = toNumber(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "Session de signature invalide" });
    }

    const session = await signatureSessions.getSignatureSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Session de signature introuvable" });
    }

    const userId = toNumber(req.user?.userId ?? req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const isSigner =
      session.signer_user_id != null && Number(session.signer_user_id) === Number(userId);
    const isAdmin = tokenHasRole(req.user, "ADMIN");
    if (!isSigner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Acces refuse" });
    }

    let signatureUrl = session.signature_url;
    if (!signatureUrl && session.signature_request_id) {
      try {
        const wait = await firma.waitForProofUrl(session.signature_request_id, { attempts: 4, delayMs: 900 });
        signatureUrl = wait?.url || "";
        if (signatureUrl) {
          await signatureSessions.updateSignatureSession(session.id, {
            signature_url: signatureUrl,
          });
        }
      } catch {
        // ignore fetch errors
      }
    }

    if (!signatureUrl) {
      return res.status(409).json({ success: false, message: "Document de preuve indisponible" });
    }

    const file = await firma.downloadSignedDocument(signatureUrl);
    const suggested =
      filenameFromContentDisposition(file.contentDisposition) ||
      sanitizeFilename(
        `signature_${session.entity_type || "document"}_${session.entity_id || session.id}.pdf`
      );

    res.setHeader("Content-Type", file.contentType || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${suggested}"`);
    if (file.contentLength) {
      res.setHeader("Content-Length", String(file.contentLength));
    }

    return res.send(file.data);
  } catch (e) {
    const status = e?.statusCode && Number.isFinite(Number(e.statusCode)) ? Number(e.statusCode) : 400;
    return res.status(status).json({ success: false, message: e.message || "Telechargement impossible" });
  }
};
