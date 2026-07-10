// Autopsy — "Bedah Coin" (SNIPER ENGINE Modul A). Given ONE mint that has already
// run, reconstruct WHO bought it early (while market cap was still small) and HOW
// the accumulation happened. This is the forensic half of the sniper loop: the
// standout early buyers it surfaces become smart-wallet candidates for a watchlist
// (Modul B) that a live monitor (Modul C) can then follow into the next winner.
//
// Data (verified available on the current Birdeye+Helius tier — see docs/SNIPER-ENGINE.md):
//   Birdeye token_overview → current price + market cap → implied supply.
//   Birdeye txs/token?sort_type=asc → the token's trades OLDEST-FIRST, each with
//     owner, side (buy/sell), USD price at trade time, amount, blockUnixTime.
//     mcapAtTrade = priceAtTrade × supply → we keep buying while mcap < EARLY_MCAP.
//   Helius addresses/{wallet}/transactions → wallet age/history (established vs fresh).
//
// Everything degrades to null/[] on failure — never throws into the route. Wallets
// labelled "smart" are a heuristic from on-chain behaviour, NOT financial advice.

const BIRDEYE = "https://public-api.birdeye.so";
const HELIUS = "https://api.helius.xyz";
const DEXSCREENER_TOKEN = "https://api.dexscreener.com/latest/dex/tokens";

// Canonical quote mints (SOL/USDC/USDT). A pair quoted in one of these has a
// reliable USD price; exotic token-token pairs on DexScreener sometimes report a
// wildly wrong priceUsd (e.g. Bonk/MET showing 5000× the real price), so we price
// off canonical pairs and only fall back to a Birdeye spot price otherwise.
const CANON_QUOTES = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

// D6: two "early" tiers by market cap at time of the wallet's first buy.
const ULTRA_EARLY_MCAP = 50_000;   // ultra-early hunters — sharpest, riskiest
const EARLY_MCAP = 100_000;        // early — sweet spot: real liquidity, pre-pump

// Bounded cost: page oldest trades until mcap crosses EARLY_MCAP or we hit the cap.
const PAGE_SIZE = 50;
const MAX_PAGES = 8;               // ≤400 trades scanned per autopsy (bounds latency)
const HELIUS_CHECK_LIMIT = 10;     // verify wallet age for at most the top N candidates

// Bundle/sybil signature: many wallets buying in the SAME second with near-uniform
// token amounts (bot behaviour). A fair-launch burst has varied amounts, so amount
// uniformity is what separates a real bundle from organic early hype.
const BUNDLE_MIN_WALLETS = 4;      // distinct wallets in one same-second cluster
const BUNDLE_UNIFORMITY = 0.6;     // ≥60% of buys within ±25% of the median amount

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry on 429 / 5xx — the free Birdeye tier can't take a burst, and
// paging a token's history is exactly a burst. Jittered backoff by attempt.
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
        await sleep(500 * (i + 1) + (url.length % 7) * 40);
        continue;
      }
      return res;
    } catch (e) {
      if (i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      throw e;
    }
  }
}

const bHeaders = (key) => ({ "X-API-KEY": key, "x-chain": "solana", accept: "application/json" });

// Current price + market cap + identity. supply is implied (mcap / price) so we
// can reconstruct the market cap at any past trade from its USD price alone.
//
// Primary source is Birdeye token_overview, but that is Birdeye's single most
// COMPUTE-UNIT-EXPENSIVE endpoint: once the account's CU budget is spent it 400s
// with "Compute units usage limit exceeded" for EVERY token, which used to surface
// as a bogus "token not found". So we fall back to DexScreener (free, key-less, no
// CU) for price + market cap → implied supply. The forensic trade history still
// comes from Birdeye's cheaper txs/token endpoint, so autopsy keeps working even
// when token_overview is quota-blocked. Returns { ..., source } for observability.
async function tokenOverview(mint, key) {
  // 1) Birdeye token_overview — richest data when the CU budget allows it.
  try {
    const res = await fetchRetry(`${BIRDEYE}/defi/token_overview?address=${mint}`, { headers: bHeaders(key) });
    if (res && res.ok) {
      const d = (await res.json())?.data;
      if (d) {
        const price = Number(d.price) || 0;
        const marketCap = Number(d.marketCap ?? d.mc) || 0;
        const supply = price > 0 && marketCap > 0 ? marketCap / price : Number(d.circulatingSupply) || 0;
        if (price > 0 && supply > 0) {
          return {
            symbol: d.symbol || "", name: d.name || "", logoUrl: d.logoURI || null,
            decimals: Number(d.decimals) || 0, price, marketCap, supply, source: "birdeye",
          };
        }
      }
    }
  } catch { /* fall through to DexScreener */ }

  // 2) DexScreener fallback — free & CU-free. Covers quota exhaustion (Birdeye 400
  //    "Compute units usage limit exceeded") and any token_overview outage.
  try {
    const ds = await dexOverview(mint, key);
    if (ds && ds.price > 0 && ds.supply > 0) return ds;
  } catch { /* both sources failed */ }

  return null;
}

// Birdeye spot price via the CHEAP /defi/price endpoint (stays 200 even when the
// expensive token_overview is CU-blocked). Returns 0 on any failure.
async function birdeyePrice(mint, key) {
  try {
    const res = await fetchRetry(`${BIRDEYE}/defi/price?address=${mint}`, { headers: bHeaders(key) });
    if (!res || !res.ok) return 0;
    return Number((await res.json())?.data?.value) || 0;
  } catch {
    return 0;
  }
}

// DexScreener-based overview. Guards against two DexScreener data traps:
//   1) pairs where our mint is the QUOTE (price/mcap would be the other token's);
//   2) exotic token-token pairs reporting a wildly wrong priceUsd.
// So: keep only pairs where our mint is the BASE, then price off the deepest
// canonical-quote (SOL/USDC/USDT) pair. If none exists, take a Birdeye spot price
// and multiply by supply (= mcap/price ratio, which is stable even on a mispriced
// pair). Returns { symbol, name, logoUrl, price, marketCap, supply, source }.
async function dexOverview(mint, birdeyeKey) {
  const res = await fetchRetry(`${DEXSCREENER_TOKEN}/${mint}`, {});
  if (!res || !res.ok) return null;
  const body = await res.json();
  const base = (body.pairs || []).filter(
    (p) => p.chainId === "solana" && p.baseToken?.address === mint
  );
  if (base.length === 0) return null;
  base.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

  const deepest = base[0];
  const meta = {
    symbol: deepest.baseToken?.symbol || "",
    name: deepest.baseToken?.name || "",
    logoUrl: deepest.info?.imageUrl || null,
    decimals: 0,
  };
  // Supply is the mcap/price ratio — stable across pairs even when a pair misprices
  // the token, so we can trust it from the deepest pair regardless of quote.
  const supply = (() => {
    const p = Number(deepest.priceUsd) || 0;
    const mc = Number(deepest.marketCap ?? deepest.fdv) || 0;
    return p > 0 && mc > 0 ? mc / p : 0;
  })();
  if (supply <= 0) return null;

  // Trust price from the deepest canonical-quote pair; else a Birdeye spot price.
  const canon = base.find((p) => CANON_QUOTES.has(p.quoteToken?.address || ""));
  let price = canon ? Number(canon.priceUsd) || 0 : 0;
  let source = canon ? "dexscreener" : "";
  if (price <= 0) {
    price = await birdeyePrice(mint, birdeyeKey);
    source = price > 0 ? "dexscreener+birdeye-price" : "";
  }
  if (price <= 0) return null;

  return { ...meta, price, marketCap: price * supply, supply, source };
}

// One page of the token's trades, oldest first.
async function tradePage(mint, key, offset) {
  const url = `${BIRDEYE}/defi/txs/token?address=${mint}&offset=${offset}&limit=${PAGE_SIZE}&tx_type=swap&sort_type=asc`;
  const res = await fetchRetry(url, { headers: bHeaders(key) });
  if (!res || !res.ok) return null;
  const items = (await res.json())?.data?.items;
  return Array.isArray(items) ? items : [];
}

// Normalise a raw Birdeye trade into what the forensic pass needs. `base` is the
// token under autopsy; basePrice is its USD price at that moment.
function normalizeTrade(t, supply) {
  const base = t.base || t.to || {};
  const price = Number(t.basePrice ?? t.tokenPrice ?? base.price) || 0;
  const tokens = Math.abs(Number(base.uiAmount) || 0);
  return {
    owner: t.owner || "",
    side: t.side === "sell" ? "sell" : "buy",
    price,
    tokens,
    usd: tokens * price,
    mcap: price * supply,
    at: Number(t.blockUnixTime) || 0,
  };
}

// Helius: how much history a wallet has. Established wallets have many parsed txs;
// fresh sniper/throwaway wallets are near-empty. null when Helius absent/fails.
async function heliusTxCount(owner, key) {
  try {
    const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${key}&limit=20`, {
      headers: { accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) ? arr.length : null;
  } catch {
    return null;
  }
}

// Detect bundle/sybil clusters: buys landing in the SAME second (≈same block) by
// many distinct wallets with near-uniform token amounts. Uniform sizing is the
// tell — a fair-launch burst is many wallets too, but with VARIED amounts, so it
// won't pass the uniformity test. Returns only the coordinated clusters.
function bundleClusters(earlyBuys) {
  const bySecond = new Map();
  for (const b of earlyBuys) {
    if (!bySecond.has(b.at)) bySecond.set(b.at, []);
    bySecond.get(b.at).push(b);
  }
  const clusters = [];
  for (const [at, buys] of bySecond) {
    const wallets = new Set(buys.map((b) => b.owner));
    if (wallets.size < BUNDLE_MIN_WALLETS) continue;
    const amts = buys.map((b) => b.tokens).sort((a, b) => a - b);
    const median = amts[Math.floor(amts.length / 2)] || 0;
    if (median <= 0) continue;
    const uniform = buys.filter((b) => Math.abs(b.tokens - median) <= median * 0.25).length / buys.length;
    if (uniform < BUNDLE_UNIFORMITY) continue; // varied amounts → organic, not a bundle
    clusters.push({
      at,
      walletCount: wallets.size,
      avgMcap: Math.round(buys.reduce((s, b) => s + b.mcap, 0) / buys.length),
      uniformity: Number(uniform.toFixed(2)),
      wallets: [...wallets],
    });
  }
  return clusters.sort((a, b) => b.walletCount - a.walletCount);
}

/**
 * Run the autopsy for a mint.
 * @param {string} mint
 * @param {object} opts { birdeyeKey, heliusKey, nowMs }
 * @returns {Promise<object>} forensic report (see docs/SNIPER-ENGINE.md § Modul A)
 */
export async function runAutopsy(mint, { birdeyeKey, heliusKey, nowMs } = {}) {
  if (!birdeyeKey) return { error: "Birdeye key belum diset (wajib untuk bedah coin)." };
  const now = nowMs ?? Date.now();

  const ov = await tokenOverview(mint, birdeyeKey);
  if (!ov || ov.supply <= 0 || ov.price <= 0) {
    return { error: "Token tidak ditemukan di Birdeye maupun DexScreener — cek alamat mint (harus token Solana yang sudah listing di DEX)." };
  }

  // 1) Page oldest→newest, collecting trades until mcap crosses the EARLY line.
  const trades = [];
  let pages = 0;
  let reachedEarlyCap = false;
  let cappedByPages = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const raw = await tradePage(mint, birdeyeKey, p * PAGE_SIZE);
    pages++;
    if (raw == null) break;          // hard API failure → stop with what we have
    if (raw.length === 0) break;     // ran out of history before the cap
    for (const t of raw) {
      const n = normalizeTrade(t, ov.supply);
      if (n.owner && n.price > 0) trades.push(n);
    }
    // Sorted ascending, so the last trade on the page is the highest mcap so far.
    const lastMcap = trades.length ? trades[trades.length - 1].mcap : 0;
    if (lastMcap > EARLY_MCAP) { reachedEarlyCap = true; break; }
    if (p === MAX_PAGES - 1) cappedByPages = true;
    if (raw.length < PAGE_SIZE) break; // last page
    await sleep(120); // gentle on the rate limit between pages
  }

  // 2) Keep only the early window (mcap < EARLY_MCAP). Separate buys and sells.
  const earlyTrades = trades.filter((t) => t.mcap < EARLY_MCAP);
  const earlyBuys = earlyTrades.filter((t) => t.side === "buy" && t.tokens > 0);
  const earlySellers = new Set(earlyTrades.filter((t) => t.side === "sell").map((t) => t.owner));
  const launchMcap = trades.length ? trades[0].mcap : null;

  // 3) Aggregate per early-buyer wallet.
  const byWallet = new Map();
  for (const b of earlyBuys) {
    let w = byWallet.get(b.owner);
    if (!w) {
      w = { owner: b.owner, firstBuyMcap: b.mcap, firstBuyAt: b.at, usd: 0, tokens: 0, buys: 0 };
      byWallet.set(b.owner, w);
    }
    w.usd += b.usd;
    w.tokens += b.tokens;
    w.buys++;
    if (b.mcap < w.firstBuyMcap) w.firstBuyMcap = b.mcap;
    if (b.at < w.firstBuyAt) w.firstBuyAt = b.at;
  }

  const clusters = bundleClusters(earlyBuys);
  const bundledWallets = new Set(clusters.flatMap((c) => c.wallets));

  // 4) Shape each early buyer: tier, entry→now multiple, held vs sold-in-window,
  // potential value if still holding. Multiple uses current mcap vs entry mcap.
  let earlyBuyers = [...byWallet.values()].map((w) => {
    const avgEntryPrice = w.tokens > 0 ? w.usd / w.tokens : 0;
    const tier = w.firstBuyMcap < ULTRA_EARLY_MCAP ? "ultra-early" : "early";
    return {
      owner: w.owner,
      tier,
      firstBuyMcap: Math.round(w.firstBuyMcap),
      firstBuyAt: w.firstBuyAt,
      buys: w.buys,
      totalBuyUsd: Math.round(w.usd),
      tokens: Math.round(w.tokens),
      avgEntryPrice,
      xFromEntry: avgEntryPrice > 0 ? Number((ov.price / avgEntryPrice).toFixed(1)) : null,
      potentialValueUsd: Math.round(w.tokens * ov.price),
      soldInWindow: earlySellers.has(w.owner),
      bundleSuspected: bundledWallets.has(w.owner),
      established: null, // filled by Helius below for the top candidates
      txCount: null,
    };
  });

  // Smart-wallet score (0–100): earlier entry, established wallet, still holding,
  // not part of a bundle, meaningful size. Used both to pick who to verify and to
  // rank the final list. (Declared before use; hoisting would allow it either way.)
  function scoreWallet(w) {
    const why = [];
    let s = 0;
    if (w.tier === "ultra-early") { s += 30; why.push("masuk ultra-early (<$50k)"); }
    else { s += 15; why.push("masuk early (<$100k)"); }
    if (w.established === true) { s += 25; why.push(`wallet mapan (${w.txCount}+ tx)`); }
    else if (w.established == null) { s += 10; }
    else { why.push("wallet fresh (hati-hati)"); }
    if (!w.soldInWindow) { s += 20; why.push("belum jual di window awal"); }
    else { why.push("sudah jual sebagian di awal"); }
    if (!w.bundleSuspected) { s += 15; }
    else { why.push("terindikasi bundle/koordinasi"); }
    s += Math.min(10, Math.round(w.totalBuyUsd / 500));
    return { score: Math.min(100, s), why };
  }

  // 5) Pick who to verify by a PROVISIONAL score (established still unknown, so
  // neutral for everyone). This favours clean wallets that HELD — exactly the ones
  // we surface — instead of the earliest bots that dumped. Verify those with Helius
  // (shared object refs, so the detail list below sees the result too), then rank.
  const cleanEarly = earlyBuyers.filter((w) => !w.bundleSuspected);
  cleanEarly.sort((a, b) => scoreWallet(b).score - scoreWallet(a).score);
  if (heliusKey) {
    const top = cleanEarly.slice(0, HELIUS_CHECK_LIMIT);
    const counts = await Promise.all(top.map((w) => heliusTxCount(w.owner, heliusKey)));
    top.forEach((w, i) => {
      w.txCount = counts[i];
      w.established = counts[i] == null ? null : counts[i] >= 10;
    });
  }

  // 6) Final candidate list, re-scored now that established is known for the top.
  const smartWalletCandidates = cleanEarly
    .map((w) => { const { score, why } = scoreWallet(w); return { owner: w.owner, tier: w.tier, xFromEntry: w.xFromEntry, established: w.established, firstBuyMcap: w.firstBuyMcap, totalBuyUsd: w.totalBuyUsd, score, why }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // Detail list ordered earliest-first (intuitive "who got in first").
  earlyBuyers.sort((a, b) => a.firstBuyMcap - b.firstBuyMcap || b.totalBuyUsd - a.totalBuyUsd);

  const ultraEarly = earlyBuyers.filter((w) => w.tier === "ultra-early").length;
  const walletsChecked = earlyBuyers.filter((w) => w.established != null).length;
  const establishedCount = earlyBuyers.filter((w) => w.established === true).length;

  // Data-quality guard: for OLD tokens Birdeye's oldest indexed trade can already
  // be above the early line (its history doesn't reach the real launch). Then we
  // simply have no early window to dissect — say so honestly instead of inventing
  // a "launch mcap" from a high/glitchy first trade.
  const firstTradeMcap = trades.length ? trades[0].mcap : null;
  const noEarlyData = earlyBuyers.length === 0 && firstTradeMcap != null && firstTradeMcap >= EARLY_MCAP;
  // launch→now multiple is only meaningful when launch was genuinely below now.
  const validLaunch = launchMcap != null && launchMcap > 0 && launchMcap < ov.marketCap;

  const notes = [];
  if (noEarlyData) notes.push(`Trade paling awal yang tersedia di Birdeye sudah di mcap ~$${Math.round(firstTradeMcap).toLocaleString()} (di atas $${EARLY_MCAP.toLocaleString()}). Fase early tidak ada di data — tool ini paling akurat untuk token yang BARU naik (riwayat lengkap tersedia).`);
  if (cappedByPages) notes.push(`Riwayat dibatasi ${MAX_PAGES * PAGE_SIZE} trade paling awal (hemat kuota API) — early buyer setelah itu belum tercakup.`);
  if (!reachedEarlyCap && !cappedByPages) notes.push("Riwayat token habis sebelum mcap menembus $100k — semua trade token tercakup.");
  if (heliusKey) notes.push(`Umur wallet diverifikasi Helius hanya untuk ${walletsChecked} kandidat teratas (hemat kuota); sisanya 'belum dicek'.`);
  else notes.push("Helius belum diset — verifikasi umur wallet (mapan/fresh) nonaktif.");
  notes.push("Deteksi bundle = wallet beli di detik yang sama dengan jumlah token seragam (ciri bot). Heuristik, bisa meleset.");
  notes.push("Heuristik on-chain, BUKAN nasihat finansial. Wallet 'smart' = pola perilaku, bukan jaminan.");

  return {
    mint,
    scannedAt: now,
    token: {
      symbol: ov.symbol, name: ov.name, logoUrl: ov.logoUrl,
      currentPriceUsd: ov.price, currentMcap: Math.round(ov.marketCap),
      launchMcap: validLaunch ? Math.round(launchMcap) : null,
      launchToNowX: validLaunch ? Number((ov.marketCap / launchMcap).toFixed(0)) : null,
      noEarlyData,
    },
    window: {
      tradesScanned: trades.length,
      pagesFetched: pages,
      earlyTrades: earlyTrades.length,
      reachedEarlyCap,
      cappedByPages,
    },
    summary: {
      earlyWallets: earlyBuyers.length,
      ultraEarlyWallets: ultraEarly,
      walletsChecked,
      establishedWallets: establishedCount,
      bundleClusters: clusters.length,
      bundledWallets: bundledWallets.size,
    },
    earlyBuyers: earlyBuyers.slice(0, 50), // cap payload
    coordination: { clusters, minWallets: BUNDLE_MIN_WALLETS, uniformityThreshold: BUNDLE_UNIFORMITY },
    smartWalletCandidates,
    notes,
  };
}
