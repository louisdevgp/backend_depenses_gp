const { resolveFrontendBaseUrl } = require("../utils/frontendUrl");

const APP_NAME = "E-Depenses";
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

function demandeRef(meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const raw =
    m.numero ??
    m.demandeNumero ??
    m.demandeUuid ??
    m.demande_uuid ??
    m.demandeId ??
    m.demande_id ??
    m.demande ??
    null;
  if (raw == null || String(raw).trim() === "") return null;
  return `#${String(raw).trim()}`;
}

function titleForType(type, meta) {
  const t = String(type || "notification").toLowerCase();
  const ref = demandeRef(meta);
  const withDemande = (prefix) => (ref ? `${prefix} ${ref}` : prefix);

  switch (t) {
    case "achat_effectue":
    case "demande_acheteur_assigne":
    case "demande_acheteur_retire":
      return withDemande("ACHAT");

    case "demande_updated":
    case "demande_returned_for_modification":
      return withDemande("MODIFICATION ACHAT");

    case "demande_created":
    case "demande_deleted":
    case "demande_cancelled":
    case "demande_closed":
      return withDemande("DEMANDE ACHAT");

    case "validation_pending":
    case "validation_step_approved":
    case "validation_rejected":
    case "validation_cancelled":
      return withDemande("VALIDATION ACHAT");

    case "paiement_pending":
    case "paiement_effectue":
    case "paiement_updated":
    case "paiement_deleted":
      return withDemande("PAIEMENT ACHAT");

    case "reception_creee":
    case "reception_updated":
    case "reception_deleted":
    case "reception_reminder":
    case "reception_visa_pending":
    case "reception_visa_directeur":
    case "reception_visa_daf":
      return withDemande("RECEPTION ACHAT");

    case "delegation_created":
    case "delegation_updated":
    case "delegation_toggled":
    case "delegation_deleted":
      return "DELEGATION";

    default:
      return String(type || "NOTIFICATION").toUpperCase();
  }
}

function inferCta(type, meta) {
  const front = resolveFrontendBaseUrl();
  const m = meta && typeof meta === "object" ? meta : {};

  if (m.paiementUuid) {
    return { label: "Ouvrir le paiement", url: joinUrl(front, `/paiements/${m.paiementUuid}`) };
  }

  if (m.receptionUuid) {
    return { label: "Ouvrir la reception", url: joinUrl(front, `/receptions/${m.receptionUuid}`) };
  }

  if (m.validationUuid) {
    return { label: "Ouvrir la validation", url: joinUrl(front, `/validations/uuid/${m.validationUuid}`) };
  }

  if (m.demandeUuid) {
    return { label: "Ouvrir la demande", url: joinUrl(front, `/demandes/${m.demandeUuid}`) };
  }

  const t = String(type || "").toLowerCase();
  if (t === "validation_pending") {
    return { label: "Voir les validations", url: joinUrl(front, "/validations/pending") };
  }
  if (t.startsWith("delegation_")) {
    return { label: "Ouvrir les delegations", url: joinUrl(front, "/delegations") };
  }
  if (t.startsWith("reception_")) {
    return { label: "Voir les receptions", url: joinUrl(front, "/receptions") };
  }
  if (t.startsWith("paiement_")) {
    return { label: "Voir les paiements", url: joinUrl(front, "/paiements/pending") };
  }
  if (t.includes("achat")) {
    return { label: "Voir les achats", url: joinUrl(front, "/achats/pending") };
  }

  return { label: "Ouvrir l'application", url: joinUrl(front, "/") };
}

function pickHighlights(type, meta) {
  const t = String(type || "");
  const m = meta && typeof meta === "object" ? meta : {};
  const items = [];

  const ref = demandeRef(m);
  if (ref) items.push({ label: "Demande", value: ref });
  if (m.numero) items.push({ label: "Numero", value: String(m.numero) });

  if (m.role) items.push({ label: "Role", value: String(m.role) });
  if (m.level != null) items.push({ label: "Niveau", value: String(m.level) });
  if (m.currentRole) items.push({ label: "Etape actuelle", value: String(m.currentRole) });
  if (m.currentLevel != null) items.push({ label: "Niveau actuel", value: String(m.currentLevel) });

  if (t.startsWith("delegation_")) {
    if (m.role_name) items.push({ label: "Role delegue", value: String(m.role_name) });
    if (m.period) items.push({ label: "Periode", value: String(m.period) });
    if (typeof m.is_active === "boolean") items.push({ label: "Active", value: m.is_active ? "Oui" : "Non" });
    if (m.actor) items.push({ label: "Action par", value: String(m.actor) });
  }

  if (t === "demande_returned_for_modification") {
    if (m.fromRole) items.push({ label: "Role validateur", value: String(m.fromRole) });
    if (m.previousRole) items.push({ label: "Etape precedente", value: String(m.previousRole) });
    if (m.previousLevel != null) items.push({ label: "Niveau precedent", value: String(m.previousLevel) });
    if (m.commentaire) items.push({ label: "Motif", value: String(m.commentaire) });
  }

  return items.slice(0, 7);
}

function buildNotificationEmail({ type, message, meta }) {
  const safeMessage = message ? String(message) : "";
  const safeMeta = meta && typeof meta === "object" ? meta : null;

  const title = titleForType(type, safeMeta);
  const subject = title;
  const { label: ctaLabel, url: ctaUrl } = inferCta(type, safeMeta);
  const highlights = pickHighlights(type, safeMeta);

  const textLines = [title, "", safeMessage];
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
            <td style="padding:6px 0; color:${BRAND_TEXT}; font-weight:700;">${escapeHtml(h.value)}</td>
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
            <div style="font-size:20px; font-weight:800; margin-top:4px;"><strong>${escapeHtml(subject)}</strong></div>
          </div>

          <div style="padding:18px;">
            <div style="font-size:16px; font-weight:800; margin-bottom:10px;"><strong>${escapeHtml(subject)}</strong></div>
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
          - ${escapeHtml(APP_NAME)}
        </div>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

module.exports = { buildNotificationEmail };
