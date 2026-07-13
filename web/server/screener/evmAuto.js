// evmAuto.js — POWER: orkestrator otomatis ekosistem Robinhood Chain. Menyelesaikan
// masalah "watchlist kosong / wallet pasif": tiap tick ia otomatis mem-Bedah winner
// TRENDING terbaru → merekam early-buyer aktif ke Watchlist EVM → lalu Sniper sweep.
// Jadi watchlist tumbuh sendiri dari smart money yang BENAR-BENAR sedang aktif, dan
// sinyal muncul otomatis tanpa klik. Semua degrade aman; tak pernah melempar ke loop.

import { bedahEvmToken } from "./evmAutopsy.js";
import { recordEvmCandidates, evmWatchlistSize } from "./evmWatchlist.js";
import { runEvmSniperSweep, getEvmSignals } from "./evmSniper.js";

const GT = "https://api.geckoterminal.com/api/v2";
const NET = "robinhood";

// Ambang & batas (env-overridable).
const SEED_MIN_MCAP = Number(process.env.RH_SEED_MIN_MCAP || 250_000);   // winner trending untuk di-bedah
// Pool BARU ikut dipindai dengan ambang lebih rendah (setara ambang winner watchlist):
// winner muda terdeteksi lebih cepat → early buyer-nya masuk Watchlist lebih cepat,
// tanpa menunggu token naik ke daftar trending. Discovery jadi jalan terus sendiri.
const SEED_NEW_MIN_MCAP = Number(process.env.RH_SEED_NEW_MIN_MCAP || 100_000);
const SEED_MAX_BEDAH = Number(process.env.RH_SEED_MAX_BEDAH || 4);       // maks bedah per tick (hemat kuota)
const SEED_RESEED_MIN = Number(process.env.RH_SEED_RESEED_MIN || 360);   // jangan re-bedah token sama < ini (menit)
// Batas pertumbuhan: berhenti MENAMBAH wallet baru saat watchlist ≥ ini, supaya sweep
// (yang memantau SEMUA wallet) tak makin lama tanpa henti. Wallet yang sudah ada tetap
// dipantau — cap ini hanya menghentikan pertumbuhan, bukan memangkas.
const WATCHLIST_MAX = Number(process.env.RH_WATCHLIST_MAX || 300);

// Token yang sudah di-seed baru-baru ini (hindari re-bedah tiap tick).
const seededAt = new Map(); // token → ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON dengan retry pada 429/5xx/timeout (auto-pilot menembak Blockscout tiap
// tick; retry mencegah blip transien menggagalkan seed/sweep). Null = gagal permanen.
async function jget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(600 * (i + 1)); continue; }
      return r && r.ok ? await r.json() : null;
    } catch {
      if (i < tries - 1) { await sleep(600 * (i + 1)); continue; }
      return null;
    }
  }
  return null;
}

function tokenAddr(id) { if (!id) return null; const i = id.indexOf("_"); return i >= 0 ? id.slice(i + 1) : id; }

// Winner untuk di-Bedah: gabungan pool TRENDING (mcap ≥ SEED_MIN_MCAP) + pool BARU
// (mcap ≥ SEED_NEW_MIN_MCAP), dedupe per token. Dua sumber = discovery smart wallet
// berjalan terus otomatis dari dua arah: token yang sudah ramai DAN token muda yang
// baru saja terbukti naik.
async function trendingWinners() {
  const [tr, nw] = await Promise.all([
    jget(`${GT}/networks/${NET}/trending_pools?page=1`),
    jget(`${GT}/networks/${NET}/new_pools?page=1`),
  ]);
  const out = [];
  const seen = new Set();
  for (const { pools, min } of [
    { pools: tr?.data || [], min: SEED_MIN_MCAP },
    { pools: nw?.data || [], min: SEED_NEW_MIN_MCAP },
  ]) {
    for (const p of pools) {
      const a = p.attributes || {};
      const token = tokenAddr(p.relationships?.base_token?.data?.id);
      if (!token || seen.has(token)) continue;
      const mcap = Math.round(Number(a.market_cap_usd) || Number(a.fdv_usd) || 0);
      if (mcap < min) continue;
      seen.add(token);
      out.push({ token, mcap, name: a.name || "" });
    }
  }
  return out.sort((x, y) => y.mcap - x.mcap);
}

/**
 * Auto-seed: bedah winner trending yang belum di-seed baru-baru ini, rekam kandidatnya.
 * @returns {{winnersSeen:number, bedahed:number, recorded:number, tokens:string[]}}
 */
export async function autoSeedWatchlist({ nowMs } = {}) {
  const now = nowMs ?? Date.now();
  // Cap pertumbuhan: kalau watchlist sudah penuh, jangan seed lagi (tetap pantau yang ada).
  const size = evmWatchlistSize();
  if (size >= WATCHLIST_MAX) {
    return { winnersSeen: 0, bedahed: 0, recorded: 0, tokens: [], capped: true, size };
  }
  const winners = await trendingWinners();
  let bedahed = 0, recorded = 0;
  const tokens = [];
  for (const w of winners) {
    if (bedahed >= SEED_MAX_BEDAH) break;
    const last = seededAt.get(w.token) || 0;
    if (now - last < SEED_RESEED_MIN * 60_000) continue;   // baru di-seed → lewati
    // checkHolding:false → seeding cepat (tanpa ratusan call saldo); "masih pegang"
    // untuk seeding cukup dari soldPct window. Hold live tetap dicek nanti oleh Sniper.
    const bedah = await bedahEvmToken(w.token, { checkHolding: false });
    seededAt.set(w.token, now);
    if (bedah?.error) continue;
    const rec = recordEvmCandidates(bedah, now);
    bedahed++;
    recorded += rec.recorded;
    if (rec.recorded > 0) tokens.push(bedah.symbol || w.token.slice(0, 8));
  }
  return { winnersSeen: winners.length, bedahed, recorded, tokens };
}

// Status tick terakhir (untuk UI).
let lastTick = null;
let ticking = false; // mutex: cegah tick tumpang-tindih (background + manual) yang membanjiri Blockscout

export function isTicking() { return ticking; }

/** Satu putaran penuh: auto-seed watchlist → sniper sweep. */
export async function robinhoodTick({ nowMs } = {}) {
  if (ticking) return { ...(lastTick || {}), skipped: true, reason: "tick lain sedang berjalan" };
  ticking = true;
  const now = nowMs ?? Date.now();
  let seed = null, sweep = null;
  try {
    try { seed = await autoSeedWatchlist({ nowMs: now }); } catch { seed = { error: true }; }
    try { sweep = await runEvmSniperSweep({ nowMs: now }); } catch { sweep = { error: true }; }
    lastTick = {
      at: now,
      seededWinners: seed?.winnersSeen ?? 0,
      bedahed: seed?.bedahed ?? 0,
      recorded: seed?.recorded ?? 0,
      capped: Boolean(seed?.capped),
      watchlistSize: evmWatchlistSize(),
      watchlistMax: WATCHLIST_MAX,
      swept: sweep?.swept ?? 0,
      candidates: sweep?.candidates ?? 0,
      newSignals: sweep?.newSignals ?? 0,
      signalCount: getEvmSignals().count,
    };
    return lastTick;
  } finally {
    ticking = false;
  }
}

export function getLastTick() { return lastTick; }

// Background loop — jalan otomatis tiap RH_TICK_MIN menit (default 10). Panggil startEvmAuto()
// dari index.js. Tick pertama ditunda sebentar agar server siap lebih dulu.
const TICK_MIN = Number(process.env.RH_TICK_MIN || 10);
let timer = null;
export function startEvmAuto() {
  if (timer) return;
  const run = () => robinhoodTick().catch(() => {});
  setTimeout(run, 15_000);                       // tick pertama 15 dtk setelah boot
  timer = setInterval(run, TICK_MIN * 60_000);
  return { tickMin: TICK_MIN };
}
