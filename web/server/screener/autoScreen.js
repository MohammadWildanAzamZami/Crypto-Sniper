// 10x Radar — auto-screen discovered Solana tokens and surface the ones that
// fit a "high upside" profile: small market cap (room to grow), real liquidity,
// healthy momentum, sane age, and a decent GEM Score. This is a HEURISTIC radar,
// not a prediction — memecoins are extremely risky. DYOR, not financial advice.

import { screenToken } from "./screen.js";
import { discoverSolanaTokens } from "./discover.js";

// Reference cap used to express rough upside as a multiple (e.g. "~14x to $10M").
const UPSIDE_TARGET_CAP = 10_000_000;

// Criteria presets. Balanced is the default.
export const PRESETS = {
  aggressive:   { maxMarketCap:   500_000, minLiquidity:  5_000, minGem: 55, minAgeHours: 0.5, maxAgeHours: 24 * 14, minLockedPctIfKnown:  0,  minBuyRatio: 0.50 },
  balanced:     { maxMarketCap: 2_000_000, minLiquidity: 10_000, minGem: 60, minAgeHours: 1,   maxAgeHours: 24 * 30, minLockedPctIfKnown: 30,  minBuyRatio: 0.50 },
  conservative: { maxMarketCap: 5_000_000, minLiquidity: 50_000, minGem: 72, minAgeHours: 6,   maxAgeHours: 24 * 60, minLockedPctIfKnown: 80,  minBuyRatio: 0.50 },
};

// Stablecoins / blue-chips: no 10x there, skip them.
const SKIP = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112",  // wSOL
]);

function ageHoursOf(report, nowMs) {
  const c = report.metrics?.pairCreatedAt;
  return c ? (nowMs - c) / 3_600_000 : null;
}

/** Evaluate one screened report against the chosen criteria. */
export function evaluateMoonshot(report, criteria, nowMs) {
  const m = report.metrics || {};
  const reasons = [];
  const fails = [];

  const mc = m.marketCap || 0;
  const liq = m.liquidityUsd || 0;
  const gem = report.gemScore || 0;
  const age = ageHoursOf(report, nowMs);
  const lockPct = report.liquidityLock?.lockedPct;
  const { buys = 0, sells = 0 } = m.txns24h || {};
  const totalTx = buys + sells;
  const buyRatio = totalTx > 0 ? buys / totalTx : 0.5;

  // Market cap: needs to be real and small for 10x headroom.
  if (mc <= 0) fails.push("market cap tidak diketahui");
  else if (mc > criteria.maxMarketCap) fails.push(`market cap $${Math.round(mc).toLocaleString()} terlalu besar`);
  else reasons.push(`Market cap kecil $${Math.round(mc).toLocaleString()}`);

  if (liq < criteria.minLiquidity) fails.push(`likuiditas $${Math.round(liq).toLocaleString()} kurang`);
  else reasons.push(`Likuiditas $${Math.round(liq).toLocaleString()}`);

  if (gem < criteria.minGem) fails.push(`GEM ${gem} < ${criteria.minGem}`);
  else reasons.push(`GEM Score ${gem}`);

  if (age == null) reasons.push("umur tidak diketahui");
  else if (age < criteria.minAgeHours) fails.push(`terlalu baru (${age.toFixed(1)}j)`);
  else if (age > criteria.maxAgeHours) fails.push(`terlalu tua (${(age / 24).toFixed(0)}h)`);
  else reasons.push(`Umur ${age < 48 ? age.toFixed(1) + "j" : (age / 24).toFixed(0) + "h"}`);

  if (report.liquidityLock?.rugged) fails.push("ditandai rugged (RugCheck)");
  if (typeof lockPct === "number" && lockPct < criteria.minLockedPctIfKnown) fails.push(`LP locked ${lockPct}% kurang`);
  else if (typeof lockPct === "number") reasons.push(`LP locked ${lockPct}%`);

  if (buyRatio < criteria.minBuyRatio) fails.push(`buy ratio ${(buyRatio * 100).toFixed(0)}% rendah`);
  else reasons.push(`Buy ratio ${(buyRatio * 100).toFixed(0)}%`);

  const pass = fails.length === 0;
  const upsideX = mc > 0 ? Math.min(999, Math.max(1, Math.round(UPSIDE_TARGET_CAP / mc))) : null;
  return { pass, reasons, fails, upsideX };
}

/** Run a callback over items with a bounded concurrency pool. */
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

/**
 * Discover → screen → filter. Returns { scannedAt, preset, discovered,
 * candidatesScanned, matches[] } sorted best-first. Each match carries the full
 * `report` (used for Telegram alerts; strip it before sending to the browser).
 */
export async function runAutoScan({ solscanKey, nowMs, preset = "balanced", limit = 18, concurrency = 9 } = {}) {
  const criteria = PRESETS[preset] || PRESETS.balanced;
  const now = nowMs ?? Date.now();

  const mints = (await discoverSolanaTokens({ limit })).filter((m) => !SKIP.has(m));

  const screened = await mapPool(mints, concurrency, async (mint) => {
    try {
      // skipLock: keep the bulk scan fast (RugCheck is the slow call).
      const report = await screenToken(mint, { solscanKey, nowMs: now, skipLock: true });
      const evalRes = evaluateMoonshot(report, criteria, now);
      return { report, ...evalRes };
    } catch {
      return null;
    }
  });

  const valid = screened.filter(Boolean);
  const matches = valid
    .filter((r) => r.pass)
    .map((r) => ({
      address: r.report.token.address,
      name: r.report.token.name,
      symbol: r.report.token.symbol,
      logoUrl: r.report.token.logoUrl || null,
      gemScore: r.report.gemScore,
      verdict: r.report.verdict,
      marketCap: r.report.metrics.marketCap || 0,
      liquidityUsd: r.report.metrics.liquidityUsd || 0,
      priceUsd: r.report.token.priceUsd,
      url: r.report.token.url,
      trojanLink: r.report.trojanLink,
      lockedPct: r.report.liquidityLock?.lockedPct ?? null,
      upsideX: r.upsideX,
      reasons: r.reasons,
      report: r.report,
    }))
    .sort((a, b) => b.gemScore - a.gemScore);

  return { scannedAt: now, preset, discovered: mints.length, candidatesScanned: valid.length, matches };
}
