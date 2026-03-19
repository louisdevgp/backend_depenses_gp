const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/firmaWebhooks.controllers");
const auth = require("../middlewares/auth.middleware");
const requirePermission = require("../middlewares/requirePermission.middleware");
const P = require("../constants/permissions");

// Webhook receiver (no auth, signature verified)
router.post("/firma", ctrl.handleFirmaWebhook);

// Debug: list recent webhook events (auth required)
router.get("/firma/events", auth, requirePermission(P.VALIDATION_APPROVE), ctrl.listRecentFirmaEvents);

module.exports = router;
