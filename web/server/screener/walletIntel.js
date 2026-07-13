// Wallet Intelligence v2 — reputasi "akurasi terbukti + bukan pelaku", bukan
// sekadar hitung tembakan kena. Mengganti model lama (catch-count) dengan pipeline:
//
//   1. Kandidat masuk lewat 2 pintu: hasil Bedah winner (Modul A/B, sudah ada) +
//      kemunculan-berulang sebagai early buyer lintas token (recordEarlySighting —
//      bookkeeping murni, NOL call API di jalur ini).
//   2. Vetting "KTP": umur tx pertama-terlihat, rentang aktivitas 20 tx, sumber
//      dana lapis-1 (pengirim SOL masuk pertama; induk sama lintas kandidat =
//      sharedFunding, indikasi sybil).
//   3. AUDIT AKURASI retrospektif: riwayat auditLookbackDays hari → entry early
//      (mcap saat beli < AUDIT_EARLY_MCAP, definisi sama dengan autopsy.js) →
//      hit-rate = winner ÷ semua entry early. Reputasi instan dari sejarah.
//   4. Klasifikasi SMART_MONEY / INSIDER / REJECTED / UNRATED. Insider TIDAK
//      dibuang — tetap dipantau, sinyalnya berlabel ⚠ (lihat sniper.js).
//   5. Siklus hidup: CANDIDATE → QUARANTINE (bobot 50%) → ACTIVE → EVICTED;
//      fast-track untuk bukti sejarah kuat (bobot 80%, karantina 1 sinyal).
//   6. Umpan balik: hasil grading sniperTrack mengkredit/mendebit reputasi wallet
//      pemicu sinyal; reputasi decay eksponensial (half-life dari registry).
//
// Semua angka tunable dari walletIntelParams.js (env seed + live-editable).
// Persistensi .wallet-intel.json, fallback in-memory — persis pola sniperTrack.js.
// Semua fungsi degrade aman: tanpa key / HTTP gagal → hasil netral, tak pernah
// throw ke caller. Heuristik on-chain, BUKAN nasihat keuangan.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getWiParams } from "./walletIntelParams.js";
import { getParams } from "./sniperParams.js";
import { getWalletsRaw } from "./watchlist.js";
import { fetchDexScreener } from "./sources.js";

const FILE_PATH = fileURLToPath(new URL("./.wallet-intel.json", import.meta.url));

const HELIUS = "https://api.helius.xyz";

// Batas struktural (BUKAN knob sinyal — kapasitas/anggaran, seperti POOL di
// sniper.js; semua ambang keputusan ada di registry walletIntelParams.js):
const VET_TX_LIMIT = 20;          // tx untuk vetting (spek: "rentang 20 tx terakhir")
const AUDIT_TX_LIMIT = 100;       // tx riwayat maksimal yang ditarik saat audit
const AUDIT_MAX_MINTS = 12;       // token unik maksimal yang dicek nasibnya per audit
const DEPLOYER_MAX_MINTS = 6;     // token early maksimal yang dicek deployer-nya
const AUDIT_EARLY_MCAP = 100_000; // definisi "early" by-mcap — SAMA dengan EARLY_MCAP autopsy.js
const POOL = 5;                   // concurrency fetch (burst safety)
const MAX_SIGHTINGS = 40;         // kemunculan early tersimpan per wallet
const MAX_PROCESSED_TRACK = 2000; // cap set id record track yang sudah diproses
const MAX_QUEUE_ATTEMPTS = 3;     // audit gagal (API) dicoba ulang maksimal segini
// Fast-track (bagian dari definisi fastTrackSample di spek/registry-hint):
const FAST_TRACK_HITRATE_PCT = 40; // hit-rate minimal bukti sejarah kuat
const FAST_TRACK_WEIGHT_PCT = 80;  // bobot karantina wallet fast-track
const FAST_TRACK_QUARANTINE = 1;   // cukup 1 sinyal ternilai sebelum ACTIVE

const DAY_MS = 24 * 60 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mint yang bukan "gem" — wSOL + stables (sama dengan sniper.js).
const WSOL = "So11111111111111111111111111111111111111112";
const STABLE_USD = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      return res;
    } catch (e) {
      if (i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      throw e;
    }
  }
}

async function mapPool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- Store ------------------------------------------------------------------
// record per wallet:
// { owner, status: CANDIDATE|QUARANTINE|ACTIVE|EVICTED,
//   klass: UNRATED|SMART_MONEY|INSIDER|REJECTED,
//   sightings: [{mint, at}], vet: {...}|null, audit: {...}|null,
//   reputation (0–100, basis decay), repAt (anchor decay),
//   gradedSignals, fastTracked, source, createdAt, updatedAt }
let wallets = new Map();
let processedTrack = new Set(); // id record sniperTrack yang sudah dikredit/didebit
let queue = [];                 // [{ owner, attempts }] — antrean vet+audit berjatah
let migrated = false;

try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (Array.isArray(saved.wallets)) wallets = new Map(saved.wallets.map((w) => [w.owner, w]));
  if (Array.isArray(saved.processedTrack)) processedTrack = new Set(saved.processedTrack);
  if (Array.isArray(saved.queue)) queue = saved.queue.filter((q) => q && q.owner);
  migrated = saved.migrated === true;
} catch { /* belum ada file — mulai kosong, migrasi jalan di bawah */ }

let saveTimer = null;
function save() {
  try {
    writeFileSync(FILE_PATH, JSON.stringify({
      migrated,
      wallets: [...wallets.values()],
      processedTrack: [...processedTrack].slice(-MAX_PROCESSED_TRACK),
      queue,
    }, null, 2), "utf8");
  } catch { /* FS read-only/ephemeral — state bertahan in-memory */ }
}
// Debounce untuk jalur panas (recordEarlySighting dipanggil berkali-kali per siklus
// discovery) — satu tulisan per burst, bukan per sighting.
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

function newRecord(owner, now, source) {
  return {
    owner, status: "CANDIDATE", klass: "UNRATED",
    sightings: [], vet: null, audit: null,
    reputation: 0, repAt: now,
    gradedSignals: 0, fastTracked: false,
    source, createdAt: now, updatedAt: now,
  };
}

// ---- Migrasi sekali jalan ----------------------------------------------------
// Anggota watchlist lama otomatis berstatus QUARANTINE (data lama TIDAK dihapus):
// reputasi lama dibawa sebagai basis, sightings di-seed dari catches — jadi mereka
// tetap ikut skor sinyal (dengan bobot karantina) sampai teraudit/ternilai.
function migrateOnce(nowMs) {
  if (migrated) return;
  const now = nowMs ?? Date.now();
  try {
    for (const w of getWalletsRaw()) {
      if (wallets.has(w.owner)) continue;
      const rec = newRecord(w.owner, now, "migrasi");
      rec.status = "QUARANTINE";
      rec.reputation = Math.max(0, Math.min(100, Number(w.reputation) || 0));
      rec.repAt = now;
      for (const c of w.catches || []) {
        if (c?.mint && !rec.sightings.some((s) => s.mint === c.mint)) rec.sightings.push({ mint: c.mint, at: c.at || now });
      }
      wallets.set(w.owner, rec);
    }
    migrated = true;
    save();
  } catch { /* watchlist belum siap — coba lagi di tick berikutnya */ }
}
migrateOnce();

// ---- 1) Pintu masuk: kemunculan berulang --------------------------------------
/**
 * Catat satu kemunculan wallet sebagai early buyer di sebuah mint. Dipanggil dari
 * jalur yang SUDAH menarik top_traders/autopsy (discoverWallets, Bedah manual) —
 * murni bookkeeping, NOL call API. Dedupe per mint. Saat kemunculan lintas token
 * mencapai recurMinHits → wallet diantrekan untuk vetting + audit (berjatah).
 * Tidak pernah throw.
 */
export function recordEarlySighting(owner, mint, nowMs) {
  try {
    if (typeof owner !== "string" || !owner || typeof mint !== "string" || !mint) return;
    const now = nowMs ?? Date.now();
    let rec = wallets.get(owner);
    if (!rec) { rec = newRecord(owner, now, "sighting"); wallets.set(owner, rec); }
    if (rec.sightings.some((s) => s.mint === mint)) return; // sudah tercatat untuk mint ini
    rec.sightings.push({ mint, at: now });
    if (rec.sightings.length > MAX_SIGHTINGS) rec.sightings = rec.sightings.slice(-MAX_SIGHTINGS);
    rec.updatedAt = now;
    const P = getWiParams();
    const auditedSightings = rec.audit?.sightingsAtAudit ?? -Infinity;
    const dueForAudit = rec.audit == null || rec.sightings.length >= auditedSightings + P.recurMinHits;
    if (rec.sightings.length >= P.recurMinHits && rec.status !== "EVICTED" && dueForAudit
        && !queue.some((q) => q.owner === owner)) {
      queue.push({ owner, attempts: 0 });
    }
    saveSoon();
  } catch { /* jangan pernah ganggu jalur pemanggil */ }
}

// ---- 2) Vetting KTP ------------------------------------------------------------
/**
 * Vetting identitas on-chain: umur first-seen + rentang aktivitas dari VET_TX_LIMIT
 * tx terakhir (pola heliusTxCount autopsy.js), plus penelusuran dana lapis-1 —
 * pengirim transfer SOL masuk paling awal yang terlihat. Catatan: umur dari 20 tx
 * terakhir adalah BATAS BAWAH (wallet sangat aktif terlihat lebih muda) — bias
 * konservatifnya menolak, dan wallet yang benar akan lolos saat aktivitasnya wajar.
 * Tanpa key / HTTP gagal → { pass: null } (netral, tidak menolak). Tidak pernah throw.
 */
export async function vetWallet(owner, { heliusKey } = {}, nowMs) {
  const now = nowMs ?? Date.now();
  const P = getWiParams();
  const neutral = { at: now, ageDays: null, spanDays: null, txSeen: 0, fundingParent: null, sharedFunding: false, pass: null, reasons: ["Helius tidak tersedia — vetting netral"] };
  if (!heliusKey) return neutral;
  try {
    const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${heliusKey}&limit=${VET_TX_LIMIT}`, {
      headers: { accept: "application/json" },
    });
    if (!res || !res.ok) return neutral;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return { ...neutral, txSeen: 0, reasons: ["belum ada riwayat tx terlihat"] };

    const times = arr.map((t) => Number(t.timestamp) || 0).filter(Boolean);
    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const ageDays = Number(((now / 1000 - oldest) / 86400).toFixed(1));
    const spanDays = Number(((newest - oldest) / 86400).toFixed(1));

    // Funding lapis-1: dari tx TERTUA yang terlihat, pengirim SOL masuk pertama.
    let fundingParent = null;
    if (P.fundingCheckDepth > 0) {
      const asc = [...arr].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
      outer: for (const tx of asc) {
        for (const n of tx.nativeTransfers || []) {
          if (n.toUserAccount === owner && n.fromUserAccount && n.fromUserAccount !== owner) {
            fundingParent = n.fromUserAccount;
            break outer;
          }
        }
      }
    }

    const reasons = [];
    if (ageDays < P.minWalletAgeDays) reasons.push(`umur ~${ageDays}h < ${P.minWalletAgeDays}h`);
    if (spanDays < P.minTxSpanDays) reasons.push(`rentang aktivitas ~${spanDays}h < ${P.minTxSpanDays}h`);

    // sharedFunding: induk dana yang sama dengan kandidat LAIN = indikasi jaringan
    // sybil satu operator. Ditandai (dipakai classifier), bukan langsung menolak.
    let sharedFunding = false;
    if (fundingParent) {
      for (const other of wallets.values()) {
        if (other.owner !== owner && other.vet?.fundingParent === fundingParent) {
          sharedFunding = true;
          other.vet.sharedFunding = true;
          break;
        }
      }
    }

    return { at: now, ageDays, spanDays, txSeen: arr.length, fundingParent, sharedFunding, pass: reasons.length === 0, reasons };
  } catch {
    return neutral;
  }
}

// ---- 3) Audit akurasi retrospektif ---------------------------------------------
// Ekstrak BELI dari satu enhanced-tx Helius: owner membayar (SOL/wSOL/stable keluar)
// DAN menerima token non-stable di tx yang sama. Versi ringkas parseTxSwaps sniper.js
// (audit hanya butuh sisi beli; tanpa filter dust/net yang memang knob sinyal live).
function extractBuys(tx, owner, solPrice) {
  const at = Number(tx.timestamp) || 0;
  let solOut = 0, wsolOut = 0, stableOut = 0;
  for (const n of tx.nativeTransfers || []) {
    if (n.fromUserAccount === owner) solOut += Number(n.amount) || 0; // lamports
  }
  const received = new Map();
  for (const t of tx.tokenTransfers || []) {
    const amt = Number(t.tokenAmount) || 0;
    if (amt <= 0) continue;
    if (t.fromUserAccount === owner) {
      if (t.mint === WSOL) wsolOut += amt;
      else if (STABLE_USD.has(t.mint)) stableOut += amt;
    } else if (t.toUserAccount === owner) {
      if (t.mint && t.mint !== WSOL && !STABLE_USD.has(t.mint)) {
        received.set(t.mint, (received.get(t.mint) || 0) + amt);
      }
    }
  }
  if (!(solOut > 0 || wsolOut > 0 || stableOut > 0) || received.size === 0) return [];
  const paidUsd = (solOut / 1e9 + wsolOut) * solPrice + stableOut;
  const single = received.size === 1;
  const out = [];
  for (const [mint, amt] of received) {
    out.push({ mint, at, tokens: amt, priceUsd: single && paidUsd > 0 && amt > 0 ? paidUsd / amt : null });
  }
  return out;
}

// Harga SOL saat ini via DexScreener wSOL (gratis, tanpa key). Aproksimasi untuk
// menilai USD beli historis — sama semangatnya dengan komentar C9 di sniper.js.
let solPriceCache = { v: 0, at: 0 };
async function solPriceUsd() {
  if (solPriceCache.v > 0 && Date.now() - solPriceCache.at < 5 * 60_000) return solPriceCache.v;
  try {
    const m = await fetchDexScreener(WSOL);
    if (m?.priceUsd > 0) solPriceCache = { v: m.priceUsd, at: Date.now() };
  } catch { /* pakai cache lama / 0 */ }
  return solPriceCache.v;
}

// Deployer sebuah mint — feePayer transaksi TERTUA mint itu (tx pembuat). Best-effort
// via RPC getSignaturesForAddress: hanya bisa yakin bila seluruh riwayat muat dalam
// satu halaman (≤1000 sig); lebih dalam dari itu → null (tak menebak). ≤2 call RPC.
async function deployerOf(mint, heliusKey) {
  if (!heliusKey) return null;
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  try {
    const sigRes = await fetchRetry(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [mint, { limit: 1000 }] }),
    });
    if (!sigRes || !sigRes.ok) return null;
    const sigs = (await sigRes.json())?.result;
    if (!Array.isArray(sigs) || sigs.length === 0 || sigs.length >= 1000) return null; // riwayat terpotong → tak yakin
    const oldest = sigs[sigs.length - 1]?.signature;
    if (!oldest) return null;
    const txRes = await fetchRetry(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [oldest, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
    });
    if (!txRes || !txRes.ok) return null;
    const keys = (await txRes.json())?.result?.transaction?.message?.accountKeys;
    const payer = Array.isArray(keys) ? keys.find((k) => k?.signer)?.pubkey : null;
    return payer || null;
  } catch {
    return null;
  }
}

/**
 * Audit akurasi historis satu wallet. Tarik riwayat tx (Helius), temukan entry early
 * (mcap saat beli < AUDIT_EARLY_MCAP — definisi sama dengan autopsy.js), cocokkan
 * nasib tiap token via DexScreener (harga kini vs saat beli; winner = ≥ winnerMinX
 * dari sniperParams). Juga kumpulkan indikator insider: beli pra-likuiditas
 * (pairCreatedAt) + hitungan deployer sama. MAHAL — panggil hanya lewat antrean
 * berjatah (walletIntelTick) atau endpoint manual. Tidak pernah throw.
 * @returns {{ sample, hits, hitRate, preliq, sameDeployerMax, mintsChecked, truncated, disabled? }}
 */
export async function auditWallet(owner, { heliusKey } = {}, nowMs) {
  const now = nowMs ?? Date.now();
  const P = getWiParams();
  const winnerMinX = getParams().winnerMinX;
  const empty = { at: now, lookbackDays: P.auditLookbackDays, sample: 0, hits: 0, hitRate: null, preliq: 0, sameDeployerMax: 0, mintsChecked: 0, truncated: false };
  if (!heliusKey) return { ...empty, disabled: true };
  try {
    const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${heliusKey}&limit=${AUDIT_TX_LIMIT}`, {
      headers: { accept: "application/json" },
    });
    if (!res || !res.ok) return empty;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return empty;

    const sinceSec = Math.floor(now / 1000) - P.auditLookbackDays * 86400;
    const sol = await solPriceUsd();

    // Beli per mint di dalam jendela — entry = beli PALING AWAL yang terlihat.
    const entries = new Map(); // mint → { at, priceUsd }
    for (const tx of arr) {
      if ((Number(tx.timestamp) || 0) < sinceSec) continue;
      for (const b of extractBuys(tx, owner, sol)) {
        const e = entries.get(b.mint);
        if (!e || b.at < e.at) entries.set(b.mint, { at: b.at, priceUsd: b.priceUsd });
      }
    }
    if (entries.size === 0) return empty;

    // Nasib tiap token (DexScreener, gratis) — dibatasi AUDIT_MAX_MINTS, terbaru dulu
    // (yang paling relevan dengan kebiasaan wallet sekarang).
    const mints = [...entries.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, AUDIT_MAX_MINTS);
    const truncated = entries.size > mints.length;

    const fates = await mapPool(mints, POOL, async ([mint, e]) => {
      const m = await fetchDexScreener(mint).catch(() => null);
      return { mint, entry: e, market: m };
    });

    let sample = 0, hits = 0, preliq = 0;
    const earlyMints = [];
    for (const f of fates) {
      if (!f) continue;
      const { entry, market } = f;
      if (!market || !(market.priceUsd > 0) || !(entry.priceUsd > 0)) continue; // tak ternilai → bukan sampel
      const supply = market.marketCap > 0 ? market.marketCap / market.priceUsd : 0;
      const mcapAtBuy = supply > 0 ? entry.priceUsd * supply : 0;
      if (!(mcapAtBuy > 0) || mcapAtBuy >= AUDIT_EARLY_MCAP) continue; // bukan entry early
      sample++;
      earlyMints.push(f.mint);
      if (market.priceUsd / entry.priceUsd >= winnerMinX) hits++;
      // Pra-likuiditas: beli SEBELUM pool publik tercatat ada.
      if (market.pairCreatedAt > 0 && entry.at * 1000 < market.pairCreatedAt) preliq++;
    }

    // Deployer sama — hanya dicek bila deteksinya relevan (param aktif) dan ada
    // cukup token early; dibatasi DEPLOYER_MAX_MINTS (≤2 call RPC per token).
    let sameDeployerMax = 0;
    if (earlyMints.length >= P.insiderSameDeployerMin) {
      const deps = await mapPool(earlyMints.slice(0, DEPLOYER_MAX_MINTS), 2, (m) => deployerOf(m, heliusKey));
      const count = new Map();
      for (const d of deps) if (d) count.set(d, (count.get(d) || 0) + 1);
      for (const n of count.values()) if (n > sameDeployerMax) sameDeployerMax = n;
    }

    return {
      at: now, lookbackDays: P.auditLookbackDays,
      sample, hits,
      hitRate: sample > 0 ? Number(((hits / sample) * 100).toFixed(1)) : null,
      preliq, sameDeployerMax,
      mintsChecked: mints.length, truncated,
    };
  } catch {
    return empty;
  }
}

// ---- 4) Klasifikasi --------------------------------------------------------------
/**
 * SMART_MONEY / INSIDER / REJECTED / UNRATED dari hasil vet + audit.
 * Insider menang atas smart money (akurasinya bukan analisis); vet gagal = REJECTED;
 * data kurang = UNRATED (bukan hukuman — menunggu sampel).
 */
export function classifyWallet({ vet, audit } = {}) {
  const P = getWiParams();
  if (vet && vet.pass === false) return "REJECTED"; // gagal KTP: terlalu muda / burner
  const a = audit;
  if (!a || a.disabled) return "UNRATED";
  if (P.insiderPreliq && a.preliq > 0) return "INSIDER";
  if (a.sameDeployerMax >= P.insiderSameDeployerMin) return "INSIDER";
  if (a.sample < P.auditMinSample) return "UNRATED";
  return a.hitRate >= P.hitrateMinPct ? "SMART_MONEY" : "REJECTED";
}

// ---- 5) Siklus hidup ---------------------------------------------------------------
function decayFactor(rec, now, P) {
  const elapsed = Math.max(0, now - (rec.repAt || now));
  return Math.pow(0.5, elapsed / (P.repDecayHalflifeDays * DAY_MS));
}

function statusWeight(rec, P) {
  if (rec.status === "EVICTED" || rec.klass === "REJECTED") return 0;
  if (rec.status === "ACTIVE") return 1;
  // CANDIDATE (belum divetting) diperlakukan sehati-hati karantina.
  const pct = rec.fastTracked ? FAST_TRACK_WEIGHT_PCT : P.quarantineWeightPct;
  return pct / 100;
}

/**
 * Reputasi EFEKTIF sebuah wallet: basis × decay half-life × bobot status.
 * Wallet yang tak dikenal intel → `fallbackRep` (reputasi watchlist lama), sehingga
 * skor sinyal tetap bekerja untuk wallet yang belum melewati pipeline. Tidak throw.
 */
export function effectiveReputation(owner, fallbackRep = 0, nowMs) {
  try {
    const rec = wallets.get(owner);
    if (!rec) return fallbackRep;
    const now = nowMs ?? Date.now();
    const P = getWiParams();
    return Math.round(Math.max(0, Math.min(100, rec.reputation)) * decayFactor(rec, now, P) * statusWeight(rec, P));
  } catch {
    return fallbackRep;
  }
}

/** Kelas wallet untuk pelabelan sinyal (⚠ insider). "UNKNOWN" bila tak dikenal. */
export function getWalletClass(owner) {
  return wallets.get(owner)?.klass || "UNKNOWN";
}

// Rebase reputasi ke "sekarang": terapkan decay yang sudah berjalan ke basis, lalu
// geser anchor — supaya kredit/debit baru dijumlahkan ke nilai yang sudah membusuk.
function rebaseRep(rec, now, P) {
  rec.reputation = Math.max(0, Math.min(100, rec.reputation * decayFactor(rec, now, P)));
  rec.repAt = now;
}

// Terapkan hasil vet+audit ke record: klasifikasi, status, reputasi-dari-sejarah,
// fast-track. Dipakai tick antrean + endpoint audit manual.
function applyAssessment(rec, vet, audit, now) {
  const P = getWiParams();
  rec.vet = vet;
  rec.audit = { ...audit, sightingsAtAudit: rec.sightings.length };
  rec.klass = classifyWallet({ vet, audit });
  rec.updatedAt = now;

  if (rec.klass === "REJECTED") {
    rec.status = "EVICTED";
    rebaseRep(rec, now, P);
    return;
  }
  // Reputasi instan dari sejarah (hit-rate 0–100) — tidak menunggu sinyal live.
  if (audit && audit.hitRate != null) {
    rec.reputation = Math.max(0, Math.min(100, audit.hitRate));
    rec.repAt = now;
  }
  // Fast-track: bukti sejarah kuat & bukan insider → karantina 1 sinyal, bobot 80%.
  rec.fastTracked = rec.klass === "SMART_MONEY"
    && audit.sample >= P.fastTrackSample
    && audit.hitRate >= FAST_TRACK_HITRATE_PCT;
  if (rec.status === "CANDIDATE") rec.status = "QUARANTINE";
}

// ---- 6) Umpan balik track record ---------------------------------------------------
/**
 * Kredit/debit reputasi wallet pemicu dari hasil grading sniperTrack. Idempoten:
 * tiap record dikenali id `variant|mint|firstDetectedAt` dan hanya diproses sekali
 * (set persisten). Winner → +trackCredit per wallet; rug → −trackDebitRug. Sinyal
 * ternilai juga menaikkan hitungan promosi karantina; rep efektif di bawah
 * evictRepMin (untuk wallet yang SUDAH pernah diaudit/dinilai) → EVICTED.
 * Dipanggil sniperTrack.gradeMatured via dynamic import — tidak pernah throw.
 */
export function applyTrackFeedback(records, nowMs) {
  try {
    const now = nowMs ?? Date.now();
    const P = getWiParams();
    let applied = 0;
    for (const r of records || []) {
      if (!r?.outcome || !Array.isArray(r.wallets) || r.wallets.length === 0) continue;
      const id = `${r.variant}|${r.mint}|${r.firstDetectedAt}`;
      if (processedTrack.has(id)) continue;
      processedTrack.add(id);
      const delta = r.outcome.status === "win" ? P.trackCredit
        : r.outcome.status === "rug" ? -P.trackDebitRug
        : 0;
      for (const owner of r.wallets) {
        const rec = wallets.get(owner);
        if (!rec) continue;
        rebaseRep(rec, now, P);
        rec.reputation = Math.max(0, Math.min(100, rec.reputation + delta));
        rec.gradedSignals = (rec.gradedSignals || 0) + 1;
        rec.updatedAt = now;
        // Promosi: karantina selesai setelah cukup sinyal ternilai.
        const needed = rec.fastTracked ? FAST_TRACK_QUARANTINE : P.quarantineSignals;
        if (rec.status === "QUARANTINE" && rec.gradedSignals >= needed) rec.status = "ACTIVE";
        // Evict: hanya wallet yang sudah punya bukti (audit/nilai) — anggota migrasi
        // yang belum tersentuh tidak digusur diam-diam.
        if ((rec.audit || rec.gradedSignals > 0) && rec.status !== "EVICTED"
            && effectiveReputation(owner, 0, now) < P.evictRepMin) {
          rec.status = "EVICTED";
        }
        applied++;
      }
    }
    if (processedTrack.size > MAX_PROCESSED_TRACK) {
      processedTrack = new Set([...processedTrack].slice(-MAX_PROCESSED_TRACK));
    }
    if (applied > 0) save();
    return { applied };
  } catch {
    return { applied: 0 };
  }
}

// ---- Tick antrean (jatah audit per putaran) -----------------------------------------
let ticking = false;

/**
 * Satu putaran pipeline: proses maksimal auditMaxPerTick kandidat dari antrean —
 * vet → audit → klasifikasi → status. Audit MAHAL, jadi HANYA jalur ini (dan endpoint
 * manual) yang boleh memanggilnya — tidak pernah di jalur sweep/webhook. Fail-safe:
 * kandidat yang gagal karena API dicoba ulang tick berikutnya (maks MAX_QUEUE_ATTEMPTS).
 */
export async function walletIntelTick({ heliusKey } = {}, nowMs) {
  const now = nowMs ?? Date.now();
  migrateOnce(now);
  if (ticking) return { skipped: true, reason: "tick masih berjalan", queued: queue.length };
  ticking = true;
  const summary = { processed: 0, smart: 0, insider: 0, rejected: 0, unrated: 0, queued: 0 };
  try {
    const P = getWiParams();
    const batch = queue.splice(0, P.auditMaxPerTick);
    for (const item of batch) {
      const rec = wallets.get(item.owner);
      if (!rec || rec.status === "EVICTED") continue;
      const vet = await vetWallet(item.owner, { heliusKey }, now);
      // Vet netral (API mati) + audit kosong = tak ada data sama sekali → antre ulang.
      const audit = vet.pass === false ? null : await auditWallet(item.owner, { heliusKey }, now);
      const noData = vet.pass == null && (!audit || (audit.sample === 0 && audit.mintsChecked === 0));
      if (noData && item.attempts + 1 < MAX_QUEUE_ATTEMPTS) {
        queue.push({ owner: item.owner, attempts: item.attempts + 1 });
        continue;
      }
      // Vet gagal → audit dilewati (hemat kuota); audit kosong netral sebagai placeholder.
      const auditResult = audit || { at: now, lookbackDays: P.auditLookbackDays, sample: 0, hits: 0, hitRate: null, preliq: 0, sameDeployerMax: 0, mintsChecked: 0, truncated: false };
      applyAssessment(rec, vet, auditResult, now);
      summary.processed++;
      if (rec.klass === "SMART_MONEY") summary.smart++;
      else if (rec.klass === "INSIDER") summary.insider++;
      else if (rec.klass === "REJECTED") summary.rejected++;
      else summary.unrated++;
    }
    summary.queued = queue.length;
    if (summary.processed > 0 || batch.length > 0) save();
  } catch { /* tick tidak pernah melempar ke interval */ }
  ticking = false;
  return summary;
}

/**
 * Audit manual SATU wallet (endpoint POST /api/wallet-intel/audit/:wallet) —
 * langsung vet + audit + klasifikasi di luar antrean. Wallet yang belum dikenal
 * dibuatkan record (source "manual"). Mengembalikan record publiknya.
 */
export async function auditOne(owner, { heliusKey } = {}, nowMs) {
  const now = nowMs ?? Date.now();
  migrateOnce(now);
  let rec = wallets.get(owner);
  if (!rec) { rec = newRecord(owner, now, "manual"); wallets.set(owner, rec); }
  const vet = await vetWallet(owner, { heliusKey }, now);
  const audit = await auditWallet(owner, { heliusKey }, now);
  applyAssessment(rec, vet, audit, now);
  queue = queue.filter((q) => q.owner !== owner); // sudah tuntas — keluar dari antrean
  save();
  return toPublic(rec, now);
}

// ---- API bentuk publik ---------------------------------------------------------------
function toPublic(rec, now) {
  return {
    owner: rec.owner,
    status: rec.status,
    klass: rec.klass,
    reputation: Math.round(rec.reputation),
    effectiveRep: effectiveReputation(rec.owner, 0, now),
    fastTracked: rec.fastTracked,
    sightings: rec.sightings.length,
    gradedSignals: rec.gradedSignals || 0,
    hitRate: rec.audit?.hitRate ?? null,
    sample: rec.audit?.sample ?? null,
    preliq: rec.audit?.preliq ?? 0,
    sameDeployerMax: rec.audit?.sameDeployerMax ?? 0,
    sharedFunding: rec.vet?.sharedFunding === true,
    ageDays: rec.vet?.ageDays ?? null,
    auditedAt: rec.audit?.at ?? null,
    updatedAt: rec.updatedAt,
  };
}

/** Daftar intel untuk UI/API: wallet + status + hitRate + rep efektif, terurut. */
export function getWalletIntel({ limit = 200 } = {}) {
  const now = Date.now();
  migrateOnce(now);
  const P = getWiParams();
  const list = [...wallets.values()]
    .map((w) => toPublic(w, now))
    .sort((a, b) => b.effectiveRep - a.effectiveRep || b.reputation - a.reputation);
  const by = (k, v) => list.filter((w) => w[k] === v).length;
  return {
    total: list.length,
    queued: queue.length,
    counts: {
      smart: by("klass", "SMART_MONEY"), insider: by("klass", "INSIDER"),
      rejected: by("klass", "REJECTED"), unrated: by("klass", "UNRATED"),
      active: by("status", "ACTIVE"), quarantine: by("status", "QUARANTINE"),
      candidate: by("status", "CANDIDATE"), evicted: by("status", "EVICTED"),
    },
    params: { hitrateMinPct: P.hitrateMinPct, auditMinSample: P.auditMinSample, quarantineSignals: P.quarantineSignals, evictRepMin: P.evictRepMin },
    wallets: list.slice(0, limit),
  };
}
