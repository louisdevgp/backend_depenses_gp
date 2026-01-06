const prisma = require("../config/prisma")
const { hashPassword, comparePassword } = require("../utils/password");
const { signAccessToken, signRefreshToken } = require("./token.services");
const { v4: uuidv4 } = require("uuid");

// Option simple: tokens reset en mémoire DB -> à ajouter si tu veux table password_resets.
// Là je fais “simple”: on génère token et tu verras comment le stocker après.
function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function register({ email, password, nom, prenom, agent }) {
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) throw new Error("EMAIL_ALREADY_USED");

  const password_hash = await hashPassword(password);

  // Transaction: user + agent (optionnel) + rôle DEMANDEUR par défaut (optionnel)
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: { uuid: uuidv4(), email, password_hash, nom, prenom },
    });

    if (agent) {
      await tx.agents.create({
        data: {
          uuid: uuidv4(),
          user_id: user.id,
          nom: agent.nom,
          prenom: agent.prenom,
          matricule: agent.matricule || null,
          direction_id: agent.direction_id || null,
          departement_id: agent.departement_id || null,
          service_id: agent.service_id || null,
        },
      });
    }

    return user;
  });

  const accessToken = signAccessToken({ userId: created.id, email: created.email });
  const refreshToken = signRefreshToken({ userId: created.id });

  return { user: created, accessToken, refreshToken };
}

async function login({ email, password }) {
  const user = await prisma.users.findUnique({
    where: { email },
    include: {
      user_roles: { include: { roles: true } },
      agents: true,
    },
  });

  if (!user || user.deleted_at) throw new Error("INVALID_CREDENTIALS");
  if (!user.is_active) throw new Error("USER_DISABLED");

  const ok = await comparePassword(password, user.password_hash);
  if (!ok) throw new Error("INVALID_CREDENTIALS");

  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  const refreshToken = signRefreshToken({ userId: user.id });

  return {
    user: {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      roles: user.user_roles.map((ur) => ur.roles.name),
      agent: user.agents?.[0] || null,
    },
    accessToken,
    refreshToken,
  };
}

async function forgotPassword({ email }) {
  const user = await prisma.users.findUnique({ where: { email } });
  // Toujours répondre OK (anti user-enum)
  if (!user) return { sent: true };

  const token = generateResetToken();
  // 👉 Recommandation: créer une table password_reset_tokens et stocker hash(token) + expires_at
  // Pour l’instant on te renvoie token (en dev) pour tester.
  return { sent: true, token };
}

async function resetPassword({ token, newPassword }) {
  // Avec table reset_tokens: vérifier token + expiration + user_id.
  // Ici on met “placeholder”.
  throw new Error("RESET_TOKEN_NOT_IMPLEMENTED");
}

module.exports = { register, login, forgotPassword, resetPassword };
