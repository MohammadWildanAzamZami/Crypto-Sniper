// evmAutopsy.js — "Bedah Coin" EVM (Robinhood Chain, LANGKAH #3). Diberi SATU token
// yang sudah jalan, telusuri EARLY BUYER dari histori transfer on-chain paling awal
// (Blockscout Etherscan-compat, sort=asc). Sebuah BELI = transfer `from = pool → wallet`
// (wallet menerima token dari LP). Menghasilkan kandidat smart-wallet (beli paling awal
// + masih memegang sekarang) untuk MENYEMAI watchlist EVM yang dipakai Sniper EVM nanti.
//
// GeckoTerminal trades cuma ~300 trade terakhir (bisa < 30 menit untuk token aktif),
// jadi tak cukup untuk menemukan pembeli launch — makanya kita pakai transfer asc
// Blockscout yang bisa mundur sampai blok genesis. Heuristik, bukan nasihat keuangan.

const GT = "https://api.geckoterminal.com/api/v2";
const BS = "https://robinhoodchain.blockscout.com";
const NET = "robinhood";

async function jget(url) {
  try { const r = await fetch(url, { headers: { accept: "application/json" } }); return r && r.ok ? await r.json() : null; }
  catch { return null; }
}

// Pool likuiditas-terbesar + harga/mcap kini + identitas.
async function topPool(token) {
  const j = await jget(`${GT}/networks/${NET}/tokens/${token}/pools?page=1`);
  const pools = j?.data || [];
  if (!pools.length) return null;
  let best = null, bl = -1;
  for (const p of pools) { const l = Number(p.attributes?.reserve_in_usd) || 0; if (l > bl) { bl = l; best = p; } }
  const a = best.attributes || {};
  return {
    poolAddress: (a.address || "").toLowerCase(),
    priceUsd: Number(a.base_token_price_usd) || 0,
    mcapUsd: Math.round(Number(a.market_cap_usd) || 0),
    name: a.name || "",
    createdAt: a.pool_created_at || null,
  };
}

async function tokenMeta(token) {
  const t = await jget(`${BS}/api/v2/tokens/${token}`);
  return { decimals: t && t.decimals != null ? Number(t.decimals) : 18, symbol: t?.symbol || "", name: t?.name || "" };
}

// Transfer token PALING AWAL (ascending), sampai maxRows.
async function earliestTransfers(token, maxRows) {
  const out = [];
  const offset = 100;
  for (let page = 1; out.length < maxRows && page <= Math.ceil(maxRows / offset) + 1; page++) {
    const j = await jget(`${BS}/api?module=account&action=tokentx&contractaddress=${token}&sort=asc&page=${page}&offset=${offset}`);
    const rows = j?.result;
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < offset) break;
  }
  return out.slice(0, maxRows);
}

// Saldo token wallet SEKARANG (Etherscan-compat). null bila gagal (fail-safe).
async function tokenBalance(token, wallet, dec) {
  const j = await jget(`${BS}/api?module=account&action=tokenbalance&contractaddress=${token}&address=${wallet}`);
  if (!j || j.status !== "1" || j.result == null) return null;
  return Number(j.result) / 10 ** dec;
}

async function mapPool(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; } }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Bedah satu token EVM: temukan early buyer + kandidat smart wallet.
 * @param {string} token 0x…
 * @param {{maxTransfers?:number, earlyBuyCount?:number, earlyWindowMin?:number, checkHolding?:boolean}} opts
 */
export async function bedahEvmToken(token, opts = {}) {
  const addr = String(token || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { error: "alamat token EVM tidak valid" };
  const { maxTransfers = 300, earlyBuyCount = 30, earlyWindowMin = 60, checkHolding = true } = opts;

  const [pool, meta] = await Promise.all([topPool(addr), tokenMeta(addr)]);
  if (!pool || !pool.poolAddress) return { error: "pool token tak ditemukan di GeckoTerminal" };
  const transfers = await earliestTransfers(addr, maxTransfers);
  if (!transfers.length) return { error: "tak ada histori transfer di Blockscout" };

  const poolAddr = pool.poolAddress;
  const dec = meta.decimals || 18;

  // Agregasi per wallet dari transfer paling awal: beli (from pool), jual (to pool).
  const wallets = new Map(); // owner → { firstBuyAt, buyIdx, buyTokens, sellTokens }
  let buyIdx = 0;
  for (const t of transfers) {
    const from = (t.from || "").toLowerCase();
    const to = (t.to || "").toLowerCase();
    const val = Number(t.value) / 10 ** dec;
    const at = Number(t.timeStamp) * 1000;
    if (from === poolAddr && to && to !== poolAddr) {          // BELI
      buyIdx++;
      let w = wallets.get(to);
      if (!w) { w = { firstBuyAt: at, buyIdx, buyTokens: 0, sellTokens: 0 }; wallets.set(to, w); }
      w.buyTokens += val;
    } else if (to === poolAddr && from && from !== poolAddr) {  // JUAL
      const w = wallets.get(from);
      if (w) w.sellTokens += val;
    }
  }
  if (wallets.size === 0) return { error: "tak ada transaksi beli dari pool di window awal — mungkin bukan pair yang benar." };

  const firstBuy = [...wallets.values()].reduce((m, w) => (m == null || w.firstBuyAt < m ? w.firstBuyAt : m), null);
  const windowMs = earlyWindowMin * 60_000;

  // Early buyer = di antara `earlyBuyCount` beli pertama ATAU dalam window awal.
  let early = [...wallets.entries()]
    .map(([owner, w]) => ({
      owner, buyIdx: w.buyIdx, firstBuyAt: w.firstBuyAt,
      boughtTokens: Math.round(w.buyTokens),
      soldPctWindow: w.buyTokens > 0 ? Math.round((w.sellTokens / w.buyTokens) * 100) : 0,
      early: w.buyIdx <= earlyBuyCount || (firstBuy != null && w.firstBuyAt - firstBuy <= windowMs),
    }))
    .filter((c) => c.early && c.boughtTokens > 0)
    .sort((a, b) => a.buyIdx - b.buyIdx);

  // Konfirmasi kepemilikan SEKARANG (bukan cuma di window) untuk kandidat teratas —
  // inilah yang membedakan "diamond hand early" (kandidat smart) dari yang sudah keluar.
  let holdingChecked = false;
  if (checkHolding && early.length) {
    const top = early.slice(0, 40);
    const bals = await mapPool(top, 5, (c) => tokenBalance(addr, c.owner, dec));
    top.forEach((c, i) => {
      const b = bals[i];
      c.balanceNow = b == null ? null : Math.round(b);
      c.holdingNow = b == null ? null : b > c.boughtTokens * 0.1; // masih pegang >10% yang dibeli
    });
    holdingChecked = true;
  }

  // Kandidat smart wallet = early + masih pegang sekarang (kalau dicek), else early +
  // tak dump di window. Ini yang akan menyemai watchlist EVM.
  const smartCandidates = early.filter((c) =>
    holdingChecked ? c.holdingNow === true : c.soldPctWindow < 50
  );

  return {
    token: addr,
    chain: "Robinhood Chain",
    name: pool.name || meta.name,
    symbol: meta.symbol,
    poolAddress: poolAddr,
    priceUsd: pool.priceUsd,
    mcapUsd: pool.mcapUsd,
    launchAt: firstBuy,
    analyzedTransfers: transfers.length,
    windowTruncated: transfers.length >= maxTransfers,   // histori mungkin lebih panjang
    earlyBuyers: early.length,
    holdingChecked,
    smartCandidates: smartCandidates.slice(0, 40),
    earlyAll: early.slice(0, 40),
    note: "Early buyer = menerima token dari pool paling awal (Blockscout asc). Kandidat smart = early + masih pegang sekarang. Untuk menyemai watchlist EVM. Heuristik — DYOR.",
  };
}
