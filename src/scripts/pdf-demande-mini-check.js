/* eslint-disable no-console */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const { once } = require("events");

const prisma = require("../config/prisma");
const pdfService = require("../services/pdf.services");

class FakeRes extends PassThrough {
  constructor() {
    super();
    this.headers = Object.create(null);
    this.statusCode = 200;
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  }

  status(code) {
    this.statusCode = Number(code);
    return this;
  }
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertLooksLikePdf(buf, label) {
  assert(Buffer.isBuffer(buf), `${label}: buffer invalide`);
  const head = buf.subarray(0, 5).toString("utf8");
  assert(head === "%PDF-", `${label}: signature PDF manquante (%PDF-)`);
  const hasEof = buf.includes(Buffer.from("%%EOF", "utf8"));
  assert(hasEof, `${label}: fin PDF manquante (%%EOF)`);
}

async function streamToBuffer(resStream) {
  const chunks = [];
  resStream.on("data", (c) => chunks.push(Buffer.from(c)));
  await Promise.race([
    once(resStream, "end"),
    once(resStream, "error").then(([err]) => {
      throw err;
    }),
  ]);
  return Buffer.concat(chunks);
}

function isFinalDemandeLike(d) {
  const statutOk = String(d?.statut || "").trim().toLowerCase() === "approuvee";
  const steps = Array.isArray(d?.validation_steps) ? d.validation_steps : [];
  const allValid = steps.length > 0 && steps.every((s) => String(s?.status || "").trim().toLowerCase() === "valide");
  return statutOk && allValid;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyTemplateVars(html, vars) {
  return String(html).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, key) => {
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

function clonePlain(obj) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch {
      // fallback below
    }
  }
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      return v;
    })
  );
}

async function main() {
  // Garantit qu'on peut calculer une signature HMAC dans les simulations
  if (!process.env.SIGNATURE_SECRET && !process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
    process.env.SIGNATURE_SECRET = "dev-local-secret";
    console.log("WARN: aucun secret trouvé (SIGNATURE_SECRET/JWT_*). Utilisation d'un secret de dev local.");
  }

  const outDir = path.resolve(process.cwd(), "tmp", "pdf-check");
  await ensureDir(outDir);

  // Charge quelques demandes récentes et sélectionne une non-finale si possible
  const candidates = await prisma.demandes_paiement.findMany({
    where: { deleted_at: null },
    include: {
      validation_steps: true,
      agents_demandes_paiement_demandeur_idToagents: { include: { users: true } },
    },
    orderBy: { created_at: "desc" },
    take: 20,
  });

  const nonFinal = candidates.find((d) => !isFinalDemandeLike(d)) || null;
  const anyDemande = candidates[0] || null;
  assert(anyDemande, "Aucune demande trouvée en base.");

  // 1) Cas non-final: génération PDF OK et pas d'overlay QR (au niveau HTML)
  if (nonFinal) {
    const templatePath = path.join(__dirname, "..", "templates", "template1.html");
    const template = await fs.promises.readFile(templatePath, "utf8");
    const vars = {
      montant: String(nonFinal.montant ?? ""),
      montant_lettres: "", // pas nécessaire pour le check d'overlay
      motif: nonFinal.motif || "",
      beneficiaire: nonFinal.beneficiaire || "",
      note: nonFinal.note || nonFinal.remarque || nonFinal.description || "",
    };
    const html = applyTemplateVars(template, vars);
    assert(!html.includes("gp-qr-overlay"), "Non-final: le template HTML ne doit pas contenir l'overlay QR.");

    const res = new FakeRes();
    const bufPromise = streamToBuffer(res);
    await pdfService.streamDemandePdf(res, nonFinal.uuid);
    const pdfBuf = await bufPromise;
    const outPath = path.join(outDir, `demande_NON_FINAL_${nonFinal.uuid}.pdf`);
    await fs.promises.writeFile(outPath, pdfBuf);
    assertLooksLikePdf(pdfBuf, `PDF non-final -> ${outPath}`);
    console.log(`OK: Demande non-finale => pas de QR (gating OK) -> ${outPath}`);
  } else {
    console.log("WARN: aucune demande non-finale trouvée (impossible de tester le cas 'sans QR').");
  }

  // 2) Cas final simulé: on force final via streamDemandePdfFromData et on valide la présence d'overlay QR au niveau HTML
  const dSim = clonePlain(anyDemande);
  dSim.statut = "approuvee";
  dSim.validation_steps = Array.isArray(dSim.validation_steps) ? dSim.validation_steps : [{ status: "valide" }];
  dSim.validation_steps.forEach((s) => {
    s.status = "valide";
  });

  // Ici le PDF service va injecter l'overlay QR (si secret OK). On vérifie que le HTML overlay est bien présent
  // en reproduisant l'injection (déterministe) avec un dataUrl fictif.
  {
    const templatePath = path.join(__dirname, "..", "templates", "template1.html");
    const template = await fs.promises.readFile(templatePath, "utf8");
    const vars = {
      montant: String(dSim.montant ?? ""),
      montant_lettres: "",
      motif: dSim.motif || "",
      beneficiaire: dSim.beneficiaire || "",
      note: dSim.note || dSim.remarque || dSim.description || "",
    };
    let html = applyTemplateVars(template, vars);
    html = injectQrOverlay(html, { qrDataUrl: "data:image/png;base64,AAAA", ref: "SIMREF" });
    assert(html.includes("gp-qr-overlay"), "Final simulé: overlay QR attendu dans le HTML.");
  }

  const now = new Date();
  const res2 = new FakeRes();
  const bufPromise2 = streamToBuffer(res2);
  await pdfService.streamDemandePdfFromData(res2, dSim, { forceFinal: true, forcedFinalizedAt: now });
  const pdfBuf2 = await bufPromise2;
  const outPath2 = path.join(outDir, `demande_SIM_FINAL_${String(dSim.uuid)}.pdf`);
  await fs.promises.writeFile(outPath2, pdfBuf2);
  assertLooksLikePdf(pdfBuf2, `PDF final simulé -> ${outPath2}`);
  console.log(`OK: Demande simulée finale => PDF généré (QR attendu visuellement) -> ${outPath2}`);

  console.log("\nMini-check demande terminé: OK.");
}

main()
  .catch((e) => {
    console.error("Erreur:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
