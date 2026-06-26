const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");
const { sendMail } = require("../config/mailer");

const OTP_EXPIRY_MINUTES = 10;
const OTP_WEEKLY_DAYS = 7;

function generateCode() {
  // 6 chiffres cryptographiquement aléatoires
  return String(crypto.randomInt(100000, 999999));
}

async function needsOtp(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { otp_last_verified_at: true },
  });
  if (!user || !user.otp_last_verified_at) return true;
  const msElapsed = Date.now() - new Date(user.otp_last_verified_at).getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
  return daysElapsed >= OTP_WEEKLY_DAYS;
}

async function generateOtp(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, nom: true, prenom: true },
  });
  if (!user) throw new Error("Utilisateur introuvable");

  // Invalider tous les OTP non utilisés de cet utilisateur
  await prisma.otp_tokens.updateMany({
    where: { user_id: userId, used_at: null },
    data: { used_at: new Date() },
  });

  const code = generateCode();
  const code_hash = await bcrypt.hash(code, 10);
  const expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.otp_tokens.create({
    data: {
      uuid: crypto.randomUUID(),
      user_id: userId,
      code_hash,
      expires_at,
    },
  });

  const prenom = user.prenom || "";
  const nom = user.nom || "";

  await sendMail({
    to: user.email,
    subject: "Code de vérification GreenPay",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
        <h2 style="color:#16a34a;">GreenPay — Vérification hebdomadaire</h2>
        <p>Bonjour ${prenom} ${nom},</p>
        <p>Une vérification de sécurité est requise pour accéder aux signatures.</p>
        <p>Votre code de vérification :</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#16a34a;">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:13px;">Ce code est valable <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.<br>Si vous n'avez pas demandé ce code, ignorez cet email.</p>
      </div>
    `,
    text: `Votre code de vérification GreenPay : ${code} (valable ${OTP_EXPIRY_MINUTES} minutes)`,
  });

  return { sent: true };
}

async function verifyOtp(userId, code) {
  const token = await prisma.otp_tokens.findFirst({
    where: {
      user_id: userId,
      used_at: null,
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: "desc" },
  });

  if (!token) {
    return { success: false, reason: "Code invalide ou expiré" };
  }

  const match = await bcrypt.compare(code, token.code_hash);
  if (!match) {
    return { success: false, reason: "Code incorrect" };
  }

  await prisma.$transaction([
    prisma.otp_tokens.update({
      where: { id: token.id },
      data: { used_at: new Date() },
    }),
    prisma.users.update({
      where: { id: userId },
      data: { otp_last_verified_at: new Date() },
    }),
  ]);

  return { success: true };
}

module.exports = { needsOtp, generateOtp, verifyOtp };
