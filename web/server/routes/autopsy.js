// "Bedah Coin" (SNIPER ENGINE Modul A) + Smart-wallet watchlist (Modul B).
//   GET /api/autopsy?mint=<mint> — reconstruct who bought a token early, and
//     auto-record its clean smart-wallet candidates into the watchlist IF the
//     token is a real winner (self-learning; D5 = auto from track record).
//   GET /api/watchlist — the ranked smart-wallet watchlist (top = active/monitored).
// Keys stay server-side (getState), like the rest.
import { Router } from "express";
import { runAutopsy } from "../screener/autopsy.js";
import { recordCandidates, getWatchlist } from "../screener/watchlist.js";
import { runDiscovery, getDiscoveryStatus } from "../screener/discoverWallets.js";
import { runSniperSweep, getSignals, ingestWebhookTxs } from "../screener/sniper.js";
import { getSniperTrack } from "../screener/sniperTrack.js";
import { getParamDefs, applyParams } from "../screener/sniperParams.js";
import { explainSignal } from "../ai/explainSignal.js";
import { getState } from "../ai/settings.js";
import { scanLimit } from "../middleware/limits.js";
import { requireAdmin } from "../middleware/guard.js";
import { webhookAuthToken, syncHeliusWebhook } from "../screener/heliusWebhook.js";

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
    res.json({ ...getWatchlist(), discovery: getDiscoveryStatus() });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Auto-discovery: populate the watchlist live from on-chain data (no manual Bedah).
// Also runs on a background interval in index.js. One cycle = auto-Bedah on a few
// trending winners (A) + Birdeye top-trader harvest (B). Bounded/throttled.
export async function discoverWalletsOnce() {
  const st = getState();
  return runDiscovery({ birdeyeKey: st.birdeyeKey, heliusKey: st.heliusKey, nowMs: Date.now() });
}

router.get("/watchlist/discover", scanLimit, async (_req, res) => {
  try {
    res.json(await discoverWalletsOnce());
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

// Sniper PnL track record. Every raised signal is snapshotted at entry and graded a
// few hours later against the live price (win/loss/rug/flat + return% + peak) — so
// "when the sniper signalled, PnL = ?" is answered from real outcomes, not a guess.
// Read-only; grading runs inside the background sweep. Mirrors /api/pro-radar/track.
router.get("/sniper/track", (_req, res) => {
  try {
    res.json(getSniperTrack());
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

// Real-time push (Modul C, PRIMARY path — event-driven). Helius POSTs the enhanced
// SWAP transaction(s) the instant a watched smart-money wallet swaps. We consume the
// PAYLOAD directly (accumulate buys per token, raise a signal when ≥ signalMin wallets
// converge on one small token) instead of re-polling every wallet — so a signal
// appears seconds after the buy with ZERO /transactions polling. Verified via the
// authHeader Helius echoes back. Acks FAST (Helius retries on non-2xx); ingest runs
// asynchronously after the ack.
router.post("/sniper/helius-webhook", (req, res) => {
  const expected = webhookAuthToken();
  const got = (req.get("authorization") || "").trim();
  if (expected && got !== expected) return res.status(401).json({ ok: false });
  res.json({ ok: true });                 // ack immediately
  const txs = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
  const st = getState();
  ingestWebhookTxs(txs, { heliusKey: st.heliusKey, birdeyeKey: st.birdeyeKey }).catch(() => {});
});

// Admin: force (re)registration of the Helius webhook — handy after ngrok restarts
// (new public URL) or to point it at the current active watchlist on demand.
router.post("/sniper/webhook/sync", requireAdmin, async (_req, res) => {
  try {
    res.json(await syncHeliusWebhook());
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
