const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parsePngDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\n\r]+)$/.exec(raw);
  if (!m) {
    const err = new Error("Signature invalide: format attendu data:image/png;base64,...");
    err.statusCode = 400;
    throw err;
  }
  const base64 = m[1].replace(/\s+/g, "");
  const buf = Buffer.from(base64, "base64");
  if (!buf.length) {
    const err = new Error("Signature invalide: image vide");
    err.statusCode = 400;
    throw err;
  }
  // limite raisonnable (signatures => petites images)
  if (buf.length > 1_500_000) {
    const err = new Error("Signature trop lourde");
    err.statusCode = 413;
    throw err;
  }
  return buf;
}

function saveSignaturePngDataUrl(dataUrl, { prefix = "sig" } = {}) {
  const buf = parsePngDataUrl(dataUrl);

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const dir = path.join(uploadsRoot, "signatures");
  ensureDirSync(dir);

  const fileName = `${String(prefix)}_${randomUUID()}.png`;
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, buf);

  return {
    url: `/uploads/signatures/${fileName}`,
    fullPath,
    bytes: buf.length,
  };
}

function resolveUploadsPathFromUrl(uploadUrl) {
  const u = String(uploadUrl || "").trim();
  if (!u.startsWith("/uploads/")) return null;
  return path.join(process.cwd(), u.replace(/^\//, ""));
}

module.exports = {
  saveSignaturePngDataUrl,
  resolveUploadsPathFromUrl,
};
