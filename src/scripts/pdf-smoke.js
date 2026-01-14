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

function parseArgs(argv) {
  const args = {
    demande: null,
    reception: null,
    outDir: path.resolve(process.cwd(), "tmp", "pdfs"),
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--demande" || a === "-d") args.demande = argv[i + 1], (i += 1);
    else if (a === "--reception" || a === "-r") args.reception = argv[i + 1], (i += 1);
    else if (a === "--out" || a === "-o") args.outDir = path.resolve(process.cwd(), argv[i + 1]), (i += 1);
  }

  return args;
}

function printHelp() {
  console.log("PDF smoke test (Demande / Réception)");
  console.log("\nUsage:");
  console.log("  node src/scripts/pdf-smoke.js [options]\n");
  console.log("Options:");
  console.log("  -d, --demande <id|uuid>     Génère le PDF d'une demande");
  console.log("  -r, --reception <id|uuid>   Génère le PDF d'une réception");
  console.log("  -o, --out <dir>             Dossier de sortie (défaut: ./tmp/pdfs)");
  console.log("  -h, --help                  Aide\n");
  console.log("Sans -d/-r, le script prend la dernière Demande et la dernière Réception.");
}

async function ensureOutDir(outDir) {
  await fs.promises.mkdir(outDir, { recursive: true });
}

async function latestUuid(modelName) {
  if (modelName === "demande") {
    const d = await prisma.demandes_paiement.findFirst({
      where: { deleted_at: null },
      select: { uuid: true },
      orderBy: { created_at: "desc" },
    });
    return d?.uuid || null;
  }
  if (modelName === "reception") {
    const r = await prisma.receptions.findFirst({
      select: { uuid: true },
      orderBy: { created_at: "desc" },
    });
    return r?.uuid || null;
  }
  return null;
}

async function writeDemandePdf({ idOrUuid, outDir }) {
  const res = new FakeRes();
  const outPath = path.join(outDir, `demande_${String(idOrUuid)}.pdf`);
  const out = fs.createWriteStream(outPath);
  res.pipe(out);

  const servicePromise = pdfService.streamDemandePdf(res, idOrUuid);
  await Promise.all([servicePromise, once(out, "finish")]);
  return outPath;
}

async function writeReceptionPdf({ idOrUuid, outDir }) {
  const res = new FakeRes();
  const outPath = path.join(outDir, `reception_${String(idOrUuid)}.pdf`);
  const out = fs.createWriteStream(outPath);
  res.pipe(out);

  const servicePromise = pdfService.streamReceptionPdf(res, idOrUuid);
  await Promise.all([servicePromise, once(out, "finish")]);
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  await ensureOutDir(args.outDir);

  const demandeIdOrUuid = args.demande || (await latestUuid("demande"));
  const receptionIdOrUuid = args.reception || (await latestUuid("reception"));

  if (!demandeIdOrUuid && !receptionIdOrUuid) {
    throw new Error("Aucune demande/réception trouvée en base. Fournis --demande/--reception.");
  }

  console.log(`Sortie: ${args.outDir}`);
  if (demandeIdOrUuid) {
    const p = await writeDemandePdf({ idOrUuid: demandeIdOrUuid, outDir: args.outDir });
    console.log(`OK Demande PDF: ${p}`);
  } else {
    console.log("Skip Demande: aucune trouvée.");
  }

  if (receptionIdOrUuid) {
    const p = await writeReceptionPdf({ idOrUuid: receptionIdOrUuid, outDir: args.outDir });
    console.log(`OK Réception PDF: ${p}`);
  } else {
    console.log("Skip Réception: aucune trouvée.");
  }
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
