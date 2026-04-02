// Smoke test for payment conditions (70/30, 50/50, 100/100)
// - Creates a temporary demande + conditions
// - Calls the paiement service to validate business rules
// - Cleans up created records at the end

// Disable email sending in this script (mailer will skip if not configured)
process.env.MAIL_HOST = "";
process.env.SMTP_HOST = "";
process.env.EMAIL_HOST = "";
process.env.NODEMAILER_USER = "";
process.env.NODEMAILER_PASSWORD = "";

const prisma = require("../config/prisma");
const { randomUUID: uuidv4 } = require("crypto");
const paiementsService = require("../services/paiements.services");

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function buildTranches(total, mode) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) throw new Error("invalid total");

  if (mode === "100/100") {
    return [{ pourcentage: 100, montant_prevu: round2(t), condition_texte: "100/100" }];
  }
  if (mode === "70/30") {
    const first = round2((t * 70) / 100);
    return [
      { pourcentage: 70, montant_prevu: first, condition_texte: "70/30" },
      { pourcentage: 30, montant_prevu: round2(t - first), condition_texte: "70/30" },
    ];
  }
  if (mode === "50/50") {
    const first = round2((t * 50) / 100);
    return [
      { pourcentage: 50, montant_prevu: first, condition_texte: "50/50" },
      { pourcentage: 50, montant_prevu: round2(t - first), condition_texte: "50/50" },
    ];
  }
  throw new Error(`unknown mode: ${mode}`);
}

async function findActorAgents() {
  const comptable = await prisma.agents.findFirst({
    where: { deleted_at: null, roles: { is: { name: "COMPTABLE" } } },
    select: { id: true },
  });
  const admin = await prisma.agents.findFirst({
    where: { deleted_at: null, roles: { is: { name: "ADMIN" } } },
    select: { id: true },
  });
  const demandeur = await prisma.agents.findFirst({
    where: { deleted_at: null },
    select: { id: true },
  });

  return {
    comptableId: comptable?.id || admin?.id || demandeur?.id,
    demandeurId: demandeur?.id,
  };
}

async function createDemandeWithConditions({ mode, montant, demandeurId }) {
  const demande = await prisma.demandes_paiement.create({
    data: {
      uuid: uuidv4(),
      motif: `SMOKE_COND_${mode}`,
      description: "smoke test",
      montant: round2(montant),
      devise: "XOF",
      beneficiaire: "SMOKE_TEST",
      fournisseur_id: null,
      remarque: null,
      demandeur_id: Number(demandeurId),
      statut: "approuvee",
      budget_prevu: null,
      budget_disponible: null,
      paiement_immediat: false,
      ajournee: false,
      ajournee_le: null,
      ajournee_par_id: null,
      prochaine_revue_le: null,
      validation_flow_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    },
    select: { id: true, uuid: true, montant: true },
  });

  const tranches = buildTranches(demande.montant, mode);
  await prisma.conditions_paiement.createMany({
    data: tranches.map((t, i) => ({
      uuid: uuidv4(),
      demande_id: Number(demande.id),
      label: `Tranche ${i + 1}`,
      pourcentage: t.pourcentage,
      montant_prevu: t.montant_prevu,
      date_echeance: null,
      condition_texte: t.condition_texte,
      statut: "prevu",
      paiement_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    })),
  });

  return demande;
}

async function cleanupDemande(demandeId) {
  const paiements = await prisma.paiements.findMany({
    where: { demande_id: Number(demandeId) },
    select: { id: true },
  });

  // delete docs linked to payments
  if (paiements.length) {
    await prisma.documents.deleteMany({ where: { paiement_id: { in: paiements.map((p) => p.id) } } });
  }

  await prisma.conditions_paiement.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.paiements.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.receptions.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.bons_commande.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.demande_items.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.notifications.deleteMany({ where: { demande_id: Number(demandeId) } });
  await prisma.demandes_paiement.delete({ where: { id: Number(demandeId) } });
}

async function test70_30({ comptableId, demandeurId }) {
  const demande = await createDemandeWithConditions({ mode: "70/30", montant: 1000, demandeurId });
  try {
    // should reject paying the small tranche first
    let failed = false;
    try {
      await paiementsService.createPaiement(
        {
          demande_id: demande.id,
          type_paiement: "partiel",
          montant: 300,
          date_paiement: new Date().toISOString(),
          moyen_paiement: "virement",
          reference_piece: "SMOKE",
          compte_debite: "SMOKE",
          commentaire: "smoke",
          documents: [],
        },
        comptableId,
      );
    } catch {
      failed = true;
    }
    assert(failed, "70/30: paying 30% first must fail");

    const p1 = await paiementsService.createPaiement(
      {
        demande_id: demande.id,
        type_paiement: "partiel",
        montant: 700,
        date_paiement: new Date().toISOString(),
        moyen_paiement: "virement",
        reference_piece: "SMOKE",
        compte_debite: "SMOKE",
        commentaire: "smoke",
        documents: [],
      },
      comptableId,
    );
    assert(!!p1?.id, "70/30: tranche 1 payment must succeed");

    const after1 = await prisma.demandes_paiement.findUnique({ where: { id: demande.id }, select: { statut: true } });
    assert(String(after1?.statut).toLowerCase() === "en_attente_paiement", "70/30: status must be en_attente_paiement after first tranche");

    const p2 = await paiementsService.createPaiement(
      {
        demande_id: demande.id,
        type_paiement: "partiel",
        montant: 300,
        date_paiement: new Date().toISOString(),
        moyen_paiement: "virement",
        reference_piece: "SMOKE",
        compte_debite: "SMOKE",
        commentaire: "smoke",
        documents: [],
      },
      comptableId,
    );
    assert(!!p2?.id, "70/30: tranche 2 payment must succeed");

    const after2 = await prisma.demandes_paiement.findUnique({ where: { id: demande.id }, select: { statut: true } });
    assert(String(after2?.statut).toLowerCase() === "paye", "70/30: status must be paye after second tranche");
  } finally {
    await cleanupDemande(demande.id);
  }
}

async function test50_50({ comptableId, demandeurId }) {
  const demande = await createDemandeWithConditions({ mode: "50/50", montant: 1000, demandeurId });
  try {
    const p1 = await paiementsService.createPaiement(
      {
        demande_id: demande.id,
        type_paiement: "partiel",
        montant: 500,
        date_paiement: new Date().toISOString(),
        moyen_paiement: "virement",
        reference_piece: "SMOKE",
        compte_debite: "SMOKE",
        commentaire: "smoke",
        documents: [],
      },
      comptableId,
    );
    assert(!!p1?.id, "50/50: tranche 1 payment must succeed");

    const p2 = await paiementsService.createPaiement(
      {
        demande_id: demande.id,
        type_paiement: "partiel",
        montant: 500,
        date_paiement: new Date().toISOString(),
        moyen_paiement: "virement",
        reference_piece: "SMOKE",
        compte_debite: "SMOKE",
        commentaire: "smoke",
        documents: [],
      },
      comptableId,
    );
    assert(!!p2?.id, "50/50: tranche 2 payment must succeed");

    const after2 = await prisma.demandes_paiement.findUnique({ where: { id: demande.id }, select: { statut: true } });
    assert(String(after2?.statut).toLowerCase() === "paye", "50/50: status must be paye after second tranche");
  } finally {
    await cleanupDemande(demande.id);
  }
}

async function test100_100({ comptableId, demandeurId }) {
  const demande = await createDemandeWithConditions({ mode: "100/100", montant: 1000, demandeurId });
  try {
    // partiel forbidden
    let failed = false;
    try {
      await paiementsService.createPaiement(
        {
          demande_id: demande.id,
          type_paiement: "partiel",
          montant: 1000,
          date_paiement: new Date().toISOString(),
          moyen_paiement: "virement",
          reference_piece: "SMOKE",
          compte_debite: "SMOKE",
          commentaire: "smoke",
          documents: [],
        },
        comptableId,
      );
    } catch {
      failed = true;
    }
    assert(failed, "100/100: partiel must fail");

    const p = await paiementsService.createPaiement(
      {
        demande_id: demande.id,
        type_paiement: "total",
        montant: 1000,
        date_paiement: new Date().toISOString(),
        moyen_paiement: "virement",
        reference_piece: "SMOKE",
        compte_debite: "SMOKE",
        commentaire: "smoke",
        documents: [],
      },
      comptableId,
    );
    assert(!!p?.id, "100/100: total must succeed");

    const after = await prisma.demandes_paiement.findUnique({ where: { id: demande.id }, select: { statut: true } });
    assert(String(after?.statut).toLowerCase() === "paye", "100/100: status must be paye after payment");
  } finally {
    await cleanupDemande(demande.id);
  }
}

async function main() {
  const { comptableId, demandeurId } = await findActorAgents();
  assert(comptableId, "No comptable/admin agent found to act as paiement creator");
  assert(demandeurId, "No agent found to act as demandeur");

  // eslint-disable-next-line no-console
  console.log("[conditions-paiement-check] Using comptableId=", comptableId, "demandeurId=", demandeurId);

  await test70_30({ comptableId, demandeurId });
  // eslint-disable-next-line no-console
  console.log("[conditions-paiement-check] 70/30 OK");

  await test50_50({ comptableId, demandeurId });
  // eslint-disable-next-line no-console
  console.log("[conditions-paiement-check] 50/50 OK");

  await test100_100({ comptableId, demandeurId });
  // eslint-disable-next-line no-console
  console.log("[conditions-paiement-check] 100/100 OK");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error("[conditions-paiement-check] FAILED:", e?.message || e);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});

