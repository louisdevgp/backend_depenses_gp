const service = require("../services/validationFlows.services");

exports.createFlow = async (req, res) => {
  try {
    const data = await service.createFlow(req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.listFlows = async (req, res) => {
  try {
    const data = await service.listFlows();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getFlowById = async (req, res) => {
  try {
    const data = await service.getFlowById(Number(req.params.id));
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(404).json({ success: false, message: e.message });
  }
};

exports.updateFlow = async (req, res) => {
  try {
    const data = await service.updateFlow(Number(req.params.id), req.body);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.disableFlow = async (req, res) => {
  try {
    const data = await service.disableFlow(Number(req.params.id));
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

// steps
exports.addStep = async (req, res) => {
  try {
    const data = await service.addStep(Number(req.params.id), req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.updateStep = async (req, res) => {
  try {
    const data = await service.updateStep(
      Number(req.params.id),
      Number(req.params.stepId),
      req.body
    );
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.deleteStep = async (req, res) => {
  try {
    const data = await service.deleteStep(Number(req.params.id), Number(req.params.stepId));
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

exports.reorderSteps = async (req, res) => {
  try {
    const data = await service.reorderSteps(Number(req.params.id), req.body);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
