const prisma = require("../config/prisma");
const { v4: uuidv4 } = require("uuid");

const VALID_ROLES = ["ADMIN", "DEMANDEUR", "RESPONSABLE", "DIRECTEUR", "DAF", "DGA", "DG", "COMPTABLE"];

function assertRoleName(role) {
  const r = String(role || "").toUpperCase();
  if (!VALID_ROLES.includes(r)) {
    throw new Error(`role_name invalide. Valeurs: ${VALID_ROLES.join(", ")}`);
  }
  return r;
}

exports.createFlow = async ({ code, label, is_active = true }) => {
  if (!code || !label) throw new Error("code et label sont requis");

  return prisma.validation_flows.create({
    data: {
      uuid: uuidv4(),
      code: String(code).trim(),
      label: String(label).trim(),
      is_active: !!is_active,
    },
  });
};

exports.listFlows = async () => {
  return prisma.validation_flows.findMany({
    orderBy: { id: "desc" },
    include: { validation_flow_steps: { orderBy: { step_order: "asc" } } },
  });
};

exports.getFlowById = async (id) => {
  const flow = await prisma.validation_flows.findUnique({
    where: { id: Number(id) },
    include: { validation_flow_steps: { orderBy: { step_order: "asc" } } },
  });
  if (!flow) throw new Error("Flow introuvable");
  return flow;
};

exports.updateFlow = async (id, { label, is_active }) => {
  const exists = await prisma.validation_flows.findUnique({ where: { id: Number(id) } });
  if (!exists) throw new Error("Flow introuvable");

  return prisma.validation_flows.update({
    where: { id: Number(id) },
    data: {
      ...(label !== undefined ? { label: String(label).trim() } : {}),
      ...(is_active !== undefined ? { is_active: !!is_active } : {}),
    },
  });
};

exports.disableFlow = async (id) => {
  const exists = await prisma.validation_flows.findUnique({ where: { id: Number(id) } });
  if (!exists) throw new Error("Flow introuvable");

  return prisma.validation_flows.update({
    where: { id: Number(id) },
    data: { is_active: false },
  });
};

exports.addStep = async (flowId, { step_order, role_name, required = true }) => {
  if (step_order === undefined || role_name === undefined) throw new Error("step_order et role_name requis");
  const role = assertRoleName(role_name);

  const taken = await prisma.validation_flow_steps.findFirst({
    where: { flow_id: Number(flowId), step_order: Number(step_order) },
  });
  if (taken) throw new Error("step_order déjà utilisé pour ce flow");

  return prisma.validation_flow_steps.create({
    data: {
      uuid: uuidv4(),
      flow_id: Number(flowId),
      step_order: Number(step_order),
      role_name: role,
      required: !!required,
    },
  });
};

exports.updateStep = async (flowId, stepId, { step_order, role_name, required }) => {
  const step = await prisma.validation_flow_steps.findFirst({
    where: { id: Number(stepId), flow_id: Number(flowId) },
  });
  if (!step) throw new Error("Step introuvable");

  const data = {};

  if (role_name !== undefined) data.role_name = assertRoleName(role_name);

  if (step_order !== undefined && Number(step_order) !== step.step_order) {
    const taken = await prisma.validation_flow_steps.findFirst({
      where: { flow_id: Number(flowId), step_order: Number(step_order) },
    });
    if (taken) throw new Error("step_order déjà utilisé pour ce flow");
    data.step_order = Number(step_order);
  }

  if (required !== undefined) data.required = !!required;

  return prisma.validation_flow_steps.update({
    where: { id: Number(stepId) },
    data,
  });
};

exports.deleteStep = async (flowId, stepId) => {
  const step = await prisma.validation_flow_steps.findFirst({
    where: { id: Number(stepId), flow_id: Number(flowId) },
  });
  if (!step) throw new Error("Step introuvable");

  await prisma.validation_flow_steps.delete({ where: { id: Number(stepId) } });
  return { deleted: true };
};

exports.reorderSteps = async (flowId, { items }) => {
  if (!Array.isArray(items) || items.length === 0) throw new Error("items requis");

  const orders = items.map((i) => Number(i.step_order));
  const uniqueOrders = new Set(orders);
  if (uniqueOrders.size !== orders.length) throw new Error("step_order dupliqués dans items");

  return prisma.$transaction(async (tx) => {
    const ids = items.map((i) => Number(i.id));
    const found = await tx.validation_flow_steps.findMany({
      where: { id: { in: ids }, flow_id: Number(flowId) },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new Error("Certains steps n'appartiennent pas à ce flow");

    for (const it of items) {
      await tx.validation_flow_steps.update({
        where: { id: Number(it.id) },
        data: { step_order: Number(it.step_order) },
      });
    }

    return tx.validation_flow_steps.findMany({
      where: { flow_id: Number(flowId) },
      orderBy: { step_order: "asc" },
    });
  });
};
