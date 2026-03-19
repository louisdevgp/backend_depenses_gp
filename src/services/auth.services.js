const prisma = require("../config/prisma")
const crypto = require("crypto");
const { hashPassword, comparePassword } = require("../utils/password");
const { signAccessToken, signRefreshToken } = require("./token.services");
const { v4: uuidv4 } = require("uuid");
const { sendMail, getTransporter } = require("../config/mailer");
const { resolveFrontendBaseUrl } = require("../utils/frontendUrl");

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
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
  const emailValue = String(email || "").trim();
  let user = await prisma.users.findFirst({
    where: { email: emailValue },
    include: {
      user_roles: { include: { roles: true } },
      agents: true,
    },
  });

  if (!user && emailValue) {
    try {
      const rows = await prisma.$queryRaw`SELECT id FROM users WHERE LOWER(email) = LOWER(${emailValue}) LIMIT 1`;
      const rowId = Array.isArray(rows) && rows[0]?.id ? Number(rows[0].id) : null;
      if (rowId) {
        user = await prisma.users.findUnique({
          where: { id: rowId },
          include: {
            user_roles: { include: { roles: true } },
            agents: true,
          },
        });
      }
    } catch {
      // ignore fallback query errors
    }
  }

  if (!user || user.deleted_at) throw new Error("INVALID_CREDENTIALS");
  if (!user.is_active) throw new Error("USER_DISABLED");

  let ok = await comparePassword(password, user.password_hash);
  if (!ok) {
    const storedHash = String(user.password_hash || "");
    const looksBcrypt = storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$");
    if (!looksBcrypt && storedHash && storedHash === String(password || "")) {
      const newHash = await hashPassword(password);
      try {
        await prisma.users.update({
          where: { id: user.id },
          data: { password_hash: newHash },
        });
      } catch {
        // ignore update error
      }
      ok = true;
    }
  }
  if (!ok) throw new Error("INVALID_CREDENTIALS");

  const isFirstLogin = user.last_login_at == null;

  // audit: track last login timestamp
  try {
    await prisma.users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });
  } catch {
    // ignore audit update errors
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    mustChangePassword: isFirstLogin,
  });
  const refreshToken = signRefreshToken({
    userId: user.id,
    mustChangePassword: isFirstLogin,
  });

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
    mustChangePassword: isFirstLogin,
  };
}

async function changePassword(userId, { oldPassword, newPassword }) {
  const user = await prisma.users.findUnique({
    where: { id: Number(userId) },
    include: {
      user_roles: { include: { roles: true } },
      agents: true,
    },
  });

  if (!user || user.deleted_at) throw new Error("USER_NOT_FOUND");
  if (!user.is_active) throw new Error("USER_DISABLED");

  const ok = await comparePassword(String(oldPassword || ""), user.password_hash);
  if (!ok) throw new Error("INVALID_OLD_PASSWORD");

  const password_hash = await hashPassword(newPassword);

  await prisma.users.update({
    where: { id: user.id },
    data: { password_hash },
  });

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    mustChangePassword: false,
  });
  const refreshToken = signRefreshToken({
    userId: user.id,
    mustChangePassword: false,
  });

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
    mustChangePassword: false,
  };
}

async function forgotPassword({ email }) {
  const user = await prisma.users.findUnique({ where: { email } });
  // Toujours répondre OK (anti user-enum)
  if (!user) return { sent: true };

  const token = generateResetToken();
  const token_hash = hashToken(token);
  const expires_at = new Date(Date.now() + 60 * 60 * 1000); // 1h

  // Create token row (and invalidate previous unused tokens)
  await prisma.$transaction(async (tx) => {
    await tx.password_reset_tokens.updateMany({
      where: { user_id: user.id, used_at: null },
      data: { used_at: new Date() },
    });

    await tx.password_reset_tokens.create({
      data: {
        uuid: uuidv4(),
        user_id: user.id,
        token_hash,
        expires_at,
      },
    });
  });

  const resetUrl = `${resolveFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  // Non-blocking email send
  sendMail({
    to: user.email,
    subject: "Réinitialisation de mot de passe",
    text: `Pour réinitialiser votre mot de passe, ouvrez ce lien : ${resetUrl}`,
    html: `
      <p>Bonjour,</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
      <p><a href="${resetUrl}">Cliquer ici pour réinitialiser</a></p>
      <p>Ce lien expire dans 1 heure.</p>
    `,
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn("[auth] forgot-password email failed:", String(e?.message || e));
  });

  // Dev convenience: if mailer not configured, return token
  if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") {
    const t = getTransporter();
    if (!t) return { sent: true, token };
  }

  return { sent: true };
}

async function resetPassword({ token, newPassword }) {
  const token_hash = hashToken(token);
  const now = new Date();

  const prt = await prisma.password_reset_tokens.findFirst({
    where: {
      token_hash,
      used_at: null,
      expires_at: { gt: now },
    },
    include: { users: true },
  });

  if (!prt || !prt.users || prt.users.deleted_at) {
    throw new Error("INVALID_RESET_TOKEN");
  }

  const password_hash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.password_reset_tokens.update({
      where: { id: prt.id },
      data: { used_at: now },
    });

    await tx.users.update({
      where: { id: prt.user_id },
      data: {
        password_hash,
        // If the user never logged in, we don't want first-login to force another password change.
        last_login_at: prt.users.last_login_at ?? now,
      },
    });
  });

  return { reset: true };
}

module.exports = { register, login, forgotPassword, resetPassword, changePassword };
