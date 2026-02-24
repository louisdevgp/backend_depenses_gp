require("dotenv").config({ path: ".env" });
const prisma = require("../config/prisma");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : null;

function uniqNumber(list) {
  return Array.from(
    new Set(
      (list || [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  );
}

async function main() {
  const agents = await prisma.agents.findMany({
    where: {
      deleted_at: null,
      role_id: { not: null },
    },
    select: { user_id: true, role_id: true },
    take: LIMIT || undefined,
  });

  const pairSet = new Set();
  const pairs = [];
  for (const a of agents) {
    const userId = Number(a.user_id);
    const roleId = Number(a.role_id);
    if (!Number.isFinite(userId) || !Number.isFinite(roleId)) continue;
    const key = `${userId}:${roleId}`;
    if (pairSet.has(key)) continue;
    pairSet.add(key);
    pairs.push({ user_id: userId, role_id: roleId });
  }

  if (!pairs.length) {
    console.log("Nothing to sync (no agent -> primary role pairs).");
    return;
  }

  const userIds = uniqNumber(pairs.map((p) => p.user_id));
  const roleIds = uniqNumber(pairs.map((p) => p.role_id));

  const [users, roles] = await Promise.all([
    prisma.users.findMany({
      where: { id: { in: userIds }, deleted_at: null },
      select: { id: true },
    }),
    prisma.roles.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    }),
  ]);

  const validUserIds = new Set(users.map((u) => Number(u.id)));
  const validRoleIds = new Set(roles.map((r) => Number(r.id)));

  const filteredPairs = pairs.filter(
    (p) => validUserIds.has(Number(p.user_id)) && validRoleIds.has(Number(p.role_id))
  );

  const skippedUsers = pairs.length - pairs.filter((p) => validUserIds.has(Number(p.user_id))).length;
  const skippedRoles = pairs.length - pairs.filter((p) => validRoleIds.has(Number(p.role_id))).length;

  if (DRY_RUN) {
    const existing = await prisma.user_roles.findMany({
      where: {
        user_id: { in: userIds },
        role_id: { in: roleIds },
      },
      select: { user_id: true, role_id: true },
    });
    const existingSet = new Set(existing.map((e) => `${e.user_id}:${e.role_id}`));
    const missing = filteredPairs.filter((p) => !existingSet.has(`${p.user_id}:${p.role_id}`));

    console.log("DRY RUN");
    console.log("Agents scanned:", agents.length);
    console.log("Unique pairs:", pairs.length);
    console.log("Valid pairs:", filteredPairs.length);
    console.log("Missing pairs:", missing.length);
    if (skippedUsers) console.log("Skipped (deleted users):", skippedUsers);
    if (skippedRoles) console.log("Skipped (unknown roles):", skippedRoles);
    if (missing.length) {
      console.log(
        "Sample missing:",
        missing.slice(0, 20).map((m) => `${m.user_id}:${m.role_id}`).join(", ")
      );
    }
    return;
  }

  const res = await prisma.user_roles.createMany({
    data: filteredPairs,
    skipDuplicates: true,
  });

  console.log("Sync done.");
  console.log("Agents scanned:", agents.length);
  console.log("Unique pairs:", pairs.length);
  console.log("Valid pairs:", filteredPairs.length);
  console.log("Inserted (skipDuplicates):", res?.count ?? 0);
  if (skippedUsers) console.log("Skipped (deleted users):", skippedUsers);
  if (skippedRoles) console.log("Skipped (unknown roles):", skippedRoles);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
