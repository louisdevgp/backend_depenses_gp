const { PrismaClient } = require("@prisma/client");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const yes = hasFlag("--yes");
  const keepDelegations = hasFlag("--keep-delegations");
  const keepPasswordResetTokens = hasFlag("--keep-password-reset-tokens");

  if (!yes) {
    console.error(
      "Refusé: ce script supprime les données transactionnelles. Relance avec --yes pour confirmer.\n" +
        "Options: --keep-delegations, --keep-password-reset-tokens",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // Ordre important pour respecter les FKs (enfants -> parents)
    const results = await prisma.$transaction(async (tx) => {
      const out = {};

      out.audit_logs = await tx.audit_logs.deleteMany({});
      out.notifications = await tx.notifications.deleteMany({});
      if (!keepPasswordResetTokens) out.password_reset_tokens = await tx.password_reset_tokens.deleteMany({});

      out.documents = await tx.documents.deleteMany({});
      out.validation_steps = await tx.validation_steps.deleteMany({});

      out.conditions_paiement = await tx.conditions_paiement.deleteMany({});
      out.paiements = await tx.paiements.deleteMany({});

      out.receptions = await tx.receptions.deleteMany({});

      out.bon_commande_items = await tx.bon_commande_items.deleteMany({});
      out.bons_commande = await tx.bons_commande.deleteMany({});

      out.demande_items = await tx.demande_items.deleteMany({});
      out.demandes_paiement = await tx.demandes_paiement.deleteMany({});

      if (!keepDelegations) out.delegations = await tx.delegations.deleteMany({});

      return out;
    });

    const lines = Object.entries(results).map(([k, v]) => `${k}: ${v.count}`);
    console.log("Reset OK (données transactionnelles supprimées):");
    console.log(lines.join("\n"));
    console.log(
      "Conservé: users, agents, roles, validation_flows, validation_flow_steps, directions/departements/services, fournisseurs, etc.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
