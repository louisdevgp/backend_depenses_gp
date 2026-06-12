const PDFDocument = require("pdfkit");
const prisma = require("../config/prisma");
const crypto = require("crypto");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const Mustache = require("mustache");
const axios = require("axios");
const { resolveUploadsPathFromUrl } = require("./signatures.services");

let puppeteer;
try {
  // Dépendance optionnelle (installée côté projet)
  // eslint-disable-next-line global-require
  puppeteer = require("puppeteer");
} catch {
  puppeteer = null;
}

let cheerio;
try {
  // eslint-disable-next-line global-require
  cheerio = require("cheerio");
} catch {
  cheerio = null;
}

function isNumericId(v) {
  return /^[0-9]+$/.test(String(v));
}

function asText(v) {
  if (v == null) return "-";
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

function asMoney(v) {
  if (v == null) return "-";
  const n = Number(v);
  if (Number.isNaN(n)) return asText(v);
  const formatted = new Intl.NumberFormat("fr-FR").format(n);
  return formatted.replace(/[\u202F\u00A0]/g, " ");
}

function asDate(d) {
  if (!d) return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return asText(d);
  return new Intl.DateTimeFormat("fr-FR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
}

function asDateTime(d) {
  if (!d) return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return asText(d);
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function asIsoDateTime(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function mustGetEnv(name, fallbacks = []) {
  const candidates = [name, ...fallbacks];
  for (const key of candidates) {
    const v = process.env[key];
    if (v) return v;
  }
  return null;
}

function getFrontendBaseUrl() {
  const raw = mustGetEnv("QR_BASE_URL", ["FRONTEND_URL", "APP_FRONTEND_URL", "DASHBOARD_URL", "WEB_URL"]);
  if (raw) return String(raw).replace(/\/+$/, "");
  return "http://localhost:5173";
}

function inferFrontendBaseUrlFromReq(req) {
  try {
    const origin = req?.headers?.origin || req?.headers?.Origin;
    if (origin) {
      const u = new URL(String(origin));
      return `${u.protocol}//${u.host}`.replace(/\/+$/, "");
    }

    const referer = req?.headers?.referer || req?.headers?.referrer;
    if (referer) {
      const u = new URL(String(referer));
      return `${u.protocol}//${u.host}`.replace(/\/+$/, "");
    }
  } catch {
    // ignore
  }
  return null;
}

function buildScanUrl(token, req) {
  if (!token) return null;
  const base = inferFrontendBaseUrlFromReq(req) || getFrontendBaseUrl();
  if (!base) return null;
  return `${base}/scan?token=${encodeURIComponent(String(token))}`;
}

function signatureSecret() {
  return mustGetEnv("SIGNATURE_SECRET", ["JWT_ACCESS_SECRET", "JWT_SECRET"]);
}

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function agentDisplayName(agent) {
  const prenom = agent?.prenom ? String(agent.prenom).trim() : "";
  const nom = agent?.nom ? String(agent.nom).trim() : "";
  const full = `${prenom} ${nom}`.trim();
  if (full) return full;
  const email = agent?.users?.email ? String(agent.users.email).trim() : "";
  return email || "-";
}

function userDisplayNameFromAgent(agent) {
  return agentDisplayName(agent);
}

function signatureLabelLinesFromValidationStep(step) {
  const validatedByName = step?.agents_validation_steps_validated_by_idToagents
    ? userDisplayNameFromAgent(step.agents_validation_steps_validated_by_idToagents)
    : "-";
  const validatorName = step?.agents_validation_steps_validator_idToagents
    ? userDisplayNameFromAgent(step.agents_validation_steps_validator_idToagents)
    : "-";

  const delegated =
    step?.validated_by_id != null &&
    step?.validator_id != null &&
    Number(step.validated_by_id) !== Number(step.validator_id);

  if (delegated) {
    const poLine = validatorName && validatorName !== "-" ? `PO ${validatorName}` : "PO";
    const byLine = validatedByName && validatedByName !== "-" ? `Par: ${validatedByName}` : null;
    return [poLine, byLine].filter(Boolean);
  }

  if (step?.validated_by_id != null) {
    return [validatedByName];
  }

  if (step?.validator_id != null) {
    return [validatorName];
  }

  return ["-"];
}

function demandeFinalizedAt(d) {
  const times = (d?.validation_steps || [])
    .map((s) => (s?.validated_at ? new Date(s.validated_at) : null))
    .filter((x) => x && !Number.isNaN(x.getTime()));
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((t) => t.getTime())));
}

function isDemandeFullyValidated(d) {
  const statutOk = normalizeStatus(d?.statut) === "approuvee";
  const steps = Array.isArray(d?.validation_steps) ? d.validation_steps : [];
  const allValid = steps.length > 0 && steps.every((s) => normalizeStatus(s?.status) === "valide");
  return statutOk && allValid;
}

function isReceptionFullyVised(r) {
  return Boolean(r?.visa_directeur_id) && (r?.visa_daf_requis === false || Boolean(r?.visa_daf_id));
}

function hmacSignature(text) {
  const secret = signatureSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(String(text), "utf8").digest("base64url");
}

async function qrPngBuffer(text) {
  const dataUrl = await QRCode.toDataURL(String(text), {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 5,
  });
  const base64 = String(dataUrl).split(",")[1] || "";
  return Buffer.from(base64, "base64");
}

function writeQrSignatureBlock(doc, { title, token, ref }) {
  writeSectionTitle(doc, title);

  const startY = doc.y;
  const boxSize = 120;
  const x = doc.page.width - doc.page.margins.right - boxSize;

  doc.fontSize(9).font("Helvetica");
  doc.text("Signature numérique (QR)", { continued: false });
  doc.fontSize(8).font("Helvetica").fillColor("#333");
  doc.text(`Réf: ${ref || "-"}`);
  doc.text(`Token: ${token || "-"}`, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - boxSize - 10,
  });
  doc.fillColor("#000");

  if (token) {
    // L'image est déjà calculée avant l'appel (voir stream*Pdf)
    // Ici on laisse le callsite faire doc.image(buffer,...)
  }

  // Réserve l'espace du QR si besoin
  const endY = Math.max(startY + boxSize, doc.y);
  doc.y = endY + 6;
}

function writeHeader(doc, title) {
  doc.fontSize(14).font("Helvetica-Bold").text("GREEN PAY", { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(12).font("Helvetica").text(title, { align: "center" });
  doc.moveDown(1);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(1);
}

function dashedLine(doc, x1, y, x2) {
  doc.save();
  doc.dash(1, { space: 2 });
  doc.moveTo(x1, y).lineTo(x2, y).stroke();
  doc.undash();
  doc.restore();
}

function frenchNumberWordsInt(n) {
  // Entiers positifs (FCFA), rendu FR simplifié mais correct pour les usages courants.
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "zéro";
  if (v < 0) return `moins ${frenchNumberWordsInt(Math.abs(v))}`;

  const units = [
    "",
    "un",
    "deux",
    "trois",
    "quatre",
    "cinq",
    "six",
    "sept",
    "huit",
    "neuf",
    "dix",
    "onze",
    "douze",
    "treize",
    "quatorze",
    "quinze",
    "seize",
  ];
  const tens = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"];

  const under100 = (x) => {
    if (x < 17) return units[x];
    if (x < 20) return `dix-${units[x - 10]}`;
    if (x < 70) {
      const t = Math.floor(x / 10);
      const u = x % 10;
      if (u === 0) return tens[t];
      if (u === 1) return `${tens[t]} et un`;
      return `${tens[t]}-${units[u]}`;
    }
    if (x < 80) {
      // 70..79 = soixante + 10..19
      const r = x - 60;
      if (r === 11) return "soixante et onze";
      return `soixante-${under100(r)}`;
    }
    // 80..99
    if (x === 80) return "quatre-vingts";
    const r = x - 80;
    const base = "quatre-vingt";
    if (r === 1) return `${base}-un`;
    return `${base}-${under100(r)}`;
  };

  const under1000 = (x) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    let out = "";
    if (h > 0) {
      if (h === 1) out = "cent";
      else out = `${units[h]} cent`;
      if (r === 0 && h > 1) out += "s";
    }
    if (r > 0) {
      out = out ? `${out} ${under100(r)}` : under100(r);
    }
    return out;
  };

  const parts = [];
  const billions = Math.floor(v / 1_000_000_000);
  const millions = Math.floor((v % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((v % 1_000_000) / 1000);
  const rest = v % 1000;

  if (billions) {
    const w = under1000(billions);
    parts.push(billions === 1 ? "un milliard" : `${w} milliards`);
  }
  if (millions) {
    const w = under1000(millions);
    parts.push(millions === 1 ? "un million" : `${w} millions`);
  }
  if (thousands) {
    if (thousands === 1) parts.push("mille");
    else parts.push(`${under1000(thousands)} mille`);
  }
  if (rest) parts.push(under1000(rest));

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function amountToFrenchWordsFcfa(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const intPart = Math.round(n);
  const words = frenchNumberWordsInt(intPart);
  if (!words) return "";
  return `${words} francs CFA`;
}

const TEMPLATE_CACHE = new Map();
const LOGO_CACHE = new Map();
const DEFAULT_LOGO_URL = "https://res.cloudinary.com/digitkbit/image/upload/v1744802840/logo_bdj4ks.png";

function getCompanyLogoUrl() {
  return (
    process.env.COMPANY_LOGO_URL ||
    process.env.LOGO_URL ||
    process.env.COMPANY_LOGO ||
    DEFAULT_LOGO_URL
  );
}

async function loadLogoBuffer(url) {
  if (!url) return null;
  if (LOGO_CACHE.has(url)) return LOGO_CACHE.get(url);

  let buf = null;
  try {
    if (String(url).startsWith("data:image/")) {
      const base64 = String(url).split(",")[1] || "";
      buf = base64 ? Buffer.from(base64, "base64") : null;
    } else {
      const uploadPath = resolveUploadsPathFromUrl(url);
      if (uploadPath && fs.existsSync(uploadPath)) {
        buf = fs.readFileSync(uploadPath);
      } else if (/^https?:\/\//i.test(String(url))) {
        const res = await axios.get(String(url), { responseType: "arraybuffer", timeout: 15_000 });
        buf = Buffer.from(res.data);
      } else if (fs.existsSync(String(url))) {
        buf = fs.readFileSync(String(url));
      }
    }
  } catch {
    buf = null;
  }

  LOGO_CACHE.set(url, buf);
  return buf;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadTemplateHtml(filename) {
  if (TEMPLATE_CACHE.has(filename)) return TEMPLATE_CACHE.get(filename);
  const filePath = path.join(__dirname, "..", "templates", filename);
  const html = fs.readFileSync(filePath, "utf8");
  TEMPLATE_CACHE.set(filename, html);
  return html;
}

function applyTemplateVars(html, vars) {
  return Mustache.render(String(html), vars);
}

function guessLogoMime(url) {
  const raw = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (raw.endsWith(".svg")) return "image/svg+xml";
  if (raw.endsWith(".jpg") || raw.endsWith(".jpeg")) return "image/jpeg";
  if (raw.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function dataUrlFromBuffer(buf, mime) {
  if (!buf) return null;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function injectQrOverlay(html, { qrDataUrl, ref }) {
  const overlay = `\n<style>
  .gp-qr-overlay{position:fixed;right:12mm;bottom:12mm;width:36mm;text-align:left;font-family:Arial,sans-serif;}
  .gp-qr-overlay img{width:36mm;height:36mm;display:block;}
  .gp-qr-ref{font-size:10px;color:#333;margin-bottom:2mm;}
  </style>
  <div class="gp-qr-overlay">
    <div class="gp-qr-ref">Réf: ${escapeHtml(ref || "-")}</div>
    <img src="${escapeHtml(qrDataUrl)}" alt="QR" />
  </div>\n`;
  if (String(html).includes("</body>")) return String(html).replace("</body>", `${overlay}</body>`);
  return `${html}${overlay}`;
}

function injectWatermark(html, { text, color = "#c62828", opacity = 0.12 } = {}) {
  if (!text) return html;
  const overlay = `\n<style>
  .gp-watermark{
    position:fixed;
    top:50%;
    left:50%;
    transform:translate(-50%, -50%) rotate(-28deg);
    font-family:Arial,sans-serif;
    font-size:130px;
    font-weight:700;
    letter-spacing:6px;
    text-transform:uppercase;
    color:${escapeHtml(color)};
    opacity:${Number(opacity).toFixed(2)};
    z-index:1;
    pointer-events:none;
  }
  </style>
  <div class="gp-watermark">${escapeHtml(text)}</div>\n`;
  if (String(html).includes("</body>")) return String(html).replace("</body>", `${overlay}</body>`);
  return `${html}${overlay}`;
}

function buildPaiementWatermark(demande) {
  const statut = String(demande?.statut || "").toLowerCase();
  if (["paye", "payé", "cloture", "clôture"].includes(statut)) {
    return { text: "PAYÉ", color: "#1b5e20", opacity: 0.12 };
  }
  if (statut === "en_attente_paiement") {
    return { text: "PAYÉ PARTIEL", color: "#b45309", opacity: 0.12 };
  }

  const paiements = Array.isArray(demande?.paiements) ? demande.paiements : [];
  const conditions = Array.isArray(demande?.conditions_paiement) ? demande.conditions_paiement : [];
  if (!paiements.length) return null;

  const unpaid = conditions.filter((c) => !c.paiement_id && String(c.statut || "").toLowerCase() !== "paye");
  if (conditions.length && unpaid.length === 0) {
    return { text: "PAYÉ", color: "#1b5e20", opacity: 0.12 };
  }
  return { text: "PAYÉ PARTIEL", color: "#b45309", opacity: 0.12 };
}

function injectDemandeSignataires(html, { demandeur, dg, dga, daf, beneficiaire }) {
  if (!cheerio) return html;
  const $ = cheerio.load(String(html), { decodeEntities: false });
  const tds = $("table.table tr").eq(1).find("td");
  if (tds.length < 5) return $.html();

  // Order must match the PDF header: Demandeur -> DAF -> DGA -> DG -> Bénéficiaire
  const cells = [demandeur, daf, dga, dg, beneficiaire].map((v) => String(v || "").trim());
  for (let i = 0; i < 5; i += 1) {
    const text = cells[i];
    // Note: ici `text` peut déjà contenir du HTML généré par le serveur (images signatures).
    // On n'injecte jamais d'HTML utilisateur brut.
    $(tds[i]).html(text ? String(text) : "");
  }
  return $.html();
}

function fileToDataUrlPng(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function signatureUrlToDataUrl(signatureUrl) {
  const p = resolveUploadsPathFromUrl(signatureUrl);
  if (!p) return null;
  try {
    return fileToDataUrlPng(p);
  } catch {
    return null;
  }
}

function signatureCellHtml({ name, nameLines, at, ref, qrDataUrl, signatureDataUrl }) {
  const safeLines = Array.isArray(nameLines)
    ? nameLines.map((x) => (x != null ? escapeHtml(String(x)) : "")).filter(Boolean)
    : [name ? escapeHtml(String(name)) : ""].filter(Boolean);
  const metaParts = [
    ...safeLines,
    at ? escapeHtml(String(at)) : "",
    ref ? escapeHtml(String(ref)) : "",
  ].filter(Boolean);
  const meta = metaParts.join("<br/>");
  const img = signatureDataUrl
    ? `<div style="height:44px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;">
         <img src="${escapeHtml(signatureDataUrl)}" alt="signature" style="max-width:100%;max-height:44px;object-fit:contain;" />
       </div>`
    : "";
  const qr = qrDataUrl
    ? `<div style="margin-top:4px;display:flex;align-items:center;justify-content:center;">
         <img src="${escapeHtml(qrDataUrl)}" alt="qr" style="width:85px;height:85px;object-fit:contain;" />
       </div>`
    : "";
  const metaDiv = meta ? `<div style="font-size:10px;line-height:1.2;color:#111;">${meta}</div>` : "";
  return `${img}${metaDiv}${qr}`;
}

async function renderHtmlToPdfBuffer(html) {
  if (!puppeteer) {
    throw new Error(
      "Dépendance manquante: installe 'puppeteer' pour générer le PDF depuis le template HTML (npm install puppeteer)."
    );
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    await page.setContent(String(html), { waitUntil: "networkidle2", timeout: 30_000 });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

function sendPdfBuffer(res, filename, buffer) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}

function drawCheckBox(doc, x, y, size, checked) {
  doc.rect(x, y, size, size).stroke();
  if (checked) {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(size - 2);
    doc.text("X", x, y - 1, { width: size, align: "center" });
    doc.restore();
  }
}

function drawReceptionSheet(doc, r, { isFinal, qrBuf, token, ref, logoBuf }) {
  // Mise en page inspirée du template HTML back/src/templates/reception.html
  // On respecte la procédure: affichage des infos + visas, et QR uniquement quand les deux visas sont présents.

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const pageTop = doc.page.margins.top;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  // Typo proche du rendu (Times)
  doc.font("Times-Roman").fontSize(12);

  // Header gauche (logo + infos société si dispo)
  const brandX = pageLeft;
  const brandY = pageTop - 10;
  let infoStartY = brandY + 22;
  if (logoBuf) {
    const logoW = 90;
    const logoH = 36;
    doc.image(logoBuf, brandX, brandY, { fit: [logoW, logoH] });
    infoStartY = brandY + logoH + 6;
  } else {
    doc.font("Times-Bold").fontSize(18).text("GREEN PAY", brandX, brandY);
  }
  doc.font("Times-Roman").fontSize(11);
  const tel = process.env.COMPANY_TELEPHONE || process.env.COMPANY_TEL || "";
  const bp = process.env.COMPANY_BP || "";
  const adr = process.env.COMPANY_ADRESSE || "";
  const reg = process.env.COMPANY_REGIME || "";
  const lines = [
    tel ? `Tél : ${tel}` : null,
    bp || null,
    adr ? `CDI : ${adr}` : null,
    reg ? `Régime d'imposition : ${reg}` : null,
  ].filter(Boolean);
  if (lines.length) {
    doc.text(lines.join("\n"), brandX, infoStartY, { lineGap: 3 });
  }

  // Titre centré dans un cadre
  const titleW = 290;
  const titleH = 44;
  const titleX = pageLeft + (pageRight - pageLeft - titleW) / 2;
  const titleY = pageTop + 10;
  doc.lineWidth(2).rect(titleX, titleY, titleW, titleH).stroke();
  doc
    .font("Times-Bold")
    .fontSize(14)
    .text("FICHE DE RECEPTION DE BIENS ET\nSERVICES", titleX + 8, titleY + 6, {
      width: titleW - 16,
      align: "center",
    });
  doc.lineWidth(1);

  // Zone formulaire
  let y = titleY + titleH + 28;
  const labelW = 180;
  const dotsX1 = pageLeft + labelW;
  const dotsX2 = pageRight;
  const rowH = 26;

  const row = (label, value) => {
    doc.font("Times-Bold").fontSize(11).text(String(label).toUpperCase(), pageLeft, y, { width: labelW });
    dashedLine(doc, dotsX1, y + 14, dotsX2);
    if (value != null && String(value).trim() !== "") {
      doc.font("Times-Roman").fontSize(11).text(String(value), dotsX1, y + 2, { width: dotsX2 - dotsX1 });
    }
    y += rowH;
  };

  row("DESCRIPTION BIEN/PRESTATION :", r.description);

  // 2e ligne description (sans le petit carré vert)
  dashedLine(doc, pageLeft, y + 14, pageRight);
  y += 26;

  row("REFERENCE FACTURE :", r.reference_facture);
  row("MONTANT:", r.montant != null ? `${asMoney(r.montant)} FCFA` : "");
  row("DATE DE RECEPTION:", asDate(r.date_reception));

  // Conforme à la commande ?
  y += 6;
  doc.font("Times-Bold").fontSize(11).text("CONFORME A LA COMMANDE?", pageLeft, y);
  const cbSize = 12;
  const rightBlockX = pageRight - 150;
  doc.font("Times-Bold").fontSize(11).text("OUI", rightBlockX, y);
  drawCheckBox(doc, rightBlockX + 32, y - 1, cbSize, Boolean(r.conforme));
  doc.font("Times-Bold").fontSize(11).text("NON", rightBlockX + 70, y);
  drawCheckBox(doc, rightBlockX + 105, y - 1, cbSize, r.conforme === false);
  y += 28;

  row("OBSERVATIONS :", r.observations);
  row("RECU PAR :", userDisplayNameFromAgent(r.agents_receptions_recu_par_idToagents));

  // Signatures en bas (2 colonnes)
  const sigW = 340;
  const sigH = 160;
  const sigX = pageLeft;
  // Monte le bloc des approbations par rapport au bas de page, tout en évitant le chevauchement
  // +2 cm ≈ 56.7 points
  const preferredSigY = pageBottom - sigH - (70 + 57);
  const minSigY = y + 16;
  const sigY = Math.max(minSigY, preferredSigY);
  const colW = sigW / 2;

  // cadre extérieur
  doc.lineWidth(2);
  doc.moveTo(sigX, sigY).lineTo(sigX + sigW, sigY).stroke();
  doc.rect(sigX, sigY, sigW, sigH).stroke();
  doc.moveTo(sigX + colW, sigY).lineTo(sigX + colW, sigY + sigH).stroke();

  // titres colonnes
  const headH = 26;
  doc.moveTo(sigX, sigY + headH).lineTo(sigX + sigW, sigY + headH).stroke();
  doc.font("Times-Bold").fontSize(9);
  doc.text("APPROBATION DIRECTION DEMANDEUSE", sigX + 6, sigY + 7, { width: colW - 12, align: "center" });
  doc.text("VISA DAF/DGA", sigX + colW + 6, sigY + 7, { width: colW - 12, align: "center" });
  doc.lineWidth(1);

  // Remplissage des infos de visa dans les cases (si existantes)
  doc.font("Times-Roman").fontSize(10);
  const leftInfo = [];
  if (r.visa_directeur_id) {
    leftInfo.push(`Visé par: ${userDisplayNameFromAgent(r.agents_receptions_visa_directeur_idToagents)}`);
  }
  const rightInfo = [];
  if (r.visa_daf_id) {
    rightInfo.push(`Visé par: ${userDisplayNameFromAgent(r.agents_receptions_visa_daf_idToagents)}`);
  }

  const tryLoadSig = (url) => {
    if (!url) return null;
    const filePath = resolveUploadsPathFromUrl(url);
    if (!filePath) return null;
    try {
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  };

  const leftCellX = sigX + 10;
  const rightCellX = sigX + colW + 10;
  const cellY = sigY + headH + 10;
  const cellW = colW - 20;

  // On n'affiche plus les signatures électroniques, seulement les noms des validateurs
  // const leftSigBuf = tryLoadSig(r.signature_directeur_url);
  // const rightSigBuf = tryLoadSig(r.signature_daf_url);
  const sigImgH = 52;

  // On ne charge plus les images de signature
  // if (leftSigBuf) {
  //   doc.image(leftSigBuf, leftCellX, cellY, { fit: [cellW, sigImgH], align: "center" });
  // }
  // if (rightSigBuf) {
  //   doc.image(rightSigBuf, rightCellX, cellY, { fit: [cellW, sigImgH], align: "center" });
  // }

  const leftTextY = cellY; // Pas de signature, donc pas de décalage vertical
  const rightTextY = cellY; // Pas de signature, donc pas de décalage vertical

  if (leftInfo.length) {
    doc.text(leftInfo.join("\n"), leftCellX, leftTextY, { width: cellW });
  }
  if (rightInfo.length) {
    doc.text(rightInfo.join("\n"), rightCellX, rightTextY, { width: cellW });
  }

  // QR à droite (uniquement si final) - désactivé par défaut sur réception
  const showReceptionQr = String(process.env.RECEPTION_QR_ENABLED || "").toLowerCase() === "true";
  if (showReceptionQr && isFinal && token && qrBuf) {
    const qrSize = 120;
    const qrX = pageRight - qrSize;
    const qrY = sigY + sigH - qrSize;
    doc.image(qrBuf, qrX, qrY, { fit: [qrSize, qrSize] });

    doc.font("Helvetica").fontSize(8).fillColor("#333");
    doc.text(`Ref: ${ref || "-"}`, pageRight - qrSize, qrY - 26, { width: qrSize, align: "left" });
    doc.fillColor("#000");
  }
}

function writeKv(doc, label, value) {
  doc.fontSize(9).font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(asText(value));
}

function writeSectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.fontSize(10).font("Helvetica-Bold").text(title);
  doc.moveDown(0.3);
}

function writeSimpleTable(doc, columns, rows) {
  const startX = doc.page.margins.left;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const totalFlex = columns.reduce((s, c) => s + (c.flex || 1), 0);
  const colWidths = columns.map((c) => (availableWidth * (c.flex || 1)) / totalFlex);
  const colX = [];
  let x = startX;
  for (const w of colWidths) {
    colX.push(x);
    x += w;
  }

  const rowPaddingY = 4;
  const headerY = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  columns.forEach((c, i) => {
    doc.text(c.label, colX[i], headerY, { width: colWidths[i] - 6 });
  });
  doc.moveDown(0.8);
  doc.moveTo(startX, doc.y).lineTo(startX + availableWidth, doc.y).stroke();
  doc.moveDown(0.3);

  doc.fontSize(9).font("Helvetica");
  for (const r of rows) {
    const y = doc.y;
    columns.forEach((c, i) => {
      const text = r[c.key];
      doc.text(asText(text), colX[i], y + rowPaddingY / 2, { width: colWidths[i] - 6 });
    });
    doc.moveDown(0.9);
  }
}

function sendPdf(res, filename, build, options = null) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const extra = options && typeof options === "object" ? options : {};
  const doc = new PDFDocument({ size: "A4", margin: 50, ...extra });
  doc.pipe(res);
  build(doc);
  doc.end();
}

async function getDemandeData(idOrUuid) {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };
  const demande = await prisma.demandes_paiement.findFirst({
    where: { ...where, deleted_at: null },
    include: {
      demande_items: true,
      conditions_paiement: { orderBy: { id: "asc" } },
      documents: true,
      paiements: true,
      validation_steps: {
        orderBy: { level: "asc" },
        include: {
          agents_validation_steps_validated_by_idToagents: { include: { users: true } },
          agents_validation_steps_validator_idToagents: { include: { users: true } },
        },
      },
      agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
    },
  });
  if (!demande) throw new Error("Demande introuvable");
  return demande;
}

async function getReceptionData(idOrUuid) {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };
  const reception = await prisma.receptions.findFirst({
    where,
    include: {
      demandes_paiement: true,
      documents: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });
  if (!reception) throw new Error("Réception introuvable");
  return reception;
}

async function streamDemandePdf(res, idOrUuid, { req } = {}) {
  const d = await getDemandeData(idOrUuid);
  return streamDemandePdfFromData(res, d, { req });
}

async function streamDemandePdfFromData(res, d, { forceFinal = false, forcedFinalizedAt = null, req = null } = {}) {
  const filename = `demande_${d.uuid}.pdf`;

  const isFinal = forceFinal ? true : isDemandeFullyValidated(d);
  const finalizedAt = isFinal ? forcedFinalizedAt || demandeFinalizedAt(d) : null;
  const finalizedIso = asIsoDateTime(finalizedAt) || "";
  const tokenBase = `GP|demande|${d.uuid}|${finalizedIso}`;
  const sig = isFinal ? hmacSignature(tokenBase) : null;
  const token = isFinal && sig ? `${tokenBase}|${sig}` : null;
  const ref = sig ? String(sig).slice(0, 16) : null;
  const qrText = token ? buildScanUrl(token, req) || token : null;
  const qrBuf = qrText ? await qrPngBuffer(qrText) : null;

  const template = loadTemplateHtml("template1.html");

  const parseBooleanLike = (value) => {
    if (value === true || value === false) return value;
    if (typeof value === "number") return value ? true : false;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (!v) return null;
      if (["true", "1", "oui", "yes"].includes(v)) return true;
      if (["false", "0", "non", "no"].includes(v)) return false;
    }
    return null;
  };

  const yesNoMarks = (value) => {
    const b = parseBooleanLike(value);
    if (b === true) return { oui: "X", non: "" };
    if (b === false) return { oui: "", non: "X" };
    return { oui: "", non: "" };
  };

  const formatDafCritere4 = (value) => {
    const label = "Moyen de paiement";
    const b = parseBooleanLike(value);
    if (b === true) return { label, value: "Oui" };
    if (b === false) return { label, value: "Non" };
    const str = value == null ? "" : String(value).trim();
    return { label, value: str || "-" };
  };

  const bp = yesNoMarks(d.budget_prevu);
  const bd = yesNoMarks(d.budget_disponible);
  const pi = yesNoMarks(d.paiement_immediat);
  const oci = yesNoMarks(d.validation_oci);
  const c4 = formatDafCritere4(d.daf_critere4);

  const montantBrut = Number(d.montant ?? 0);
  const montantNet = d.montant_net != null ? Number(d.montant_net) : montantBrut;
  const remiseType = String(d.remise_type || "").toLowerCase();
  const remiseValeur = d.remise_valeur != null ? Number(d.remise_valeur) : null;
  const remiseMontant = Math.max(0, montantBrut - montantNet);
  const remiseLabel =
    remiseType === "pourcentage" && remiseValeur != null
      ? `Remise (${asMoney(remiseValeur)}%)`
      : remiseType === "montant" && remiseValeur != null
        ? "Remise"
        : "Remise";

  const companyLogoUrl = getCompanyLogoUrl();
  const companyLogoBuf = await loadLogoBuffer(companyLogoUrl);
  const companyLogoDataUrl = companyLogoBuf ? dataUrlFromBuffer(companyLogoBuf, guessLogoMime(companyLogoUrl)) : null;

  const vars = {
    company_logo_url: companyLogoDataUrl || companyLogoUrl,
    montant: asMoney(montantNet),
    montant_lettres: amountToFrenchWordsFcfa(montantNet),
    montant_brut: asMoney(montantBrut),
    remise_label: remiseType ? remiseLabel : "",
    remise_montant: remiseType ? asMoney(remiseMontant) : "",
    montant_net: asMoney(montantNet),
    has_remise: Boolean(remiseType),
    motif: d.motif || "",
    beneficiaire: d.beneficiaire || "",
    note: d.note || d.remarque || d.description || "",

    budget_prevu_oui: bp.oui,
    budget_prevu_non: bp.non,
    budget_disponible_oui: bd.oui,
    budget_disponible_non: bd.non,
    paiement_immediat_oui: pi.oui,
    paiement_immediat_non: pi.non,
    validation_oci_oui: oci.oui,
    validation_oci_non: oci.non,

    daf_critere4_label: c4.label,
    daf_critere4_value: c4.value,
  };

  let html = applyTemplateVars(template, vars);

  {
    const watermark = buildPaiementWatermark(d);
    if (watermark) html = injectWatermark(html, watermark);
  }

  {
    const demandeurName = userDisplayNameFromAgent(d.agents_demandes_paiement_demandeur_idToagents);
    const stepByRole = new Map((d.validation_steps || []).map((s) => [String(s.role_name || "").toUpperCase(), s]));
    const pick = (role) => stepByRole.get(String(role).toUpperCase()) || null;
    const dg = pick("DG");
    const dga = pick("DGA");
    const daf = pick("DAF");
    const signatureRef = (s) => {
      if (!s) return null;
      const ref = s.signature_request_id || s.signature_request_user_id || null;
      return ref ? `ID: ${ref}` : null;
    };
    const signatureAt = (s) => {
      if (!s?.validated_at) return null;
      return `Date: ${asDateTime(s.validated_at)}`;
    };
    const signatureQrDataUrl = async (s) => {
      if (!s?.uuid || !s?.validated_at) return null;
      const validatedIso = asIsoDateTime(s.validated_at);
      if (!validatedIso) return null;
      const tokenBase = `GP|validation|${s.uuid}|${validatedIso}`;
      const sig = hmacSignature(tokenBase);
      if (!sig) return null;
      const token = `${tokenBase}|${sig}`;
      const qrText = buildScanUrl(token, req) || token;
      const qrBuf = await qrPngBuffer(qrText);
      return `data:image/png;base64,${qrBuf.toString("base64")}`;
    };

    const [dafQr, dgaQr, dgQr] = await Promise.all([
      daf?.validated_by_id ? signatureQrDataUrl(daf) : Promise.resolve(null),
      dga?.validated_by_id ? signatureQrDataUrl(dga) : Promise.resolve(null),
      dg?.validated_by_id ? signatureQrDataUrl(dg) : Promise.resolve(null),
    ]);

    // Noms + date + identifiant + QR de validation
    html = injectDemandeSignataires(html, {
      // Demandeur: affiché dès la soumission (création)
      demandeur: signatureCellHtml({ name: demandeurName, signatureDataUrl: null }),
      daf: daf?.validated_by_id
        ? signatureCellHtml({
            nameLines: signatureLabelLinesFromValidationStep(daf),
            at: signatureAt(daf),
            ref: signatureRef(daf),
            qrDataUrl: dafQr,
            signatureDataUrl: null, // Plus de signature
          })
        : "",
      dga: dga?.validated_by_id
        ? signatureCellHtml({
            nameLines: signatureLabelLinesFromValidationStep(dga),
            at: signatureAt(dga),
            ref: signatureRef(dga),
            qrDataUrl: dgaQr,
            signatureDataUrl: null, // Plus de signature
          })
        : "",
      dg: dg?.validated_by_id
        ? signatureCellHtml({
            nameLines: signatureLabelLinesFromValidationStep(dg),
            at: signatureAt(dg),
            ref: signatureRef(dg),
            qrDataUrl: dgQr,
            signatureDataUrl: null, // Plus de signature
          })
        : "",
      beneficiaire: d.beneficiaire ? escapeHtml(String(d.beneficiaire)) : "",
    });
  }

  if (isFinal && token && qrBuf) {
    const qrDataUrl = `data:image/png;base64,${qrBuf.toString("base64")}`;
    html = injectQrOverlay(html, { qrDataUrl, ref });
  }

  const pdfBuffer = await renderHtmlToPdfBuffer(html);
  return sendPdfBuffer(res, filename, pdfBuffer);
}

async function streamReceptionPdf(res, idOrUuid, { req } = {}) {
  const r = await getReceptionData(idOrUuid);
  if (!isReceptionFullyVised(r)) {
    if (r?.visa_daf_requis === false) {
      throw new Error("PDF indisponible: la reception doit etre visee par le Directeur");
    }
    throw new Error("PDF indisponible: la réception doit être visée par le Directeur et le DAF");
  }
  return streamReceptionPdfFromData(res, r, { req });
}

async function streamReceptionPdfFromData(
  res,
  r,
  { forceFinal = false, forcedFinalizedAt = null, req = null } = {}
) {
  const filename = `reception_${r.uuid}.pdf`;

  const isFinal = forceFinal ? true : isReceptionFullyVised(r);
  const finalizedIso = isFinal ? asIsoDateTime(forcedFinalizedAt || r.created_at) || "" : "";
  const tokenBase = `GP|reception|${r.uuid}|${finalizedIso}`;
  const sig = isFinal ? hmacSignature(tokenBase) : null;
  const token = isFinal && sig ? `${tokenBase}|${sig}` : null;
  const ref = sig ? String(sig).slice(0, 16) : null;
  const qrText = token ? buildScanUrl(token, req) || token : null;
  const qrBuf = qrText ? await qrPngBuffer(qrText) : null;
  const logoBuf = await loadLogoBuffer(getCompanyLogoUrl());

  sendPdf(res, filename, (doc) => {
    drawReceptionSheet(doc, r, { isFinal, qrBuf, token, ref, logoBuf });
  }, { compress: false });
}

module.exports = {
  streamDemandePdf,
  streamDemandePdfFromData,
  streamReceptionPdf,
  streamReceptionPdfFromData,
};
