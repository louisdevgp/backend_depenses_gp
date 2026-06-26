const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const COLORS = {
  ink: "#111827",
  muted: "#64748B",
  line: "#D8E0EA",
  soft: "#F5F8FC",
  primary: "#0F766E",
  primaryDark: "#0B4F4A",
  accent: "#1D4ED8",
};

const SIGNATURE_RECTS = {
  signature: { x: 62, y: 672, width: 300, height: 76 },
  date: { x: 390, y: 672, width: 142, height: 76 },
};

function toPct(value, total) {
  return Math.round((Number(value) / total) * 10000) / 100;
}

function buildSignatureFields({ recipientId }) {
  const toField = (type, rect) => ({
    recipient_id: recipientId,
    type,
    page_number: 1,
    position: {
      x: toPct(rect.x, A4_WIDTH),
      y: toPct(rect.y, A4_HEIGHT),
      width: toPct(rect.width, A4_WIDTH),
      height: toPct(rect.height, A4_HEIGHT),
    },
  });

  return [
    toField("signature", SIGNATURE_RECTS.signature),
    toField("date", SIGNATURE_RECTS.date),
  ];
}

function safeText(value, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || fallback;
}

function localLogoPaths() {
  const envPath = process.env.SIGNATURE_LOGO_PATH ? String(process.env.SIGNATURE_LOGO_PATH).trim() : "";
  return [
    envPath,
    path.resolve(__dirname, "../../../dashboard_depenses/public/logo.png"),
    path.resolve(__dirname, "../../../dashboard_depenses/dist/logo.png"),
    path.resolve(__dirname, "../../public/logo.png"),
  ].filter(Boolean);
}

function getLogoBuffer() {
  for (const logoPath of localLogoPaths()) {
    try {
      if (fs.existsSync(logoPath)) return fs.readFileSync(logoPath);
    } catch (_) {
      // Continue with the next candidate. The PDF must still be generated without a logo.
    }
  }
  return null;
}

function drawLogo(doc, x, y) {
  const logoBuffer = getLogoBuffer();
  if (!logoBuffer) {
    doc
      .rect(x, y, 46, 46)
      .fillAndStroke(COLORS.primary, COLORS.primary);
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("GP", x, y + 15, { width: 46, align: "center" });
    return;
  }

  try {
    doc.image(logoBuffer, x, y, { fit: [58, 46], align: "left", valign: "center" });
  } catch (_) {
    doc
      .rect(x, y, 46, 46)
      .fillAndStroke(COLORS.primary, COLORS.primary);
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("GP", x, y + 15, { width: 46, align: "center" });
  }
}

function drawHeader(doc, title, subtitle) {
  doc.save();
  doc.rect(0, 0, A4_WIDTH, 116).fill("#FFFFFF");
  doc.rect(0, 112, A4_WIDTH, 4).fill(COLORS.primary);
  drawLogo(doc, 42, 36);

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("GreenPay", 112, 38);

  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Gestion des demandes de depenses", 112, 58);

  doc
    .rect(396, 36, 156, 28)
    .fillAndStroke("#EEF6F5", "#C7E2DE");
  doc
    .fillColor(COLORS.primaryDark)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("SIGNATURE ELECTRONIQUE", 396, 46, { width: 156, align: "center" });

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(24)
    .text(safeText(title), 42, 142, { width: 511, align: "center" });

  if (subtitle) {
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(10)
      .text(safeText(subtitle), 42, 172, { width: 511, align: "center" });
  }

  doc.restore();
}

function drawReferenceBar(doc, reference, generatedAtText) {
  doc.save();
  doc.rect(42, 204, 511, 42).fillAndStroke(COLORS.soft, COLORS.line);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text("REFERENCE", 62, 216);
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(safeText(reference), 62, 228, {
    width: 310,
    ellipsis: true,
  });
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text("DATE DE GENERATION", 394, 216);
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(safeText(generatedAtText), 394, 228, {
    width: 130,
    align: "right",
  });
  doc.restore();
}

function drawInfoCard(doc, x, y, width, label, value) {
  doc.save();
  doc.rect(x, y, width, 46).fillAndStroke("#FFFFFF", COLORS.line);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(safeText(label).toUpperCase(), x + 12, y + 10, {
    width: width - 24,
    ellipsis: true,
  });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(safeText(value), x + 12, y + 24, {
    width: width - 24,
    height: 14,
    ellipsis: true,
  });
  doc.restore();
}

function drawRows(doc, rows) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const x1 = 42;
  const x2 = 304;
  const width = 249;
  let y = 270;

  cleanRows.forEach((row, index) => {
    const colX = index % 2 === 0 ? x1 : x2;
    drawInfoCard(doc, colX, y, width, row.label, row.value);
    if (index % 2 === 1) y += 58;
  });

  if (cleanRows.length % 2 === 1) y += 58;
  return y;
}

function drawNote(doc, y, note) {
  doc.save();
  doc.rect(42, y, 511, 60).fillAndStroke("#F8FBFF", "#D6E4F5");
  doc
    .fillColor(COLORS.accent)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("OBJET DE LA SIGNATURE", 62, y + 14);
  doc
    .fillColor(COLORS.ink)
    .font("Helvetica")
    .fontSize(9)
    .text(safeText(note), 62, y + 30, { width: 471, height: 18, ellipsis: true });
  doc.restore();
}

function drawSignatureArea(doc, signerName) {
  const signature = SIGNATURE_RECTS.signature;
  const date = SIGNATURE_RECTS.date;

  doc.save();
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11).text("Zone de signature", 62, 626);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(
    "La signature Firma et la date seront apposees automatiquement dans les cadres ci-dessous.",
    62,
    642,
    { width: 470 }
  );

  doc.fillColor(COLORS.primaryDark).font("Helvetica-Bold").fontSize(8).text("SIGNATURE DU SIGNATAIRE", signature.x, signature.y - 14, {
    width: signature.width,
  });
  doc.fillColor(COLORS.primaryDark).font("Helvetica-Bold").fontSize(8).text("DATE", date.x, date.y - 14, {
    width: date.width,
  });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(`Signataire : ${safeText(signerName)}`, signature.x, signature.y + signature.height + 8, {
    width: 470,
    ellipsis: true,
  });

  doc.rect(signature.x, signature.y, signature.width, signature.height).fillAndStroke("#FFFFFF", COLORS.primary);
  doc.rect(date.x, date.y, date.width, date.height).fillAndStroke("#FFFFFF", COLORS.primary);
  doc.restore();
}

function drawFooter(doc, footer) {
  doc.save();
  doc.moveTo(42, 778).lineTo(553, 778).strokeColor(COLORS.line).stroke();
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(
      safeText(footer, "Ce document sert uniquement de preuve de signature electronique."),
      42,
      790,
      { width: 511, align: "center" }
    );
  doc.restore();
}

function buildSignaturePdf({ title, subtitle, reference, generatedAtText, rows, note, signerName, footer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, title, subtitle);
    drawReferenceBar(doc, reference, generatedAtText);
    const nextY = drawRows(doc, rows);
    drawNote(doc, Math.min(nextY + 8, 548), note);
    drawSignatureArea(doc, signerName);
    drawFooter(doc, footer);

    doc.end();
  });
}

module.exports = {
  buildSignatureFields,
  buildSignaturePdf,
};
