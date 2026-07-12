// Transaction log (Modul C) — records EVERY swap (buy & sell) of a monitored
// wallet that flows through the live monitor, before it's discarded. Until now the
// engine only persisted derived results (signals, catches, PnL); the raw per-wallet
// swaps were parsed, used to form confluence, then thrown away. This keeps a rolling
// history of them so "semua transaksi wallet dipantau" is queryable.
//
// Storage follows the same pattern as the other screener state files: a gitignored
// JSON snapshot, seeded into memory on load, rewritten via save(), fail-safe on a
// read-only FS (state simply stays in memory). Rolling cap: only the most recent
// MAX_TXS are kept (oldest dropped) so a 24/7 process can't grow the file unbounded.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STORE_PATH = fileURLToPath(new URL("./.sniper-txs.json", import.meta.url));
// Rolling cap. Override with SNIPER_TX_LOG_MAX. Clamped to a sane floor.
const MAX_TXS = Math.max(100, Number(process.env.SNIPER_TX_LOG_MAX || 5000));

/** @type {Array<{owner,sig,mint,side,at,tokens,priceUsd,sizeUsd,logged}>} newest last. */
let txs = [];
try {
  const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  if (Array.isArray(saved)) txs = saved.slice(-MAX_TXS);
} catch { /* no file / unreadable — start empty */ }

function save() {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(txs), "utf8");
  } catch { /* read-only/ephemeral FS — history stays in-memory */ }
}

// Dedupe key: Helius may re-deliver the same webhook tx (retries). A swap leg is
// unique per (signature, wallet, mint, side). When a tx has no signature we fall
// back to (owner, mint, side, at) which is still stable across re-delivery.
const keyOf = (e) => `${e.sig || ""}:${e.owner}:${e.mint}:${e.side}:${e.sig ? "" : e.at}`;

/**
 * Record a batch of parsed swap legs from one ingest pass. Each entry:
 *   { owner, sig, mint, side, at, tokens, priceUsd, sizeUsd }
 * De-dupes against what's already stored (webhook re-delivery), appends the fresh
 * ones, caps to MAX_TXS, and persists ONCE per batch. Returns how many were added.
 */
export function recordTxs(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const seen = new Set(txs.map(keyOf));
  let added = 0;
  for (const e of entries) {
    if (!e || !e.mint || !e.owner) continue;
    const k = keyOf(e);
    if (seen.has(k)) continue;
    seen.add(k);
    txs.push({ ...e, logged: Date.now() });
    added++;
  }
  if (added === 0) return 0;
  if (txs.length > MAX_TXS) txs = txs.slice(-MAX_TXS);
  save();
  return added;
}

/**
 * Recent transactions, newest first, with optional filters. `owner`/`mint` narrow
 * to one wallet/token; `side` to "buy"/"sell". `total` = rows matching the filter,
 * `stored`/`max` describe the rolling buffer.
 */
export function getTxLog({ limit = 200, owner, mint, side } = {}) {
  let rows = txs;
  if (owner) rows = rows.filter((t) => t.owner === owner);
  if (mint) rows = rows.filter((t) => t.mint === mint);
  if (side) rows = rows.filter((t) => t.side === side);
  const total = rows.length;
  const list = rows.slice(-Math.max(1, limit)).reverse();
  return { total, stored: txs.length, max: MAX_TXS, txs: list };
}
