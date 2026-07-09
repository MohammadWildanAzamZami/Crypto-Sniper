// Data sources for the screener. DexScreener is the backbone: it is a free,
// public, key-less API, so the GEM Score works out-of-the-box even when the
// Solscan key is missing or on the free tier. Solscan is used only to *enrich*
// the score (holder data) when a Pro key is available.

const DEXSCREENER_TOKEN = "https://api.dexscreener.com/latest/dex/tokens";
const SOLSCAN_PRO = "https://pro-api.solscan.io/v2.0";
const RUGCHECK_REPORT = "https://api.rugcheck.xyz/v1/tokens";
const PUMPFUN_COIN = "https://frontend-api-v3.pump.fun/coins";

/**
 * Fetch all DEX pairs for a token mint and return the most relevant Solana pair
 * (highest USD liquidity). Returns null if the token is not listed anywhere.
 */
export async function fetchDexScreener(tokenAddress) {
  const res = await fetch(`${DEXSCREENER_TOKEN}/${tokenAddress}`);
  if (!res.ok) throw new Error(`DexScreener responded ${res.status}`);
  const body = await res.json();
  const pairs = (body.pairs || []).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;

  // Pick the deepest-liquidity pair as the canonical market for scoring.
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const best = pairs[0];

  return {
    address: tokenAddress,
    name: best.baseToken?.name || "Unknown",
    symbol: best.baseToken?.symbol || "?",
    // Token logo — DexScreener serves it on the pair's `info.imageUrl`. Null when
    // the token has no metadata image; the UI falls back to a lettered avatar.
    logoUrl: best.info?.imageUrl || null,
    priceUsd: Number(best.priceUsd) || 0,
    liquidityUsd: best.liquidity?.usd || 0,
    fdv: best.fdv || 0,
    marketCap: best.marketCap || best.fdv || 0,
    volume: {
      h1: best.volume?.h1 || 0,
      h6: best.volume?.h6 || 0,
      h24: best.volume?.h24 || 0,
    },
    priceChange: {
      h1: best.priceChange?.h1 || 0,
      h6: best.priceChange?.h6 || 0,
      h24: best.priceChange?.h24 || 0,
    },
    txns24h: {
      buys: best.txns?.h24?.buys || 0,
      sells: best.txns?.h24?.sells || 0,
    },
    pairCreatedAt: best.pairCreatedAt || 0, // ms epoch, 0 if unknown
    dexId: best.dexId || "?",
    pairCount: pairs.length,
    pairAddress: best.pairAddress || "", // needed for the DexScreener chart embed
    url: best.url || `https://dexscreener.com/solana/${tokenAddress}`,
  };
}

/**
 * Optional Solscan enrichment: holder count + top-holder concentration.
 * Returns null on any failure (e.g. free-tier 401) so the screener degrades
 * gracefully to DexScreener-only scoring.
 */
export async function fetchSolscanHolders(tokenAddress, apiKey) {
  if (!apiKey) return null;
  try {
    const url = new URL(`${SOLSCAN_PRO}/token/holders`);
    url.searchParams.set("token_address", tokenAddress);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "20");
    const res = await fetch(url, { headers: { token: apiKey } });
    if (!res.ok) return null; // free tier -> 401, treat as "no data"
    const body = await res.json();
    const items = body?.data?.items || body?.data || [];
    if (!Array.isArray(items) || items.length === 0) return null;

    const total = body?.data?.total || items.length;
    // Concentration = share of supply held by the top holders we can see.
    const topAmount = items.reduce((s, h) => s + (Number(h.amount) || 0), 0);
    const decimals = items[0]?.decimals ?? 0;
    return { holderCount: total, top: items.length, topAmount, decimals };
  } catch {
    return null;
  }
}

/**
 * Pump.fun enrichment (free, key-less, v3 frontend API). Only pump.fun-origin
 * mints return data — everything else 404s → null. Gives us signals DexScreener
 * can't: whether the bonding curve has `complete`d (graduated = survived the
 * rug-prone launch phase), moderation flags (banned / nsfw / hidden), community
 * `reply_count`, and — crucially — the drawdown from all-time-high market cap,
 * which flags tokens that already pumped and dumped. Degrades to null on failure.
 */
export async function fetchPumpfun(tokenAddress) {
  try {
    const res = await fetch(`${PUMPFUN_COIN}/${tokenAddress}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null; // non-pump mint or API hiccup
    const j = await res.json();
    if (!j || j.mint !== tokenAddress) return null;

    const usdMc = Number(j.usd_market_cap) || 0;
    const athMc = Number(j.ath_market_cap) || 0;
    return {
      isPump: true,
      complete: Boolean(j.complete),        // graduated off the bonding curve
      banned: Boolean(j.is_banned),
      hidden: Boolean(j.hidden),
      nsfw: Boolean(j.nsfw),
      replyCount: Number(j.reply_count) || 0,
      usdMarketCap: Math.round(usdMc),
      athMarketCap: Math.round(athMc),
      // % below ATH (0 = at ATH, 90 = down 90% from the top). null if unknown.
      drawdownFromAthPct: athMc > 0 ? Math.round((1 - usdMc / athMc) * 100) : null,
      creator: typeof j.creator === "string" ? j.creator : null,
    };
  } catch {
    return null;
  }
}

/**
 * Liquidity-lock enrichment via RugCheck (free, key-less). Tells you how much of
 * the LP is locked or burned — the single most important anti-rug signal, since
 * unlocked liquidity can be pulled at any moment. We aggregate every market for
 * the mint and weight each market's lpLockedPct by its USD liquidity, so the
 * figure reflects the real pool rather than one tiny side-pool.
 * Returns null on any failure so the screener degrades gracefully.
 */
export async function fetchRugcheckLock(tokenAddress) {
  try {
    const res = await fetch(`${RUGCHECK_REPORT}/${tokenAddress}/report`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const markets = Array.isArray(body.markets) ? body.markets : [];
    if (markets.length === 0) return null;

    let weightedPct = 0; // Σ(marketUsd × lpLockedPct)
    let totalUsd = 0;    // Σ marketUsd
    for (const mk of markets) {
      const lp = mk.lp || {};
      const marketUsd = (Number(lp.baseUSD) || 0) + (Number(lp.quoteUSD) || 0);
      const pct = Number(lp.lpLockedPct) || 0;
      if (marketUsd <= 0) continue;
      totalUsd += marketUsd;
      weightedPct += marketUsd * pct;
    }
    if (totalUsd <= 0) return null;

    let lockedPct = weightedPct / totalUsd;
    if (lockedPct > 100) lockedPct = 100;
    if (lockedPct < 0) lockedPct = 0;
    const lockedUsd = (lockedPct / 100) * totalUsd;

    // Human label for the UI. >=95% = effectively safe (locked or burned).
    let status;
    if (lockedPct >= 95) status = "Locked";
    else if (lockedPct >= 50) status = "Partially locked";
    else status = "Unlocked";

    // Anti-rug signals from the same report (used by the sniper safety gate):
    // mint/freeze authority still enabled = dev can mint supply / freeze your tokens;
    // dangerRisks = RugCheck's own "danger"-level flags (LP unlocked, holder
    // concentration, honeypot, copycat, …). Derived from the token authorities AND
    // the named risks so it's robust to either field being the source of truth.
    const tk = body.token || {};
    const isSet = (a) => !!a && a !== "11111111111111111111111111111111";
    const risks = Array.isArray(body.risks) ? body.risks : [];
    const riskHas = (re) => risks.some((r) => re.test(String(r.name || "")));
    const mintEnabled = isSet(tk.mintAuthority) || riskHas(/mint authority/i);
    const freezeEnabled = isSet(tk.freezeAuthority) || riskHas(/freeze authority/i);
    const dangerRisks = risks
      .filter((r) => String(r.level || "").toLowerCase() === "danger")
      .map((r) => r.name)
      .filter(Boolean);

    return {
      lockedPct: Number(lockedPct.toFixed(1)),
      lockedUsd: Math.round(lockedUsd),
      totalLpUsd: Math.round(totalUsd),
      marketCount: markets.length,
      status,
      rugged: Boolean(body.rugged),
      mintEnabled,
      freezeEnabled,
      dangerRisks,
    };
  } catch {
    return null;
  }
}
