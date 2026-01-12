function getEnvAny(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function getFrontendBaseUrl() {
  const raw =
    getEnvAny(["FRONTEND_URL", "APP_FRONTEND_URL", "DASHBOARD_URL", "WEB_URL"]) ||
    "http://localhost:5173";
  return String(raw).replace(/\/+$/, "");
}

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
  const front = getFrontendBaseUrl();
  const m = meta && typeof meta === "object" ? meta : {};

  if (m.paiementUuid) {
    return { label: "Ouvrir le paiement", url: joinUrl(front, `/paiements/${m.paiementUuid}`) };
  }

  if (m.receptionUuid) {
    return { label: "Ouvrir la réception", url: joinUrl(front, `/receptions/${m.receptionUuid}`) };
  }

  if (m.bonCommandeUuid) {
    return { label: "Ouvrir le bon de commande", url: joinUrl(front, `/bons-commande/${m.bonCommandeUuid}`) };
  }

  // some older meta keys used by controllers
  if (m.bonCommandeId) {
    return { label: "Ouvrir le bon de commande", url: joinUrl(front, `/bons-commande/${m.bonCommandeId}`) };
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

  switch (t) {
    case "demande_created":
      return "GP Achats — Demande soumise";
    case "demande_updated":
      return "GP Achats — Demande mise à jour";
    case "demande_deleted":
      return "GP Achats — Demande supprimée";
    case "validation_pending":
      return `GP Achats — Validation en attente${m.role ? ` (${m.role})` : ""}`;
    case "validation_step_approved":
      return `GP Achats — Demande validée${m.role ? ` (${m.role})` : ""}`;
    case "validation_rejected":
      return `GP Achats — Demande rejetée${m.role ? ` (${m.role})` : ""}`;
    case "paiement_effectue":
      return "GP Achats — Paiement effectué";
    case "paiement_updated":
      return "GP Achats — Paiement modifié";
    case "paiement_deleted":
      return "GP Achats — Paiement supprimé";
    case "reception_creee":
      return "GP Achats — Réception créée";
    case "reception_updated":
      return "GP Achats — Réception modifiée";
    case "reception_deleted":
      return "GP Achats — Réception supprimée";
    case "reception_visa_pending":
      return "GP Achats — Visa DAF requis";
    case "reception_visa_directeur":
      return "GP Achats — Visa Directeur effectué";
    case "reception_visa_daf":
      return "GP Achats — Visa DAF effectué";
    case "delegation_created":
      return "GP Achats — Délégation créée";
    case "delegation_updated":
      return "GP Achats — Délégation modifiée";
    case "delegation_toggled":
      return "GP Achats — Délégation mise à jour";
    case "delegation_deleted":
      return "GP Achats — Délégation supprimée";
    case "bc_created":
      return `GP Achats — Bon de commande créé${m.numero ? ` (#${m.numero})` : ""}`;
    case "bc_updated":
      return `GP Achats — Bon de commande modifié${m.numero ? ` (#${m.numero})` : ""}`;
    case "bc_cancelled":
      return `GP Achats — Bon de commande annulé${m.numero ? ` (#${m.numero})` : ""}`;
    case "bc_deleted":
      return `GP Achats — Bon de commande supprimé${m.numero ? ` (#${m.numero})` : ""}`;
    default:
      return `GP Achats — ${t}`;
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

  if (t.startsWith("bc_") && m.demandeUuid) {
    items.push({ label: "Demande liée", value: String(m.demandeUuid) });
  }

  return items.slice(0, 6);
}

function buildNotificationEmail({ type, message, meta }) {
  const safeMessage = message ? String(message) : "";
  const safeMeta = meta && typeof meta === "object" ? meta : null;

  const subject = subjectForType(type, safeMeta);
  const { label: ctaLabel, url: ctaUrl } = inferCta(type, safeMeta);
  const highlights = pickHighlights(type, safeMeta);
  const appName = "GP Achats";

  const textLines = [safeMessage];
  if (ctaUrl) {
    textLines.push("", `${ctaLabel} : ${ctaUrl}`);
  }
  const text = textLines.join("\n");

  const highlightsHtml =
    highlights.length > 0
      ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; margin-top:12px;">
        ${highlights
          .map(
            (h) => `
          <tr>
            <td style="padding:6px 0; color:#666; width:180px;">${escapeHtml(h.label)}</td>
            <td style="padding:6px 0; color:#111; font-weight:600;">${escapeHtml(h.value)}</td>
          </tr>`
          )
          .join("")}
      </table>`
      : "";

  const html = `
  <div style="background:#f6f7f9; padding:24px 0;">
    <div style="max-width:640px; margin:0 auto; padding:0 16px;">
      <div style="font-family: Arial, sans-serif; color:#111;">
        <div style="padding:16px 18px; background:#ffffff; border-radius:12px;">
          <div style="font-size:14px; color:#666;">${escapeHtml(appName)}</div>
          <div style="font-size:20px; font-weight:700; margin-top:6px;">${escapeHtml(subject)}</div>
          <div style="margin-top:14px; font-size:15px; line-height:1.5; white-space:pre-wrap;">${escapeHtml(
            safeMessage
          )}</div>
          ${highlightsHtml}

          <div style="margin-top:18px;">
            <a href="${escapeHtml(ctaUrl)}" style="display:inline-block; padding:10px 14px; background:#111; color:#fff; text-decoration:none; border-radius:10px; font-size:14px; font-weight:700;">${escapeHtml(
              ctaLabel
            )}</a>
          </div>

          <div style="margin-top:14px; font-size:12px; color:#666;">
            Si le bouton ne fonctionne pas, utilisez ce lien :
            <a href="${escapeHtml(ctaUrl)}" style="color:#111;">${escapeHtml(ctaUrl)}</a>
          </div>
        </div>

        <div style="text-align:center; font-size:12px; color:#888; margin-top:12px;">
          — ${escapeHtml(appName)}
        </div>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

module.exports = { buildNotificationEmail, getFrontendBaseUrl };
