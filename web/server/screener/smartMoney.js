// Smart-money tracking — two interlocking sources:
//
//   Birdeye  → WHO is trading this token: its top traders over 24h, with their
//              buy vs sell volume. Sophisticated capital shows up here first.
//   Helius   → are those wallets REAL: established wallets have transaction
//              history; fresh sniper/bundle wallets don't. Helius verifies the
//              Birdeye traders so a cluster of throwaway wallets can't fake
//              "smart money".
//
// Combined into a 0–100 smartScore + a compact signal the gate/AI/UI can use.
// Both keys are optional and server-side. Birdeye is the primary source; without
// it this returns null (feature simply off). Helius only enriches. Everything
// degrades to null on failure — never throws into a scan. NOT financial advice:
// wallets labelled "smart" by 24h volume are a heuristic, not a guarantee.

const BIRDEYE = "https://public-api.birdeye.so";
const HELIUS = "https://api.helius.xyz";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry on rate-limit (429) / transient 5xx. The free Birdeye tier
// can't take ~10 concurrent calls at once (a Pro Radar enrich burst), so without
// this most calls during a scan would return null. Backoff is jittered by index.
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        if (i < tries - 1) { await sleep(500 * (i + 1) + Math.floor((url.length % 7) * 40)); continue; }
        return res;
      }
      return res;
    } catch (e) {
      if (i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      throw e;
    }
  }
}

// Birdeye: the token's top traders in the last 24h, ranked by volume. The API
// returns USD buy/sell volume, wallet `tags` (whale/bundler/…), and per-trader
// PnL — all of which we use to tell real smart money from mere high volume.
export async function birdeyeTopTraders(mint, key) {
  try {
    const url = `${BIRDEYE}/defi/v2/tokens/top_traders?address=${mint}&time_frame=24h&sort_type=desc&sort_by=volume&offset=0&limit=10`;
    const res = await fetchRetry(url, {
      headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    const j = await res.json();
    const items = j?.data?.items || j?.data || [];
    if (!Array.isArray(items) || items.length === 0) return null;
    return items
      .map((t) => ({
        owner: t.owner || t.address || t.wallet || t.trader || "",
        // Prefer USD figures; fall back to raw token volume only if USD absent.
        buyUsd: Number(t.volumeBuyUSD ?? t.volumeBuy ?? 0),
        sellUsd: Number(t.volumeSellUSD ?? t.volumeSell ?? 0),
        trades: Number(t.trade ?? t.trades ?? 0),
        tags: Array.isArray(t.tags) ? t.tags : [],
        pnl: Number(t.totalPnl ?? t.realizedPnl ?? 0),
      }))
      .filter((t) => t.owner);
  } catch {
    return null;
  }
}

// Helius: how much recent history a wallet has. Real wallets have many parsed
// transactions; fresh sniper/bundle wallets are near-empty. Cheap, capped call.
async function heliusWalletActivity(owner, key) {
  try {
    const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${key}&limit=20`, {
      headers: { accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    return { txCount: arr.length };
  } catch {
    return null;
  }
}

/**
 * Smart-money signal for a mint. Returns null when disabled/unavailable.
 * @param {string} mint
 * @param {object} opts { birdeyeKey, heliusKey }
 * @returns {Promise<null | { topTraders, accumulating, whales, profitable,
 *   netBuyUsd, established, heliusUsed, score }>}
 */
export async function fetchSmartMoney(mint, { birdeyeKey, heliusKey } = {}) {
  if (!birdeyeKey) return null; // Birdeye is required; no key → feature off
  const traders = await birdeyeTopTraders(mint, birdeyeKey);
  if (!traders || traders.length === 0) return null;

  // Net USD buy pressure, plus counts that separate real smart money from noise:
  // whales (Birdeye-tagged), profitable traders (positive PnL), and net buyers.
  const netBuyUsd = Math.round(traders.reduce((s, t) => s + (t.buyUsd - t.sellUsd), 0));
  const accumulating = traders.filter((t) => t.buyUsd > t.sellUsd).length;
  const whales = traders.filter((t) => t.tags.includes("whale")).length;
  const profitable = traders.filter((t) => t.pnl > 0).length;
  // Whales that are actively accumulating are the strongest single signal.
  const whalesBuying = traders.filter((t) => t.tags.includes("whale") && t.buyUsd > t.sellUsd).length;

  // Verify the top few traders with Helius: established wallets (real history)
  // vs fresh throwaway wallets. null when Helius isn't configured.
  let established = null;
  if (heliusKey) {
    const top = traders.slice(0, 4);
    const acts = await Promise.all(top.map((t) => heliusWalletActivity(t.owner, heliusKey)));
    established = acts.filter((a) => a && a.txCount >= 10).length;
  }

  // Score 0–100: net buy pressure + whales accumulating + profitable traders +
  // breadth + Helius wallet verification.
  let score = 0;
  if (netBuyUsd > 0) score += Math.min(30, Math.round(netBuyUsd / 3000)); // USD buy pressure
  score += Math.min(24, whalesBuying * 12);                               // whales buying
  score += Math.min(16, profitable * 4);                                  // profitable traders
  score += Math.min(15, accumulating * 3);                                // breadth
  if (established != null) score += Math.min(15, established * 5);         // real wallets
  else score += 8;                                                        // no Helius → neutral
  score = Math.min(100, Math.max(0, score));

  return {
    topTraders: traders.length,
    accumulating,
    whales,
    profitable,
    netBuyUsd,
    established,
    heliusUsed: Boolean(heliusKey),
    score,
  };
}
