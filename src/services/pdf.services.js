const PDFDocument = require("pdfkit");
const prisma = require("../config/prisma");
const crypto = require("crypto");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const Mustache = require("mustache");
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
  return new Intl.NumberFormat("fr-FR").format(n);
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
  const raw =
    mustGetEnv("QR_BASE_URL", ["FRONTEND_URL", "APP_FRONTEND_URL", "DASHBOARD_URL", "WEB_URL"]) ||
    "http://localhost:5173";
  return String(raw).replace(/\/+$/, "");
}

function buildScanUrl(token) {
  if (!token) return null;
  const base = getFrontendBaseUrl();
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
  return Boolean(r?.visa_directeur_id) && Boolean(r?.visa_daf_id);
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
  return String(html).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (m, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return "";
    return escapeHtml(vars[key]);
  });
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

function injectDemandeSignataires(html, { demandeur, dg, dga, daf, beneficiaire }) {
  if (!cheerio) return html;
  const $ = cheerio.load(String(html), { decodeEntities: false });
  const tds = $("table.table tr").eq(1).find("td");
  if (tds.length < 5) return $.html();

  const cells = [demandeur, dg, dga, daf, beneficiaire].map((v) => String(v || "").trim());
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

function signatureCellHtml({ name, at, signatureDataUrl }) {
  const meta = [name ? escapeHtml(name) : "", at ? escapeHtml(at) : ""].filter(Boolean).join("<br/>");
  const img = signatureDataUrl
    ? `<div style="height:44px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;">
         <img src="${escapeHtml(signatureDataUrl)}" alt="signature" style="max-width:100%;max-height:44px;object-fit:contain;" />
       </div>`
    : "";
  const metaDiv = meta ? `<div style="font-size:10px;line-height:1.2;color:#111;">${meta}</div>` : "";
  return `${img}${metaDiv}`;
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

function drawReceptionSheet(doc, r, { isFinal, qrBuf, token, ref }) {
  // Mise en page inspirée du template HTML back/src/templates/reception.html
  // On respecte la procédure: affichage des infos + visas, et QR uniquement quand les deux visas sont présents.

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const pageTop = doc.page.margins.top;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  // Typo proche du rendu (Times)
  doc.font("Times-Roman").fontSize(12);

  // Header gauche (logo remplacé par texte + infos société si dispo)
  const brandX = pageLeft;
  const brandY = pageTop - 10;
  doc.font("Times-Bold").fontSize(18).text("GREEN PAY", brandX, brandY);
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
    doc.text(lines.join("\n"), brandX, brandY + 22, { lineGap: 3 });
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

  row("FOURNISSEUR :", r.fournisseur);
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

  const leftSigBuf = tryLoadSig(r.signature_directeur_url);
  const rightSigBuf = tryLoadSig(r.signature_daf_url);
  const sigImgH = 52;

  if (leftSigBuf) {
    doc.image(leftSigBuf, leftCellX, cellY, { fit: [cellW, sigImgH], align: "center" });
  }
  if (rightSigBuf) {
    doc.image(rightSigBuf, rightCellX, cellY, { fit: [cellW, sigImgH], align: "center" });
  }

  const leftTextY = cellY + (leftSigBuf ? sigImgH + 6 : 0);
  const rightTextY = cellY + (rightSigBuf ? sigImgH + 6 : 0);

  if (leftInfo.length) {
    doc.text(leftInfo.join("\n"), leftCellX, leftTextY, { width: cellW });
  }
  if (rightInfo.length) {
    doc.text(rightInfo.join("\n"), rightCellX, rightTextY, { width: cellW });
  }

  // QR à droite (uniquement si final)
  if (isFinal && token && qrBuf) {
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
      fournisseurs: true,
      documents: true,
      validation_steps: {
        orderBy: { level: "asc" },
        include: {
          agents_validation_steps_validated_by_idToagents: { include: { users: true } },
        },
      },
      agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
    },
  });
  if (!demande) throw new Error("Demande introuvable");
  return demande;
}

async function getBonCommandeData(idOrUuid) {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };
  const bc = await prisma.bons_commande.findFirst({
    where,
    include: {
      bon_commande_items: true,
      fournisseurs: true,
      demandes_paiement: {
        include: {
          agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
        },
      },
      documents: true,
      receptions: true,
      agents: { include: { users: true } },
    },
  });
  if (!bc) throw new Error("Bon de commande introuvable");
  return bc;
}

async function getReceptionData(idOrUuid) {
  const where = isNumericId(idOrUuid) ? { id: Number(idOrUuid) } : { uuid: String(idOrUuid) };
  const reception = await prisma.receptions.findFirst({
    where,
    include: {
      demandes_paiement: true,
      bons_commande: true,
      documents: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
  });
  if (!reception) throw new Error("Réception introuvable");
  return reception;
}

async function streamDemandePdf(res, idOrUuid) {
  const d = await getDemandeData(idOrUuid);
  return streamDemandePdfFromData(res, d);
}

async function streamDemandePdfFromData(res, d, { forceFinal = false, forcedFinalizedAt = null } = {}) {
  const filename = `demande_${d.uuid}.pdf`;

  const isFinal = forceFinal ? true : isDemandeFullyValidated(d);
  const finalizedAt = isFinal ? forcedFinalizedAt || demandeFinalizedAt(d) : null;
  const finalizedIso = asIsoDateTime(finalizedAt) || "";
  const tokenBase = `GP|demande|${d.uuid}|${finalizedIso}`;
  const sig = isFinal ? hmacSignature(tokenBase) : null;
  const token = isFinal && sig ? `${tokenBase}|${sig}` : null;
  const ref = sig ? String(sig).slice(0, 16) : null;
  const qrText = token ? buildScanUrl(token) || token : null;
  const qrBuf = qrText ? await qrPngBuffer(qrText) : null;

  const template = loadTemplateHtml("template1.html");
  const vars = {
    montant: asMoney(d.montant),
    montant_lettres: amountToFrenchWordsFcfa(d.montant),
    motif: d.motif || "",
    beneficiaire: d.beneficiaire || "",
    note: d.note || d.remarque || d.description || "",
  };

  let html = applyTemplateVars(template, vars);

  {
    const demandeurName = userDisplayNameFromAgent(d.agents_demandes_paiement_demandeur_idToagents);
    const stepByRole = new Map((d.validation_steps || []).map((s) => [String(s.role_name || "").toUpperCase(), s]));
    const pick = (role) => stepByRole.get(String(role).toUpperCase()) || null;
    const dg = pick("DG");
    const dga = pick("DGA");
    const daf = pick("DAF");

    const dgSig = dg?.signature_url ? signatureUrlToDataUrl(dg.signature_url) : null;
    const dgaSig = dga?.signature_url ? signatureUrlToDataUrl(dga.signature_url) : null;
    const dafSig = daf?.signature_url ? signatureUrlToDataUrl(daf.signature_url) : null;

    html = injectDemandeSignataires(html, {
      // Demandeur: affiché dès la soumission (création)
      demandeur: signatureCellHtml({ name: demandeurName, at: asDateTime(d.created_at), signatureDataUrl: null }),
      dg: dg?.validated_by_id
        ? signatureCellHtml({
            name: userDisplayNameFromAgent(dg.agents_validation_steps_validated_by_idToagents),
            at: asDateTime(dg.validated_at),
            signatureDataUrl: dgSig,
          })
        : "",
      dga: dga?.validated_by_id
        ? signatureCellHtml({
            name: userDisplayNameFromAgent(dga.agents_validation_steps_validated_by_idToagents),
            at: asDateTime(dga.validated_at),
            signatureDataUrl: dgaSig,
          })
        : "",
      daf: daf?.validated_by_id
        ? signatureCellHtml({
            name: userDisplayNameFromAgent(daf.agents_validation_steps_validated_by_idToagents),
            at: asDateTime(daf.validated_at),
            signatureDataUrl: dafSig,
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

async function streamBonCommandePdf(res, idOrUuid) {
  const bc = await getBonCommandeData(idOrUuid);
  const filename = `bon_commande_${bc.numero || bc.uuid}.pdf`;

  const template = loadTemplateHtml("bc.html");

  const items = Array.isArray(bc.bon_commande_items) ? bc.bon_commande_items : [];
  const subtotal = items.reduce((acc, it) => {
    const line = it?.total_ligne != null ? Number(it.total_ligne) : Number(it?.prix_unitaire || 0) * Number(it?.quantite || 0);
    return acc + (Number.isFinite(line) ? line : 0);
  }, 0);
  const tax = 0;
  const total = subtotal + tax;

  const vendorName = bc.fournisseurs?.raison_sociale || bc.fournisseurs?.nom || "-";
  const vendorAddress = bc.fournisseurs?.adresse || bc.fournisseurs?.address || "-";
  const vendorPhone = bc.fournisseurs?.telephone || bc.fournisseurs?.tel || bc.fournisseurs?.phone || "-";
  const requisitioner = bc?.demandes_paiement?.agents_demandes_paiement_demandeur_idToagents
    ? userDisplayNameFromAgent(bc.demandes_paiement.agents_demandes_paiement_demandeur_idToagents)
    : bc?.agents
      ? userDisplayNameFromAgent(bc.agents)
      : "-";

  const view = {
    company: {
      address: process.env.COMPANY_ADRESSE || process.env.COMPANY_ADDRESS || "-",
      phone: process.env.COMPANY_TELEPHONE || process.env.COMPANY_TEL || "-",
      email: process.env.COMPANY_EMAIL || "-",
    },
    po: {
      number: bc.numero || bc.uuid,
      date: asDate(bc.date_commande) || "-",
      requisitioner,
      ship_via: "-",
      fob: "-",
      shipping_terms: "-",
      comments: bc.statut ? `Statut: ${bc.statut}` : "",
    },
    vendor: {
      name: vendorName,
      address: vendorAddress,
      phone: vendorPhone,
    },
    ship_to: {
      name: "GREENPAY",
      address: process.env.COMPANY_ADRESSE || process.env.COMPANY_ADDRESS || "-",
      phone: process.env.COMPANY_TELEPHONE || process.env.COMPANY_TEL || "-",
    },
    items: items.map((it, idx) => {
      const qty = Number(it?.quantite || 0);
      const up = it?.prix_unitaire != null ? Number(it.prix_unitaire) : null;
      const line = it?.total_ligne != null ? Number(it.total_ligne) : (up != null ? up * qty : null);
      return {
        sku: it?.unite ? String(it.unite) : String(idx + 1),
        name: it?.designation ? String(it.designation) : "-",
        qty: Number.isFinite(qty) ? qty : "-",
        unit_price: up != null && Number.isFinite(up) ? `${asMoney(up)} FCFA` : "-",
        line_total: line != null && Number.isFinite(line) ? `${asMoney(line)} FCFA` : "-",
      };
    }),
    totals: {
      subtotal: `${asMoney(subtotal)} FCFA`,
      tax: `${asMoney(tax)} FCFA`,
      total: `${asMoney(total)} FCFA`,
    },
  };

  const html = Mustache.render(template, view);
  const pdfBuffer = await renderHtmlToPdfBuffer(html);
  return sendPdfBuffer(res, filename, pdfBuffer);
}

async function streamReceptionPdf(res, idOrUuid) {
  const r = await getReceptionData(idOrUuid);
  if (!isReceptionFullyVised(r)) {
    throw new Error("PDF indisponible: la réception doit être visée par le Directeur et le DAF");
  }
  return streamReceptionPdfFromData(res, r);
}

async function streamReceptionPdfFromData(
  res,
  r,
  { forceFinal = false, forcedFinalizedAt = null } = {}
) {
  const filename = `reception_${r.uuid}.pdf`;

  const isFinal = forceFinal ? true : isReceptionFullyVised(r);
  const finalizedIso = isFinal ? asIsoDateTime(forcedFinalizedAt || r.created_at) || "" : "";
  const tokenBase = `GP|reception|${r.uuid}|${finalizedIso}`;
  const sig = isFinal ? hmacSignature(tokenBase) : null;
  const token = isFinal && sig ? `${tokenBase}|${sig}` : null;
  const ref = sig ? String(sig).slice(0, 16) : null;
  const qrText = token ? buildScanUrl(token) || token : null;
  const qrBuf = qrText ? await qrPngBuffer(qrText) : null;

  sendPdf(res, filename, (doc) => {
    drawReceptionSheet(doc, r, { isFinal, qrBuf, token, ref });
  }, { compress: false });
}

module.exports = {
  streamDemandePdf,
  streamDemandePdfFromData,
  streamBonCommandePdf,
  streamReceptionPdf,
  streamReceptionPdfFromData,
};
