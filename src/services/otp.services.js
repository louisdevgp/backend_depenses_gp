const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../config/prisma");
const { sendMail } = require("../config/mailer");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_WEEKLY_DAYS = Number(process.env.OTP_WEEKLY_DAYS || 7);
const OTP_MIN_RESEND_SECONDS = Number(process.env.OTP_MIN_RESEND_SECONDS || 30);

function envBool(name, defaultValue = true) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isWeeklyOtpEnabled() {
  return envBool("OTP_WEEKLY_ENABLED", true);
}

function withStatusCode(error, statusCode) {
  error.statusCode = Number(statusCode);
  return error;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateCode() {
  // 6 chiffres cryptographiquement aleatoires.
  return String(crypto.randomInt(100000, 999999));
}

async function needsOtp(userId) {
  if (!isWeeklyOtpEnabled()) return false;

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { otp_last_verified_at: true },
  });
  if (!user || !user.otp_last_verified_at) return true;

  const msElapsed = Date.now() - new Date(user.otp_last_verified_at).getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
  return daysElapsed >= OTP_WEEKLY_DAYS;
}

async function invalidateOtpToken(id) {
  await prisma.otp_tokens
    .update({
      where: { id },
      data: { used_at: new Date() },
    })
    .catch(() => null);
}

async function generateOtp(userId) {
  if (!isWeeklyOtpEnabled()) return { sent: false, disabled: true };

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, nom: true, prenom: true },
  });
  if (!user) throw withStatusCode(new Error("Utilisateur introuvable"), 404);
  if (!user.email) throw withStatusCode(new Error("Aucune adresse email n'est rattachee a cet utilisateur."), 400);

  const cooldownDate = new Date(Date.now() - OTP_MIN_RESEND_SECONDS * 1000);
  const recentToken = await prisma.otp_tokens.findFirst({
    where: {
      user_id: userId,
      used_at: null,
      created_at: { gt: cooldownDate },
    },
    orderBy: { created_at: "desc" },
  });

  if (recentToken) {
    return { sent: true, throttled: true };
  }

  // Invalider tous les OTP non utilises de cet utilisateur.
  await prisma.otp_tokens.updateMany({
    where: { user_id: userId, used_at: null },
    data: { used_at: new Date() },
  });

  const code = generateCode();
  const code_hash = await bcrypt.hash(code, 10);
  const expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const otpToken = await prisma.otp_tokens.create({
    data: {
      uuid: crypto.randomUUID(),
      user_id: userId,
      code_hash,
      expires_at,
    },
  });

  const prenom = escapeHtml(user.prenom || "");
  const nom = escapeHtml(user.nom || "");

  let mailResult;
  try {
    mailResult = await sendMail({
      to: user.email,
      subject: "Code de verification GreenPay",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
          <h2 style="color:#16a34a;">GreenPay - Verification hebdomadaire</h2>
          <p>Bonjour ${prenom} ${nom},</p>
          <p>Une verification de securite est requise pour acceder aux signatures.</p>
          <p>Votre code de verification :</p>
          <div style="text-align:center;margin:24px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#16a34a;">${code}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;">Ce code est valable <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.<br>Si vous n'avez pas demande ce code, ignorez cet email.</p>
        </div>
      `,
      text: `Votre code de verification GreenPay : ${code} (valable ${OTP_EXPIRY_MINUTES} minutes)`,
    });
  } catch (error) {
    await invalidateOtpToken(otpToken.id);
    throw withStatusCode(new Error("Impossible d'envoyer le code OTP par email."), 503);
  }

  if (mailResult?.skipped && String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    await invalidateOtpToken(otpToken.id);
    throw withStatusCode(new Error("Impossible d'envoyer le code OTP par email."), 503);
  }

  return {
    sent: true,
    ...(mailResult?.skipped && String(process.env.NODE_ENV || "").toLowerCase() !== "production" ? { code } : {}),
  };
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
    return { success: false, reason: "Code invalide ou expire" };
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

module.exports = { needsOtp, generateOtp, verifyOtp, isWeeklyOtpEnabled };
