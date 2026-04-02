const { PrismaClient } = require("@prisma/client");
const { randomUUID: uuidv4 } = require("crypto");
const prisma = new PrismaClient();

async function main() {
  const roles = [
    { name: "ADMIN", label: "Administrateur" },
    { name: "DEMANDEUR", label: "Demandeur" },
    { name: "ASSISTANTE_TECHNIQUE", label: "Assistante technique" },
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

  // Flows utilisés par l'application (selectionnés par rôle du demandeur)
  // ⚠️ Idempotent: on remplace les steps de chaque flow.
  const flows = [
    {
      code: "FLOW_DEMANDEUR_LAMBDA",
      label: "Demandeur lambda : RESPONSABLE > DIRECTEUR > DAF > DGA > DG",
      steps: ["RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG"],
    },
    {
      code: "FLOW_RESPONSABLE",
      label: "Responsable : DIRECTEUR > DAF > DGA > DG",
      steps: ["DIRECTEUR", "DAF", "DGA", "DG"],
    },
    {
      code: "FLOW_ASSISTANTE_TECHNIQUE",
      label: "Assistante technique : DIRECTEUR > DAF > DGA > DG",
      steps: ["DIRECTEUR", "DAF", "DGA", "DG"],
    },
    {
      code: "FLOW_DIRECTEUR",
      label: "Directeur : DAF > DGA > DG",
      steps: ["DAF", "DGA", "DG"],
    },
    {
      code: "FLOW_DAF",
      label: "DAF : DGA > DG",
      steps: ["DGA", "DG"],
    },
    {
      code: "FLOW_DGA",
      label: "DGA : DG",
      steps: ["DG"],
    },
    {
      code: "FLOW_DG",
      label: "DG : DGA",
      steps: ["DGA"],
    },
  ];

  for (const f of flows) {
    const flow = await prisma.validation_flows.upsert({
      where: { code: f.code },
      update: { label: f.label, is_active: true },
      create: {
        uuid: uuidv4(),
        code: f.code,
        label: f.label,
        is_active: true,
      },
    });

    await prisma.validation_flow_steps.deleteMany({ where: { flow_id: flow.id } });
    await prisma.validation_flow_steps.createMany({
      data: f.steps.map((roleName, idx) => ({
        uuid: uuidv4(),
        flow_id: flow.id,
        step_order: idx + 1,
        role_name: roleName,
        required: true,
      })),
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

