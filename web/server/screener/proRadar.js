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
import { qualityGate } from "./quality.js";
import { getTuning, recordPicks, gradeAndRetune, getTrackRecord, getFirstSeen, noteScanYield } from "./learn.js";

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
    // Pump.fun signals (null for non-pump tokens): graduation + drawdown from ATH.
    pumpGraduated: report.pumpfun?.complete ?? null,
    pumpDrawdownFromAthPct: report.pumpfun?.drawdownFromAthPct ?? null,
    // Smart-money signals (null when Birdeye key absent): top-trader accumulation.
    smartScore: report.smartMoney?.score ?? null,
    smartAccumulating: report.smartMoney?.accumulating ?? null,
    smartWhales: report.smartMoney?.whales ?? null,
    smartProfitableTraders: report.smartMoney?.profitable ?? null,
    smartNetBuyUsd: report.smartMoney?.netBuyUsd ?? null,
    smartEstablishedWallets: report.smartMoney?.established ?? null,
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
  preset = "balanced",
  ai = {},
  smart = {},
  discoverLimit = 40,
  concurrency = 10,
  maxAi = 14,
} = {}) {
  const now = nowMs ?? Date.now();
  const criteria = PRESETS[preset] || PRESETS.balanced;

  // Self-tuning: grade any matured past picks and pull the current (learned)
  // quality-gate thresholds. Grading is time-bounded so it won't stall the scan.
  const track = await gradeAndRetune(now).catch(() => getTrackRecord());
  const tuning = getTuning();

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
      const full = await screenToken(r.report.token.address, {
        solscanKey, nowMs: now, skipLock: false,
        birdeyeKey: smart.birdeyeKey, heliusKey: smart.heliusKey,
      });
      r.report = full;
      r.upsideX = full.metrics?.marketCap > 0
        ? Math.min(999, Math.max(1, Math.round(UPSIDE_TARGET_CAP / full.metrics.marketCap)))
        : r.upsideX;
    } catch {
      /* keep the fast report if the enrich call fails */
    }
    return r;
  });

  // 4b) HARD QUALITY GATE — drop rugs, dead pairs, honeypot-shaped and unlocked
  // tokens before they ever reach the AI or the UI. Thresholds are self-tuned.
  const rejected = [];
  const gated = finalists.filter((r) => {
    const g = qualityGate(r.report, tuning);
    if (!g.ok) rejected.push({ address: r.report.token.address, symbol: r.report.token.symbol, rejects: g.rejects });
    return g.ok;
  });

  // 5) Fable 5 ranking pass over the survivors (null if AI unavailable).
  const aiPayload = gated.map((r) => toAiCandidate(r.report, now));
  const aiMap = await analyzeCandidates(aiPayload, ai);
  const aiUsed = Boolean(aiMap);

  // 6) Merge AI verdicts onto the survivors and shape the client payload.
  const matches = gated.map((r) => {
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
      chartUrl: rep.token.chartUrl || null,
      trojanLink: rep.trojanLink,
      lockedPct: rep.liquidityLock?.lockedPct ?? null,
      lockStatus: rep.liquidityLock?.status ?? null,
      pump: rep.pumpfun
        ? { graduated: rep.pumpfun.complete, drawdownFromAthPct: rep.pumpfun.drawdownFromAthPct }
        : null,
      smart: rep.smartMoney
        ? {
            score: rep.smartMoney.score,
            accumulating: rep.smartMoney.accumulating,
            whales: rep.smartMoney.whales,
            profitable: rep.smartMoney.profitable,
            netBuyUsd: rep.smartMoney.netBuyUsd,
            established: rep.smartMoney.established,
          }
        : null,
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

  // 6b) Blended quality score (0-100): AI conviction and GEM Score together when
  // we have the AI, else GEM alone. Used for the badge + as the final sort key.
  for (const mt of matches) {
    mt.quality = mt.ai ? Math.round(0.5 * mt.gemScore + 0.5 * mt.ai.conviction) : mt.gemScore;
    // Smart-money accumulation is a strong tailwind — nudge quality up to +12.
    if (mt.smart && mt.smart.score > 0) {
      mt.quality = Math.min(100, mt.quality + Math.round(mt.smart.score * 0.12));
    }
  }

  // 7) Post-AI filter: the AI already saw only gate-survivors, so now DROP the
  // ones it judged AVOID or below the (self-tuned) conviction floor. This is what
  // stops junk from padding the list. Keep a small floor so the panel isn't empty
  // when the AI is harsh but we still have decent gems.
  let shown = matches;
  if (aiUsed) {
    shown = matches.filter((m) => m.ai && m.ai.action !== "AVOID" && m.ai.conviction >= tuning.minConviction);
    if (shown.length === 0 && matches.length) {
      shown = matches
        .slice()
        .sort((a, b) => (b.ai?.conviction ?? -1) - (a.ai?.conviction ?? -1))
        .slice(0, 3);
    }
  }

  // 8) Sort: quality first, then AI action, then GEM Score.
  shown.sort((x, y) => {
    if (y.quality !== x.quality) return y.quality - x.quality;
    const ax = ACTION_RANK[x.ai?.action] ?? 0;
    const ay = ACTION_RANK[y.ai?.action] ?? 0;
    if (ay !== ax) return ay - ax;
    return y.gemScore - x.gemScore;
  });

  // 9) Record what we surfaced so it can be graded on a future scan (self-learning),
  // and feed the yield to the starvation guard so an over-tight gate reopens.
  recordPicks(shown, now);
  noteScanYield(shown.length, now);

  // 9b) Attach the entry price at FIRST detection (recordPicks has already
  // snapshotted brand-new tokens, so every shown pick has a first-seen row).
  // This lets the UI show "screened at $X → now $Y (+Z%, Nx)" as live evidence of
  // whether the radar's picks actually run toward a 10x.
  for (const m of shown) {
    const fs = getFirstSeen(m.address);
    if (!fs) continue;
    const cur = m.priceUsd;
    const hasBoth = fs.priceUsd > 0 && typeof cur === "number" && cur > 0;
    m.firstSeen = {
      priceUsd: fs.priceUsd,
      marketCap: fs.marketCap,
      at: fs.at,
      isNew: now - fs.at < 60_000, // detected on THIS scan
      changePct: hasBoth ? Number((((cur - fs.priceUsd) / fs.priceUsd) * 100).toFixed(1)) : null,
      multiple: hasBoth ? Number((cur / fs.priceUsd).toFixed(2)) : null,
    };
  }

  return {
    scannedAt: now,
    preset,
    discovered: mints.length,
    candidatesScanned: valid.length,
    rejected: rejected.length,
    rejectedSample: rejected.slice(0, 6),
    aiUsed,
    aiMode: ai.aiMode || "none",
    model: ai.model || null,
    smartMoneyEnabled: Boolean(smart.birdeyeKey),
    tuning,
    track,
    matches: shown,
  };
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
