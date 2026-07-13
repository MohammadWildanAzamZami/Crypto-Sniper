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
import { getParams } from "./sniperParams.js";

const FILE_PATH = fileURLToPath(new URL("./.watchlist-state.json", import.meta.url));

// D5 tunables. watchSize + winnerMinX now live in the runtime param registry
// (sniperParams.js, group "Discovery") and are read via getParams() at CALL time, so
// a Settings-UI change takes effect immediately (next call) with no restart. Env
// (SNIPER_WATCH_SIZE / SNIPER_WINNER_MIN_X) still seed the defaults.
//   watchSize = berapa wallet teratas (by reputasi) yang dipantau live. 0 = TANPA
//   BATAS → SEMUA wallet di watchlist dipantau.
// POLL_MIN stays a boot-time const: the monitor interval is scheduled once at startup
// (index.js), so changing it needs a restart — not a runtime knob.
export const POLL_MIN = Number(process.env.SNIPER_POLL_MIN || 5);           // monitor interval (Modul C)
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
  s += Math.min(60, catches * 20);                          // distinct winners caught (dominant)
  s += Math.min(25, Math.log10(Math.max(1, avgX)) * 8);     // entry quality (log scale)
  if (w.established) s += 15;                                // real, aged wallet
  // Path B "sightings" — recurring quality top-trader appearances. Weak breadth
  // signal (max +10) so it never outranks a catch-driven wallet; a top-trader that
  // never catches a winner stays low and won't crowd the active set.
  s += Math.min(10, (w.sightings?.length || 0) * 2);
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
  const winnerMinX = getParams().winnerMinX;   // runtime (Settings UI) — "winner" threshold
  const x = report?.token?.launchToNowX ?? null;
  const cands = Array.isArray(report?.smartWalletCandidates) ? report.smartWalletCandidates : [];
  if (!x || x < winnerMinX || cands.length === 0) {
    return { recorded: 0, winner: false, launchToNowX: x };
  }

  const mint = report.mint;
  const symbol = report.token.symbol || "";
  let recorded = 0;
  for (const c of cands) {
    let w = wallets.get(c.owner);
    if (!w) {
      w = { owner: c.owner, firstSeen: now, lastSeen: now, established: false, catches: [], sightings: [], source: "bedah", reputation: 0 };
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

const MAX_SIGHTINGS = 30;  // keep the most recent N top-trader sightings per wallet

/**
 * Path B (live discovery): record wallets harvested from a token's Birdeye
 * top-traders. These are NOT "early buyers of a winner", so they NEVER earn a
 * "catch" — each recurring appearance is a low-weight "sighting" instead. A wallet
 * seen as a quality top-trader across many tokens gains reputation slowly but stays
 * below catch-driven wallets. Idempotent per (wallet, mint). Never throws.
 * @param {Array<{owner:string}>} traders  quality-filtered top traders
 * @param {{mint:string, symbol?:string}} token
 * @returns {{recorded:number, walletsTouched:number}}
 */
export function recordTopTraders(traders, { mint, symbol } = {}, nowMs) {
  const now = nowMs ?? Date.now();
  if (!Array.isArray(traders) || !mint) return { recorded: 0, walletsTouched: 0 };
  let recorded = 0;
  let touched = 0;
  for (const t of traders) {
    const owner = t?.owner;
    if (!owner) continue;
    let w = wallets.get(owner);
    if (!w) {
      w = { owner, firstSeen: now, lastSeen: now, established: false, catches: [], sightings: [], source: "toptrader", reputation: 0 };
      wallets.set(owner, w);
    }
    if (!Array.isArray(w.sightings)) w.sightings = []; // guard older records
    w.lastSeen = now;
    touched++;
    if (!w.sightings.some((s) => s.mint === mint)) {
      w.sightings.push({ mint, symbol: symbol || "", at: now });
      if (w.sightings.length > MAX_SIGHTINGS) w.sightings = w.sightings.slice(-MAX_SIGHTINGS);
      recorded++;
    }
    w.reputation = computeReputation(w);
  }
  if (recorded > 0) save();
  return { recorded, walletsTouched: touched };
}

// Total "winner power": sum of every catch's entry→now multiple. This is the
// ranking metric — from biggest total winners down to smallest.
const winnerSum = (w) => w.catches.reduce((s, c) => s + (c.xFromEntry || 0), 0);

/** Shape a wallet record for the client (compact, no internal churn).
 * `watchSize`/`noLimit` are passed in (resolved once by the caller) so every row in
 * a listing agrees on the same active cut. */
function toPublic(w, rank, watchSize, noLimit) {
  return {
    owner: w.owner,
    rank,
    reputation: w.reputation,
    catches: w.catches.length,
    sightings: (w.sightings?.length || 0),           // Path B: recurring top-trader appearances
    source: w.source || "bedah",                     // "bedah" (Modul A) | "toptrader" (Path B)
    winnerScore: Math.round(winnerSum(w) * 10) / 10, // Σ kelipatan semua winner (sort key)
    established: w.established,
    active: noLimit || rank <= watchSize,
    bestCatch: w.catches.reduce((best, c) => (!best || (c.xFromEntry || 0) > (best.xFromEntry || 0) ? c : best), null),
    recentCatches: w.catches.slice(-3).reverse().map((c) => ({ symbol: c.symbol, mint: c.mint, xFromEntry: c.xFromEntry })),
    lastSeen: w.lastSeen,
  };
}

/** The ranked watchlist — ordered by TOTAL winner multiple (biggest → smallest),
 * reputasi sebagai tiebreak. Top WATCH_SIZE flagged active (monitored by Modul C). */
export function getWatchlist({ limit = 200 } = {}) {
  const P = getParams();
  const watchSize = P.watchSize;
  const noLimit = !(watchSize > 0);
  // Winner berulang di token BERBEDA: hanya tampilkan wallet dengan ≥ minCatches
  // token winner berbeda (catches.length). 0 = tampilkan semua.
  const minCatches = P.minCatches || 0;
  const pool = minCatches > 0
    ? [...wallets.values()].filter((w) => w.catches.length >= minCatches)
    : [...wallets.values()];
  const ranked = pool.sort((a, b) => winnerSum(b) - winnerSum(a) || b.reputation - a.reputation);
  const list = ranked.slice(0, limit).map((w, i) => toPublic(w, i + 1, watchSize, noLimit));
  const shown = pool.length;
  return {
    total: shown,
    // No limit → semua wallet (lolos filter) aktif dipantau; laporkan sebagai "N / N".
    active: noLimit ? shown : Math.min(watchSize, shown),
    watchSize: noLimit ? shown : watchSize,
    watchAll: noLimit,
    pollMin: POLL_MIN,
    winnerMinX: P.winnerMinX,
    minCatches,
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

/** Hook untuk Wallet Intelligence v2 (walletIntel.js): akses baca record mentah
 * (owner, catches, reputation, …) — dipakai migrasi pertama untuk membawa anggota
 * lama ke status QUARANTINE tanpa menghapus/mengubah data watchlist. Read-only. */
export function getWalletsRaw() {
  return [...wallets.values()];
}

/** The active set the live monitor should poll. Default (WATCH_SIZE=0) = ALL wallets
 * in the watchlist; a positive WATCH_SIZE caps it to the top N by reputation. */
export function getActiveWallets() {
  const watchSize = getParams().watchSize;
  const noLimit = !(watchSize > 0);
  const ranked = [...wallets.values()].sort((a, b) => b.reputation - a.reputation);
  return (noLimit ? ranked : ranked.slice(0, watchSize)).map((w) => w.owner);
}
