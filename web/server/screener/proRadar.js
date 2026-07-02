// Pro Radar — the AI-boosted sibling of the 10x Radar. Same discovery + GEM
// funnel, but wider net, FULL enrichment (liquidity lock) on the finalists, and
// a Fable 5 ranking pass that scores conviction and explains each pick. Falls
// back to pure-heuristic ordering when the AI is unavailable.
//
// Pipeline (see PRO-RADAR.md for the flowchart):
//   discover → fast screen (all) → heuristic pre-filter → enrich top-N with lock
//   → Fable 5 rank → merge + sort by conviction.

import { screenToken } from "./screen.js";
import { discoverSolanaTokens } from "./discover.js";
import { evaluateMoonshot, PRESETS } from "./autoScreen.js";
import { analyzeCandidates } from "../ai/analyze.js";

const UPSIDE_TARGET_CAP = 10_000_000;

// Stablecoins / blue-chips: no 10x there.
const SKIP = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112",  // wSOL
]);

/** Bounded-concurrency map (same shape as autoScreen's pool). */
async function mapPool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch { results[idx] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

function ageHoursOf(report, nowMs) {
  const c = report.metrics?.pairCreatedAt;
  return c ? Number(((nowMs - c) / 3_600_000).toFixed(1)) : null;
}

/** Condense a full report into the compact payload we hand to Fable 5. */
function toAiCandidate(report, nowMs) {
  const m = report.metrics || {};
  const { buys = 0, sells = 0 } = m.txns24h || {};
  const totalTx = buys + sells;
  return {
    address: report.token.address,
    symbol: report.token.symbol,
    name: report.token.name,
    gemScore: report.gemScore,
    marketCap: Math.round(m.marketCap || 0),
    liquidityUsd: Math.round(m.liquidityUsd || 0),
    volume24h: Math.round(m.volume?.h24 || 0),
    priceChangeH1: m.priceChange?.h1 ?? 0,
    priceChangeH6: m.priceChange?.h6 ?? 0,
    priceChangeH24: m.priceChange?.h24 ?? 0,
    buys24h: buys,
    sells24h: sells,
    buyRatioPct: totalTx > 0 ? Math.round((buys / totalTx) * 100) : null,
    ageHours: ageHoursOf(report, nowMs),
    pairCount: m.pairCount || 1,
    lockedPct: report.liquidityLock?.lockedPct ?? null,
    lockStatus: report.liquidityLock?.status ?? "unknown",
    rugged: report.liquidityLock?.rugged ?? null,
  };
}

const ACTION_RANK = { APE: 3, WATCH: 2, AVOID: 1 };

/**
 * Run the Pro Radar. Returns
 * { scannedAt, preset, discovered, candidatesScanned, aiUsed, aiMode, matches[] }.
 * @param {object} opts { solscanKey, nowMs, preset, ai:{aiMode,aiKey,model,claudePath},
 *                        discoverLimit, concurrency, maxAi }
 */
export async function runProRadar({
  solscanKey,
  nowMs,
  preset = "aggressive",
  ai = {},
  discoverLimit = 28,
  concurrency = 10,
  maxAi = 10,
} = {}) {
  const now = nowMs ?? Date.now();
  const criteria = PRESETS[preset] || PRESETS.aggressive;

  // 1) Discover trending mints (DexScreener boosts/profiles — public, key-less).
  const mints = (await discoverSolanaTokens({ limit: discoverLimit })).filter((m) => !SKIP.has(m));

  // 2) Fast screen everything (skipLock keeps the bulk pass quick).
  const screened = await mapPool(mints, concurrency, async (mint) => {
    try {
      const report = await screenToken(mint, { solscanKey, nowMs: now, skipLock: true });
      const evalRes = evaluateMoonshot(report, criteria, now);
      return { report, ...evalRes };
    } catch {
      return null;
    }
  });
  const valid = screened.filter(Boolean);

  // 3) Pre-filter to the passers, best GEM first, and keep the finalists.
  const finalists = valid
    .filter((r) => r.pass)
    .sort((a, b) => b.report.gemScore - a.report.gemScore)
    .slice(0, maxAi);

  // 4) Enrich finalists with the (slower) RugCheck liquidity-lock data.
  await mapPool(finalists, concurrency, async (r) => {
    try {
      const full = await screenToken(r.report.token.address, { solscanKey, nowMs: now, skipLock: false });
      r.report = full;
      r.upsideX = full.metrics?.marketCap > 0
        ? Math.min(999, Math.max(1, Math.round(UPSIDE_TARGET_CAP / full.metrics.marketCap)))
        : r.upsideX;
    } catch {
      /* keep the fast report if the enrich call fails */
    }
    return r;
  });

  // 5) Fable 5 ranking pass over the finalists (null if AI unavailable).
  const aiPayload = finalists.map((r) => toAiCandidate(r.report, now));
  const aiMap = await analyzeCandidates(aiPayload, ai);
  const aiUsed = Boolean(aiMap);

  // 6) Merge AI verdicts onto the finalists and shape the client payload.
  const matches = finalists.map((r) => {
    const rep = r.report;
    const a = aiMap?.get(rep.token.address) || null;
    return {
      address: rep.token.address,
      name: rep.token.name,
      symbol: rep.token.symbol,
      logoUrl: rep.token.logoUrl || null,
      gemScore: rep.gemScore,
      verdict: rep.verdict,
      marketCap: rep.metrics.marketCap || 0,
      liquidityUsd: rep.metrics.liquidityUsd || 0,
      priceUsd: rep.token.priceUsd,
      url: rep.token.url,
      trojanLink: rep.trojanLink,
      lockedPct: rep.liquidityLock?.lockedPct ?? null,
      lockStatus: rep.liquidityLock?.status ?? null,
      upsideX: r.upsideX,
      reasons: r.reasons,
      ai: a
        ? {
            conviction: clampInt(a.conviction, 0, 100),
            tier: ["S", "A", "B", "C"].includes(a.tier) ? a.tier : "C",
            thesis: String(a.thesis || "").slice(0, 200),
            catalysts: Array.isArray(a.catalysts) ? a.catalysts.slice(0, 3).map(String) : [],
            redFlags: Array.isArray(a.redFlags) ? a.redFlags.slice(0, 3).map(String) : [],
            action: ["APE", "WATCH", "AVOID"].includes(a.action) ? a.action : "WATCH",
          }
        : null,
    };
  });

  // 7) Sort: AI conviction first when we have it, else GEM Score.
  if (aiUsed) {
    matches.sort((x, y) => {
      const cx = x.ai?.conviction ?? -1;
      const cy = y.ai?.conviction ?? -1;
      if (cy !== cx) return cy - cx;
      const ax = ACTION_RANK[x.ai?.action] ?? 0;
      const ay = ACTION_RANK[y.ai?.action] ?? 0;
      if (ay !== ax) return ay - ax;
      return y.gemScore - x.gemScore;
    });
  } else {
    matches.sort((x, y) => y.gemScore - x.gemScore);
  }

  return {
    scannedAt: now,
    preset,
    discovered: mints.length,
    candidatesScanned: valid.length,
    aiUsed,
    aiMode: ai.aiMode || "none",
    model: ai.model || null,
    matches,
  };
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
