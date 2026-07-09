// evmWatchlist.js — Watchlist smart-wallet EVM (Robinhood Chain, LANGKAH #4). Memori
// yang mengubah Bedah Coin EVM satu-kali jadi edge belajar-sendiri: tiap "Bedah" token
// winner menyemai wallet 0x yang menangkapnya lebih awal + masih pegang. Wallet yang
// menangkap winner demi winner naik reputasi; top RH_WATCH_SIZE jadi set AKTIF yang
// (nanti) dipantau Sniper EVM (langkah #5). Sejajar dengan watchlist.js (Solana).
//
// File-persisted, fail-safe di FS read-only/ephemeral. Heuristik — bukan nasihat keuangan.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE_PATH = fileURLToPath(new URL("./.evm-watchlist-state.json", import.meta.url));

export const WATCH_SIZE = Number(process.env.RH_WATCH_SIZE || 40);            // set aktif dipantau
const WINNER_MIN_MCAP = Number(process.env.RH_WINNER_MIN_MCAP || 100_000);   // token dianggap "winner" bila mcap ≥ ini
const MAX_WALLETS = 2000;
const MAX_CATCHES = 20;

/** @type {Map<string, object>} owner → record */
let wallets = new Map();
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.wallets)) wallets = new Map(saved.wallets.map((w) => [w.owner, w]));
} catch { /* no file / unreadable — start empty */ }

function save() {
  try {
    const top = [...wallets.values()].sort((a, b) => b.reputation - a.reputation).slice(0, MAX_WALLETS);
    writeFileSync(FILE_PATH, JSON.stringify({ wallets: top }, null, 2), "utf8");
  } catch { /* read-only FS — keep in memory */ }
}

// Reputasi 0–100: jumlah winner berbeda ditangkap (dominan) + kualitas entri (seberapa
// AWAL ia beli, dari buyIdx) — sejajar computeReputation() Solana. Menangkap winner
// demi winner = edge; satu beli awal beruntung = noise.
function computeReputation(w) {
  const catches = w.catches.length;
  const avgIdx = catches ? w.catches.reduce((s, c) => s + (c.buyIdx || 30), 0) / catches : 30;
  let s = 0;
  s += Math.min(65, catches * 22);                                  // winner berbeda ditangkap
  s += Math.min(35, Math.max(0, 31 - Math.min(30, avgIdx)) * 1.2);  // makin awal (buyIdx kecil) makin tinggi
  return Math.round(Math.min(100, s));
}

/**
 * Rekam kandidat smart wallet dari hasil Bedah Coin EVM. Hanya mengkredit "catch"
 * bila token benar winner (mcap ≥ WINNER_MIN_MCAP). Idempoten per (wallet, token).
 * @param {object} bedah hasil bedahEvmToken()
 * @returns {{recorded:number, winner:boolean, mcap:number}}
 */
export function recordEvmCandidates(bedah, nowMs) {
  const now = nowMs ?? Date.now();
  const mcap = Number(bedah?.mcapUsd) || 0;
  const cands = Array.isArray(bedah?.smartCandidates) ? bedah.smartCandidates : [];
  if (mcap < WINNER_MIN_MCAP || cands.length === 0) {
    return { recorded: 0, winner: false, mcap };
  }
  const token = String(bedah.token || "").toLowerCase();
  const symbol = bedah.symbol || bedah.name || "";
  let recorded = 0;
  for (const c of cands) {
    const owner = String(c.owner || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(owner)) continue;
    let w = wallets.get(owner);
    if (!w) { w = { owner, firstSeen: now, lastSeen: now, catches: [], reputation: 0 }; wallets.set(owner, w); }
    w.lastSeen = now;
    if (!w.catches.some((cc) => cc.token === token)) {  // dedupe per token
      w.catches.push({ token, symbol, buyIdx: c.buyIdx, boughtTokens: c.boughtTokens, mcap, at: now });
      if (w.catches.length > MAX_CATCHES) w.catches = w.catches.slice(-MAX_CATCHES);
      recorded++;
    }
    w.reputation = computeReputation(w);
  }
  if (recorded > 0) save();
  return { recorded, winner: true, mcap };
}

function toPublic(w, rank) {
  const best = w.catches.reduce((b, c) => (!b || (c.mcap || 0) > (b.mcap || 0) ? c : b), null);
  return {
    owner: w.owner,
    rank,
    reputation: w.reputation,
    catches: w.catches.length,
    active: true, // semua wallet terdaftar dipantau (tanpa batas)
    bestCatch: best ? { symbol: best.symbol, token: best.token, mcap: best.mcap, buyIdx: best.buyIdx } : null,
    recentCatches: w.catches.slice(-3).reverse().map((c) => ({ symbol: c.symbol, token: c.token, buyIdx: c.buyIdx })),
    lastSeen: w.lastSeen,
  };
}

/** Watchlist EVM terurut. Top WATCH_SIZE ditandai aktif. */
export function getEvmWatchlist({ limit = 200 } = {}) {
  const ranked = [...wallets.values()].sort((a, b) => b.reputation - a.reputation);
  return {
    chain: "Robinhood Chain",
    total: wallets.size,
    active: wallets.size,        // semua dipantau (tanpa batas)
    watchSize: wallets.size,
    monitorAll: true,
    winnerMinMcap: WINNER_MIN_MCAP,
    wallets: ranked.slice(0, limit).map((w, i) => toPublic(w, i + 1)),
  };
}

/** Reputasi/meta satu wallet (untuk anotasi sinyal Sniper EVM nanti). */
export function getEvmWalletMeta(owner) {
  const w = wallets.get(String(owner || "").toLowerCase());
  if (!w) return { reputation: 0, catches: 0 };
  return { reputation: w.reputation, catches: w.catches.length };
}

/** Set yang dipantau Sniper EVM: SEMUA wallet terdaftar (tanpa batas), terurut reputasi.
 * (Dulu di-cap WATCH_SIZE; kini semua watchlist dipantau sesuai permintaan.) */
export function getActiveEvmWallets() {
  return [...wallets.values()]
    .sort((a, b) => b.reputation - a.reputation)
    .map((w) => w.owner);
}
