const { PrismaClient } = require("@prisma/client");
const { v4: uuidv4 } = require("uuid");
const { hashPassword } = require("../utils/password");

function getArgValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function upsertUserWithRole({ prisma, email, password, nom, prenom, roleName, forcePassword, pruneGlobalValidators }) {
  const role = await prisma.roles.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`ROLE_NOT_FOUND:${roleName}`);

  const existing = await prisma.users.findUnique({ where: { email } });
  const password_hash = forcePassword || !existing ? await hashPassword(password) : undefined;

  const now = new Date();
  const user = await prisma.users.upsert({
    where: { email },
    update: {
      nom,
      prenom,
      is_active: true,
      deleted_at: null,
      ...(password_hash ? { password_hash } : null),
      // évite le mode "mustChangePassword" au login
      last_login_at: existing?.last_login_at ?? now,
    },
    create: {
      uuid: uuidv4(),
      email,
      password_hash,
      nom,
      prenom,
      is_active: true,
      last_login_at: now,
    },
  });

  await prisma.user_roles.createMany({
    data: [{ user_id: user.id, role_id: role.id }],
    skipDuplicates: true,
  });

  const agent = await prisma.agents.findFirst({
    where: { user_id: user.id, deleted_at: null },
    select: { id: true },
  });

  if (!agent) {
    await prisma.agents.create({
      data: {
        uuid: uuidv4(),
        user_id: user.id,
        nom: nom || roleName,
        prenom: prenom || "Test",
        matricule: null,
        role_id: role.id,
        direction_id: null,
        departement_id: null,
        service_id: null,
        manager_id: null,
      },
    });
  } else {
    await prisma.agents.updateMany({
      where: { user_id: user.id, deleted_at: null },
      data: { role_id: role.id },
    });
  }

  // Optional: prune duplicate agents for global validator roles so resolver picks the seeded profile.
  if (pruneGlobalValidators && ["DG", "DGA", "DAF"].includes(String(roleName || "").toUpperCase())) {
    await prisma.agents.updateMany({
      where: {
        role_id: role.id,
        deleted_at: null,
        user_id: { not: user.id },
      },
      data: { deleted_at: new Date() },
    });
  }

  return user;
}

async function main() {
  const prisma = new PrismaClient();

  const password =
    getArgValue("--password") ||
    process.env.SEED_PASSWORD ||
    "Test@1234";

  const forcePassword = hasFlag("--force-password");
  const pruneGlobalValidators = hasFlag("--prune-global-validators");

  const profiles = [
    { roleName: "ADMIN", email: "admin@gp.local", nom: "Admin", prenom: "GP" },
    { roleName: "DEMANDEUR", email: "demandeur@gp.local", nom: "Demandeur", prenom: "GP" },
    { roleName: "ASSISTANTE_TECHNIQUE", email: "assistante.tech@gp.local", nom: "Assistante", prenom: "Technique" },
    { roleName: "RESPONSABLE", email: "responsable@gp.local", nom: "Responsable", prenom: "GP" },
    { roleName: "DIRECTEUR", email: "directeur@gp.local", nom: "Directeur", prenom: "GP" },
    { roleName: "DAF", email: "daf@gp.local", nom: "DAF", prenom: "GP" },
    { roleName: "DGA", email: "dga@gp.local", nom: "DGA", prenom: "GP" },
    { roleName: "DG", email: "dg@gp.local", nom: "DG", prenom: "GP" },
    { roleName: "COMPTABLE", email: "comptable@gp.local", nom: "Comptable", prenom: "GP" },
  ];

  try {
    const results = [];
    for (const p of profiles) {
      const user = await upsertUserWithRole({
        prisma,
        email: p.email,
        password,
        nom: p.nom,
        prenom: p.prenom,
        roleName: p.roleName,
        forcePassword,
        pruneGlobalValidators,
      });
      results.push({ role: p.roleName, email: user.email, userId: user.id });
    }

    console.log("Seed profils OK:");
    for (const r of results) {
      console.log(`- ${r.role}: ${r.email} (userId=${r.userId})`);
    }
    console.log(`Mot de passe: ${password === "Test@1234" ? "Test@1234" : "(custom)"}`);
    if (!forcePassword) {
      console.log("Note: utilise --force-password pour réécrire les mots de passe existants.");
    }
    if (pruneGlobalValidators) {
      console.log("Note: --prune-global-validators actif (DG/DGA/DAF: suppression soft des doublons d'agents). ");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
