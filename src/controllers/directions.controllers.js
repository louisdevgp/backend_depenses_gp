const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function whereIdOrUuid(idOrUuid) {
  const n = Number(idOrUuid);
  return Number.isFinite(n) ? { id: n } : { uuid: idOrUuid };
}

exports.list = async (req, res) => {
  const rows = await prisma.directions.findMany({
    where: { deleted_at: null },
    orderBy: { id: "desc" },
  });
  res.json({ success: true, data: rows });
};

exports.getOne = async (req, res) => {
  const row = await prisma.directions.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.create = async (req, res) => {
  const {nom, code } = req.body;
  if (!nom) return res.status(400).json({ success: false, message: "nom required" });
    const uuid = require("uuid").v4();

  const row = await prisma.directions.create({
    data: { uuid, nom, code: code || null },
  });

  res.status(201).json({ success: true, data: row });
};

exports.update = async (req, res) => {
  const { nom, code } = req.body;

  // find
  const existing = await prisma.directions.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const row = await prisma.directions.update({
    where: { id: existing.id },
    data: { nom: nom ?? existing.nom, code: code ?? existing.code, updated_at: new Date() },
  });

  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  const existing = await prisma.directions.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  await prisma.directions.update({
    where: { id: existing.id },
    data: { deleted_at: new Date() },
  });

  res.json({ success: true, message: "Deleted" });
};
