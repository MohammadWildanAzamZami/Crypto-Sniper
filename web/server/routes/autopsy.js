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
import { getState } from "../ai/settings.js";
import { scanLimit } from "../middleware/limits.js";

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

// Live sniper signals (Modul C). Read the current signals cheaply...
router.get("/sniper/signals", (_req, res) => {
  try {
    res.json(getSignals());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ...or trigger a sweep on demand (also runs on a background interval in index.js).
export async function sniperSweepOnce() {
  const st = getState();
  return runSniperSweep({ heliusKey: st.heliusKey, birdeyeKey: st.birdeyeKey, nowMs: Date.now() });
}

router.get("/sniper/sweep", scanLimit, async (_req, res) => {
  try {
    res.json(await sniperSweepOnce());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

export default router;
