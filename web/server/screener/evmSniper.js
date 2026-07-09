// evmSniper.js — Sniper Live EVM (Robinhood Chain, LANGKAH #5, penutup). Cerminan
// sniper.js Solana di EVM: tiap sweep membaca transfer terbaru wallet AKTIF dari
// Watchlist EVM (Modul B EVM, top by reputasi), mendeteksi BELI, dan menaikkan SINYAL
// saat ≥ signalMin wallet berbeda membeli token fresh yang SAMA — "smart money sedang
// akumulasi sebelum pump". Kandidat di-gate lewat screen EVM (anti-rug heuristik).
//
// Deteksi beli (EVM): kelompokkan tokentx per hash. Sebuah BELI = wallet MENERIMA token
// non-base DAN MENGIRIM base (WETH/USDG) di tx yang sama (bukan airdrop/kiriman).
// Semua degrade ke null/[]; sweep tak pernah melempar. Heuristik — bukan nasihat keuangan.

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

async function jget(url) {
  try { const r = await fetch(url, { headers: { accept: "application/json" } }); return r && r.ok ? await r.json() : null; }
  catch { return null; }
}
async function mapPool(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; } }
  });
  await Promise.all(workers);
  return out;
}

// Beli terbaru sebuah wallet dalam window: token non-base yang diterima dalam tx di mana
// wallet juga mengirim base (bayar). Return [{ token, at }].
async function recentBuys(wallet, sinceSec) {
  const w = wallet.toLowerCase();
  const j = await jget(`${BS}/api?module=account&action=tokentx&address=${w}&sort=desc&page=1&offset=${RECENT_TX}`);
  const rows = j?.result;
  if (!Array.isArray(rows) || !rows.length) return [];
  // Kelompokkan per tx: token masuk vs keluar.
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
  const buys = [];
  for (const g of byTx.values()) {
    const paidBase = [...g.out].some((m) => BASE_TOKENS.has(m)); // wallet membayar WETH/USDG
    if (!paidBase) continue;
    for (const m of g.in) {
      if (!m || BASE_TOKENS.has(m)) continue;                    // yang diterima = gem yang dibeli
      buys.push({ token: m, at: g.at * 1000 });
    }
  }
  return buys;
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

  // 5) Kedaluwarsa sinyal lama (TTL) agar daftar tetap segar.
  const cutoff = now - TTL_MIN * 60_000;
  for (const [token, s] of signals) if (s.updatedAt < cutoff) signals.delete(token);

  save();
  return { chain: "Robinhood Chain", swept: active.length, candidates: candidates.length, newSignals, signals: getEvmSignals().signals };
}

/** Sinyal live EVM (terkuat dulu), plus konfigurasi untuk UI. */
export function getEvmSignals() {
  const list = [...signals.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || b.updatedAt - a.updatedAt);
  return {
    chain: "Robinhood Chain",
    count: list.length,
    signalMin: SIGNAL_MIN,
    maxMcap: MAX_MCAP,
    lookbackMin: LOOKBACK_MIN,
    safetyGate: SAFETY_GATE,
    signals: list,
  };
}
