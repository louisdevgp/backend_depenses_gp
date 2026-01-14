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

async function main() {
  // Garantit qu'on peut calculer une signature HMAC pour afficher un QR
  if (!process.env.SIGNATURE_SECRET && !process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
    process.env.SIGNATURE_SECRET = "dev-local-secret";
    console.log("WARN: aucun secret trouvé (SIGNATURE_SECRET/JWT_*). Utilisation d'un secret de dev local.");
  }

  const outDir = path.resolve(process.cwd(), "tmp", "pdf-sim");
  await ensureDir(outDir);

  // Prend une réception non-finale si possible (sinon la plus récente)
  const reception =
    (await prisma.receptions.findFirst({
      where: { OR: [{ visa_directeur_id: null }, { visa_daf_id: null }] },
      include: {
        demandes_paiement: true,
        bons_commande: true,
        documents: true,
        agents_receptions_recu_par_idToagents: { include: { users: true } },
        agents_receptions_visa_directeur_idToagents: { include: { users: true } },
        agents_receptions_visa_daf_idToagents: { include: { users: true } },
      },
      orderBy: { created_at: "desc" },
    })) ||
    (await prisma.receptions.findFirst({
      include: {
        demandes_paiement: true,
        bons_commande: true,
        documents: true,
        agents_receptions_recu_par_idToagents: { include: { users: true } },
        agents_receptions_visa_directeur_idToagents: { include: { users: true } },
        agents_receptions_visa_daf_idToagents: { include: { users: true } },
      },
      orderBy: { created_at: "desc" },
    }));

  if (!reception) throw new Error("Aucune réception trouvée en base.");

  // Choisit un agent pour simuler les visas
  const fallbackAgent = await prisma.agents.findFirst({
    include: { users: true },
    orderBy: { id: "asc" },
  });

  const agentForVisa =
    reception.agents_receptions_recu_par_idToagents ||
    reception.agents_receptions_visa_directeur_idToagents ||
    reception.agents_receptions_visa_daf_idToagents ||
    fallbackAgent;

  if (!agentForVisa) throw new Error("Aucun agent trouvé (impossible de simuler les visas).");

  // Simulation EN MÉMOIRE (zéro update DB)
  const now = new Date();
  const rSim = {
    ...reception,
    visa_directeur_id: agentForVisa.id,
    visa_daf_id: agentForVisa.id,
    agents_receptions_visa_directeur_idToagents: agentForVisa,
    agents_receptions_visa_daf_idToagents: agentForVisa,
    updated_at: now,
  };

  const outPath = path.join(outDir, `reception_SIM_FINAL_${rSim.uuid}.pdf`);
  const res = new FakeRes();
  const out = fs.createWriteStream(outPath);
  res.pipe(out);

  await pdfService.streamReceptionPdfFromData(res, rSim, { forceFinal: true, forcedFinalizedAt: now });
  await once(out, "finish");

  console.log(`OK PDF simulé (QR visible si secret OK): ${outPath}`);
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
