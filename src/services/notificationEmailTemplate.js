const { resolveFrontendBaseUrl } = require("../utils/frontendUrl");

const APP_NAME = "E-Dépenses";
const BRAND_PRIMARY = "#16a34a";
const BRAND_DARK = "#166534";
const BRAND_LIGHT = "#ecfdf3";
const BRAND_BG = "#f3f4f6";
const BRAND_TEXT = "#0f172a";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "");
  if (!p) return b;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return `${b}${p.startsWith("/") ? "" : "/"}${p}`;
}

function inferCta(type, meta) {
  const front = resolveFrontendBaseUrl();
  const m = meta && typeof meta === "object" ? meta : {};

  if (m.paiementUuid) {
    return { label: "Ouvrir le paiement", url: joinUrl(front, `/paiements/${m.paiementUuid}`) };
  }

  if (m.receptionUuid) {
    return { label: "Ouvrir la réception", url: joinUrl(front, `/receptions/${m.receptionUuid}`) };
  }

  if (m.validationUuid) {
    return { label: "Ouvrir la validation", url: joinUrl(front, `/validations/uuid/${m.validationUuid}`) };
  }

  if (m.demandeUuid) {
    return { label: "Ouvrir la demande", url: joinUrl(front, `/demandes/${m.demandeUuid}`) };
  }

  if (String(type).toLowerCase() === "validation_pending") {
    return { label: "Voir les validations", url: joinUrl(front, "/validations/pending") };
  }

  if (String(type).toLowerCase().startsWith("delegation_")) {
    return { label: "Ouvrir les délégations", url: joinUrl(front, "/delegations") };
  }

  return { label: "Ouvrir l'application", url: joinUrl(front, "/") };
}

function subjectForType(type, meta) {
  const t = String(type || "notification");
  const m = meta && typeof meta === "object" ? meta : {};
  const prefix = `${APP_NAME} — `;

  switch (t) {
    case "demande_created":
      return `${prefix}Demande soumise`;
    case "demande_updated":
      return `${prefix}Demande mise à jour`;
    case "demande_deleted":
      return `${prefix}Demande supprimée`;
    case "validation_pending":
      return `${prefix}Validation en attente${m.role ? ` (${m.role})` : ""}`;
    case "validation_step_approved":
      return `${prefix}Demande validée${m.role ? ` (${m.role})` : ""}`;
    case "validation_rejected":
      return `${prefix}Demande rejetée${m.role ? ` (${m.role})` : ""}`;
    case "demande_returned_for_modification":
      return `${prefix}Demande retournée pour modification${m.fromRole ? ` (${m.fromRole})` : ""}`;
    case "paiement_effectue":
      return `${prefix}Paiement effectué`;
    case "paiement_pending":
      return `${prefix}Paiement à effectuer`;
    case "paiement_updated":
      return `${prefix}Paiement modifié`;
    case "paiement_deleted":
      return `${prefix}Paiement supprimé`;
    case "achat_effectue":
      return `${prefix}Achat effectue`;
    case "demande_acheteur_assigne":
      return `${prefix}Affectation achat`;
    case "demande_acheteur_retire":
      return `${prefix}Affectation achat retiree`;
    case "reception_creee":
      return `${prefix}Réception créée`;
    case "reception_updated":
      return `${prefix}Réception modifiée`;
    case "reception_deleted":
      return `${prefix}Réception supprimée`;
    case "reception_reminder":
      return `${prefix}Réception en attente`;
    case "reception_visa_pending":
      return `${prefix}Visa DAF requis`;
    case "reception_visa_directeur":
      return `${prefix}Visa Directeur effectué`;
    case "reception_visa_daf":
      return `${prefix}Visa DAF effectué`;
    case "delegation_created":
      return `${prefix}Délégation créée`;
    case "delegation_updated":
      return `${prefix}Délégation modifiée`;
    case "delegation_toggled":
      return `${prefix}Délégation mise à jour`;
    case "delegation_deleted":
      return `${prefix}Délégation supprimée`;
    default:
      return `${prefix}${t}`;
  }
}

function pickHighlights(type, meta) {
  const t = String(type || "");
  const m = meta && typeof meta === "object" ? meta : {};
  const items = [];

  if (m.numero) items.push({ label: "Numéro", value: String(m.numero) });

  if (m.role) items.push({ label: "Rôle", value: String(m.role) });
  if (m.level != null) items.push({ label: "Niveau", value: String(m.level) });
  if (m.currentRole) items.push({ label: "Étape actuelle", value: String(m.currentRole) });
  if (m.currentLevel != null) items.push({ label: "Niveau actuel", value: String(m.currentLevel) });

  if (t.startsWith("delegation_")) {
    if (m.role_name) items.push({ label: "Rôle délégué", value: String(m.role_name) });
    if (m.period) items.push({ label: "Période", value: String(m.period) });
    if (typeof m.is_active === "boolean") items.push({ label: "Active", value: m.is_active ? "Oui" : "Non" });
    if (m.actor) items.push({ label: "Action par", value: String(m.actor) });
  }

  if (t === "demande_returned_for_modification") {
    if (m.fromRole) items.push({ label: "Rôle validateur", value: String(m.fromRole) });
    if (m.previousRole) items.push({ label: "Étape précédente", value: String(m.previousRole) });
    if (m.previousLevel != null) items.push({ label: "Niveau précédent", value: String(m.previousLevel) });
    if (m.commentaire) items.push({ label: "Motif", value: String(m.commentaire) });
  }

  return items.slice(0, 6);
}

function buildNotificationEmail({ type, message, meta }) {
  const safeMessage = message ? String(message) : "";
  const safeMeta = meta && typeof meta === "object" ? meta : null;

  const subject = subjectForType(type, safeMeta);
  const { label: ctaLabel, url: ctaUrl } = inferCta(type, safeMeta);
  const highlights = pickHighlights(type, safeMeta);

  const textLines = [safeMessage];
  if (ctaUrl) {
    textLines.push("", `${ctaLabel} : ${ctaUrl}`);
  }
  const text = textLines.join("\n");

  const highlightsHtml =
    highlights.length > 0
      ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
        ${highlights
          .map(
            (h) => `
          <tr>
            <td style="padding:6px 0; color:#475467; width:180px;">${escapeHtml(h.label)}</td>
            <td style="padding:6px 0; color:${BRAND_TEXT}; font-weight:600;">${escapeHtml(h.value)}</td>
          </tr>`
          )
          .join("")}
      </table>`
      : "";

  const html = `
  <div style="background:${BRAND_BG}; padding:24px 0;">
    <div style="max-width:640px; margin:0 auto; padding:0 16px;">
      <div style="font-family: Arial, sans-serif; color:${BRAND_TEXT};">
        <div style="background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e5e7eb;">
          <div style="background:${BRAND_PRIMARY}; color:#ffffff; padding:16px 18px;">
            <div style="font-size:13px; opacity:0.9; letter-spacing:.2px;">${escapeHtml(APP_NAME)}</div>
            <div style="font-size:20px; font-weight:700; margin-top:4px;">${escapeHtml(subject)}</div>
          </div>

          <div style="padding:18px;">
            <div style="font-size:15px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(safeMessage)}</div>

            ${
              highlights.length > 0
                ? `<div style="margin-top:14px; background:${BRAND_LIGHT}; border:1px solid #d1fae5; border-radius:12px; padding:12px 14px;">
                    ${highlightsHtml}
                   </div>`
                : ""
            }

            <div style="margin-top:20px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block; padding:11px 16px; background:${BRAND_DARK}; color:#fff; text-decoration:none; border-radius:10px; font-size:14px; font-weight:700;">${escapeHtml(
                ctaLabel
              )}</a>
            </div>

            <div style="margin-top:14px; font-size:12px; color:#6b7280;">
              Si le bouton ne fonctionne pas, utilisez ce lien :
              <a href="${escapeHtml(ctaUrl)}" style="color:${BRAND_DARK};">${escapeHtml(ctaUrl)}</a>
            </div>
          </div>
        </div>

        <div style="text-align:center; font-size:12px; color:#9ca3af; margin-top:12px;">
          — ${escapeHtml(APP_NAME)}
        </div>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

module.exports = { buildNotificationEmail };
