const express = require("express");
const router = express.Router();

const agentsController = require("../controllers/agents.controllers");
const requireAuth = require("../middlewares/auth.middleware");
const requireRole = require("../middlewares/requireRole.middleware");
// const { requireRole } = require("../middlewares/requireRole"); // optionnel

router.use(requireAuth);
router.use(requireRole(["ADMIN"]));

// CRUD
router.post("/", agentsController.createAgent);
router.get("/", agentsController.listAgents);
router.get("/:id", agentsController.getAgentById);
router.put("/:id", agentsController.updateAgent);
router.delete("/:id", agentsController.softDeleteAgent);

// Manager / organigramme (historique)
router.post("/:id/manager", agentsController.setAgentManager); // set current manager (+ history line)

module.exports = router;
