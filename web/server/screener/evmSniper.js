// evmSniper.js — Sniper Live EVM (Robinhood Chain, LANGKAH #5, penutup). Cerminan
// sniper.js Solana di EVM: tiap sweep membaca transfer terbaru wallet AKTIF dari
// Watchlist EVM (Modul B EVM, top by reputasi), mendeteksi BELI, dan menaikkan SINYAL
// saat ≥ signalMin wallet berbeda membeli token fresh yang SAMA — "smart money sedang
// akumulasi sebelum pump". Kandidat di-gate lewat screen EVM (anti-rug heuristik).
//
// Deteksi beli (EVM): di Robinhood Chain, beli dibayar ETH native/WETH LEWAT ROUTER DEX,
// jadi dari sudut pandang tokentx pembeli HANYA muncul "IN <memecoin>" — leg WETH ada di
// router↔pool, bukan di wallet. Maka syarat lama "wallet mengirim WETH/USDG di tx yang sama"
// TAK PERNAH terpenuhi (itu sebab Sniper selalu kosong). Deteksi yang benar: BELI = tx yang
// DIINISIASI wallet (txlist: tx.from == wallet) di mana wallet MENERIMA token non-base yang
// tak ia kirim balik. tx.from == wallet inilah yang memisahkan beli-via-router dari airdrop/
// distribusi (yang diinisiasi executor lain). Semua degrade ke null/[]; sweep tak pernah
// melempar. Heuristik — bukan nasihat keuangan.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getActiveEvmWallets, getEvmWalletMeta } from "./evmWatchlist.js";
import { screenEvmToken } from "./evmScreen.js";

const BS = "https://robinhoodchain.blockscout.com";
const FILE_PATH = fileURLToPath(new URL("./.evm-sniper-state.json", import.meta.url));

// Token "consideration" (bukan gem) di Robinhood Chain: WETH + stable USDG.
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const BASE_TOKENS = new Set([WETH, USDG]);

// Tunables (env-overridable).
const SIGNAL_MIN = Number(process.env.RH_SNIPER_SIGNAL_MIN || 2);
const LOOKBACK_MIN = Number(process.env.RH_SNIPER_LOOKBACK_MIN || 180);
const RECENT_TX = Number(process.env.RH_SNIPER_RECENT_TX || 50);
const MAX_MCAP = Number(process.env.RH_SNIPER_MAX_MCAP || 5_000_000);
const MAX_ENRICH = Number(process.env.RH_SNIPER_MAX_ENRICH || 20);
const TTL_MIN = Number(process.env.RH_SNIPER_TTL_MIN || 720);
const SAFETY_GATE = process.env.RH_SNIPER_SAFETY_GATE !== "false";
const TRACK_HOLDING = process.env.RH_SNIPER_TRACK_HOLDING !== "false"; // default on
// Grace period: sinyal yang BARU terdeteksi kebal dari culling hold-reconciliation
// selama ini. Tanpa ini, wallet watchlist (scalper cepat) sering sudah jual saat sweep
// mengecek saldo → sinyal terhapus di sweep yang SAMA saat ia dibuat → panel selalu
// kosong. Grace memberi sinyal fresh waktu tampil dulu; culling tetap jalan setelah matang.
const HOLD_GRACE_MIN = Number(process.env.RH_SNIPER_HOLD_GRACE_MIN || 45);
const POOL = 5;

/** @type {Map<string, object>} token → signal */
let signals = new Map();
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.signals)) signals = new Map(saved.signals.map((s) => [s.token, s]));
} catch { /* start empty */ }
function save() {
  try { writeFileSync(FILE_PATH, JSON.stringify({ signals: [...signals.values()] }, null, 2), "utf8"); }
  catch { /* read-only FS */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON dengan retry pada 429/5xx/timeout (Blockscout publik sering limit saat
// sweep menembak banyak wallet beruntun). Null pada kegagalan permanen (fail-safe).
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
async function mapPool(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; } }
  });
  await Promise.all(workers);
  return out;
}

// Hash tx yang DIINISIASI wallet (tx.from == wallet) dalam window — dari txlist. Dipakai
// untuk memisahkan beli-via-router (wallet→router) dari airdrop/distribusi (diinisiasi
// executor lain, tak muncul sebagai self-init). Gagal fetch → Set kosong = konservatif:
// lebih baik lewatkan beli (false negative) daripada tampilkan airdrop sebagai "smart money
// beli" (false positive yang menyesatkan sniper).
async function selfInitiatedHashes(w, sinceSec) {
  const j = await jget(`${BS}/api?module=account&action=txlist&address=${w}&sort=desc&page=1&offset=${RECENT_TX}`);
  const rows = j?.result;
  const set = new Set();
  if (!Array.isArray(rows)) return set;
  for (const t of rows) {
    if ((Number(t.timeStamp) || 0) < sinceSec) continue;
    if ((t.from || "").toLowerCase() === w) set.add(t.hash);
  }
  return set;
}

// Beli terbaru sebuah wallet dalam window. Return [{ token, at }].
async function recentBuys(wallet, sinceSec) {
  const w = wallet.toLowerCase();
  const j = await jget(`${BS}/api?module=account&action=tokentx&address=${w}&sort=desc&page=1&offset=${RECENT_TX}`);
  const rows = j?.result;
  if (!Array.isArray(rows) || !rows.length) return [];
  // Kelompokkan per tx: token masuk vs keluar (dari sudut pandang wallet).
  const byTx = new Map();
  for (const t of rows) {
    const at = Number(t.timeStamp) || 0;
    if (at < sinceSec) continue;
    const mint = (t.contractAddress || "").toLowerCase();
    const to = (t.to || "").toLowerCase();
    const from = (t.from || "").toLowerCase();
    let g = byTx.get(t.hash);
    if (!g) { g = { in: new Set(), out: new Set(), at }; byTx.set(t.hash, g); }
    if (to === w) g.in.add(mint);
    if (from === w) g.out.add(mint);
  }
  // Kandidat = tx di mana wallet MENERIMA ≥1 token non-base yang tak ia kirim balik (bukan
  // jual). Leg pembayaran (ETH native/WETH) tak muncul di tokentx pembeli → tidak dituntut.
  const candidates = [];
  for (const [hash, g] of byTx) {
    const gems = [...g.in].filter((m) => m && !BASE_TOKENS.has(m) && !g.out.has(m));
    if (gems.length) candidates.push({ hash, gems, at: g.at });
  }
  if (!candidates.length) return [];
  // Saring airdrop: hanya hitung tx yang diinisiasi wallet sendiri. (txlist hanya di-fetch
  // untuk wallet yang memang punya kandidat — minoritas aktif — jadi beban API tetap rendah.)
  const selfInit = await selfInitiatedHashes(w, sinceSec);
  const buys = [];
  for (const c of candidates) {
    if (!selfInit.has(c.hash)) continue;         // diterima tapi bukan wallet yang inisiasi → airdrop
    for (const m of c.gems) buys.push({ token: m, at: c.at * 1000 });
  }
  return buys;
}

// Saldo token wallet SEKARANG (Etherscan-compat). null bila gagal → "unknown", tak
// pernah memicu penghapusan (fail-safe, seperti hold-tracking Solana).
async function tokenBalance(token, wallet) {
  const j = await jget(`${BS}/api?module=account&action=tokenbalance&contractaddress=${token}&address=${wallet}`);
  if (!j || j.status !== "1" || j.result == null) return null;
  return Number(j.result); // raw; kita hanya butuh >0
}

/**
 * Satu sweep monitor Sniper EVM. Baca beli wallet aktif Watchlist, kelompokkan per token,
 * naikkan sinyal saat ≥ SIGNAL_MIN wallet berbeda membeli token fresh yang sama & lolos gate.
 */
export async function runEvmSniperSweep({ nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const active = getActiveEvmWallets();
  if (active.length === 0) return { chain: "Robinhood Chain", swept: 0, candidates: 0, newSignals: 0, signals: getEvmSignals().signals };

  const sinceSec = Math.floor(now / 1000) - LOOKBACK_MIN * 60;

  // 1) Kumpulkan beli tiap wallet aktif.
  const perWallet = await mapPool(active, POOL, (w) => recentBuys(w, sinceSec).then((b) => ({ w: w.toLowerCase(), b })));

  // 2) Kelompokkan per token: wallet berbeda yang membeli + waktu terbaru.
  const byToken = new Map();
  for (const row of perWallet) {
    if (!row) continue;
    for (const buy of row.b) {
      let g = byToken.get(buy.token);
      if (!g) { g = { wallets: new Set(), lastAt: 0 }; byToken.set(buy.token, g); }
      g.wallets.add(row.w);
      if (buy.at > g.lastAt) g.lastAt = buy.at;
    }
  }

  // 3) Kandidat = token dengan ≥ SIGNAL_MIN wallet berbeda (konfluensi).
  const candidates = [...byToken.entries()]
    .filter(([, g]) => g.wallets.size >= SIGNAL_MIN)
    .sort((a, b) => b[1].wallets.size - a[1].wallets.size)
    .slice(0, MAX_ENRICH);

  // 4) Enrich + gate lewat screen EVM, lalu naikkan sinyal.
  let newSignals = 0;
  const screens = await mapPool(candidates, POOL, ([token]) => screenEvmToken(token).catch(() => null));
  candidates.forEach(([token, g], i) => {
    const scr = screens[i];
    if (!scr || scr.error) return;
    if (SAFETY_GATE && !scr.safety?.ok) return;                 // buang rug/high-risk
    const mcap = scr.metrics?.mcapUsd || 0;
    if (mcap > 0 && mcap > MAX_MCAP) return;                    // kebesaran = terlambat
    // Skor = Σ reputasi wallet (dari Watchlist EVM) + skor screen sebagai bumbu.
    const owners = [...g.wallets];
    const repSum = owners.reduce((s, o) => s + (getEvmWalletMeta(o).reputation || 0), 0);
    const score = Math.round(repSum + (scr.score || 0) * 0.5);
    const existing = signals.get(token);
    signals.set(token, {
      token,
      symbol: scr.symbol || scr.name || "",
      name: scr.name || "",
      chain: "Robinhood Chain",
      mcap,
      priceUsd: scr.metrics?.priceUsd || 0,
      liquidityUsd: scr.metrics?.liquidityUsd || 0,
      gemScore: scr.score ?? null,
      verdict: scr.verdict ?? null,
      safetyRisk: scr.safety?.risk ?? null,
      walletCount: g.wallets.size,
      wallets: owners,
      score,
      chartUrl: scr.metrics?.chartUrl || null,
      lastBuyAt: g.lastAt,
      firstDetectedAt: existing?.firstDetectedAt || now,
      updatedAt: now,
      isNew: !existing,
    });
    if (!existing) newSignals++;
  });

  // 4.5) Hold / exit reconciliation (parity Solana). Cek apakah wallet di balik tiap
  // sinyal masih memegang token on-chain. Buang sinyal saat wallet yang masih pegang
  // < SIGNAL_MIN dan sudah ada yang jual; pertahankan (refresh) selama ≥ SIGNAL_MIN
  // masih pegang. unknown (gagal fetch) tak pernah memicu penghapusan.
  if (TRACK_HOLDING && signals.size > 0) {
    const graceCutoff = now - HOLD_GRACE_MIN * 60_000;
    for (const [token, s] of signals) {
      const owners = s.wallets || [];
      if (!owners.length) continue;
      // Grace: jangan rekonsiliasi/hapus sinyal yang masih fresh — beri waktu tampil
      // dulu. Scalper watchlist sering sudah jual saat dicek; tanpa grace sinyal mati
      // di sweep yang sama saat dibuat. Setelah > HOLD_GRACE_MIN baru dieligibel culling.
      if ((s.firstDetectedAt || now) > graceCutoff) continue;
      const bals = await mapPool(owners, POOL, (o) => tokenBalance(token, o));
      let holders = 0, sold = 0, unknown = 0;
      owners.forEach((o, i) => {
        const b = bals[i];
        if (b == null) unknown++;
        else if (b > 0) holders++;
        else sold++;
      });
      s.holders = holders;
      s.soldOff = sold;
      if (unknown === 0 && sold > 0 && holders < SIGNAL_MIN) { signals.delete(token); continue; }
      if (s.updatedAt < now && holders > 0) s.updatedAt = now; // masih dipegang → jaga tetap tampil
    }
  }

  // 5) Kedaluwarsa berbasis waktu — FALLBACK saja saat hold-tracking OFF.
  if (!TRACK_HOLDING) {
    const cutoff = now - TTL_MIN * 60_000;
    for (const [token, s] of signals) if (s.updatedAt < cutoff) signals.delete(token);
  }

  save();
  return { chain: "Robinhood Chain", swept: active.length, candidates: candidates.length, newSignals, signals: getEvmSignals().signals };
}

/**
 * Purge on-demand: cek saldo on-chain SEMUA sinyal (abaikan grace) dan hapus token
 * yang smart money-nya sudah tidak ada — semua wallet di balik sinyal terkonfirmasi
 * jual (saldo 0, tanpa "unknown"). unknown (gagal fetch) tak pernah memicu hapus,
 * sejajar fail-safe hold-tracking sweep. Dipanggil dari endpoint admin.
 */
export async function purgeEvmSignals({ nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const removed = [];
  const kept = [];
  for (const [token, s] of signals) {
    const owners = s.wallets || [];
    if (!owners.length) continue;
    const bals = await mapPool(owners, POOL, (o) => tokenBalance(token, o));
    let holders = 0, sold = 0, unknown = 0;
    bals.forEach((b) => {
      if (b == null) unknown++;
      else if (b > 0) holders++;
      else sold++;
    });
    s.holders = holders;
    s.soldOff = sold;
    s.updatedAt = now;
    if (unknown === 0 && holders === 0) {
      signals.delete(token);
      removed.push({ token, symbol: s.symbol, soldOff: sold });
    } else {
      kept.push({ token, symbol: s.symbol, holders, soldOff: sold, unknown });
    }
  }
  save();
  return { chain: "Robinhood Chain", checked: removed.length + kept.length, removed, kept };
}

/** Sinyal live EVM (terkuat dulu), plus konfigurasi untuk UI. */
export function getEvmSignals() {
  // Urut: jumlah smart wallet (holders bila di-track, else walletCount) → skor → terbaru.
  const smCount = (s) => (s.holders != null ? s.holders : (s.walletCount || 0));
  const list = [...signals.values()].sort((a, b) =>
    smCount(b) - smCount(a) || (b.walletCount || 0) - (a.walletCount || 0) || (b.score || 0) - (a.score || 0) || b.updatedAt - a.updatedAt);
  return {
    chain: "Robinhood Chain",
    count: list.length,
    signalMin: SIGNAL_MIN,
    maxMcap: MAX_MCAP,
    lookbackMin: LOOKBACK_MIN,
    safetyGate: SAFETY_GATE,
    trackHolding: TRACK_HOLDING,
    holdGraceMin: HOLD_GRACE_MIN,
    signals: list,
  };
}
