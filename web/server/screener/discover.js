// Discover candidate Solana tokens for the 10x Radar. DexScreener's boost &
// profile feeds are public, key-less lists of tokens currently getting
// attention — a free funnel of fresh candidates to auto-screen. No wallet,
// no key, just public "what's trending right now" data.

const FEEDS = [
  "https://api.dexscreener.com/token-boosts/latest/v1",
  "https://api.dexscreener.com/token-boosts/top/v1",
  "https://api.dexscreener.com/token-profiles/latest/v1",
];

/**
 * Return up to `limit` unique Solana token mints from the discovery feeds.
 * Degrades gracefully: a failing feed is skipped, never throws.
 */
export async function discoverSolanaTokens({ limit = 30 } = {}) {
  const seen = new Set();
  const mints = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const body = await res.json();
      const items = Array.isArray(body) ? body : body?.tokens || [];
      for (const it of items) {
        if (it?.chainId !== "solana") continue;
        const mint = it.tokenAddress || it.address;
        if (!mint || seen.has(mint)) continue;
        seen.add(mint);
        mints.push(mint);
        if (mints.length >= limit) return mints;
      }
    } catch {
      /* ignore a single feed failure */
    }
  }
  return mints;
}
