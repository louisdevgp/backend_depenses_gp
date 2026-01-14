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

async function generateReceptionPdfBuffer(idOrUuid) {
  const res = new FakeRes();
  const bufPromise = streamToBuffer(res);
  await pdfService.streamReceptionPdf(res, idOrUuid);
  return bufPromise;
}

async function tryGenerateReceptionPdfBuffer(idOrUuid) {
  try {
    const buf = await generateReceptionPdfBuffer(idOrUuid);
    return { ok: true, buf, error: null };
  } catch (e) {
    return { ok: false, buf: null, error: e };
  }
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

function bufferContainsUtf8(buf, needle) {
  // Heuristique simple: PDFKit met souvent les chaînes en clair.
  // Suffisant pour valider la présence/absence du libellé QR "Ref:".
  return buf.includes(Buffer.from(String(needle), "utf8"));
}

function bufferContainsRefMarker(buf) {
  // PDFKit peut écrire les chaînes soit en clair, soit en hex string (<...>).
  // 'Ref:' en hex ASCII = 52 65 66 3a => "5265663a"
  return bufferContainsUtf8(buf, "Ref:") || bufferContainsUtf8(buf, "5265663a");
}

async function main() {
  const outDir = path.resolve(process.cwd(), "tmp", "pdf-check");
  await ensureDir(outDir);

  const nonFinal = await prisma.receptions.findFirst({
    where: {
      OR: [{ visa_directeur_id: null }, { visa_daf_id: null }],
    },
    select: { uuid: true, visa_directeur_id: true, visa_daf_id: true },
    orderBy: { created_at: "desc" },
  });

  const final = await prisma.receptions.findFirst({
    where: {
      AND: [{ visa_directeur_id: { not: null } }, { visa_daf_id: { not: null } }],
    },
    select: { uuid: true, visa_directeur_id: true, visa_daf_id: true },
    orderBy: { created_at: "desc" },
  });

  if (!nonFinal) {
    console.log("WARN: aucune réception NON-FINALE trouvée (impossible de tester l'absence de QR).");
  }
  if (!final) {
    console.log("WARN: aucune réception FINALE trouvée (impossible de tester la présence de QR).");
  }

  if (!nonFinal && !final) {
    console.log("WARN: aucune réception trouvée en base. Mini-check ignoré.");
    return;
  }

  let failures = 0;

  if (nonFinal) {
    const attempt = await tryGenerateReceptionPdfBuffer(nonFinal.uuid);

    if (attempt.ok) {
      failures += 1;
      const outPath = path.join(outDir, `reception_NON_FINAL_${nonFinal.uuid}.pdf`);
      await fs.promises.writeFile(outPath, attempt.buf);
      console.log(`FAIL: Une réception NON-FINALE a généré un PDF (devrait être refusé) -> ${outPath}`);
    } else {
      const msg = attempt.error?.message || String(attempt.error);
      if (String(msg).toLowerCase().includes("pdf indisponible")) {
        console.log("OK: Non-final refusé (PDF indisponible tant que 2 visas ne sont pas présents).");
      } else {
        failures += 1;
        console.log(`FAIL: Erreur inattendue sur non-final -> ${msg}`);
      }
    }
  }

  if (final) {
    const attempt = await tryGenerateReceptionPdfBuffer(final.uuid);
    if (!attempt.ok) {
      failures += 1;
      console.log(`FAIL: PDF final non généré -> ${attempt.error?.message || attempt.error}`);
    } else {
      const outPath = path.join(outDir, `reception_FINAL_${final.uuid}.pdf`);
      await fs.promises.writeFile(outPath, attempt.buf);

      assertLooksLikePdf(attempt.buf, `PDF final -> ${outPath}`);
      const hasRef = bufferContainsRefMarker(attempt.buf);
      if (!hasRef) {
        failures += 1;
        console.log(`FAIL: Final ne contient pas 'Ref:' (QR devrait apparaître) -> ${outPath}`);
      } else {
        console.log(`OK: Final affiche le bloc QR -> ${outPath}`);
      }
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    console.log(`\nMini-check terminé: ${failures} échec(s).`);
  } else {
    console.log("\nMini-check terminé: OK.");
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
