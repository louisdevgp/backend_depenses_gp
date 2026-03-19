function getEnvAny(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function isLocalHostname(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  return h === "0.0.0.0" || h === "127.0.0.1" || h === "localhost";
}

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (isLocalHostname(url.hostname)) {
      const alt = getEnvAny([
        "PUBLIC_FRONTEND_URL",
        "PUBLIC_BASE_URL",
        "SERVER_PUBLIC_URL",
        "APP_PUBLIC_URL",
        "APP_URL",
        "PUBLIC_URL",
      ]);
      if (alt && alt !== trimmed) return normalizeBaseUrl(alt);

      const host = getEnvAny(["PUBLIC_HOST", "SERVER_HOST", "APP_HOST", "HOSTNAME", "HOST"]);
      if (host) {
        const hostTrimmed = String(host).trim();
        if (/^https?:\/\//i.test(hostTrimmed)) return normalizeBaseUrl(hostTrimmed);
        if (!isLocalHostname(hostTrimmed)) {
          url.hostname = hostTrimmed;
        }
      }

      const port = getEnvAny(["FRONTEND_PORT", "PUBLIC_PORT", "APP_PORT"]);
      if (port != null && String(port).trim() !== "") {
        url.port = String(port).trim();
      }
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function resolveFrontendBaseUrl() {
  const raw =
    getEnvAny([
      "FRONTEND_URL",
      "APP_FRONTEND_URL",
      "DASHBOARD_URL",
      "WEB_URL",
      "PUBLIC_FRONTEND_URL",
      "PUBLIC_BASE_URL",
      "SERVER_PUBLIC_URL",
      "APP_PUBLIC_URL",
    ]) || "http://localhost:5173";

  return normalizeBaseUrl(raw);
}

module.exports = { resolveFrontendBaseUrl };
