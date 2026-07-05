// Screener (GEM Score™) endpoints — single, alerting, and batch.
import { Router } from "express";
import { screenToken, screenAndAlert, batchScreen, isValidMint } from "../screener/screen.js";
import { requireAdmin } from "../middleware/guard.js";
import { solscanKey, telegram } from "../context.js";

const router = Router();

router.get("/screen", async (req, res) => {
  const addr = String(req.query.token_address || "");
  if (!isValidMint(addr)) return res.status(400).json({ error: "Invalid Solana mint address (base58, 32–44 chars)." });
  try {
    res.json(await screenToken(addr, { solscanKey: solscanKey(), nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.post("/screen-and-alert", requireAdmin, async (req, res) => {
  const addr = String(req.body?.token_address || req.query.token_address || "");
  if (!isValidMint(addr)) return res.status(400).json({ error: "Invalid Solana mint address." });
  try {
    res.json(await screenAndAlert(addr, { solscanKey: solscanKey(), nowMs: Date.now(), telegram: telegram() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.post("/batch-screen", requireAdmin, async (req, res) => {
  const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
  if (addresses.length === 0) return res.status(400).json({ error: "Provide a non-empty 'addresses' array." });
  try {
    res.json({ results: await batchScreen(addresses.slice(0, 20), { solscanKey: solscanKey(), nowMs: Date.now() }) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

export default router;
