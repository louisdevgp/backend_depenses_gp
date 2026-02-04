require("dotenv").config();
const prisma = require("../config/prisma");

const PAID_STATUSES = ["paye", "payee", "regle", "reglee"];

async function main() {
  const now = new Date();

  const resetPaidWithoutPayment = await prisma.conditions_paiement.updateMany({
    where: { paiement_id: null, statut: { in: PAID_STATUSES } },
    data: { statut: "prevu", updated_at: now },
  });

  const alignPaidWithPayment = await prisma.conditions_paiement.updateMany({
    where: { paiement_id: { not: null }, NOT: { statut: "paye" } },
    data: { statut: "paye", updated_at: now },
  });

  console.log(
    JSON.stringify(
      {
        resetPaidWithoutPayment: resetPaidWithoutPayment.count,
        alignPaidWithPayment: alignPaidWithPayment.count,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("Fix conditions paiement failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
