// Auto-Discovery Watchlist (SNIPER ENGINE — live population, no manual Bedah).
//
// Fills Modul B (watchlist) automatically from on-chain data so smart wallets no
// longer have to be found by hand. Two sources per cycle:
//   A) Auto-Bedah  — discover trending Solana tokens → runAutopsy() on a few →
//      recordCandidates() (ONLY a real winner earns a "catch"). High quality,
//      "early buyer of a winner". Most expensive (paged Birdeye) → hard cap.
//   B) Top-trader harvest — discover trending → Birdeye top_traders → quality
//      wallets (profitable + net-buyer + not bundler) recorded as low-weight
//      "sightings". Broad, live, noisier. Cheap (1 call/mint).
//
// Bounded + throttled so the free Birdeye tier isn't burst. Never throws into the
// interval — any failing token is skipped and the cycle continues.

import { discoverSolanaTokens } from "./discover.js";
import { runAutopsy } from "./autopsy.js";
import { birdeyeTopTraders } from "./smartMoney.js";
import { recordCandidates, recordTopTraders } from "./watchlist.js";
import { recordEarlySighting } from "./walletIntel.js";
import { getParams } from "./sniperParams.js";

// All four discovery tunables now live in the runtime param registry
// (sniperParams.js, group "Discovery") and are read via getParams() at the START of
// each cycle — so an edit from the Settings UI takes effect on the next cycle with
// no restart. Env vars (SNIPER_DISCOVERY_*) still seed the defaults.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRun = null;   // last completed cycle summary (surfaced to the UI)
let running = false;  // guard against overlapping cycles (interval + manual trigger)

/** Last discovery cycle summary (safe defaults before the first run). */
export function getDiscoveryStatus() {
  return lastRun || { at: null, discovered: 0, autopsied: 0, winnersRecorded: 0, tradersScanned: 0, walletsAdded: 0 };
}

/**
 * One discovery cycle (A + B). Bounded & fail-safe: a token that fails is skipped,
 * the cycle continues, and `lastRun` records what happened.
 * @param {object} opts { birdeyeKey, heliusKey, nowMs }
 */
export async function runDiscovery({ birdeyeKey, heliusKey, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  if (!birdeyeKey) return { disabled: true, reason: "Birdeye key belum diset", ...getDiscoveryStatus() };
  if (running) return { skipped: true, reason: "discovery masih berjalan", ...getDiscoveryStatus() };
  running = true;

  // Read the tunables once per cycle (runtime — reflects any Settings UI change).
  const P = getParams();
  const DISCOVERY_TOKENS = P.discoveryTokens;   // trending mints pulled / cycle
  const AUTOPSY_PER_CYCLE = P.autopsyPerCycle;  // cap auto-Bedah / cycle (expensive)
  const TOPTRADER_TOKENS = P.topTraderTokens;   // cap top-trader scans / cycle
  const THROTTLE_MS = P.discoveryThrottleMs;    // pause between Birdeye calls

  const summary = { at: now, discovered: 0, autopsied: 0, winnersRecorded: 0, tradersScanned: 0, walletsAdded: 0 };
  try {
    const mints = await discoverSolanaTokens({ limit: DISCOVERY_TOKENS });
    summary.discovered = mints.length;

    // A) Auto-Bedah — reuse the full forensic engine; recordCandidates only credits winners.
    for (const mint of mints.slice(0, AUTOPSY_PER_CYCLE)) {
      try {
        const report = await runAutopsy(mint, { birdeyeKey, heliusKey, nowMs: now });
        summary.autopsied++;
        if (report && !report.error) {
          const rec = recordCandidates(report, now);
          if (rec.winner) summary.winnersRecorded += rec.recorded;
          // Wallet Intelligence v2: setiap early buyer bersih (bukan bundle) tercatat
          // sebagai "sighting" lintas token — kemunculan berulang menjadikannya kandidat
          // pipeline vetting+audit. Bookkeeping murni, nol call API tambahan.
          for (const b of report.earlyBuyers || []) {
            if (!b.bundleSuspected) recordEarlySighting(b.owner, mint, now);
          }
        }
      } catch { /* skip this token, keep going */ }
      await sleep(THROTTLE_MS);
    }

    // B) Top-trader harvest — quality filter before recording (profitable, net-buyer, not a bundler).
    for (const mint of mints.slice(0, TOPTRADER_TOKENS)) {
      try {
        const traders = await birdeyeTopTraders(mint, birdeyeKey);
        summary.tradersScanned++;
        if (Array.isArray(traders) && traders.length) {
          const quality = traders.filter(
            (t) => t.pnl > 0 && t.buyUsd > t.sellUsd && !t.tags.includes("bundler")
          );
          if (quality.length) {
            const rec = recordTopTraders(quality, { mint, symbol: "" }, now);
            summary.walletsAdded += rec.recorded;
            // Wallet Intelligence v2: kemunculan top-trader berkualitas juga sighting.
            for (const t of quality) recordEarlySighting(t.owner, mint, now);
          }
        }
      } catch { /* skip this token, keep going */ }
      await sleep(THROTTLE_MS);
    }
  } catch {
    /* discover feed down — keep whatever the cycle gathered so far */
  }

  lastRun = summary;
  running = false;
  return summary;
}
