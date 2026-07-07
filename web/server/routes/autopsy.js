// "Bedah Coin" (SNIPER ENGINE Modul A) + Smart-wallet watchlist (Modul B).
//   GET /api/autopsy?mint=<mint> — reconstruct who bought a token early, and
//     auto-record its clean smart-wallet candidates into the watchlist IF the
//     token is a real winner (self-learning; D5 = auto from track record).
//   GET /api/watchlist — the ranked smart-wallet watchlist (top = active/monitored).
// Keys stay server-side (getState), like the rest.
import { Router } from "express";
import { runAutopsy } from "../screener/autopsy.js";
import { recordCandidates, getWatchlist } from "../screener/watchlist.js";
import { runSniperSweep, getSignals } from "../screener/sniper.js";
import { getParamDefs, applyParams } from "../screener/sniperParams.js";
import { explainSignal } from "../ai/explainSignal.js";
import { getState } from "../ai/settings.js";
import { scanLimit } from "../middleware/limits.js";
import { requireAdmin } from "../middleware/guard.js";

const router = Router();

// Loose Solana mint check: base58, 32–44 chars. Cheap guard before we hit Birdeye.
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

router.get("/autopsy", scanLimit, async (req, res) => {
  const mint = String(req.query.mint || "").trim();
  if (!MINT_RE.test(mint)) {
    return res.status(400).json({ error: "Parameter 'mint' tidak valid (alamat token Solana, 32–44 karakter base58)." });
  }
  const st = getState();
  if (!st.birdeyeKey) {
    return res.status(400).json({ error: "Birdeye key belum diset — wajib untuk bedah coin. Isi di panel Settings." });
  }
  try {
    const report = await runAutopsy(mint, { birdeyeKey: st.birdeyeKey, heliusKey: st.heliusKey, nowMs: Date.now() });
    if (report.error) return res.status(502).json(report);
    // Self-learning: feed the watchlist. Only real winners credit a "catch"
    // (see watchlist.js). Never let a store hiccup break the autopsy response.
    try {
      report.watchlist = recordCandidates(report, Date.now());
    } catch {
      report.watchlist = { recorded: 0, winner: false, launchToNowX: report.token?.launchToNowX ?? null };
    }
    res.json(report);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.get("/watchlist", (_req, res) => {
  try {
    res.json(getWatchlist());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Live sniper signals (Modul C). Two independent streams:
//   /sniper/signals       → "v2" (sharp: net-buy + dust + safety gate + weighted score)
//   /sniper/awal/signals  → "awal" (original v1 headcount behaviour, fixed loose profile)
// Both read cheaply (no sweep); the sweep runs on the background interval.
router.get("/sniper/signals", (_req, res) => {
  try {
    res.json(getSignals("v2"));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.get("/sniper/awal/signals", (_req, res) => {
  try {
    res.json(getSignals("awal"));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Sniper v2 parameter registry. GET is public (values are heuristic thresholds, not
// secrets — same spirit as getSignals exposing several already). POST is admin-gated
// like /settings: it changes engine behaviour, so gate it behind ADMIN_TOKEN/loopback.
// A saved change takes effect on the NEXT sweep (getParams() is read per-sweep) — no restart.
router.get("/sniper/params", (_req, res) => {
  try {
    res.json(getParamDefs());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.post("/sniper/params", requireAdmin, (req, res) => {
  try {
    res.json(applyParams(req.body || {}));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ...or trigger a sweep on demand. Both variants share the wallet-read cost pattern
// but keep separate stores, so each is swept independently.
function sweepVariant(variant) {
  const st = getState();
  return runSniperSweep({ variant, heliusKey: st.heliusKey, birdeyeKey: st.birdeyeKey, nowMs: Date.now() });
}

// The background interval (index.js) sweeps BOTH streams each cycle. Sequential so a
// 40-wallet dual sweep doesn't burst Helius; awal has no safety-gate calls so it's cheap.
export async function sniperSweepOnce() {
  const v2 = await sweepVariant("v2");
  const awal = await sweepVariant("awal");
  return { v2, awal };
}

router.get("/sniper/sweep", scanLimit, async (_req, res) => {
  try {
    res.json(await sweepVariant("v2"));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.get("/sniper/awal/sweep", scanLimit, async (_req, res) => {
  try {
    res.json(await sweepVariant("awal"));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// AI "Jelaskan sinyal ini": look up the signal by mint (server-side, authoritative)
// and ask Claude to explain why it's a signal + the risks. Rate-limited (it costs).
router.post("/sniper/explain", scanLimit, async (req, res) => {
  const mint = String(req.body?.mint || "").trim();
  if (!MINT_RE.test(mint)) {
    return res.status(400).json({ error: "Parameter 'mint' tidak valid." });
  }
  // Authoritative lookup across both streams (v2 first, then awal).
  const signal = getSignals("v2").signals.find((s) => s.mint === mint)
    || getSignals("awal").signals.find((s) => s.mint === mint);
  if (!signal) {
    return res.status(404).json({ error: "Sinyal tidak ditemukan atau sudah kedaluwarsa. Sweep dulu." });
  }
  const st = getState();
  const out = await explainSignal(signal, {
    aiMode: st.aiMode, aiKey: st.aiKey, model: st.model, claudePath: st.claudePath,
  });
  if (out.error) return res.status(502).json(out);
  res.json(out);
});

export default router;
