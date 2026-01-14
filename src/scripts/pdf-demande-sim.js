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

function upsertStep(steps, roleName, agentForStep, date) {
  const roleUpper = String(roleName).toUpperCase();
  let step = steps.find((s) => String(s.role_name || "").toUpperCase() === roleUpper);
  if (!step) {
    step = {
      id: `sim-${roleUpper}`,
      level: steps.length + 1,
      role_name: roleName,
      status: "valide",
      validated_by_id: agentForStep.id,
      validated_at: date,
      agents_validation_steps_validated_by_idToagents: agentForStep,
    };
    steps.push(step);
    return;
  }
  step.status = "valide";
  step.validated_by_id = agentForStep.id;
  step.validated_at = date;
  step.agents_validation_steps_validated_by_idToagents = agentForStep;
}

async function main() {
  // Garantit qu'on peut calculer une signature HMAC pour afficher un QR
  if (!process.env.SIGNATURE_SECRET && !process.env.JWT_ACCESS_SECRET && !process.env.JWT_SECRET) {
    process.env.SIGNATURE_SECRET = "dev-local-secret";
    console.log("WARN: aucun secret trouvé (SIGNATURE_SECRET/JWT_*). Utilisation d'un secret de dev local.");
  }

  const outDir = path.resolve(process.cwd(), "tmp", "pdf-sim");
  await ensureDir(outDir);

  // Charge la dernière demande (même include que le service)
  const demande = await prisma.demandes_paiement.findFirst({
    where: { deleted_at: null },
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
    orderBy: { created_at: "desc" },
  });

  if (!demande) throw new Error("Aucune demande trouvée en base.");

  const fallbackAgent = await prisma.agents.findFirst({
    include: { users: true },
    orderBy: { id: "asc" },
  });
  const agentForSteps =
    demande.agents_demandes_paiement_demandeur_idToagents ||
    demande.validation_steps?.find((s) => s?.agents_validation_steps_validated_by_idToagents)?.
      agents_validation_steps_validated_by_idToagents ||
    fallbackAgent;

  if (!agentForSteps) throw new Error("Aucun agent trouvé (impossible de simuler les validations).");

  const now = new Date();
  const dSim = clonePlain(demande);

  // On force une situation finalisée en mémoire, sans write DB
  dSim.statut = "approuvee";
  dSim.validation_steps = Array.isArray(dSim.validation_steps) ? dSim.validation_steps : [];
  upsertStep(dSim.validation_steps, "DG", agentForSteps, now);
  upsertStep(dSim.validation_steps, "DGA", agentForSteps, now);
  upsertStep(dSim.validation_steps, "DAF", agentForSteps, now);

  const outPath = path.join(outDir, `demande_SIM_FINAL_${dSim.uuid}.pdf`);
  const res = new FakeRes();
  const out = fs.createWriteStream(outPath);
  res.pipe(out);

  await pdfService.streamDemandePdfFromData(res, dSim, { forceFinal: true, forcedFinalizedAt: now });
  await once(out, "finish");
  console.log(`OK PDF demande simulée (QR visible si secret OK): ${outPath}`);
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
