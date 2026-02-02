const { PrismaClient } = require("@prisma/client");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const yes = hasFlag("--yes");
  const dryRun = hasFlag("--dry-run");
  const keepDelegations = hasFlag("--keep-delegations");
  const keepPasswordResetTokens = hasFlag("--keep-password-reset-tokens");

  if (!yes && !dryRun) {
    console.error(
      "Refusé: ce script supprime les données transactionnelles. Relance avec --yes pour confirmer, ou --dry-run pour prévisualiser.\n" +
        "Options: --dry-run, --keep-delegations, --keep-password-reset-tokens",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    if (dryRun) {
      const counts = await prisma.$transaction(async (tx) => {
        const out = {};

        out.audit_logs = await tx.audit_logs.count();
        out.notifications = await tx.notifications.count();
        out.password_reset_tokens = keepPasswordResetTokens ? 0 : await tx.password_reset_tokens.count();

        out.documents = await tx.documents.count();
        out.validation_steps = await tx.validation_steps.count();

        out.conditions_paiement = await tx.conditions_paiement.count();
        out.paiements = await tx.paiements.count();

        out.receptions = await tx.receptions.count();

        out.bon_commande_items = await tx.bon_commande_items.count();
        out.bons_commande = await tx.bons_commande.count();

        out.demande_items = await tx.demande_items.count();
        out.demandes_paiement = await tx.demandes_paiement.count();

        out.delegations = keepDelegations ? 0 : await tx.delegations.count();

        return out;
      });

      console.log("DRY RUN (aucune suppression). Compteurs des données transactionnelles:");
      console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("\n"));
      console.log(
        "Conservé: users, agents, roles, user_roles, validation_flows, validation_flow_steps, directions/departements/services, etc.",
      );
      return;
    }

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
      "Conservé: users, agents, roles, validation_flows, validation_flow_steps, directions/departements/services, etc.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
