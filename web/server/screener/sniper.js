// Live Sniper Monitor (SNIPER ENGINE Modul C). The part that makes the loop live:
// every SNIPER_POLL_MIN it sweeps the ACTIVE watchlist (top wallets from Modul B),
// reads each wallet's most recent buys (Helius), and raises a SIGNAL when ≥
// SNIPER_SIGNAL_MIN distinct proven wallets are buying the SAME fresh token that's
// still small (mcap < cap). That's "smart money is accumulating this BEFORE the
// pump" — the whole point of the sniper. Signals are deduped and expire, and shown
// in the UI (D4: no dedicated alert channel yet; Telegram optional later).
//
// Cost: |active wallets| Helius calls per sweep (40 × /5min ≈ 8/min) — light.
// Everything degrades to null/[] on failure; a sweep never throws into the loop.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getActiveWallets, POLL_MIN } from "./watchlist.js";

const HELIUS = "https://api.helius.xyz";
const BIRDEYE = "https://public-api.birdeye.so";
const FILE_PATH = fileURLToPath(new URL("./.sniper-state.json", import.meta.url));

// Tunables (env-overridable — same spirit as the watchlist D5 knobs).
const SIGNAL_MIN = Number(process.env.SNIPER_SIGNAL_MIN || 2);              // distinct wallets buying same token → signal
const SIGNAL_MAX_MCAP = Number(process.env.SNIPER_SIGNAL_MAX_MCAP || 2_000_000); // only flag still-early tokens
const RECENT_TX = Number(process.env.SNIPER_RECENT_TX || 20);              // recent txs scanned per wallet
const LOOKBACK_MIN = Number(process.env.SNIPER_LOOKBACK_MIN || 90);        // only buys newer than this count
const SIGNAL_TTL_MIN = Number(process.env.SNIPER_SIGNAL_TTL_MIN || 360);   // signals expire after this
const MAX_ENRICH = Number(process.env.SNIPER_MAX_ENRICH || 20);           // cap Birdeye enrich per sweep
const POOL = 5;                                                            // Helius/Birdeye concurrency

// Tokens that are never a "fresh gem" — stablecoins / wrapped SOL.
const IGNORE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Signal store (file-persisted; survives a restart briefly) ------------
/** @type {Map<string, object>} mint → signal */
let signals = new Map();
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.signals)) signals = new Map(saved.signals.map((s) => [s.mint, s]));
} catch { /* no file / unreadable — start empty */ }

function save() {
  try {
    writeFileSync(FILE_PATH, JSON.stringify({ signals: [...signals.values()] }, null, 2), "utf8");
  } catch { /* read-only FS — keep in memory */ }
}

async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      return res;
    } catch (e) {
      if (i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      throw e;
    }
  }
}

// Bounded-concurrency map so a 40-wallet sweep doesn't burst Helius.
async function mapPool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// A wallet's recent token BUYS: tokens it RECEIVED in a swap within the lookback
// window. Returns [{ mint, at }]. Uses Helius parsed txs + tokenTransfers.
async function recentBuys(owner, key, sinceSec) {
  const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${key}&limit=${RECENT_TX}`, {
    headers: { accept: "application/json" },
  });
  if (!res || !res.ok) return [];
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  const buys = [];
  for (const tx of arr) {
    const at = Number(tx.timestamp) || 0;
    if (at < sinceSec) continue;
    // A "buy" = this wallet received a non-stable token in the tx.
    const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
    for (const t of transfers) {
      if (t.toUserAccount !== owner) continue;
      const mint = t.mint;
      if (!mint || IGNORE_MINTS.has(mint)) continue;
      if (Number(t.tokenAmount) <= 0) continue;
      buys.push({ mint, at });
    }
  }
  return buys;
}

// Enrich a candidate token with current mcap/identity so we only signal ones that
// are still small (early). null → skip (unknown or too big).
async function tokenSnapshot(mint, key) {
  try {
    const res = await fetchRetry(`${BIRDEYE}/defi/token_overview?address=${mint}`, {
      headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    const d = (await res.json())?.data;
    if (!d) return null;
    return { symbol: d.symbol || "", name: d.name || "", mcap: Math.round(Number(d.marketCap ?? d.mc) || 0), priceUsd: Number(d.price) || 0 };
  } catch { return null; }
}

/**
 * One monitor sweep. Reads active-watchlist wallets' recent buys, groups by token,
 * and raises/refreshes a signal when ≥ SIGNAL_MIN distinct wallets bought the same
 * still-small token. Returns { swept, candidates, newSignals, signals }.
 */
export async function runSniperSweep({ heliusKey, birdeyeKey, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  if (!heliusKey) return { disabled: true, reason: "Helius key belum diset", swept: 0, newSignals: 0, signals: getSignals().signals };

  const active = getActiveWallets();
  if (active.length === 0) return { swept: 0, candidates: 0, newSignals: 0, signals: getSignals().signals };

  const sinceSec = Math.floor(now / 1000) - LOOKBACK_MIN * 60;

  // 1) Gather each active wallet's recent buys.
  const perWallet = await mapPool(active, POOL, (owner) => recentBuys(owner, heliusKey, sinceSec).then((b) => ({ owner, b })));

  // 2) Group by token: which distinct watchlist wallets bought it, and when.
  const byToken = new Map(); // mint → { wallets:Set, lastAt }
  for (const row of perWallet) {
    if (!row) continue;
    for (const buy of row.b) {
      let g = byToken.get(buy.mint);
      if (!g) { g = { wallets: new Set(), lastAt: 0 }; byToken.set(buy.mint, g); }
      g.wallets.add(row.owner);
      if (buy.at > g.lastAt) g.lastAt = buy.at;
    }
  }

  // 3) Candidates = tokens with enough distinct smart wallets buying. Strongest
  // first (most wallets), capped so a burst of bot-traded tokens can't blow up the
  // enrichment cost — we only care about the top confluence anyway.
  const candidates = [...byToken.entries()]
    .filter(([, g]) => g.wallets.size >= SIGNAL_MIN)
    .sort((a, b) => b[1].wallets.size - a[1].wallets.size)
    .slice(0, MAX_ENRICH);

  // 4) Enrich (bounded-concurrency Birdeye) + gate by mcap (still early), then
  // raise/refresh signals.
  let newSignals = 0;
  const snaps = await mapPool(candidates, POOL, ([mint]) => tokenSnapshot(mint, birdeyeKey));
  candidates.forEach(([mint, g], i) => {
    const snap = snaps[i];
    if (!snap) return;
    if (snap.mcap > 0 && snap.mcap > SIGNAL_MAX_MCAP) return; // already too big — missed the early window
    const existing = signals.get(mint);
    signals.set(mint, {
      mint,
      symbol: snap.symbol,
      name: snap.name,
      mcap: snap.mcap,
      priceUsd: snap.priceUsd,
      walletCount: g.wallets.size,
      wallets: [...g.wallets],
      lastBuyAt: g.lastAt * 1000,
      firstDetectedAt: existing?.firstDetectedAt || now,
      updatedAt: now,
      isNew: !existing,
    });
    if (!existing) newSignals++;
  });

  // 5) Expire stale signals so the list stays fresh/actionable.
  const cutoff = now - SIGNAL_TTL_MIN * 60_000;
  for (const [mint, s] of signals) if (s.updatedAt < cutoff) signals.delete(mint);

  save();
  return { swept: active.length, candidates: candidates.length, newSignals, signals: getSignals().signals };
}

/** Current live signals (freshest first), plus config for the UI. */
export function getSignals() {
  const list = [...signals.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    count: list.length,
    signalMin: SIGNAL_MIN,
    maxMcap: SIGNAL_MAX_MCAP,
    pollMin: POLL_MIN,
    signals: list,
  };
}
