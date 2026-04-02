require("dotenv").config();

const { randomUUID: uuidv4 } = require("crypto");
const prisma = require("../config/prisma");
const requireRole = require("../middlewares/requireRole.middleware");

async function pickAgents() {
  const principal = await prisma.agents.findFirst({
    where: { deleted_at: null, roles: { name: "DAF" } },
    include: { roles: true },
    orderBy: { id: "asc" },
  });

  if (!principal) throw new Error("Aucun agent avec rôle DAF trouvé (nécessaire pour le test). ");

  const delegate = await prisma.agents.findFirst({
    where: {
      deleted_at: null,
      NOT: { id: Number(principal.id) },
      // On veut un user qui n'a PAS déjà accès à /paiements (roles autorisés: DAF, COMPTABLE, ADMIN)
      roles: { name: { notIn: ["DAF", "COMPTABLE", "ADMIN"] } },
    },
    include: { roles: true },
    orderBy: { id: "asc" },
  });

  if (!delegate) throw new Error("Aucun agent non-DAF trouvé pour servir de délégataire.");

  return { principal, delegate };
}

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ nextCalled: false, statusCode: this.statusCode, body: this.body, req });
      },
    };

    mw(req, res, () => {
      resolve({ nextCalled: true, statusCode: 200, body: null, req });
    });
  });
}

(async () => {
  const { principal, delegate } = await pickAgents();
  console.log(
    `[delegations-check] principal=${principal.id} (${principal.roles?.name}) -> delegate=${delegate.id} (${delegate.roles?.name})`
  );

  const mw = requireRole(["DAF"]);
  const baseReq = { user: { userId: Number(delegate.user_id) } };

  // 1) Sans délégation: doit être refusé (403)
  const before = await runMiddleware(mw, { ...baseReq });
  console.log(`[delegations-check] before delegation: next=${before.nextCalled} status=${before.statusCode}`);

  // 2) Créer une délégation active donnant le rôle DAF
  const now = new Date();
  const startAt = new Date(now.getTime() - 60 * 1000);
  const endAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Nettoyage préventif: anciennes délégations identiques
  await prisma.delegations.deleteMany({
    where: {
      principal_id: Number(principal.id),
      delegate_id: Number(delegate.id),
      role_name: "DAF",
    },
  });

  const delegation = await prisma.delegations.create({
    data: {
      uuid: uuidv4(),
      principal_id: Number(principal.id),
      delegate_id: Number(delegate.id),
      role_name: "DAF",
      scope: null,
      start_at: startAt,
      end_at: endAt,
      is_active: true,
      created_by_id: Number(principal.id),
    },
  });
  console.log(`[delegations-check] delegation created id=${delegation.id}`);

  // 3) Avec délégation: doit passer (next appelé)
  const after = await runMiddleware(mw, { ...baseReq });
  console.log(`[delegations-check] after delegation: next=${after.nextCalled} status=${after.statusCode}`);

  // 4) Test fin de délégation (end_at passé) => doit redevenir interdit
  await prisma.delegations.update({
    where: { id: Number(delegation.id) },
    data: { end_at: new Date(Date.now() - 1000), is_active: true },
  });
  const expired = await runMiddleware(mw, { ...baseReq });
  console.log(`[delegations-check] after expiry: next=${expired.nextCalled} status=${expired.statusCode}`);

  // Cleanup
  await prisma.delegations.delete({ where: { id: Number(delegation.id) } });
  console.log("[delegations-check] cleanup done");

  // Résumé simple pour CI / lecture
  const ok =
    before.nextCalled === false &&
    before.statusCode === 403 &&
    after.nextCalled === true &&
    expired.nextCalled === false &&
    expired.statusCode === 403;
  if (!ok) process.exitCode = 1;
})().catch((e) => {
  const status = e?.response?.status;
  const data = e?.response?.data;
  console.error(
    "[delegations-check] error:",
    e?.message || e,
    e?.code ? `(code=${e.code})` : "",
    status ? `(status=${status})` : "",
  );
  if (data) console.error("[delegations-check] response:", data);
  process.exitCode = 1;
});

