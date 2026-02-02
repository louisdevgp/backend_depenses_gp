const nodemailer = require("nodemailer");

let transporter;
let warnedMissingConfig = false;

function getEnvAny(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function getEnvBool(keys, defaultValue = false) {
  const v = getEnvAny(keys);
  if (v === undefined) return defaultValue;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

function getEnvInt(keys, defaultValue) {
  const v = getEnvAny(keys);
  if (v === undefined) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function getTransporter() {
  if (transporter !== undefined) return transporter;

  const host = getEnvAny(["MAIL_HOST", "SMTP_HOST", "EMAIL_HOST"]);
  const port = getEnvInt(["MAIL_PORT", "SMTP_PORT", "EMAIL_PORT"], 587);
  const secure = getEnvBool(["MAIL_SECURE", "SMTP_SECURE", "EMAIL_SECURE"], false);
  const user = getEnvAny(["MAIL_USER", "SMTP_USER", "EMAIL_USER", "NODEMAILER_USER"]);
  const pass = getEnvAny(["MAIL_PASS", "SMTP_PASS", "EMAIL_PASS", "NODEMAILER_PASSWORD"]);

  // Mailer not configured => do not crash the API; emails will be skipped.
  if (!host || !user || !pass) {
    transporter = null;
    return transporter;
  }

  const isOffice365 = String(host).toLowerCase().includes("office365.com");

  // Exchange Online (recommended defaults)
  const requireTLS = getEnvBool(["MAIL_REQUIRE_TLS", "SMTP_REQUIRE_TLS"], isOffice365);
  const pool = getEnvBool(["MAIL_POOL", "SMTP_POOL"], isOffice365);
  const maxConnections = getEnvInt(["MAIL_MAX_CONNECTIONS", "SMTP_MAX_CONNECTIONS"], pool ? 5 : undefined);
  const maxMessages = getEnvInt(["MAIL_MAX_MESSAGES", "SMTP_MAX_MESSAGES"], pool ? 100 : undefined);
  const connectionTimeout = getEnvInt(["MAIL_CONNECTION_TIMEOUT", "SMTP_CONNECTION_TIMEOUT"], 30_000);
  const greetingTimeout = getEnvInt(["MAIL_GREETING_TIMEOUT", "SMTP_GREETING_TIMEOUT"], 30_000);
  const socketTimeout = getEnvInt(["MAIL_SOCKET_TIMEOUT", "SMTP_SOCKET_TIMEOUT"], 60_000);

  const debugEnabled = getEnvBool(["MAIL_DEBUG", "SMTP_DEBUG", "SMTP_DEBUG_ENABLED"], false);

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
    ...(pool ? { pool } : {}),
    ...(Number.isFinite(maxConnections) ? { maxConnections } : {}),
    ...(Number.isFinite(maxMessages) ? { maxMessages } : {}),
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    tls: {
      ...(isOffice365 ? { minVersion: "TLSv1.2" } : {}),
      rejectUnauthorized: getEnvBool(["MAIL_TLS_REJECT_UNAUTHORIZED", "SMTP_TLS_REJECT_UNAUTHORIZED"], true),
      ...(isOffice365 ? { servername: "smtp.office365.com" } : {}),
    },
    ...(debugEnabled ? { logger: true, debug: true } : {}),
  });

  return transporter;
}

async function sendMail({ to, subject, text, html, cc, bcc, attachments }) {
  const fromName = getEnvAny(["MAIL_FROM_NAME", "SMTP_FROM_NAME", "EMAIL_FROM_NAME"]) || "GP Achats";
  const fromEmail =
    getEnvAny(["MAIL_FROM_EMAIL", "SMTP_FROM_EMAIL", "EMAIL_FROM_EMAIL"]) ||
    getEnvAny(["MAIL_USER", "SMTP_USER", "EMAIL_USER", "NODEMAILER_USER"]);

  // Allow explicitly disabling email sending in dev/test environments.
  // Example: set `MAIL_DISABLED=true` to avoid long SMTP connection timeouts.
  if (getEnvBool(["MAIL_DISABLED", "SMTP_DISABLED", "EMAIL_DISABLED"], false)) {
    return { skipped: true, reason: "Mailer disabled by env (MAIL_DISABLED/SMTP_DISABLED/EMAIL_DISABLED)" };
  }

  if (!to) throw new Error("sendMail: to is required");

  const t = getTransporter();
  if (!t) {
    const reason =
      "Mailer not configured (set MAIL_HOST/MAIL_USER/MAIL_PASS, or SMTP_HOST/SMTP_USER/SMTP_PASS, or NODEMAILER_USER/NODEMAILER_PASSWORD)";
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      // eslint-disable-next-line no-console
      console.warn("[mailer]", reason);
    }
    return { skipped: true, reason };
  }

  if (!fromEmail) throw new Error("sendMail: fromEmail is missing (set MAIL_FROM_EMAIL or MAIL_USER)");

  return t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject,
    text,
    html,
    ...(attachments?.length ? { attachments } : {}),
  });
}

module.exports = { transporter: getTransporter(), getTransporter, sendMail };
