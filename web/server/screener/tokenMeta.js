// Token identity cache (Modul C) — mint → { symbol, name, logoUrl }. The tx log
// stores raw swap legs (mint address only); the UI wants a human face on each row
// (logo + symbol) without re-hitting an API per render. This module keeps a small
// persistent cache, warmed for free by the sniper's own identity fetches (Birdeye/
// DexScreener snapshots) and lazily backfilled via DexScreener's batch endpoint
// (key-less, up to 30 mints per request) when the tx log surfaces a mint the
// sniper never enriched.
//
// Storage follows the screener state-file pattern: gitignored JSON snapshot,
// seeded on load, rewritten via save(), fail-safe on a read-only FS. Rolling cap
// keeps a 24/7 process from growing the file unbounded. Unknown mints get a
// negative-cache entry with a TTL so a token with no DEX listing yet isn't
// re-queried on every poll, but is retried once it may have listed.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STORE_PATH = fileURLToPath(new URL("./.token-meta.json", import.meta.url));
const MAX_ENTRIES = Math.max(200, Number(process.env.TOKEN_META_MAX || 4000));
const NEG_TTL_MS = 10 * 60_000; // unknown token → retry after 10 min (may list late)
const BATCH_URL = "https://api.dexscreener.com/latest/dex/tokens";
const BATCH_SIZE = 30;          // DexScreener batch endpoint limit

/** @type {Map<string, {symbol:string, name:string, logoUrl:string|null, at:number, miss?:true}>} */
let meta = new Map();
try {
  const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  if (saved && typeof saved === "object") {
    for (const [mint, m] of Object.entries(saved)) {
      if (m && typeof m === "object" && !m.miss) meta.set(mint, m); // misses are not worth persisting
    }
  }
} catch { /* no file / unreadable — start empty */ }

function save() {
  try {
    const obj = {};
    for (const [mint, m] of meta) if (!m.miss) obj[mint] = m;
    writeFileSync(STORE_PATH, JSON.stringify(obj), "utf8");
  } catch { /* read-only/ephemeral FS — cache stays in-memory */ }
}

// Oldest-first eviction once over cap (Map preserves insertion order; re-insert on
// update keeps hot mints alive).
function capSize() {
  while (meta.size > MAX_ENTRIES) {
    const oldest = meta.keys().next().value;
    meta.delete(oldest);
  }
}

/**
 * Remember a token's identity from an enrichment the engine already paid for
 * (Birdeye snapshot / DexScreener safety metrics). No-ops when there's nothing
 * useful to store. Persists at most once per call batch — cheap enough given how
 * rarely the sniper touches new tokens.
 */
export function rememberTokenMeta(mint, { symbol, name, logoUrl } = {}) {
  if (!mint || (!symbol && !logoUrl)) return;
  const cur = meta.get(mint);
  // Don't clobber a known logo with null (Birdeye sometimes lacks logoURI).
  const next = {
    symbol: symbol || cur?.symbol || "",
    name: name || cur?.name || "",
    logoUrl: logoUrl || cur?.logoUrl || null,
    at: Date.now(),
  };
  if (cur && !cur.miss && cur.symbol === next.symbol && cur.name === next.name && cur.logoUrl === next.logoUrl) return;
  meta.delete(mint); // re-insert → moves to newest for eviction order
  meta.set(mint, next);
  capSize();
  save();
}

/** Cached identity for a mint, or null (negative-cache entries count as null). */
export function getTokenMeta(mint) {
  const m = meta.get(mint);
  return m && !m.miss ? m : null;
}

/**
 * Ensure identities exist for the given mints, batch-fetching the missing ones
 * from DexScreener (key-less). Best-effort: network failures leave gaps, unknown
 * tokens are negative-cached for NEG_TTL_MS. Returns a plain lookup object
 * mint → { symbol, name, logoUrl } for everything known after the fill.
 */
export async function ensureTokenMetas(mints) {
  const now = Date.now();
  const missing = [...new Set(mints)].filter((mint) => {
    if (!mint) return false;
    const m = meta.get(mint);
    if (!m) return true;
    return m.miss ? now - m.at > NEG_TTL_MS : false;
  });

  let dirty = false;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(`${BATCH_URL}/${batch.join(",")}`);
      if (!res.ok) continue;
      const body = await res.json();
      // One pair list covering all requested mints; pick the deepest Solana pair
      // where the mint is the BASE token (mirrors fetchDexScreener's relevance rule).
      const bestByMint = new Map();
      for (const p of body.pairs || []) {
        if (p.chainId !== "solana") continue;
        const addr = p.baseToken?.address;
        if (!addr || !batch.includes(addr)) continue;
        const cur = bestByMint.get(addr);
        if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) bestByMint.set(addr, p);
      }
      for (const mint of batch) {
        const p = bestByMint.get(mint);
        meta.delete(mint);
        meta.set(mint, p
          ? { symbol: p.baseToken?.symbol || "", name: p.baseToken?.name || "", logoUrl: p.info?.imageUrl || null, at: now }
          : { symbol: "", name: "", logoUrl: null, at: now, miss: true });
        dirty = true;
      }
    } catch { /* network blip — leave these mints for a later call */ }
  }
  if (dirty) { capSize(); save(); }

  const out = {};
  for (const mint of new Set(mints)) {
    const m = getTokenMeta(mint);
    if (m) out[mint] = { symbol: m.symbol, name: m.name, logoUrl: m.logoUrl };
  }
  return out;
}
