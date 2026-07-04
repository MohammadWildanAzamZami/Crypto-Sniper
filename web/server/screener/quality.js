// Quality gate — the hard anti-junk filter the Pro Radar applies AFTER full
// enrichment (liquidity lock included). The GEM Score and the AI ranking are
// soft/relative; this gate is a set of non-negotiable red lines that keep
// obvious rugs, dead pairs, and honeypot-shaped tokens off the radar entirely.
//
// Thresholds come from the self-tuning `learn.js` store, so the gate tightens
// itself over time as past picks are graded. Everything here is heuristic — it
// reduces junk, it does not guarantee a winner. Not financial advice.

const money = (n) => "$" + Math.round(n || 0).toLocaleString();

/**
 * Evaluate one fully-enriched report against the current (tuned) thresholds.
 * @param {object} report  a screenToken() report (metrics + liquidityLock)
 * @param {object} tuning  { minLiquidity, minVolume, minTx, minLockedPct }
 * @returns {{ ok: boolean, rejects: string[] }}
 */
export function qualityGate(report, tuning) {
  const m = report?.metrics || {};
  const lock = report?.liquidityLock || null;
  const rejects = [];

  const mc = m.marketCap || 0;
  const liq = m.liquidityUsd || 0;
  const vol = m.volume?.h24 || 0;
  const { buys = 0, sells = 0 } = m.txns24h || {};
  const tx = buys + sells;
  const ratio = tx > 0 ? buys / tx : 0.5;

  // Hard rug flag from RugCheck — never surface these.
  if (lock?.rugged) rejects.push("ditandai rugged (RugCheck)");

  // A token with no real market cap can't be valued or exited safely.
  if (mc <= 0) rejects.push("market cap tak diketahui");

  // Liquidity you can actually exit into.
  if (liq < tuning.minLiquidity) rejects.push(`likuiditas ${money(liq)} < ${money(tuning.minLiquidity)}`);

  // Dead pairs: no volume / no trades = nobody's really trading it.
  if (vol < tuning.minVolume) rejects.push(`volume 24j ${money(vol)} terlalu rendah`);
  if (tx < tuning.minTx) rejects.push(`transaksi 24j sedikit (${tx})`);

  // Extreme one-sidedness: ~all-buys can be a honeypot (can't sell), ~all-sells
  // is an active dump. Healthy trading is two-sided.
  if (tx >= tuning.minTx) {
    if (ratio > 0.92) rejects.push(`hampir semua beli (${Math.round(ratio * 100)}%) — indikasi honeypot`);
    else if (ratio < 0.12) rejects.push(`hampir semua jual (${Math.round(ratio * 100)}% beli) — sedang didump`);
  }

  // Liquidity lock: only enforce when RugCheck actually returned a figure (it's
  // often missing). Unknown lock is allowed through but scored lower elsewhere.
  if (lock && typeof lock.lockedPct === "number" && lock.lockedPct < tuning.minLockedPct) {
    rejects.push(`LP locked ${lock.lockedPct}% < ${tuning.minLockedPct}%`);
  }

  return { ok: rejects.length === 0, rejects };
}
