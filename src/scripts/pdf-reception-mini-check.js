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
  return buf.includes(Buffer.from(String(needle), "utf8"));
}

function bufferContainsRefMarker(buf) {
  return bufferContainsUtf8(buf, "Ref:") || bufferContainsUtf8(buf, "5265663a");
}

async function generateReceptionPdfBufferFromUuid(uuid) {
  const res = new FakeRes();
  const bufPromise = streamToBuffer(res);
  await pdfService.streamReceptionPdf(res, uuid);
  return bufPromise;
}

async function generateReceptionPdfBufferFromData(rSim, now) {
  const res = new FakeRes();
  const bufPromise = streamToBuffer(res);
  await pdfService.streamReceptionPdfFromData(res, rSim, { forceFinal: true, forcedFinalizedAt: now });
  return bufPromise;
}

async function main() {
  // Garantit qu'on peut calculer une signature HMAC pour afficher un QR en simulation
  if (!process.env.SIGNATURE_SECRET && !process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
    process.env.SIGNATURE_SECRET = "dev-local-secret";
    console.log("WARN: aucun secret trouvé (SIGNATURE_SECRET/JWT_*). Utilisation d'un secret de dev local.");
  }

  const outDir = path.resolve(process.cwd(), "tmp", "pdf-check");
  await ensureDir(outDir);

  const anyReception = await prisma.receptions.findFirst({
    include: {
      demandes_paiement: true,
      bons_commande: true,
      documents: true,
      agents_receptions_recu_par_idToagents: { include: { users: true } },
      agents_receptions_visa_directeur_idToagents: { include: { users: true } },
      agents_receptions_visa_daf_idToagents: { include: { users: true } },
    },
    orderBy: { created_at: "desc" },
  });
  if (!anyReception) throw new Error("Aucune réception trouvée en base.");

  const nonFinal =
    (await prisma.receptions.findFirst({
      where: { OR: [{ visa_directeur_id: null }, { visa_daf_id: null }] },
      select: { uuid: true },
      orderBy: { created_at: "desc" },
    })) || null;

  let failures = 0;

  if (nonFinal) {
    let threw = false;
    try {
      await generateReceptionPdfBufferFromUuid(nonFinal.uuid);
    } catch (e) {
      threw = true;
      console.log(`OK: Non-final => téléchargement bloqué (${e?.message || "erreur"})`);
    }
    if (!threw) {
      failures += 1;
      console.log("FAIL: Une réception non visée ne devrait pas être téléchargeable en PDF.");
    }
  } else {
    console.log("WARN: aucune réception NON-FINALE trouvée (skip absence QR).");
  }

  // Final simulé (zéro update DB)
  const fallbackAgent = await prisma.agents.findFirst({ include: { users: true }, orderBy: { id: "asc" } });
  const agentForVisa =
    anyReception.agents_receptions_recu_par_idToagents ||
    anyReception.agents_receptions_visa_directeur_idToagents ||
    anyReception.agents_receptions_visa_daf_idToagents ||
    fallbackAgent;
  if (!agentForVisa) throw new Error("Aucun agent trouvé (impossible de simuler les visas).");

  const now = new Date();
  const rSim = {
    ...anyReception,
    visa_directeur_id: agentForVisa.id,
    visa_daf_id: agentForVisa.id,
    agents_receptions_visa_directeur_idToagents: agentForVisa,
    agents_receptions_visa_daf_idToagents: agentForVisa,
    updated_at: now,
  };

  const bufSim = await generateReceptionPdfBufferFromData(rSim, now);
  const outPathSim = path.join(outDir, `reception_SIM_FINAL_${rSim.uuid}.pdf`);
  await fs.promises.writeFile(outPathSim, bufSim);
  assertLooksLikePdf(bufSim, `PDF final simulé -> ${outPathSim}`);
  const hasRefSim = bufferContainsRefMarker(bufSim);
  if (!hasRefSim) {
    failures += 1;
    console.log(`FAIL: Final simulé ne contient pas 'Ref:' (QR devrait apparaître) -> ${outPathSim}`);
  } else {
    console.log(`OK: Final simulé affiche le bloc QR -> ${outPathSim}`);
  }

  if (failures > 0) {
    process.exitCode = 1;
    console.log(`\nMini-check réception terminé: ${failures} échec(s).`);
  } else {
    console.log("\nMini-check réception terminé: OK.");
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
