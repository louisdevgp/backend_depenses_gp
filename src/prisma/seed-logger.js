function timestamp() {
  return new Date().toISOString();
}

function safeDatabaseLabel() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "DATABASE_URL not set";

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "DATABASE_URL set";
  }
}

function log(level, message, details) {
  const suffix = details == null ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
  console.log(`[${timestamp()}] [seed] [${level}] ${message}${suffix}`);
}

function info(message, details) {
  log("INFO", message, details);
}

function warn(message, details) {
  log("WARN", message, details);
}

function success(message, details) {
  log("OK", message, details);
}

function error(message, err) {
  console.error(`[${timestamp()}] [seed] [ERROR] ${message}`);
  if (err?.message) console.error(`[${timestamp()}] [seed] [ERROR] ${err.message}`);
  if (err?.code) console.error(`[${timestamp()}] [seed] [ERROR] code=${err.code}`);
  if (err?.meta) console.error(`[${timestamp()}] [seed] [ERROR] meta=${JSON.stringify(err.meta)}`);
  if (err?.stack) console.error(err.stack);
}

function start(seedName) {
  info(`${seedName} started`, { database: safeDatabaseLabel() });
}

function end(seedName, startedAt) {
  const durationMs = startedAt ? Date.now() - startedAt : undefined;
  success(`${seedName} completed`, durationMs == null ? undefined : { durationMs });
}

module.exports = {
  end,
  error,
  info,
  start,
  success,
  warn,
};
