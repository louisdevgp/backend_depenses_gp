const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function whereIdOrUuid(idOrUuid) {
  const n = Number(idOrUuid);
  return Number.isFinite(n) ? { id: n } : { uuid: idOrUuid };
}

async function resolveDepartementId(departementIdOrUuid) {
  const dep = await prisma.departements.findFirst({
    where: { ...whereIdOrUuid(departementIdOrUuid), deleted_at: null },
  });
  return dep?.id || null;
}

exports.list = async (req, res) => {
  const { departementIdOrUuid } = req.query;

  let departement_id = undefined;
  if (departementIdOrUuid) {
    const resolved = await resolveDepartementId(departementIdOrUuid);
    if (!resolved) return res.status(400).json({ success: false, message: "Invalid departementIdOrUuid" });
    departement_id = resolved;
  }

  const rows = await prisma.services.findMany({
    where: { deleted_at: null, ...(departement_id ? { departement_id } : {}) },
    orderBy: { id: "desc" },
    include: { departements: { include: { directions: true } } },
  });
  res.json({ success: true, data: rows });
};

exports.getOne = async (req, res) => {
  const row = await prisma.services.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
    include: { departements: { include: { directions: true } } },
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
};

exports.create = async (req, res) => {
  try {
    const agent = await prisma.agents.findFirst({
      where: { user_id: req.user.userId, deleted_at: null },
      select: { id: true },
    });

    if (!agent) {
      return res.status(400).json({ success: false, message: "Agent non trouvé" });
    }

    const reception = await receptionsService.createReception(req.body, agent.id);

    return res.status(201).json({ success: true, data: reception });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message || "Erreur réception" });
  }
};

exports.update = async (req, res) => {
  const { nom, code, departementIdOrUuid } = req.body;

  const existing = await prisma.services.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  let departement_id = undefined;
  if (departementIdOrUuid) {
    const resolved = await resolveDepartementId(departementIdOrUuid);
    if (!resolved) return res.status(400).json({ success: false, message: "Departement not found" });
    departement_id = resolved;
  }

  const row = await prisma.services.update({
    where: { id: existing.id },
    data: {
      nom: nom ?? existing.nom,
      code: code ?? existing.code,
      ...(departement_id ? { departement_id } : {}),
      updated_at: new Date(),
    },
  });

  res.json({ success: true, data: row });
};

exports.remove = async (req, res) => {
  const existing = await prisma.services.findFirst({
    where: { ...whereIdOrUuid(req.params.idOrUuid), deleted_at: null },
  });
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  await prisma.services.update({
    where: { id: existing.id },
    data: { deleted_at: new Date() },
  });

  res.json({ success: true, message: "Deleted" });
};
