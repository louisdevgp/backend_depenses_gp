const prisma = require("../config/prisma");
const notifications = require("../services/notifications.services");

function parseDays() {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const raw = arg ? arg.split("=")[1] : process.env.RECEPTION_REMINDER_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

function isDryRun() {
  if (process.argv.includes("--dry-run")) return true;
  const raw = process.env.RECEPTION_REMINDER_DRY_RUN || process.env.DRY_RUN;
  return String(raw || "").trim() === "1";
}

function daysBetween(from, to) {
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function main() {
  const days = parseDays();
  const dryRun = isDryRun();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const eligibleStatuts = ["approuvee", "en_attente_paiement", "paye", "payee", "achat_effectue"];

  const candidates = await prisma.demandes_paiement.findMany({
    where: {
      deleted_at: null,
      statut: { in: eligibleStatuts },
      receptions: { none: {} },
    },
    select: {
      id: true,
      uuid: true,
      motif: true,
      agents_demandes_paiement_demandeur_idToagents: {
        select: { users: { select: { id: true, email: true } } },
      },
    },
  });

  if (!candidates.length) {
    console.log("[reception-reminder] aucune demande candidate.");
    return;
  }

  const demandeIds = candidates.map((d) => d.id);

  const validations = await prisma.validation_steps.findMany({
    where: {
      demande_id: { in: demandeIds },
      status: "valide",
      validated_at: { not: null },
    },
    select: { demande_id: true, validated_at: true },
  });

  const lastValidationByDemande = new Map();
  for (const v of validations) {
    if (!v?.validated_at) continue;
    const id = Number(v.demande_id);
    const current = lastValidationByDemande.get(id);
    if (!current || v.validated_at > current) {
      lastValidationByDemande.set(id, v.validated_at);
    }
  }

  const toNotify = candidates.filter((d) => {
    const last = lastValidationByDemande.get(Number(d.id));
    return last && last <= cutoff;
  });

  if (!toNotify.length) {
    console.log("[reception-reminder] aucune demande au-delà du seuil.");
    return;
  }

  const alreadyNotified = await prisma.notifications.findMany({
    where: { demande_id: { in: toNotify.map((d) => d.id) }, type: "reception_reminder" },
    select: { demande_id: true },
  });
  const alreadyNotifiedSet = new Set(alreadyNotified.map((n) => Number(n.demande_id)));

  let sent = 0;
  let skipped = 0;

  for (const demande of toNotify) {
    if (alreadyNotifiedSet.has(Number(demande.id))) {
      skipped += 1;
      continue;
    }

    const userId = demande?.agents_demandes_paiement_demandeur_idToagents?.users?.id;
    if (!userId) {
      skipped += 1;
      continue;
    }

    const lastValidatedAt = lastValidationByDemande.get(Number(demande.id));
    if (!lastValidatedAt) {
      skipped += 1;
      continue;
    }

    const daysSince = daysBetween(lastValidatedAt, new Date());
    const message = `Rappel : votre demande${
      demande.uuid ? ` (UUID: ${demande.uuid})` : ""
    } n'a pas encore été réceptionnée ${daysSince} jour(s) après validation.`;

    if (dryRun) {
      console.log("[reception-reminder] dry-run ->", {
        demande_id: demande.id,
        demande_uuid: demande.uuid,
        user_id: userId,
        daysSince,
      });
      sent += 1;
      continue;
    }

    await notifications.createNotification({
      user_id: userId,
      type: "reception_reminder",
      demande_id: demande.id,
      message,
      meta: {
        demandeUuid: demande.uuid || null,
        validatedAt: lastValidatedAt.toISOString(),
        daysSinceValidation: daysSince,
      },
      sendEmailNow: true,
    });

    sent += 1;
  }

  console.log(
    `[reception-reminder] terminé. envoyés=${sent} ignorés=${skipped} (dryRun=${dryRun ? "oui" : "non"})`
  );
}

main()
  .catch((err) => {
    console.error("[reception-reminder] erreur:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
