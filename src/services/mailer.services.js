const { sendMail } = require("../config/mailer");
const { buildNotificationEmail } = require("./notificationEmailTemplate");

const APP_NAME = "E-Dépenses";

function buildDefaultEmail({ subject, message, meta }) {
  const safeMeta = meta ? JSON.stringify(meta, null, 2) : null;

  const text = `${message}${safeMeta ? `\n\nMETA:\n${safeMeta}` : ""}`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.4">
      <h2 style="margin:0 0 8px">${subject}</h2>
      <p style="margin:0 0 12px">${message}</p>
      ${
        safeMeta
          ? `<pre style="background:#f6f6f6;padding:12px;border-radius:8px">${safeMeta}</pre>`
          : ""
      }
      <p style="color:#777;margin-top:16px">— ${APP_NAME}</p>
    </div>
  `;

  return { text, html };
}

async function sendNotificationEmail({ to, cc, type, message, meta }) {
  try {
    const built = buildNotificationEmail({ type, message, meta });
    return sendMail({ to, cc, subject: built.subject, text: built.text, html: built.html });
  } catch {
    const subject = `${APP_NAME} - ${type}`;
    const { text, html } = buildDefaultEmail({ subject, message, meta });
    return sendMail({ to, cc, subject, text, html });
  }
}

module.exports = { sendNotificationEmail };
