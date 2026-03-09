require("dotenv").config({ path: ".env" });
const prisma = require("../config/prisma");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;

function normalizeValidationStopRole(value) {
  if (!value) return null;
  const v = String(value).trim().toUpperCase();
  if (["DAF", "DGA", "DG"].includes(v)) return v;
  return null;
}

function normalizeRoleName(value) {
  return String(value || "").trim().toUpperCase();
}

function toStageStatus(roleName) {
  return `validation_${String(roleName || "").toLowerCase()}`;
}

function shouldUpdateStatut(currentStatut) {
  const s = String(currentStatut || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "soumise") return true;
  return s.startsWith("validation_");
}

async function recomputeStatutIfNeeded(tx, demandeId, currentStatut) {
  if (!shouldUpdateStatut(currentStatut)) return false;
  const current = await tx.validation_steps.findFirst({
    where: { demande_id: Number(demandeId), status: "en_attente" },
    orderBy: { level: "asc" },
  });
  const nextStatut = current ? toStageStatus(current.role_name) : "approuvee";
  const currentLower = String(currentStatut || "").trim().toLowerCase();
  if (String(nextStatut).toLowerCase() === currentLower) return false;
  await tx.demandes_paiement.update({
    where: { id: Number(demandeId) },
    data: { statut: nextStatut, updated_at: new Date() },
  });
  return true;
}

(async () => {
  const demandes = await prisma.demandes_paiement.findMany({
    where: { deleted_at: null, validation_stop_role: { not: null } },
    include: { validation_steps: true },
    orderBy: { id: "asc" },
    take: LIMIT || undefined,
  });

  const summary = {
    total: demandes.length,
    updated: 0,
    skipped: 0,
    errors: 0,
    deletedSteps: 0,
    statutUpdates: 0,
  };

  for (const d of demandes) {
    const stopRole = normalizeValidationStopRole(d.validation_stop_role);
    if (!stopRole) {
      summary.skipped += 1;
      continue;
    }

    const steps = Array.isArray(d.validation_steps) ? d.validation_steps : [];
    if (!steps.length) {
      summary.skipped += 1;
      continue;
    }

    const stopLevels = steps
      .filter((s) => normalizeRoleName(s?.role_name) === stopRole)
      .map((s) => Number(s?.level))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!stopLevels.length) {
      summary.skipped += 1;
      continue;
    }

    const stopLevel = Math.max(...stopLevels);
    const toDelete = steps.filter((s) => Number(s?.level) > stopLevel);
    if (!toDelete.length) {
      summary.skipped += 1;
      continue;
    }

    const label = `demande ${d.id}${d.uuid ? ` (${d.uuid})` : ""}`;

    if (DRY_RUN) {
      console.log(`[DRY] ${label}: delete ${toDelete.length} steps after level ${stopLevel}`);
      summary.updated += 1;
      summary.deletedSteps += toDelete.length;
      continue;
    }

    try {
      let statutUpdated = false;
      await prisma.$transaction(async (tx) => {
        await tx.validation_steps.deleteMany({
          where: { demande_id: Number(d.id), level: { gt: stopLevel } },
        });
        statutUpdated = await recomputeStatutIfNeeded(tx, d.id, d.statut);
      });

      summary.updated += 1;
      summary.deletedSteps += toDelete.length;
      if (statutUpdated) summary.statutUpdates += 1;
      console.log(`[OK] ${label}: deleted ${toDelete.length} steps after level ${stopLevel}`);
    } catch (e) {
      summary.errors += 1;
      console.error(`[ERR] ${label}: ${e?.message || e}`);
    }
  }

  console.log("");
  console.log(
    `Summary: total=${summary.total} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors} deletedSteps=${summary.deletedSteps} statutUpdates=${summary.statutUpdates}`
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
