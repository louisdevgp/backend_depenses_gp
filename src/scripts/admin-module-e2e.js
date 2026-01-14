// End-to-end smoke test for Admin module (HTTP API)
// - Ensures an existing ADMIN user has a known password
// - Logs in to obtain a Bearer token
// - Exercises CRUD for directions/departements/services/users/agents
// - Exercises admin reset-password on a created user
//
// Usage (PowerShell):
//   $env:BASE_URL = "http://localhost:3101"; node src/scripts/admin-module-e2e.js
//
// Note: This script creates records and then soft-deletes them at the end.

process.env.MAIL_HOST = "";
process.env.SMTP_HOST = "";
process.env.EMAIL_HOST = "";
process.env.NODEMAILER_USER = "";
process.env.NODEMAILER_PASSWORD = "";

const prisma = require("../config/prisma");
const { hashPassword } = require("../utils/password");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pickFirst(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] || null;
  return v;
}

async function ensureAdminHasKnownPassword({ password }) {
  const adminUser = await prisma.users.findFirst({
    where: {
      deleted_at: null,
      is_active: true,
      user_roles: { some: { roles: { is: { name: "ADMIN" } } } },
    },
    select: { id: true, email: true },
  });

  assert(adminUser?.email, "No ADMIN user found (via user_roles) to run e2e test");

  const password_hash = await hashPassword(password);
  await prisma.users.update({
    where: { id: adminUser.id },
    data: {
      password_hash,
      is_active: true,
      deleted_at: null,
      last_login_at: new Date(), // avoid mustChangePassword
    },
  });

  return { email: adminUser.email, userId: adminUser.id };
}

async function main() {
  const baseURL = process.env.BASE_URL || "http://localhost:3101";
  const apiBase = `${baseURL}/api`;

  const adminPassword = process.env.ADMIN_E2E_PASSWORD || "Admin123!";
  const stamp = Date.now();

  const created = {
    direction: null,
    departement: null,
    service: null,
    user: null,
    agent: null,
  };

  try {
    // quick server check
    const healthRes = await fetch(`${baseURL}/health`);
    const health = await healthRes.json().catch(() => null);
    assert(health?.ok === true, "Backend /health not ok");

    const admin = await ensureAdminHasKnownPassword({ password: adminPassword });
    console.log(`[E2E] Using admin: ${admin.email}`);

    let token = null;
    const authHeaders = {};

    async function request(method, path, body) {
      const url = `${apiBase}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || `${res.status} ${res.statusText}`;
        const err = new Error(msg);
        err.response = { status: res.status, data };
        throw err;
      }
      return data;
    }

    const loginRes = await request("POST", "/auth/login", { email: admin.email, password: adminPassword });
    assert(loginRes?.success, `Login failed: ${loginRes?.message || "unknown"}`);
    assert(loginRes?.data?.accessToken, "Login failed: missing accessToken");
    token = loginRes.data.accessToken;
    authHeaders.Authorization = `Bearer ${token}`;

    // 1) Create direction
    const dirRes = await request("POST", "/directions", { nom: `E2E_DIR_${stamp}`, code: `E2E_DIR_${stamp}` });
    assert(dirRes?.success, `Create direction failed: ${dirRes?.message || "unknown"}`);
    created.direction = dirRes.data;

    // 2) Create departement
    const depRes = await request("POST", "/departements", {
      nom: `E2E_DEP_${stamp}`,
      code: `E2E_DEP_${stamp}`,
      directionIdOrUuid: created.direction.uuid || created.direction.id,
    });
    assert(depRes?.success, `Create departement failed: ${depRes?.message || "unknown"}`);
    created.departement = depRes.data;

    // 3) Create service
    const srvRes = await request("POST", "/services", {
      nom: `E2E_SRV_${stamp}`,
      code: `E2E_SRV_${stamp}`,
      departementIdOrUuid: created.departement.uuid || created.departement.id,
    });
    assert(srvRes?.success, `Create service failed: ${srvRes?.message || "unknown"}`);
    created.service = srvRes.data;

    // 4) Create user
    const email = `e2e_admin_${stamp}@example.com`;
    const uRes = await request("POST", "/users", { email, nom: "E2E", prenom: "Admin", is_active: true });
    assert(uRes?.success, `Create user failed: ${uRes?.message || "unknown"}`);
    created.user = uRes.data;
    assert(created.user?.id || created.user?.uuid, "Create user: missing id/uuid");

    // 5) Set roles (exercise userRoles)
    const userIdOrUuid = created.user.uuid || created.user.id;
    const rolesRes = await request("PUT", `/user-roles/users/${userIdOrUuid}/roles`, { roles: ["ADMIN"] });
    assert(rolesRes?.success, `Set user roles failed: ${rolesRes?.message || "unknown"}`);

    // 6) Fetch role_id for agent
    const rRes = await request("GET", "/roles");
    assert(rRes?.success, `List roles failed: ${rRes?.message || "unknown"}`);
    const roles = rRes.data || rRes.items || [];
    const demandeurRole = roles.find((r) => r?.name === "DEMANDEUR") || pickFirst(roles);
    assert(demandeurRole?.id, "Could not resolve DEMANDEUR role id");

    // 7) Create agent for created user
    const aRes = await request("POST", "/agents", {
      user_id: created.user.id,
      nom: "E2E",
      prenom: "Agent",
      matricule: `E2E_${stamp}`,
      direction_id: created.direction.id,
      departement_id: created.departement.id,
      service_id: created.service.id,
      role_id: demandeurRole.id,
    });
    assert(aRes?.success, `Create agent failed: ${aRes?.message || "unknown"}`);
    created.agent = aRes.data;

    // 8) Admin reset password for created user
    const resetRes = await request("POST", `/users/${userIdOrUuid}/reset-password`);
    assert(resetRes?.success, `Reset password failed: ${resetRes?.message || "unknown"}`);
    assert(resetRes?.data?.temporaryPassword, "Reset password: missing temporaryPassword");

    console.log("[E2E] OK: directions/departements/services/users/agents/reset-password");
    console.log(`[E2E] Temporary password for ${email}: ${resetRes.data.temporaryPassword}`);
  } finally {
    // Best-effort cleanup (soft deletes)
    try {
      if (created.agent?.id) {
        await fetch(`${apiBase}/agents/${created.agent.id}`, { method: "DELETE", headers: authHeaders });
      }
    } catch {}
    try {
      if (created.user?.id || created.user?.uuid) {
        const idOrUuid = created.user.uuid || created.user.id;
        await fetch(`${apiBase}/users/${idOrUuid}`, { method: "DELETE", headers: authHeaders });
      }
    } catch {}
    try {
      if (created.service?.id || created.service?.uuid) {
        const idOrUuid = created.service.uuid || created.service.id;
        await fetch(`${apiBase}/services/${idOrUuid}`, { method: "DELETE", headers: authHeaders });
      }
    } catch {}
    try {
      if (created.departement?.id || created.departement?.uuid) {
        const idOrUuid = created.departement.uuid || created.departement.id;
        await fetch(`${apiBase}/departements/${idOrUuid}`, { method: "DELETE", headers: authHeaders });
      }
    } catch {}
    try {
      if (created.direction?.id || created.direction?.uuid) {
        const idOrUuid = created.direction.uuid || created.direction.id;
        await fetch(`${apiBase}/directions/${idOrUuid}`, { method: "DELETE", headers: authHeaders });
      }
    } catch {}
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[E2E] FAILED:", e?.response?.data || e);
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(1);
    }
  });
