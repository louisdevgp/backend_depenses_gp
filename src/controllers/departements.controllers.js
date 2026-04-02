const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function whereIdOrUuid(idOrUuid) {
  const n = Number(idOrUuid);
  return Number.isFinite(n) ? { id: n } : { uuid: idOrUuid };
}

async function resolveDirectionId(directionIdOrUuid) {
  const dir = await prisma.directions.findFirst({
    where: { ...whereIdOrUuid(directionIdOrUuid), deleted_at: null },
  });
  return dir?.id || null;
}

exports.list = async (req, res) => {
  const { directionIdOrUuid } = req.query;

  let direction_id = undefined;
  if (directionIdOrUuid) {
    const resolved = await resolveDirectionId(directionIdOrUuid);
    if (!resolved) return res.status(400).json({ success: false, message: "Invalid directionIdOrUuid" });
    direction_id = resolved;
  }

  const rows = await prisma.departements.findMany({
    where: { deleted_at: null, ...(direction_id ? { direction_id } : {}) },
    orderBy: { id: "desc" },
    include: { directions: true },
  });
  res.json({ success: true, data: rows });
};

exports.getOne = async (req, res) => {
  const row = await prisma.departements.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
    include: { directions: true },
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.create = async (req, res) => {
  const { nom, code, directionIdOrUuid } = req.body;
  if (!nom || !directionIdOrUuid) {
    return res.status(400).json({ success: false, message: "nom, directionIdOrUuid required" });
  }
  
  const uuid = require("crypto").randomUUID();

  const direction_id = await resolveDirectionId(directionIdOrUuid);
  console.table({"Data": { directionIdOrUuid, direction_id , nom, code }});
  
  if (!direction_id) return res.status(400).json({ success: false, message: "Direction not found" });

  const row = await prisma.departements.create({
    data: { uuid, nom, code: code || null, direction_id },
  });

  res.status(201).json({ success: true, data: row });
};

exports.update = async (req, res) => {
  const { nom, code, directionIdOrUuid } = req.body;

  const existing = await prisma.departements.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  let direction_id = undefined;
  if (directionIdOrUuid) {
    const resolved = await resolveDirectionId(directionIdOrUuid);
    if (!resolved) return res.status(400).json({ success: false, message: "Direction not found" });
    direction_id = resolved;
  }

  const row = await prisma.departements.update({
    where: { id: existing.id },
    data: {
      nom: nom ?? existing.nom,
      code: code ?? existing.code,
      ...(direction_id ? { direction_id } : {}),
      updated_at: new Date(),
    },
  });

  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  const existing = await prisma.departements.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  await prisma.departements.update({
    where: { id: existing.id },
    data: { deleted_at: new Date() },
  });

  res.json({ success: true, message: "Deleted" });
};

