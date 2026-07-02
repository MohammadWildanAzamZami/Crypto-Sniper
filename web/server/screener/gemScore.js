// GEM Score™ — a transparent 0-100 heuristic, NOT a prediction and NOT financial
// advice. It rewards healthy liquidity, real momentum, and basic trust signals,
// and penalises the patterns common to rugs (no liquidity, one-sided dumping,
// brand-new pairs with nothing behind them).
//
// Three pillars, weighted 40 / 35 / 25:
//   Pillar 1 — Liquidity & Market (40): can you actually get in and out?
//   Pillar 2 — Momentum (35): is there real, two-sided trading right now?
//   Pillar 3 — Trust & Age (25): distribution, market depth, sane maturity.

// Map a value onto 0..1 with a soft floor/ceiling (linear ramp between lo..hi).
function ramp(value, lo, hi) {
  if (value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

// ---- Pillar 1: Liquidity & Market (max 40) -------------------------------
function scoreLiquidity(m, lock) {
  const reasons = [];
  // Liquidity depth (0..18): $1k -> 0, $250k+ -> full.
  const liq = ramp(m.liquidityUsd, 1_000, 250_000) * 18;
  reasons.push(`Liquidity $${Math.round(m.liquidityUsd).toLocaleString()} → ${liq.toFixed(1)}/18`);

  // 24h volume (0..10): $5k -> 0, $1M+ -> full.
  const vol = ramp(m.volume.h24, 5_000, 1_000_000) * 10;
  reasons.push(`24h volume $${Math.round(m.volume.h24).toLocaleString()} → ${vol.toFixed(1)}/10`);

  // Volume/Liquidity turnover (0..6): healthy churn without being a wash farm.
  const turnover = m.liquidityUsd > 0 ? m.volume.h24 / m.liquidityUsd : 0;
  const turn = ramp(turnover, 0.2, 3) * 6;
  reasons.push(`Turnover ${turnover.toFixed(2)}x → ${turn.toFixed(1)}/6`);

  // LP lock (0..6): locked/burned liquidity can't be rug-pulled. Without
  // RugCheck data, give a neutral 3 so unknowns aren't unfairly punished.
  let lockScore;
  if (lock && typeof lock.lockedPct === "number") {
    lockScore = ramp(lock.lockedPct, 0, 100) * 6;
    reasons.push(`LP locked ${lock.lockedPct}% (${lock.status}) → ${lockScore.toFixed(1)}/6`);
  } else {
    lockScore = 3;
    reasons.push(`LP lock n/a (RugCheck unavailable) → neutral 3/6`);
  }

  return { score: liq + vol + turn + lockScore, max: 40, reasons };
}

// ---- Pillar 2: Momentum (max 35) -----------------------------------------
function scoreMomentum(m) {
  const reasons = [];
  // Short-term price action (0..15): blend of 1h & 6h, capped.
  const trend = (m.priceChange.h1 + m.priceChange.h6) / 2;
  const mom = ramp(trend, -10, 60) * 15;
  reasons.push(`1h/6h change ${trend.toFixed(1)}% → ${mom.toFixed(1)}/15`);

  // Buy/sell balance (0..12): reward buy pressure, punish one-sided dumping.
  const { buys, sells } = m.txns24h;
  const totalTx = buys + sells;
  const buyRatio = totalTx > 0 ? buys / totalTx : 0.5;
  const balance = ramp(buyRatio, 0.35, 0.65) * 12;
  reasons.push(`Buy ratio ${(buyRatio * 100).toFixed(0)}% (${buys}/${totalTx}) → ${balance.toFixed(1)}/12`);

  // Activity (0..8): enough trades to mean something.
  const activity = ramp(totalTx, 50, 1500) * 8;
  reasons.push(`24h trades ${totalTx} → ${activity.toFixed(1)}/8`);

  return { score: mom + balance + activity, max: 35, reasons };
}

// ---- Pillar 3: Trust & Age (max 25) --------------------------------------
function scoreTrust(m, holders, nowMs) {
  const reasons = [];
  // Pair maturity (0..10): rewards a sweet spot — old enough to not be a
  // 5-minute honeypot, young enough to still be a "gem" (peaks ~2h–7d).
  let ageScore = 0;
  if (m.pairCreatedAt && nowMs) {
    const ageHours = (nowMs - m.pairCreatedAt) / 3_600_000;
    if (ageHours < 0.5) ageScore = 2;
    else if (ageHours < 2) ageScore = 6;
    else if (ageHours <= 168) ageScore = 10; // 2h .. 7d
    else if (ageHours <= 720) ageScore = 7;  // up to 30d
    else ageScore = 5;
    reasons.push(`Pair age ${ageHours.toFixed(1)}h → ${ageScore}/10`);
  } else {
    ageScore = 4;
    reasons.push(`Pair age unknown → 4/10`);
  }

  // Market depth across DEXes (0..7): listed on more than one pool = healthier.
  const depth = ramp(m.pairCount, 1, 4) * 7;
  reasons.push(`Listed on ${m.pairCount} pair(s) → ${depth.toFixed(1)}/7`);

  // Holder distribution (0..8): needs Solscan. Without it, give a neutral 4.
  let dist = 4;
  if (holders && holders.holderCount) {
    dist = ramp(holders.holderCount, 50, 3000) * 8;
    reasons.push(`Holders ${holders.holderCount.toLocaleString()} → ${dist.toFixed(1)}/8`);
  } else {
    reasons.push(`Holders n/a (no Solscan Pro key) → neutral 4/8`);
  }

  return { score: ageScore + depth + dist, max: 25, reasons };
}

function verdict(score) {
  if (score >= 70) return { label: "STRONG", action: "Consider entry (DYOR)", emoji: "🟢" };
  if (score >= 50) return { label: "WATCH", action: "Watchlist — wait for confirmation", emoji: "🟡" };
  return { label: "SKIP", action: "High risk — likely skip", emoji: "🔴" };
}

/**
 * Compute the full GEM Score report for a token.
 * @param {object} metrics  output of fetchDexScreener()
 * @param {object|null} holders  output of fetchSolscanHolders()
 * @param {number} nowMs  current epoch ms (passed in from the edge)
 * @param {object|null} lock  output of fetchRugcheckLock()
 */
export function computeGemScore(metrics, holders, nowMs, lock) {
  const p1 = scoreLiquidity(metrics, lock);
  const p2 = scoreMomentum(metrics);
  const p3 = scoreTrust(metrics, holders, nowMs);
  const total = Math.round(p1.score + p2.score + p3.score);

  return {
    token: {
      address: metrics.address,
      name: metrics.name,
      symbol: metrics.symbol,
      logoUrl: metrics.logoUrl || null,
      priceUsd: metrics.priceUsd,
      url: metrics.url,
      pairAddress: metrics.pairAddress,
      // Embeddable DexScreener chart for the deepest pair (null if unknown).
      chartUrl: metrics.pairAddress
        ? `https://dexscreener.com/solana/${metrics.pairAddress}?embed=1&theme=dark&info=0&trades=0`
        : null,
    },
    gemScore: total,
    verdict: verdict(total),
    liquidityLock: lock
      ? {
          lockedPct: lock.lockedPct,
          lockedUsd: lock.lockedUsd,
          totalLpUsd: lock.totalLpUsd,
          status: lock.status,
          rugged: lock.rugged,
          source: "RugCheck",
        }
      : null,
    pillars: [
      { name: "Liquidity & Market", weight: 40, score: Number(p1.score.toFixed(1)), reasons: p1.reasons },
      { name: "Momentum", weight: 35, score: Number(p2.score.toFixed(1)), reasons: p2.reasons },
      { name: "Trust & Age", weight: 25, score: Number(p3.score.toFixed(1)), reasons: p3.reasons },
    ],
    metrics,
    disclaimer:
      "GEM Score is a heuristic from public market data, not financial advice. " +
      "Memecoins can go to zero. Always DYOR and only risk what you can lose.",
  };
}
