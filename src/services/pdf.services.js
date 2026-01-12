const PDFDocument = require("pdfkit");
const prisma = require("../config/prisma");

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

function writeHeader(doc, title) {
  doc.fontSize(14).font("Helvetica-Bold").text("GREEN PAY", { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(12).font("Helvetica").text(title, { align: "center" });
  doc.moveDown(1);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(1);
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

function sendPdf(res, filename, build) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
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
      validation_steps: { orderBy: { level: "asc" } },
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
      demandes_paiement: true,
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
      agents: { include: { users: true } },
    },
  });
  if (!reception) throw new Error("Réception introuvable");
  return reception;
}

async function streamDemandePdf(res, idOrUuid) {
  const d = await getDemandeData(idOrUuid);
  const filename = `demande_${d.uuid}.pdf`;

  sendPdf(res, filename, (doc) => {
    writeHeader(doc, "Demande de dépense");

    writeSectionTitle(doc, "Informations");
    writeKv(doc, "UUID", d.uuid);
    writeKv(doc, "Motif", d.motif);
    writeKv(doc, "Bénéficiaire", d.beneficiaire);
    writeKv(doc, "Statut", d.statut);
    writeKv(doc, "Montant", `${asMoney(d.montant)} FCFA`);
    writeKv(doc, "Créée le", asDateTime(d.created_at));

    if (d.description) {
      doc.moveDown(0.6);
      writeSectionTitle(doc, "Description");
      doc.fontSize(9).font("Helvetica").text(asText(d.description));
    }

    if (Array.isArray(d.demande_items) && d.demande_items.length) {
      writeSectionTitle(doc, "Items");
      writeSimpleTable(
        doc,
        [
          { key: "designation", label: "Désignation", flex: 5 },
          { key: "quantite", label: "Qté", flex: 1 },
          { key: "prix_unitaire", label: "PU", flex: 2 },
          { key: "unite", label: "Unité", flex: 1 },
        ],
        d.demande_items.map((it) => ({
          designation: it.designation,
          quantite: it.quantite,
          prix_unitaire: it.prix_unitaire != null ? asMoney(it.prix_unitaire) : "-",
          unite: it.unite || "-",
        }))
      );
    }

    if (Array.isArray(d.validation_steps) && d.validation_steps.length) {
      writeSectionTitle(doc, "Circuit de validation");
      writeSimpleTable(
        doc,
        [
          { key: "level", label: "Niveau", flex: 1 },
          { key: "role", label: "Rôle", flex: 2 },
          { key: "status", label: "Statut", flex: 2 },
          { key: "date", label: "Date", flex: 2 },
        ],
        d.validation_steps.map((s) => ({
          level: s.level,
          role: s.role_name,
          status: s.status,
          date: asDateTime(s.validated_at),
        }))
      );
    }
  });
}

async function streamBonCommandePdf(res, idOrUuid) {
  const bc = await getBonCommandeData(idOrUuid);
  const filename = `bon_commande_${bc.numero || bc.uuid}.pdf`;

  sendPdf(res, filename, (doc) => {
    writeHeader(doc, "Bon de commande");

    writeSectionTitle(doc, "Informations");
    writeKv(doc, "UUID", bc.uuid);
    writeKv(doc, "Numéro", bc.numero);
    writeKv(doc, "Statut", bc.statut);
    writeKv(doc, "Date commande", asDate(bc.date_commande));
    writeKv(doc, "Demande liée", bc.demandes_paiement?.uuid || bc.demande_id);
    writeKv(doc, "Fournisseur", bc.fournisseurs?.raison_sociale || bc.fournisseurs?.nom || "-");

    if (Array.isArray(bc.bon_commande_items) && bc.bon_commande_items.length) {
      writeSectionTitle(doc, "Items");
      writeSimpleTable(
        doc,
        [
          { key: "designation", label: "Désignation", flex: 5 },
          { key: "quantite", label: "Qté", flex: 1 },
          { key: "pu", label: "PU", flex: 2 },
          { key: "unite", label: "Unité", flex: 1 },
        ],
        bc.bon_commande_items.map((it) => ({
          designation: it.designation,
          quantite: it.quantite,
          pu: it.prix_unitaire != null ? asMoney(it.prix_unitaire) : "-",
          unite: it.unite || "-",
        }))
      );
    }
  });
}

async function streamReceptionPdf(res, idOrUuid) {
  const r = await getReceptionData(idOrUuid);
  const filename = `reception_${r.uuid}.pdf`;

  sendPdf(res, filename, (doc) => {
    writeHeader(doc, "Réception");

    writeSectionTitle(doc, "Informations");
    writeKv(doc, "UUID", r.uuid);
    writeKv(doc, "Demande liée", r.demandes_paiement?.uuid || r.demande_id);
    writeKv(doc, "BC liée", r.bons_commande?.numero || r.bon_commande_id || "-");
    writeKv(doc, "Date réception", asDateTime(r.date_reception));
    writeKv(doc, "Conforme", r.conforme ? "Oui" : "Non");
    writeKv(doc, "Référence facture", r.reference_facture || "-");
    writeKv(doc, "Montant", r.montant != null ? `${asMoney(r.montant)} FCFA` : "-");

    if (r.observations) {
      writeSectionTitle(doc, "Observations");
      doc.fontSize(9).font("Helvetica").text(asText(r.observations));
    }

    writeSectionTitle(doc, "Visas");
    writeKv(doc, "Visa Directeur", r.visa_directeur_id ? "Oui" : "Non");
    writeKv(doc, "Visa DAF", r.visa_daf_id ? "Oui" : "Non");
  });
}

module.exports = {
  streamDemandePdf,
  streamBonCommandePdf,
  streamReceptionPdf,
};
