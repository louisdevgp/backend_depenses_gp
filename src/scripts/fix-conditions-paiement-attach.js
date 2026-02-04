require("dotenv").config();
const prisma = require("../config/prisma");

const PAID_STATUSES = ["paye", "payee", "regle", "reglee"];

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function amountsEqual(a, b, tolerance = 0.01) {
  return Math.abs(toNumber(a) - toNumber(b)) <= tolerance;
}

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

async function main() {
  const now = new Date();

  const paidWithoutPayment = await prisma.conditions_paiement.findMany({
    where: { paiement_id: null, statut: { in: PAID_STATUSES } },
    select: { id: true, demande_id: true, montant_prevu: true, statut: true, created_at: true },
    orderBy: { id: "asc" },
  });

  const grouped = new Map();
  for (const cond of paidWithoutPayment) {
    if (!grouped.has(cond.demande_id)) grouped.set(cond.demande_id, []);
    grouped.get(cond.demande_id).push(cond);
  }

  const summary = {
    demandes: grouped.size,
    conditionsTotal: paidWithoutPayment.length,
    assigned: 0,
    assignedByTotal: 0,
    assignedByMatch: 0,
    skippedNoPayment: 0,
    skippedNoMatch: 0,
    ambiguous: 0,
  };

  for (const [demandeId, conds] of grouped.entries()) {
    const payments = await prisma.paiements.findMany({
      where: { demande_id: Number(demandeId) },
      orderBy: [{ date_paiement: "asc" }, { id: "asc" }],
      select: { id: true, montant: true, type_paiement: true, date_paiement: true, created_at: true },
    });

    if (!payments.length) {
      summary.skippedNoPayment += conds.length;
      continue;
    }

    let unassigned = [...conds];
    const updates = [];
    const usedPayments = new Set();

    const sumUnassigned = unassigned.reduce((acc, c) => acc + toNumber(c.montant_prevu), 0);
    if (payments.length === 1 && amountsEqual(sumUnassigned, payments[0].montant)) {
      const p = payments[0];
      for (const c of unassigned) {
        updates.push({ conditionId: c.id, paiementId: p.id });
      }
      summary.assignedByTotal += unassigned.length;
      unassigned = [];
      usedPayments.add(p.id);
    }

    for (const payment of payments) {
      if (!unassigned.length) break;
      if (usedPayments.has(payment.id)) continue;

      const type = normalizeType(payment.type_paiement);
      const remainingTotal = unassigned.reduce((acc, c) => acc + toNumber(c.montant_prevu), 0);

      if (type === "total") {
        if (amountsEqual(remainingTotal, payment.montant)) {
          for (const c of unassigned) {
            updates.push({ conditionId: c.id, paiementId: payment.id });
          }
          summary.assignedByTotal += unassigned.length;
          unassigned = [];
          usedPayments.add(payment.id);
        }
        continue;
      }

      const matches = unassigned.filter((c) => amountsEqual(c.montant_prevu, payment.montant));
      if (matches.length === 1) {
        updates.push({ conditionId: matches[0].id, paiementId: payment.id });
        summary.assignedByMatch += 1;
        unassigned = unassigned.filter((c) => c.id !== matches[0].id);
        usedPayments.add(payment.id);
        continue;
      }

      if (!type && matches.length === 0 && amountsEqual(remainingTotal, payment.montant)) {
        for (const c of unassigned) {
          updates.push({ conditionId: c.id, paiementId: payment.id });
        }
        summary.assignedByTotal += unassigned.length;
        unassigned = [];
        usedPayments.add(payment.id);
        continue;
      }

      if (matches.length > 1) {
        summary.ambiguous += matches.length;
      } else {
        summary.skippedNoMatch += 1;
      }
    }

    if (updates.length) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.conditions_paiement.update({
            where: { id: Number(u.conditionId) },
            data: { paiement_id: Number(u.paiementId), statut: "paye", updated_at: now },
          })
        )
      );
      summary.assigned += updates.length;
    } else if (unassigned.length) {
      summary.skippedNoMatch += unassigned.length;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error("Fix conditions paiement attach failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
