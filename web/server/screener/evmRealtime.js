// evmRealtime.js — Watcher REAL-TIME Sniper EVM (Robinhood Chain). Menggantikan
// ketergantungan pada tick 10-menit untuk DETEKSI beli: poll eth_getLogs Blockscout
// tiap beberapa detik, saring event Transfer yang MASUK ke wallet Watchlist, verifikasi
// tx diinisiasi wallet sendiri (anti-airdrop, paritas aturan sweep), lalu naikkan sinyal
// Sniper Live SAAT ITU JUGA begitu ≥ signalMin wallet berbeda membeli token yang sama.
// Tick 10-menit (evmAuto) tetap jalan sebagai seeding watchlist + rekonsiliasi hold —
// bukan lagi satu-satunya jalur deteksi.
//
// Catatan RPC (hasil probing chain ini): /api/eth-rpc Blockscout MENDUKUNG filter array
// di topics (kegagalan sesekali = "Internal server error" transien → di-retry), tapi
// meng-cap hasil ±1000 log per call TANPA penanda — maka wallet difilter server-side
// (topic2 = array wallet watchlist, di-chunk), range blok di-chunk, dan chunk yang kena
// cap dipecah dua rekursif agar tak ada log yang lolos diam-diam. Chain ±10 blok/dtk
// dengan volume Transfer tinggi (bot). Semua degrade aman: gagal fetch → kursor blok
// tidak maju (blok itu dicoba lagi di putaran berikut).

import { getActiveEvmWallets } from "./evmWatchlist.js";
import { raiseEvmSignalNow, EVM_SIGNAL_MIN, EVM_LOOKBACK_MIN, EVM_BASE_TOKENS } from "./evmSniper.js";

const RPC = "https://robinhoodchain.blockscout.com/api/eth-rpc";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Tunables (env-overridable).
const POLL_SEC = Number(process.env.RH_RT_POLL_SEC || 12);          // jeda antar poll
const CHUNK_BLOCKS = Number(process.env.RH_RT_CHUNK_BLOCKS || 512); // ±50 dtk chain per chunk
const WALLET_CHUNK = Number(process.env.RH_RT_WALLET_CHUNK || 200); // wallet per filter topic2
const MAX_SPAN = Number(process.env.RH_RT_MAX_SPAN || 2048);        // batas kejar-ketinggalan per putaran
const BACKLOG_BLOCKS = Number(process.env.RH_RT_BACKLOG_BLOCKS || 600); // ±1 mnt ke belakang saat boot

let lastBlock = 0;        // kursor: blok terakhir yang sudah diproses
let polling = false;      // mutex antar-putaran
let lastPoll = null;      // status putaran terakhir (untuk UI)

/** @type {Map<string, Map<string, number>>} token → (wallet → waktu beli ms) */
const buys = new Map();
/** @type {Map<string, string|null>} txHash → tx.from (cache verifikasi self-init) */
const txFrom = new Map();
/** @type {Map<string, {wallets:number, at:number}>} token → raise terakhir (hindari re-screen tiap poll) */
const raisedMeta = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JSON-RPC dengan retry pada 429/5xx/timeout — Blockscout publik sering blip transien
// (paritas jget di evmSniper/evmAuto). null = gagal permanen (fail-safe).
async function rpc(method, params, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      if (j?.error && i < tries - 1) { await sleep(500 * (i + 1)); continue; } // "Internal server error" dkk.
      return j && j.result !== undefined ? j.result : null;
    } catch {
      if (i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      return null;
    }
  }
  return null;
}

const hex = (n) => "0x" + n.toString(16);
const topicAddr = (t) => (t && t.length === 66 ? "0x" + t.slice(26) : "").toLowerCase();

async function mapPool(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; } }
  });
  await Promise.all(workers);
  return out;
}

// Ambil log Transfer MASUK ke wallet2 (topic2 = array alamat ter-pad) dalam [from..to].
// Cap ±1000 log Blockscout → bila kena, pecah dua rekursif supaya tak ada yang terpotong
// diam-diam. null = gagal (jangan majukan kursor). Rekursi berhenti di 1 blok.
async function fetchTransferLogs(from, to, walletTopics) {
  const res = await rpc("eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, null, walletTopics] }]);
  if (!Array.isArray(res)) return null;
  if (res.length < 1000 || to <= from) return res;
  const mid = Math.floor((from + to) / 2);
  const [a, b] = await Promise.all([fetchTransferLogs(from, mid, walletTopics), fetchTransferLogs(mid + 1, to, walletTopics)]);
  if (!a || !b) return null;
  return a.concat(b);
}

function pruneOld(now) {
  const cutoff = now - EVM_LOOKBACK_MIN * 60_000;
  for (const [token, m] of buys) {
    for (const [w, at] of m) if (at < cutoff) m.delete(w);
    if (m.size === 0) buys.delete(token);
  }
  while (txFrom.size > 3000) txFrom.delete(txFrom.keys().next().value);
  for (const [t, r] of raisedMeta) if (r.at < cutoff) raisedMeta.delete(t);
}

/** Satu putaran watcher. Dipanggil interval; aman dipanggil manual. */
export async function evmRealtimePoll({ nowMs } = {}) {
  if (polling) return lastPoll;
  polling = true;
  const now = nowMs ?? Date.now();
  try {
    const active = getActiveEvmWallets();
    if (!active.length) { lastPoll = { at: now, skipped: "watchlist kosong" }; return lastPoll; }
    const activeSet = new Set(active.map((w) => w.toLowerCase()));

    const headHex = await rpc("eth_blockNumber", []);
    const head = headHex ? parseInt(headHex, 16) : 0;
    if (!head) { lastPoll = { at: now, error: "rpc blockNumber gagal" }; return lastPoll; }

    if (!lastBlock) lastBlock = Math.max(0, head - BACKLOG_BLOCKS);
    let from = lastBlock + 1;
    if (head < from) { lastPoll = { at: now, head, scanned: 0, matched: 0, raised: 0 }; return lastPoll; }
    if (head - from > MAX_SPAN) from = head - MAX_SPAN;   // ketinggalan jauh → lompat (tick 10-mnt menambal)

    // 1) Tarik log Transfer masuk ke wallet watchlist per chunk blok × chunk wallet.
    //    Chunk gagal → berhenti di situ, kursor hanya maju sampai chunk blok terakhir
    //    yang sukses penuh (tak ada blok/wallet yang terlewat diam-diam).
    const walletTopics = active.map((w) => "0x" + "0".repeat(24) + w.slice(2).toLowerCase());
    const logs = [];
    let processedTo = from - 1;
    outer: for (let a = from; a <= head; a += CHUNK_BLOCKS) {
      const b = Math.min(a + CHUNK_BLOCKS - 1, head);
      for (let i = 0; i < walletTopics.length; i += WALLET_CHUNK) {
        const part = await fetchTransferLogs(a, b, walletTopics.slice(i, i + WALLET_CHUNK));
        if (!part) break outer;
        logs.push(...part);
      }
      processedTo = b;
    }

    // 2) Saring: Transfer MASUK ke wallet watchlist, token non-base, bukan self-transfer.
    const hits = [];
    for (const lg of logs) {
      const token = (lg.address || "").toLowerCase();
      if (!token || EVM_BASE_TOKENS.has(token)) continue;
      const to = topicAddr(lg.topics?.[2]);
      if (!to || !activeSet.has(to)) continue;
      const fromAddr = topicAddr(lg.topics?.[1]);
      if (fromAddr === to) continue;
      hits.push({ token, wallet: to, tx: lg.transactionHash });
    }

    // 3) Anti-airdrop (paritas sweep): hanya hitung bila tx DIINISIASI wallet sendiri.
    //    Lookup tx.from di-pool paralel per tx UNIK — airdrop massal (1 tx → ratusan
    //    transfer) cukup satu lookup, jadi jumlah call tetap kecil meski log banyak.
    const uniqueTx = [...new Set(hits.map((h) => h.tx))].filter((t) => !txFrom.has(t));
    await mapPool(uniqueTx, 6, async (t) => {
      const tx = await rpc("eth_getTransactionByHash", [t]);
      txFrom.set(t, tx ? (tx.from || "").toLowerCase() : null);
    });
    let matched = 0;
    const touched = new Set();
    for (const h of hits) {
      if (txFrom.get(h.tx) !== h.wallet) continue;   // diterima tapi bukan inisiator → airdrop/distribusi
      let m = buys.get(h.token);
      if (!m) { m = new Map(); buys.set(h.token, m); }
      m.set(h.wallet, now);
      touched.add(h.token);
      matched++;
    }

    pruneOld(now);

    // 4) Konfluensi tercapai → naikkan sinyal SEKARANG. Re-raise token yang sama hanya
    //    bila ada wallet baru (hindari re-screen tiap poll saat wallet yang sama nyicil).
    let raised = 0;
    for (const token of touched) {
      const m = buys.get(token);
      if (!m || m.size < EVM_SIGNAL_MIN) continue;
      const prev = raisedMeta.get(token);
      if (prev && prev.wallets >= m.size) continue;
      const lastAt = Math.max(...m.values());
      const r = await raiseEvmSignalNow(token, [...m.keys()], lastAt, { nowMs: now });
      raisedMeta.set(token, { wallets: m.size, at: now });
      if (r.raised) raised++;
    }

    if (processedTo >= from) lastBlock = processedTo;
    lastPoll = {
      at: now, head, fromBlock: from, toBlock: processedTo,
      scanned: logs.length, matched, raised,
      bufferTokens: buys.size,
    };
    return lastPoll;
  } finally {
    polling = false;
  }
}

export function getEvmRealtimeStatus() {
  return { enabled: true, pollSec: POLL_SEC, lastPoll };
}

// Loop background. Panggil startEvmRealtime() dari index.js.
let timer = null;
export function startEvmRealtime() {
  if (timer) return { pollSec: POLL_SEC };
  const run = () => evmRealtimePoll().catch(() => {});
  setTimeout(run, 8_000);                    // putaran pertama 8 dtk setelah boot
  timer = setInterval(run, POLL_SEC * 1000);
  return { pollSec: POLL_SEC };
}
