// evmScreen.js — Screen EVM untuk Robinhood Chain (LANGKAH #2). Padanan "GEM Score"
// di dunia EVM: metrik pasar (GeckoTerminal) + gate keamanan HEURISTIK on-chain
// (Blockscout), karena scanner rug siap-pakai (GoPlus / Honeypot.is) BELUM mendukung
// chain sebaru ini (dikonfirmasi: GoPlus "main chain not supported", Honeypot "invalid chain").
//
// Ini FONDASI BERSAMA: 10x Radar EVM (skor/filter), Bedah Coin EVM (enrich token), dan
// Sniper EVM (safety gate) semuanya memanggil screenEvmToken(). Semua fetch degrade ke
// null/parsial; tak pernah melempar. Heuristik — bukan nasihat keuangan. DYOR.

const GT = "https://api.geckoterminal.com/api/v2";
const BS = "https://robinhoodchain.blockscout.com/api/v2";
const NET = "robinhood";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON dengan retry pada 429/5xx/timeout — GeckoTerminal/Blockscout publik
// sering limit saat dipanggil beruntun; retry mencegah satu blip meng-null-kan
// metrik. Tetap null pada kegagalan permanen (pemanggil sudah degrade dengan aman).
async function jget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(600 * (i + 1)); continue; }
      if (!r || !r.ok) return null;
      return await r.json();
    } catch {
      if (i < tries - 1) { await sleep(600 * (i + 1)); continue; }
      return null;
    }
  }
  return null;
}

// GeckoTerminal: metrik pasar dari pool likuiditas-terbesar milik token.
async function gtMetrics(token) {
  const j = await jget(`${GT}/networks/${NET}/tokens/${token}/pools?page=1`);
  const pools = j?.data || [];
  if (!pools.length) return null;
  let best = null, bestLiq = -1;
  for (const p of pools) {
    const liq = Number(p.attributes?.reserve_in_usd) || 0;
    if (liq > bestLiq) { bestLiq = liq; best = p; }
  }
  const a = best.attributes || {};
  const tx = a.transactions?.h24 || {};
  return {
    poolAddress: a.address || "",
    name: a.name || "",
    priceUsd: Number(a.base_token_price_usd) || 0,
    liquidityUsd: Math.round(Number(a.reserve_in_usd) || 0),
    volume24h: Math.round(Number(a.volume_usd?.h24) || 0),
    fdvUsd: Math.round(Number(a.fdv_usd) || 0),
    // market_cap_usd hanya terisi bila circulating supply terverifikasi CoinGecko —
    // hampir selalu null untuk memecoin baru. Fallback ke FDV (≈ mcap saat semua
    // supply beredar), pola sama dengan evmAuto.js.
    mcapUsd: Math.round(Number(a.market_cap_usd) || Number(a.fdv_usd) || 0),
    change24h: a.price_change_percentage ? Number(a.price_change_percentage.h24) : null,
    createdAt: a.pool_created_at || null,
    buys24h: Number(tx.buys) || 0,
    sells24h: Number(tx.sells) || 0,
    buyers24h: Number(tx.buyers) || 0,
    sellers24h: Number(tx.sellers) || 0,
    chartUrl: a.address ? `https://www.geckoterminal.com/${NET}/pools/${a.address}?embed=1&info=0&swaps=0` : null,
  };
}

// Blockscout: identitas + sinyal keamanan on-chain (jumlah holder, reputasi, supply).
async function bsToken(token) {
  const t = await jget(`${BS}/tokens/${token}`);
  if (!t) return null;
  return {
    name: t.name || "",
    symbol: t.symbol || "",
    type: t.type || "",
    decimals: Number(t.decimals) || 0,
    holdersCount: t.holders_count != null ? Number(t.holders_count) : null,
    totalSupply: t.total_supply || null,
    reputation: t.reputation || null, // Blockscout dapat menandai 'scam'/'spam'
  };
}

// Konsentrasi kepemilikan: % supply di holder terbesar NON-pool (LP dikecualikan,
// juga alamat burn/dead). Tinggi = risiko rug/dump.
async function bsConcentration(token, totalSupply, poolAddress) {
  const sup = Number(totalSupply);
  if (!(sup > 0)) return null;
  const j = await jget(`${BS}/tokens/${token}/holders`);
  const items = j?.items || [];
  if (!items.length) return null;
  const pool = (poolAddress || "").toLowerCase();
  let topPct = 0, top5 = 0, counted = 0;
  for (const h of items) {
    const addr = (h.address?.hash || "").toLowerCase();
    if (!addr || addr === pool) continue;                 // kecualikan LP pool
    if (/^0x0+$/.test(addr) || addr.endsWith("dead")) continue; // burn/dead
    const pct = (Number(h.value) || 0) / sup * 100;
    if (pct > topPct) topPct = pct;
    if (counted < 5) { top5 += pct; counted++; }
  }
  return { topHolderPct: Math.round(topPct * 10) / 10, top5Pct: Math.round(top5 * 10) / 10 };
}

const clamp = (lo, hi, n) => Math.max(lo, Math.min(hi, n));

/**
 * Screen satu token EVM di Robinhood Chain.
 * @param {string} token alamat 0x…
 * @param {{minLiquidity?: number}} opts
 * @returns metrik + safety gate + skor 0-100 + verdict STRONG/WATCH/SKIP.
 */
export async function screenEvmToken(token, { minLiquidity = 10000 } = {}) {
  const addr = String(token || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { error: "alamat token EVM tidak valid" };

  const [m, bt] = await Promise.all([gtMetrics(addr), bsToken(addr)]);
  if (!m && !bt) return { error: "token tak ditemukan di GeckoTerminal / Blockscout" };

  const conc = m && bt?.totalSupply ? await bsConcentration(addr, bt.totalSupply, m.poolAddress) : null;

  // ---- Gate keamanan heuristik (on-chain; bukan simulasi honeypot penuh) ----
  const reasons = [];
  let risk = "low";
  const bump = (lvl) => { if (lvl === "high") risk = "high"; else if (lvl === "med" && risk !== "high") risk = "med"; };

  const liq = m?.liquidityUsd ?? 0;
  if (m && liq < minLiquidity) { reasons.push(`likuiditas tipis ($${liq.toLocaleString()})`); bump("high"); }
  if (m && m.buys24h > 20 && m.sells24h === 0) { reasons.push("tak ada penjualan 24j (indikasi honeypot)"); bump("high"); }
  if (bt?.reputation && /scam|spam/i.test(bt.reputation)) { reasons.push(`Blockscout menandai reputasi '${bt.reputation}'`); bump("high"); }
  if (bt?.holdersCount != null && bt.holdersCount < 50) { reasons.push(`holder sangat sedikit (${bt.holdersCount})`); bump("med"); }
  if (conc && conc.topHolderPct >= 30) { reasons.push(`1 wallet pegang ${conc.topHolderPct}% supply`); bump(conc.topHolderPct >= 50 ? "high" : "med"); }
  const safeOk = risk !== "high";

  // ---- Skor kualitas/momentum 0-100 ----
  let score = 0;
  if (m) {
    score += clamp(0, 25, (Math.log10(Math.max(1, liq)) - 3) * 12.5);        // kedalaman: $10k=12.5, $100k=25
    const turn = liq > 0 ? m.volume24h / liq : 0;
    score += clamp(0, 25, turn * 8);                                          // turnover 3x ≈ 24
    score += clamp(0, 20, (m.buyers24h || 0) / 50);                           // 1000 pembeli = 20
    const txTot = m.buys24h + m.sells24h;
    const buyRatio = txTot > 0 ? m.buys24h / txTot : 0.5;
    score += clamp(0, 15, (buyRatio - 0.5) * 2 * 15);                         // tekanan beli
    if (m.change24h > 0) score += clamp(0, 15, m.change24h / 10);             // +150% = 15
  }
  if (bt?.holdersCount >= 500) score += 5;                                    // bonus sebaran holder
  score = Math.round(clamp(0, 100, score));

  // ---- Verdict ----
  let verdict;
  if (!safeOk) verdict = "SKIP";
  else if (score >= 65) verdict = "STRONG";
  else if (score >= 40) verdict = "WATCH";
  else verdict = "SKIP";

  return {
    token: addr,
    name: bt?.name || m?.name || "",
    symbol: bt?.symbol || "",
    chain: "Robinhood Chain",
    metrics: m,
    holders: bt?.holdersCount ?? null,
    concentration: conc,
    reputation: bt?.reputation ?? null,
    safety: { ok: safeOk, risk, reasons },
    score,
    verdict,
    note: "Heuristik on-chain — scanner rug siap-pakai belum mendukung Robinhood Chain. DYOR.",
  };
}
