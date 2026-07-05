// Health + settings. Keys stay server-side; GET returns status only (never secrets).
import { Router } from "express";
import { publicStatus, applySettings, testTarget } from "../ai/settings.js";
import { requireAdmin } from "../middleware/guard.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, ...publicStatus() });
});

router.get("/settings", (_req, res) => res.json(publicStatus()));

router.post("/settings", requireAdmin, (req, res) => {
  res.json(applySettings(req.body || {}));
});

router.post("/settings/test", requireAdmin, async (req, res) => {
  const target = String(req.body?.target || "");
  res.json(await testTarget(target));
});

export default router;
