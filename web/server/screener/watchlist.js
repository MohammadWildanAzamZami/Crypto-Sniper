// Smart-wallet watchlist (SNIPER ENGINE Modul B). The persistent memory that turns
// one-off "Bedah Coin" autopsies into a self-learning edge: every time an autopsy
// of a REAL winner (pumped ≥ WINNER_MIN_X from launch) surfaces clean smart-wallet
// candidates, they're recorded here. A wallet that catches winner after winner
// climbs the reputation ranking; the top SNIPER_WATCH_SIZE become the ACTIVE
// watchlist that the live monitor (Modul C) will follow into the next pump.
//
// Store keyed by wallet. Each wallet accumulates distinct "catches" (winners it
// bought early), from which a 0–100 reputation is derived. File-persisted like
// radarStore/learn — fails safe on a read-only/ephemeral FS (stays in-memory).
// D5: auto-populated from track record; size + thresholds tunable via env.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE_PATH = fileURLToPath(new URL("./.watchlist-state.json", import.meta.url));

// D5 tunables (env-overridable so the user can retune without a code change).
export const WATCH_SIZE = Number(process.env.SNIPER_WATCH_SIZE || 40);      // active watchlist size
export const POLL_MIN = Number(process.env.SNIPER_POLL_MIN || 5);           // monitor interval (Modul C)
const WINNER_MIN_X = Number(process.env.SNIPER_WINNER_MIN_X || 10);         // "winner" = launch→now ≥ this
const MAX_WALLETS = 2000;   // hard cap so the file can't grow unbounded
const MAX_CATCHES = 20;     // keep the most recent N catches per wallet

// ---- Store (seeded once at module load) -----------------------------------
/** @type {Map<string, object>} owner → wallet record */
let wallets = new Map();
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.wallets)) wallets = new Map(saved.wallets.map((w) => [w.owner, w]));
} catch {
  /* no file yet, or unreadable FS — start empty */
}

function save() {
  try {
    // Persist only the strongest wallets (by reputation) up to the cap.
    const top = [...wallets.values()].sort((a, b) => b.reputation - a.reputation).slice(0, MAX_WALLETS);
    writeFileSync(FILE_PATH, JSON.stringify({ wallets: top }, null, 2), "utf8");
  } catch {
    /* read-only/ephemeral FS — keep state in-memory for this process */
  }
}

// Reputation 0–100: how many DISTINCT winners caught (dominant), how good the
// entries were (avg entry→now multiple, log-scaled), and whether the wallet is
// Helius-established. Catch count is the real signal — one lucky early buy is
// noise; catching winner after winner is edge.
function computeReputation(w) {
  const catches = w.catches.length;
  const avgX = catches ? w.catches.reduce((s, c) => s + (c.xFromEntry || 1), 0) / catches : 1;
  let s = 0;
  s += Math.min(60, catches * 20);                          // distinct winners caught
  s += Math.min(25, Math.log10(Math.max(1, avgX)) * 8);     // entry quality (log scale)
  if (w.established) s += 15;                                // real, aged wallet
  return Math.round(Math.min(100, s));
}

/**
 * Record the smart-wallet candidates from an autopsy report. Only credits a
 * "catch" when the token is a genuine winner (launch→now ≥ WINNER_MIN_X), so the
 * watchlist learns from real runners, not every token someone bedah'd. Idempotent
 * per (wallet, mint): re-running an autopsy won't double-count the same winner.
 * @returns {{recorded:number, winner:boolean, launchToNowX:number|null}}
 */
export function recordCandidates(report, nowMs) {
  const now = nowMs ?? Date.now();
  const x = report?.token?.launchToNowX ?? null;
  const cands = Array.isArray(report?.smartWalletCandidates) ? report.smartWalletCandidates : [];
  if (!x || x < WINNER_MIN_X || cands.length === 0) {
    return { recorded: 0, winner: false, launchToNowX: x };
  }

  const mint = report.mint;
  const symbol = report.token.symbol || "";
  let recorded = 0;
  for (const c of cands) {
    let w = wallets.get(c.owner);
    if (!w) {
      w = { owner: c.owner, firstSeen: now, lastSeen: now, established: false, catches: [], reputation: 0 };
      wallets.set(c.owner, w);
    }
    w.lastSeen = now;
    if (c.established === true) w.established = true; // sticky once verified
    // Dedupe by mint — the same winner counts once per wallet.
    if (!w.catches.some((cc) => cc.mint === mint)) {
      w.catches.push({ mint, symbol, firstBuyMcap: c.firstBuyMcap, xFromEntry: c.xFromEntry, launchToNowX: x, at: now });
      if (w.catches.length > MAX_CATCHES) w.catches = w.catches.slice(-MAX_CATCHES);
      recorded++;
    }
    w.reputation = computeReputation(w);
  }
  if (recorded > 0) save();
  return { recorded, winner: true, launchToNowX: x };
}

/** Shape a wallet record for the client (compact, no internal churn). */
function toPublic(w, rank) {
  return {
    owner: w.owner,
    rank,
    reputation: w.reputation,
    catches: w.catches.length,
    established: w.established,
    active: rank <= WATCH_SIZE,
    bestCatch: w.catches.reduce((best, c) => (!best || (c.xFromEntry || 0) > (best.xFromEntry || 0) ? c : best), null),
    recentCatches: w.catches.slice(-3).reverse().map((c) => ({ symbol: c.symbol, mint: c.mint, xFromEntry: c.xFromEntry })),
    lastSeen: w.lastSeen,
  };
}

/** The ranked watchlist. Top WATCH_SIZE are flagged active (monitored by Modul C). */
export function getWatchlist({ limit = 200 } = {}) {
  const ranked = [...wallets.values()].sort((a, b) => b.reputation - a.reputation);
  const list = ranked.slice(0, limit).map((w, i) => toPublic(w, i + 1));
  return {
    total: wallets.size,
    active: Math.min(WATCH_SIZE, wallets.size),
    watchSize: WATCH_SIZE,
    pollMin: POLL_MIN,
    winnerMinX: WINNER_MIN_X,
    wallets: list,
  };
}

/** Reputation/meta for one wallet (for the live monitor to annotate signals).
 * Returns zeros for an unknown wallet — never throws. */
export function getWalletMeta(owner) {
  const w = wallets.get(owner);
  if (!w) return { reputation: 0, catches: 0, established: false };
  return { reputation: w.reputation, catches: w.catches.length, established: w.established };
}

/** The active set the live monitor should poll (top WATCH_SIZE by reputation). */
export function getActiveWallets() {
  return [...wallets.values()]
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, WATCH_SIZE)
    .map((w) => w.owner);
}
