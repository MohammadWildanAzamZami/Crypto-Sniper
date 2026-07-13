// Robinhood Chain (EVM L2) — prototipe discover. LANGKAH #1 dari porting ekosistem
// ke Robinhood Chain: menemukan token/pool memecoin trending & fresh via GeckoTerminal
// (network id "robinhood"), lalu screen ringan (lantai likuiditas). Ini fondasi
// "10x Radar EVM" — belum sniper/smart-money (butuh Blockscout, tahap berikutnya).
//
// Sumber: GeckoTerminal public API (gratis, ~30 req/mnt). Semua degrade ke error
// bersih; tak pernah melempar ke loop. Bukan nasihat keuangan.

import { Router } from "express";
import { scanLimit } from "../middleware/limits.js";
import { requireAdmin } from "../middleware/guard.js";
import { screenEvmToken } from "../screener/evmScreen.js";
import { bedahEvmToken } from "../screener/evmAutopsy.js";
import { recordEvmCandidates, getEvmWatchlist } from "../screener/evmWatchlist.js";
import { runEvmSniperSweep, getEvmSignals, purgeEvmSignals } from "../screener/evmSniper.js";
import { autoSeedWatchlist, robinhoodTick, getLastTick } from "../screener/evmAuto.js";
import { getEvmRealtimeStatus } from "../screener/evmRealtime.js";

const router = Router();
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const GT = "https://api.geckoterminal.com/api/v2";
const NET = "robinhood";
const MIN_LIQ = Number(process.env.RH_MIN_LIQUIDITY || 5000); // lantai likuiditas USD

async function gtPools(kind) {
  // kind: "trending_pools" | "new_pools"
  const r = await fetch(`${GT}/networks/${NET}/${kind}?page=1`, { headers: { accept: "application/json" } });
  if (!r || !r.ok) throw new Error(`GeckoTerminal ${kind} → ${r ? r.status : "no response"}`);
  const j = await r.json();
  return Array.isArray(j.data) ? j.data : [];
}

// GeckoTerminal token id looks like "robinhood_0xabc…"; strip the network prefix
// to get the raw EVM address.
function tokenAddr(id) {
  if (!id) return null;
  const i = id.indexOf("_");
  return i >= 0 ? id.slice(i + 1) : id;
}

function norm(p, fresh) {
  const a = p.attributes || {};
  const pool = a.address || "";
  const base = tokenAddr(p.relationships?.base_token?.data?.id);
  return {
    name: a.name || "",
    poolAddress: pool,
    tokenAddress: base,
    priceUsd: Number(a.base_token_price_usd) || 0,
    liquidityUsd: Math.round(Number(a.reserve_in_usd) || 0),
    volume24h: Math.round(Number((a.volume_usd || {}).h24) || 0),
    fdvUsd: Math.round(Number(a.fdv_usd) || 0),
    marketCapUsd: Math.round(Number(a.market_cap_usd) || 0),
    change24h: a.price_change_percentage ? Number(a.price_change_percentage.h24) : null,
    createdAt: a.pool_created_at || null,
    fresh: Boolean(fresh),
    // GeckoTerminal punya chart embed per-pool (mirip embed DexScreener di Solana).
    geckoUrl: pool ? `https://www.geckoterminal.com/${NET}/pools/${pool}` : null,
    chartUrl: pool ? `https://www.geckoterminal.com/${NET}/pools/${pool}?embed=1&info=0&swaps=0` : null,
  };
}

// GET /api/robinhood/discover — gabungan trending + new pools, dedupe by pool,
// disaring lantai likuiditas, diurut volume 24h. Query ?min_liq override lantai.
router.get("/robinhood/discover", scanLimit, async (req, res) => {
  try {
    const [trending, fresh] = await Promise.all([gtPools("trending_pools"), gtPools("new_pools")]);
    const minLiq = Number(req.query.min_liq) >= 0 ? Number(req.query.min_liq) : MIN_LIQ;
    const map = new Map();
    for (const p of trending) { const n = norm(p, false); if (n.poolAddress && !map.has(n.poolAddress)) map.set(n.poolAddress, n); }
    for (const p of fresh)    { const n = norm(p, true);  if (n.poolAddress && !map.has(n.poolAddress)) map.set(n.poolAddress, n); }
    const pools = [...map.values()]
      .filter((p) => p.liquidityUsd >= minLiq)
      .sort((a, b) => b.volume24h - a.volume24h);
    res.json({
      chain: "Robinhood Chain",
      network: NET,
      scannedAt: Date.now(),
      minLiquidity: minLiq,
      count: pools.length,
      pools,
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/screen?token=0x… — screen EVM satu token (metrik + gate
// keamanan heuristik + skor/verdict). Fondasi bersama untuk Radar/Bedah/Sniper EVM.
router.get("/robinhood/screen", scanLimit, async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!EVM_ADDR.test(token)) return res.status(400).json({ error: "Parameter 'token' (alamat 0x…) tidak valid." });
  try {
    const out = await screenEvmToken(token, {
      minLiquidity: Number(req.query.min_liq) >= 0 ? Number(req.query.min_liq) : undefined,
    });
    if (out?.error) return res.status(404).json(out);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/bedah?token=0x… — Bedah Coin EVM: early buyer + kandidat smart
// wallet dari histori transfer paling awal. Menyemai (calon) watchlist EVM.
router.get("/robinhood/bedah", scanLimit, async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!EVM_ADDR.test(token)) return res.status(400).json({ error: "Parameter 'token' (alamat 0x…) tidak valid." });
  try {
    const out = await bedahEvmToken(token, {
      maxTransfers: Number(req.query.max) > 0 ? Math.min(600, Number(req.query.max)) : undefined,
    });
    // Kegagalan transien (Blockscout sibuk/limit) → 503 "coba lagi", bukan 404
    // (yang menyiratkan token benar-benar tak ada). Frontend bisa tawarkan retry.
    if (out?.error) return res.status(out.retryable ? 503 : 404).json(out);
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/watchlist — watchlist smart-wallet EVM (terurut reputasi).
router.get("/robinhood/watchlist", (_req, res) => {
  try {
    res.json(getEvmWatchlist());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// POST /api/robinhood/watchlist/record { token } — Bedah token (server-side, otoritatif)
// lalu rekam kandidat smart wallet ke watchlist EVM. Mengembalikan hasil + watchlist baru.
router.post("/robinhood/watchlist/record", scanLimit, async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!EVM_ADDR.test(token)) return res.status(400).json({ error: "Parameter 'token' (alamat 0x…) tidak valid." });
  try {
    const bedah = await bedahEvmToken(token);
    if (bedah?.error) return res.status(404).json(bedah);
    const rec = recordEvmCandidates(bedah, Date.now());
    res.json({ ...rec, token, name: bedah.name, mcapUsd: bedah.mcapUsd, watchlist: getEvmWatchlist() });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/auto/status — status tick otomatis terakhir + watcher real-time (untuk UI).
router.get("/robinhood/auto/status", (_req, res) => {
  res.json({ lastTick: getLastTick(), realtime: getEvmRealtimeStatus() });
});

// POST /api/robinhood/auto/seed — auto-seed watchlist sekarang (bedah winner trending).
router.post("/robinhood/auto/seed", scanLimit, async (_req, res) => {
  try {
    res.json(await autoSeedWatchlist({ nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// POST /api/robinhood/auto/tick — jalankan satu putaran penuh (seed + sweep) sekarang.
router.post("/robinhood/auto/tick", scanLimit, async (_req, res) => {
  try {
    res.json(await robinhoodTick({ nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/sniper/signals — sinyal Sniper Live EVM saat ini (murah, tanpa sweep).
router.get("/robinhood/sniper/signals", (_req, res) => {
  try {
    res.json(getEvmSignals());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// POST /api/robinhood/sniper/purge — hapus sinyal yang smart money-nya sudah tidak ada:
// cek saldo on-chain semua wallet tiap sinyal (abaikan grace), buang bila semua sudah jual.
router.post("/robinhood/sniper/purge", requireAdmin, scanLimit, async (_req, res) => {
  try {
    res.json(await purgeEvmSignals({ nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// GET /api/robinhood/sniper/sweep — sweep sekarang: baca beli wallet aktif Watchlist EVM.
router.get("/robinhood/sniper/sweep", scanLimit, async (_req, res) => {
  try {
    res.json(await runEvmSniperSweep({ nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

export default router;
