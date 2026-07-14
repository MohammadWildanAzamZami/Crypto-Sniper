// Quality gate — the hard anti-junk filter the Pro Radar applies AFTER full
// enrichment (liquidity lock included). The GEM Score and the AI ranking are
// soft/relative; this gate is a set of non-negotiable red lines that keep
// obvious rugs, dead pairs, and honeypot-shaped tokens off the radar entirely.
//
// Ambang TETAP (self-tuning dihapus 2026-07-14): tidak lagi berubah sendiri dari
// hasil grading. Ubah GATE di bawah bila perlu. Selain anti-junk, gate ini juga
// menegakkan fokus TRENDING: trafik transaksi harus masih ramai SEKARANG
// (jam terakhir / 5 menit terakhir), bukan cuma ramai kemarin. Everything here
// is heuristic — it reduces junk, it does not guarantee a winner. NFA.

// Ambang gate kualitas + trending — satu-satunya sumber kebenaran.
export const GATE = {
  minLiquidity: 12_000,
  minVolume: 15_000,       // volume 24 jam
  minTx: 60,               // transaksi 24 jam
  minLockedPct: 20,
  minConviction: 45,       // lantai conviction AI (dipakai proRadar)
  minGem: 60,
  maxDrawdownFromAth: 80,
  requirePumpComplete: false,
  // Trending: trafik harus hidup sekarang, bukan cuma di angka 24 jam.
  minTxH1: 20,             // transaksi jam terakhir
  minVolH1: 2_000,         // volume USD jam terakhir
  minPaceH1: 0.35,         // laju 1 jam vs rata-rata harian (< berarti trafik sekarat)
};

const money = (n) => "$" + Math.round(n || 0).toLocaleString();

/**
 * Evaluate one fully-enriched report against the fixed thresholds.
 * @param {object} report  a screenToken() report (metrics + liquidityLock)
 * @param {object} tuning  ambang — default GATE
 * @returns {{ ok: boolean, rejects: string[] }}
 */
export function qualityGate(report, tuning = GATE) {
  const m = report?.metrics || {};
  const lock = report?.liquidityLock || null;
  const pump = report?.pumpfun || null;
  const gem = report?.gemScore || 0;
  const rejects = [];

  const mc = m.marketCap || 0;
  const liq = m.liquidityUsd || 0;
  const vol = m.volume?.h24 || 0;
  const { buys = 0, sells = 0 } = m.txns24h || {};
  const tx = buys + sells;
  const ratio = tx > 0 ? buys / tx : 0.5;

  // Hard rug flag from RugCheck — never surface these.
  if (lock?.rugged) rejects.push("ditandai rugged (RugCheck)");

  // GEM Score floor (self-tuned) — the overall heuristic quality bar.
  if (tuning.minGem && gem < tuning.minGem) rejects.push(`GEM ${gem} < ${tuning.minGem}`);

  // Pump.fun signals (only when the mint is a pump.fun token and data loaded).
  if (pump) {
    if (pump.banned) rejects.push("di-ban Pump.fun");
    if (pump.nsfw) rejects.push("ditandai NSFW (Pump.fun)");
    if (pump.hidden) rejects.push("disembunyikan Pump.fun");
    // Already pumped-and-dumped: far below its ATH market cap.
    if (typeof pump.drawdownFromAthPct === "number" && pump.drawdownFromAthPct >= tuning.maxDrawdownFromAth) {
      rejects.push(`sudah −${pump.drawdownFromAthPct}% dari ATH (dump)`);
    }
    // When strict, only trust graduated tokens (survived the bonding curve).
    if (tuning.requirePumpComplete && !pump.complete) rejects.push("belum graduate dari bonding curve");
  }

  // A token with no real market cap can't be valued or exited safely.
  if (mc <= 0) rejects.push("market cap tak diketahui");

  // Liquidity you can actually exit into.
  if (liq < tuning.minLiquidity) rejects.push(`likuiditas ${money(liq)} < ${money(tuning.minLiquidity)}`);

  // Dead pairs: no volume / no trades = nobody's really trading it.
  if (vol < tuning.minVolume) rejects.push(`volume 24j ${money(vol)} terlalu rendah`);
  if (tx < tuning.minTx) rejects.push(`transaksi 24j sedikit (${tx})`);

  // TRENDING: trafik harus masih ramai SEKARANG. Angka 24 jam bagus tapi jam
  // terakhirnya sepi = pump-nya sudah lewat — jangan tampilkan. Hanya ditegakkan
  // bila data per-jendela tersedia (metrics lama tanpa `txns` lolos apa adanya).
  if (m.txns?.h1) {
    const txH1 = (m.txns.h1.buys || 0) + (m.txns.h1.sells || 0);
    const volH1 = m.volume?.h1 || 0;
    if (tuning.minTxH1 && txH1 < tuning.minTxH1) {
      rejects.push(`trafik 1 jam terakhir sepi (${txH1} tx) — tren sudah lewat`);
    }
    if (tuning.minVolH1 && volH1 < tuning.minVolH1) {
      rejects.push(`volume 1 jam terakhir ${money(volH1)} — trafik mati`);
    }
    if (tuning.minPaceH1 && vol > 0) {
      const paceH1 = (volH1 * 24) / vol; // 1 = sama dengan rata-rata harian
      if (paceH1 < tuning.minPaceH1) {
        rejects.push(`laju 1 jam cuma ${Math.round(paceH1 * 100)}% dari rata-rata harian — melambat`);
      }
    }
  }

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
