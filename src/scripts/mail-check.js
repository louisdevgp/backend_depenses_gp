require("dotenv").config();

const { getTransporter } = require("../config/mailer");
const { sendMail } = require("../config/mailer");

function mask(value) {
  if (!value) return value;
  const s = String(value);
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

async function main() {
  const t = getTransporter();
  if (!t) {
    console.log("MAIL CHECK: transporter=null (mailer non configuré)");
    console.log("Attendu: MAIL_HOST + MAIL_USER + MAIL_PASS");
    process.exit(2);
  }

  console.log("MAIL CHECK: config (sans secrets)");
  console.log({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: String(process.env.MAIL_SECURE || "false"),
    requireTLS: String(process.env.MAIL_REQUIRE_TLS || ""),
    user: mask(process.env.MAIL_USER),
    fromEmail: process.env.MAIL_FROM_EMAIL,
    fromName: process.env.MAIL_FROM_NAME,
  });

  try {
    await t.verify();
    console.log("MAIL CHECK: SMTP OK (verify réussi)");
  } catch (e) {
    console.error("MAIL CHECK: SMTP VERIFY FAILED", {
      message: e?.message,
      code: e?.code,
      response: e?.response,
      responseCode: e?.responseCode,
      command: e?.command,
    });
    process.exit(1);
  }

  const testTo = process.env.MAIL_TEST_TO;
  if (!testTo) {
    console.log("MAIL CHECK: (optionnel) définir MAIL_TEST_TO pour envoyer un email de test.");
    return;
  }

  const front = process.env.FRONTEND_URL || "http://localhost:5173";
  await sendMail({
    to: testTo,
    subject: "GP Achats — Test SMTP",
    text: `Ceci est un email de test. Lien: ${front}`,
    html: `<p>Ceci est un email de test.</p><p><a href="${front}">Ouvrir l'application</a></p>`,
  });
  console.log("MAIL CHECK: email de test envoyé à", testTo);
}

main().catch((e) => {
  console.error("MAIL CHECK: FAILED", e?.message || e);
  process.exit(1);
});
