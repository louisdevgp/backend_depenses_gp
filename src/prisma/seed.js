const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");
const prisma = new PrismaClient();

async function main() {
  const roles = [
    { name: "ADMIN", label: "Administrateur" },
    { name: "DEMANDEUR", label: "Demandeur" },
    { name: "RESPONSABLE", label: "Responsable" },
    { name: "DIRECTEUR", label: "Directeur" },
    { name: "DAF", label: "Direction Administrative et Financière" },
    { name: "DGA", label: "Directeur Général Adjoint" },
    { name: "DG", label: "Directeur Général" },
    { name: "COMPTABLE", label: "Comptable / Caisse" },
  ];

  for (const r of roles) {
    await prisma.roles.upsert({
      where: { name: r.name },
      update: { label: r.label, is_active: true, deleted_at: null },
      create: {
        uuid: uuidv4(),
        name: r.name,
        label: r.label,
        description: null,
        is_active: true,
        deleted_at: null,
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });