// Live Sniper Monitor (SNIPER ENGINE Modul C). The part that makes the loop live:
// every SNIPER_POLL_MIN it sweeps the ACTIVE watchlist (top wallets from Modul B),
// reads each wallet's most recent buys (Helius), and raises a SIGNAL when ≥
// SNIPER_SIGNAL_MIN distinct proven wallets are buying the SAME fresh token that's
// still small (mcap < cap). That's "smart money is accumulating this BEFORE the
// pump" — the whole point of the sniper. Signals are deduped and expire, and shown
// in the UI (D4: no dedicated alert channel yet; Telegram optional later).
//
// Cost: |active wallets| Helius calls per sweep (40 × /5min ≈ 8/min) — light.
// Everything degrades to null/[] on failure; a sweep never throws into the loop.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getActiveWallets, getWalletMeta, POLL_MIN } from "./watchlist.js";
import { screenToken } from "./screen.js";
import { getParams } from "./sniperParams.js";
import { recordSignals, gradeMatured } from "./sniperTrack.js";

const HELIUS = "https://api.helius.xyz";
const BIRDEYE = "https://public-api.birdeye.so";

// v2: every sniper tunable now lives in a runtime-editable registry
// (sniperParams.js) and is read at SWEEP time via getParams() — so a change from the
// Settings UI takes effect on the next sweep, no restart. Env vars (SNIPER_*) still
// seed the defaults (backward compatible). See sniperParams.js for the full list:
//   Deteksi: requireSwap, minBuyUsd (C6 dust), netBuyOnly (C7), lookbackMin, recentTx
//   Skor:    signalMin, cobuyWindowMin, repWeighted, scoreMin
//   Gate:    safetyGate, allowUnknownMcap, minMcap, maxMcap, minLiquidity, minLockedPct
//   Mesin:   maxEnrich, signalTtlMin
// Only the non-tunable concurrency knob stays a constant here.
const POOL = 5; // Helius/Birdeye concurrency (fixed — burst safety, not a signal knob)

// Tokens that are never a "fresh gem" — wrapped SOL + USD stables.
const WSOL = "So11111111111111111111111111111111111111112";
const STABLE_USD = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const IGNORE_MINTS = new Set([WSOL, ...STABLE_USD]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Two independent signal streams, ONE engine --------------------------
// v2 is a superset of v1, so both streams run the SAME sweep code with different
// profiles + separate stores:
//   - "v2"   : the sharp, runtime-editable profile from the registry (getParams()).
//   - "awal" : the ORIGINAL v1 headcount behaviour — a FIXED loose profile with
//              net-buy / dust / safety-gate / reputation-weighting all OFF, so a mere
//              count of distinct wallets buying a still-small token raises a signal.
//              Kept as a reference baseline beside v2; intentionally NOT editable.
const AWAL_PROFILE = Object.freeze({
  // minMcap floor $20rb tetap diberlakukan meski profil ini "longgar" — sesuai
  // permintaan batas minimal market cap di sinyal sniper live untuk semua aliran.
  signalMin: 2, maxMcap: 2_000_000, minMcap: 20_000, minLiquidity: 0, minLockedPct: 0,
  scoreMin: 0, cobuyWindowMin: 15, lookbackMin: 90, recentTx: 20, signalTtlMin: 360,
  maxEnrich: 20, requireSwap: false, allowUnknownMcap: true, netBuyOnly: false,
  minBuyUsd: 0, repWeighted: false, safetyGate: false, trackHolding: false,
});
const profileFor = (variant) => (variant === "awal" ? AWAL_PROFILE : getParams());

// Per-variant store, file-persisted; fail-safe on a read-only/ephemeral FS.
const STORES = {
  v2:   { file: fileURLToPath(new URL("./.sniper-state.json", import.meta.url)),      signals: new Map() },
  awal: { file: fileURLToPath(new URL("./.sniper-awal-state.json", import.meta.url)), signals: new Map() },
};
for (const st of Object.values(STORES)) {
  try {
    const saved = JSON.parse(readFileSync(st.file, "utf8"));
    if (Array.isArray(saved.signals)) st.signals = new Map(saved.signals.map((s) => [s.mint, s]));
  } catch { /* no file / unreadable — start empty */ }
}
function save(store) {
  try {
    writeFileSync(store.file, JSON.stringify({ signals: [...store.signals.values()] }, null, 2), "utf8");
  } catch { /* read-only FS — keep in memory */ }
}

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

// Bounded-concurrency map so a 40-wallet sweep doesn't burst Helius.
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

// A wallet's recent token SWAPS (buys AND sells) within the lookback window, from
// Helius parsed txs. Returns [{ mint, side:'buy'|'sell', at, tokens, priceUsd, sizeUsd }].
//
// C2: a receipt alone is NOT a buy. A BUY = owner spent consideration (native SOL
// out, or wSOL/USDC/USDT out) AND received a non-stable token in the SAME tx. A
// SELL is the mirror: owner sent a non-stable token AND received consideration.
// Tracking sells is what lets the sweep compute a NET position (C7) so a wallet that
// bought then dumped in-window isn't counted as accumulating. With P.requireSwap we
// also insist the tx parses as a swap (kills airdrops/inbound sends/self-transfers).
//
// C9: consideration is valued in USD (current SOL price, ~ok within the lookback) to
// surface each wallet's ENTRY price/size. Detection stays price-independent — a
// SOL-paid buy still counts if solPrice is unknown, it just has no USD size.
// C6: dust buys below P.minBuyUsd are dropped (bot test-buys); a buy whose size is
// unmeasurable (solPrice unknown / multi-token) is kept (fail-open, never silently lost).
async function recentSwaps(owner, key, sinceSec, solPrice, P) {
  const res = await fetchRetry(`${HELIUS}/v0/addresses/${owner}/transactions?api-key=${key}&limit=${P.recentTx}`, {
    headers: { accept: "application/json" },
  });
  if (!res || !res.ok) return [];
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  const swaps = [];
  for (const tx of arr) {
    const at = Number(tx.timestamp) || 0;
    if (at < sinceSec) continue;
    if (P.requireSwap && tx.type !== "SWAP" && !tx.events?.swap) continue;

    const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
    const natives = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];

    // Consideration the owner PAID (→ buy) and RECEIVED (→ sell), amount-based.
    let solOut = 0, wsolOut = 0, stableOut = 0, solIn = 0, wsolIn = 0, stableIn = 0;
    for (const n of natives) {
      if (n.fromUserAccount === owner) solOut += Number(n.amount) || 0; // lamports
      else if (n.toUserAccount === owner) solIn += Number(n.amount) || 0;
    }
    const received = new Map(); // non-stable tokens owner got (bought)
    const sent = new Map();     // non-stable tokens owner gave (sold)
    for (const t of transfers) {
      const amt = Number(t.tokenAmount) || 0;
      if (amt <= 0) continue;
      if (t.fromUserAccount === owner) {
        if (t.mint === WSOL) wsolOut += amt;
        else if (STABLE_USD.has(t.mint)) stableOut += amt;
        else if (t.mint) sent.set(t.mint, (sent.get(t.mint) || 0) + amt);
      } else if (t.toUserAccount === owner) {
        if (t.mint === WSOL) wsolIn += amt;
        else if (STABLE_USD.has(t.mint)) stableIn += amt;
        else if (t.mint && !IGNORE_MINTS.has(t.mint)) received.set(t.mint, (received.get(t.mint) || 0) + amt);
      }
    }

    const paidUsd = (solOut / 1e9 + wsolOut) * solPrice + stableOut; // 0 if solPrice unknown & no stable
    const recvUsd = (solIn / 1e9 + wsolIn) * solPrice + stableIn;

    // BUY leg: paid consideration + received target token(s). Entry price/size only
    // unambiguous when a single target token was received.
    if ((solOut > 0 || wsolOut > 0 || stableOut > 0) && received.size > 0) {
      const single = received.size === 1;
      for (const [mint, amt] of received) {
        const priceUsd = single && paidUsd > 0 && amt > 0 ? paidUsd / amt : null;
        const sizeUsd = single && paidUsd > 0 ? paidUsd : null;
        // C6 dust filter — only drop when the size is actually measurable.
        if (P.minBuyUsd > 0 && sizeUsd != null && sizeUsd < P.minBuyUsd) continue;
        swaps.push({ mint, side: "buy", at, tokens: amt, priceUsd, sizeUsd });
      }
    }
    // SELL leg: received consideration + sent target token(s).
    if ((solIn > 0 || wsolIn > 0 || stableIn > 0) && sent.size > 0) {
      const single = sent.size === 1;
      for (const [mint, amt] of sent) {
        const priceUsd = single && recvUsd > 0 && amt > 0 ? recvUsd / amt : null;
        const sizeUsd = single && recvUsd > 0 ? recvUsd : null;
        swaps.push({ mint, side: "sell", at, tokens: amt, priceUsd, sizeUsd });
      }
    }
  }
  return swaps;
}

// Enrich a candidate token with current mcap/identity so we only signal ones that
// are still small (early). null → skip (unknown or too big).
async function tokenSnapshot(mint, key) {
  try {
    const res = await fetchRetry(`${BIRDEYE}/defi/token_overview?address=${mint}`, {
      headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    const d = (await res.json())?.data;
    if (!d) return null;
    return {
      symbol: d.symbol || "",
      name: d.name || "",
      logoUrl: d.logoURI || d.logo || null,
      mcap: Math.round(Number(d.marketCap ?? d.mc) || 0),
      priceUsd: Number(d.price) || 0,
    };
  } catch { return null; }
}

// RPC endpoints for the holdings check, tried in order. Helius first (fast, keyed),
// then PUBLIC Solana RPCs as fallback — critical because the Helius free-tier RPC
// hits "max usage reached" (429) under sniper load, which would otherwise leave
// every wallet 'unknown' and block exit-pruning. Public RPCs keep hold-tracking
// alive so a fully-exited signal still gets removed from the list.
const HOLDINGS_RPCS = (key) => [
  key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : null,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);

// Does `owner` currently hold `mint` (summed uiAmount > 0)? Uses the lightweight
// {mint} filter — public RPCs allow it, whereas the {programId} "list everything"
// form is blocked by some (e.g. publicnode). Tries each endpoint until one resolves;
// returns true/false, or null ONLY when every endpoint failed — the caller treats
// null as "unknown" and never prunes on unknown, so a blip can't wipe signals.
async function holdsMint(owner, mint, key) {
  for (const rpc of HOLDINGS_RPCS(key)) {
    try {
      const body = { jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }] };
      const res = await fetchRetry(rpc, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!res || !res.ok) continue;                 // endpoint failed → try next
      const j = await res.json().catch(() => null);
      if (!j || j.error) continue;                   // JSON-RPC error (e.g. 429) → next
      const accts = j.result?.value;
      if (!Array.isArray(accts)) continue;
      let bal = 0;
      for (const a of accts) bal += Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0;
      return bal > 0;                                // resolved: holds iff any balance
    } catch { /* try next endpoint */ }
  }
  return null; // all endpoints failed → unknown (fail-safe)
}

// C4 safety gate. Reuses the canonical screener (screenToken → DexScreener +
// RugCheck + Pump.fun) and applies sniper-appropriate red lines. NOTE: we do NOT
// apply Pro Radar's full quality gate — that demands mature volume/graduation,
// which would reject exactly the fresh "before pump" tokens the sniper targets.
// Returns { ok, reasons, unscreenable, metrics }. `metrics` (DexScreener) doubles
// as an identity/mcap fallback when Birdeye doesn't know the token. Never throws.
async function safetyCheck(mint, { heliusKey }, P) {
  let report;
  try {
    // No birdeyeKey → skips the (unneeded here) Birdeye smart-money call; no
    // solscanKey → holders null. We only want DexScreener + RugCheck + Pump.fun.
    report = await screenToken(mint, { nowMs: Date.now(), heliusKey });
  } catch {
    return { ok: false, unscreenable: true, reasons: ["belum listing DEX — tak bisa diverifikasi"], metrics: null };
  }
  const m = report.metrics || {};
  const lock = report.liquidityLock || null;
  const pump = report.pumpfun || null;
  const liq = m.liquidityUsd || 0;
  const mc = m.marketCap || 0;
  const { buys = 0, sells = 0 } = m.txns24h || {};
  const tx = buys + sells;
  const ratio = tx > 0 ? buys / tx : 0.5;

  const reasons = [];
  // Non-RugCheck red lines (DexScreener + Pump.fun) — independent of RugCheck data.
  if (pump?.banned) reasons.push("di-ban Pump.fun");
  if (pump?.nsfw) reasons.push("ditandai NSFW (Pump.fun)");
  if (pump?.hidden) reasons.push("disembunyikan Pump.fun");
  if (liq < P.minLiquidity) reasons.push(`likuiditas $${Math.round(liq).toLocaleString()} di bawah batas`);
  if (mc > 0 && mc < P.minMcap) reasons.push("mcap terlalu mikro");
  // Honeypot shape only once there are enough trades to judge (avoids false positives on brand-new tokens).
  if (tx >= 10 && ratio > 0.95) reasons.push("hampir semua beli — indikasi honeypot");

  // Anti-rug via RugCheck. FAIL-OPEN: when RugCheck has no data yet (brand-new
  // token), don't reject on rug rules — flag `riskUnknown` so the UI can warn (⚠).
  let riskUnknown = false;
  if (lock) {
    if (lock.rugged) reasons.push("ditandai rugged (RugCheck)");
    if (P.rugMintRenounced !== false && lock.mintEnabled) reasons.push("mint authority belum di-renounce (dev bisa cetak supply)");
    if (P.rugNoFreeze !== false && lock.freezeEnabled) reasons.push("freeze authority aktif (dev bisa bekukan token)");
    if (P.rugBlockDanger !== false && Array.isArray(lock.dangerRisks) && lock.dangerRisks.length) {
      reasons.push("RugCheck bahaya: " + lock.dangerRisks.slice(0, 2).join(", "));
    }
    if (P.minLockedPct > 0 && typeof lock.lockedPct === "number" && lock.lockedPct < P.minLockedPct) {
      reasons.push(`LP terkunci ${lock.lockedPct}% < ${P.minLockedPct}%`);
    }
  } else {
    riskUnknown = true; // RugCheck belum punya data → fail-open, tandai ⚠
  }

  return { ok: reasons.length === 0, reasons, unscreenable: false, riskUnknown, metrics: m };
}

/**
 * One monitor sweep. Reads active-watchlist wallets' recent buys, groups by token,
 * and raises/refreshes a signal when ≥ SIGNAL_MIN distinct wallets bought the same
 * still-small token. Returns { swept, candidates, newSignals, signals }.
 */
export async function runSniperSweep({ variant = "v2", heliusKey, birdeyeKey, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  if (!heliusKey) return { variant, disabled: true, reason: "Helius key belum diset", swept: 0, newSignals: 0, signals: getSignals(variant).signals };

  // Resolve this variant's profile + store. v2 = editable registry; awal = fixed v1.
  const P = profileFor(variant);
  const store = STORES[variant] || STORES.v2;
  const signals = store.signals;

  // Sweep the active smart wallets (Modul B, auto-ranked by reputation).
  const active = getActiveWallets();
  if (active.length === 0) return { variant, swept: 0, candidates: 0, newSignals: 0, signals: getSignals(variant).signals };

  const sinceSec = Math.floor(now / 1000) - P.lookbackMin * 60;

  // Current SOL price (once per sweep) so we can value each buy in USD. Best-effort:
  // if Birdeye is down, solPrice = 0 and buys still count, just without a USD entry.
  const solPrice = (await tokenSnapshot(WSOL, birdeyeKey))?.priceUsd || 0;

  // 1) Gather each active wallet's recent swaps (buys + sells, with entry price/size).
  const perWallet = await mapPool(active, POOL, (owner) => recentSwaps(owner, heliusKey, sinceSec, solPrice, P).then((s) => ({ owner, swaps: s })));

  // 2) Group by token → per wallet, accumulate buy/sell token amounts and keep the
  // EARLIEST buy in the window as its entry (at + price + size). lastAt tracks the
  // freshest BUY so the "last activity" reflects accumulation, not an exit.
  const byToken = new Map(); // mint → { wallets: Map(owner → {at, priceUsd, sizeUsd, buyTokens, sellTokens}), lastAt }
  for (const row of perWallet) {
    if (!row) continue;
    for (const s of row.swaps) {
      let g = byToken.get(s.mint);
      if (!g) { g = { wallets: new Map(), lastAt: 0 }; byToken.set(s.mint, g); }
      let w = g.wallets.get(row.owner);
      if (!w) { w = { at: Infinity, priceUsd: null, sizeUsd: null, buyTokens: 0, sellTokens: 0 }; g.wallets.set(row.owner, w); }
      if (s.side === "buy") {
        w.buyTokens += s.tokens;
        if (s.at < w.at) { w.at = s.at; w.priceUsd = s.priceUsd; w.sizeUsd = s.sizeUsd; } // earliest buy = entry
        if (s.at > g.lastAt) g.lastAt = s.at;
      } else {
        w.sellTokens += s.tokens;
      }
    }
  }

  // 3) Per token, keep only wallets that actually accumulated: bought something and
  // (C7 netBuyOnly) whose net token position is positive — a wallet that bought then
  // dumped in-window isn't "accumulating". Candidates = tokens with enough such
  // wallets (confluence). Strongest first, capped so a burst can't blow up enrich cost.
  const tokenAgg = [];
  for (const [mint, g] of byToken) {
    const eff = new Map();
    let netFiltered = 0;
    for (const [owner, w] of g.wallets) {
      if (w.buyTokens <= 0) continue;                                   // only-sold / never bought here
      if (P.netBuyOnly && w.buyTokens - w.sellTokens <= 0) { netFiltered++; continue; } // C7 net ≤ 0
      eff.set(owner, { at: w.at, priceUsd: w.priceUsd, sizeUsd: w.sizeUsd });
    }
    if (eff.size > 0) tokenAgg.push({ mint, wallets: eff, lastAt: g.lastAt, netFiltered });
  }
  const candidates = tokenAgg
    .filter((t) => t.wallets.size >= P.signalMin)
    .sort((a, b) => b.wallets.size - a.wallets.size)
    .slice(0, P.maxEnrich);

  // 4) Enrich (Birdeye identity/price) + C4 safety gate (screener: liquidity, rug,
  // LP, honeypot), then raise/refresh signals. Both run bounded-concurrency.
  let newSignals = 0;
  const snaps = await mapPool(candidates, POOL, (t) => tokenSnapshot(t.mint, birdeyeKey));
  const safeties = await mapPool(candidates, POOL, (t) => (P.safetyGate ? safetyCheck(t.mint, { heliusKey }, P) : null));
  candidates.forEach((t, i) => {
    const { mint, wallets, lastAt, netFiltered } = t;
    const snap = snaps[i];
    const safety = safeties[i];
    const dsm = safety?.metrics || null; // DexScreener metrics — second source

    // Identity/price: prefer Birdeye, fall back to DexScreener (from the safety
    // check). This is what lets a Birdeye-unknown token still resolve a real mcap
    // and count as verified — the C1 "fresh token" path, now backed by a source.
    const symbol = snap?.symbol || dsm?.symbol || "";
    const name = snap?.name || dsm?.name || "";
    const logoUrl = snap?.logoUrl || dsm?.logoUrl || null;
    const mcap = snap && snap.mcap > 0 ? snap.mcap : Math.round(dsm?.marketCap || 0);
    const curPrice = snap?.priceUsd || dsm?.priceUsd || 0;
    const liquidityUsd = dsm ? Math.round(dsm.liquidityUsd || 0) : null;
    const known = mcap > 0;

    // Gate. With safetyGate on, a candidate must clear the safety check — an
    // unsafe OR unverifiable (not on any DEX) token is withheld (fail-closed), so
    // `unverified` tokens only ever reach the UI once on-chain safety is clean.
    if (P.safetyGate) {
      if (!safety || !safety.ok) return;
    } else if (!known && !P.allowUnknownMcap) {
      return;
    }
    if (known && mcap > P.maxMcap) return; // already too big — missed the early window
    // Hard mcap floor on the DISPLAYED mcap (Birdeye→DexScreener). Enforced here for
    // BOTH streams and regardless of safetyGate, so the "batas minimal market cap"
    // holds even when safetyCheck's DexScreener mcap disagrees or is unknown.
    if (known && P.minMcap > 0 && mcap < P.minMcap) return; // below the mcap floor — too micro

    // C9: per-wallet smart-money positions — reputation + entry + current PnL.
    const positions = [...wallets.entries()].map(([owner, e]) => {
      const meta = getWalletMeta(owner);
      const pnlX = curPrice > 0 && e.priceUsd > 0 ? curPrice / e.priceUsd : null;
      const entryMcap = known && pnlX ? Math.round(mcap / pnlX) : null;
      return {
        owner,
        reputation: meta.reputation,
        established: meta.established,
        at: e.at * 1000,
        entryPriceUsd: e.priceUsd || null,
        entryMcap,
        sizeUsd: e.sizeUsd ? Math.round(e.sizeUsd) : null,
        pnlX,
      };
    }).sort((a, b) => b.reputation - a.reputation || (b.sizeUsd || 0) - (a.sizeUsd || 0));

    // C5/C10: composite strength score. Reputation dominates (weighted Σ, or a flat
    // per-head value when REP_WEIGHTED is off), plus a log-scaled buy-size bonus and
    // a co-buy density bonus (wallets buying within the tight COBUY window = coordinated
    // conviction). Below SCORE_MIN → too weak, withhold.
    const repSum = positions.reduce((s, p) => s + (p.reputation || 0), 0);
    const repComponent = P.repWeighted ? repSum : wallets.size * 50;
    const totalSize = positions.reduce((s, p) => s + (p.sizeUsd || 0), 0);
    const sizeBonus = totalSize > 0 ? Math.min(60, Math.log10(Math.max(1, totalSize)) * 15) : 0;

    const times = positions.map((p) => p.at).filter(Boolean).sort((a, b) => a - b); // ms, ascending
    const winMs = P.cobuyWindowMin * 60_000;
    let maxCobuy = times.length ? 1 : 0;
    for (let a = 0; a < times.length; a++) {
      let c = 1;
      for (let b = a + 1; b < times.length; b++) { if (times[b] - times[a] <= winMs) c++; else break; }
      if (c > maxCobuy) maxCobuy = c;
    }
    const cobuyBonus = Math.max(0, maxCobuy - 1) * 30;
    const score = Math.round(repComponent + sizeBonus + cobuyBonus);
    if (score < P.scoreMin) return; // confluence too weak — "sedikit tapi tajam"

    const topRep = positions.reduce((m, p) => Math.max(m, p.reputation || 0), 0);
    const why = [`${wallets.size} smart wallet sepakat`];
    if (P.repWeighted && repSum > 0) why.push(`reputasi total ${repSum} (top ${topRep})`);
    if (maxCobuy >= 2) why.push(`${maxCobuy} beli dalam ${P.cobuyWindowMin} menit (rapat)`);
    if (totalSize > 0) why.push(`total beli ~$${Math.round(totalSize).toLocaleString()}`);
    if (netFiltered > 0) why.push(`${netFiltered} wallet diabaikan (net jual)`);

    const existing = signals.get(mint);
    signals.set(mint, {
      mint,
      symbol,
      name,
      logoUrl,
      mcap,
      priceUsd: curPrice,
      liquidityUsd,
      unverified: !known,                    // market data not confirmed → UI warns, DYOR
      safetyChecked: P.safetyGate,           // passed the C4 gate this sweep
      riskUnknown: P.safetyGate ? !!safety?.riskUnknown : false, // RugCheck belum bisa cek rug → ⚠
      score,
      why,
      walletCount: wallets.size,
      netFiltered,                           // C7: wallets dropped for net-selling in-window
      wallets: [...wallets.keys()],
      positions,
      lastBuyAt: lastAt * 1000,
      firstDetectedAt: existing?.firstDetectedAt || now,
      updatedAt: now,
      isNew: !existing,
    });
    if (!existing) newSignals++;
  });

  // 4.5) Hold / exit reconciliation. Check whether the smart wallets behind each
  // LIVE signal still hold the token on-chain. Drop a signal once every known wallet
  // has SOLD (smart money fully exited); keep — and keep alive (refresh TTL) — a
  // signal while ≥1 wallet still holds, so it stays visible as long as smart money
  // is holding or accumulating. Fail-safe: a wallet whose balance can't be fetched
  // is "unknown" and never counts toward an exit, so an RPC blip can't wipe signals.
  if (P.trackHolding && signals.size > 0) {
    // One light {mint} balance check per unique (owner, mint) pair across all signals.
    const pairs = [];
    const seenPair = new Set();
    for (const [mint, s] of signals) {
      for (const p of s.positions || []) {
        const pk = p.owner + "|" + mint;
        if (seenPair.has(pk)) continue;
        seenPair.add(pk);
        pairs.push({ owner: p.owner, mint, pk });
      }
    }
    const fetched = await mapPool(pairs, POOL, (pr) => holdsMint(pr.owner, pr.mint, heliusKey).then((h) => ({ pk: pr.pk, h })));
    const holdMap = new Map(fetched.filter(Boolean).map((x) => [x.pk, x.h])); // "owner|mint" → true|false|null
    for (const [mint, s] of signals) {
      let holders = 0, sold = 0, unknown = 0;
      for (const p of s.positions || []) {
        const h = holdMap.get(p.owner + "|" + mint);
        if (h == null) { p.holding = null; unknown++; }   // fetch failed → unknown
        else if (h) { p.holding = true; holders++; }      // still holds
        else { p.holding = false; sold++; }               // exited / sold
      }
      s.holders = holders;
      s.soldOff = sold;
      s.holdersUnknown = unknown;
      // Remove once smart-money confluence is broken by exits — blip-safe even when
      // some balances failed to fetch. `sold` counts only CONFIRMED sells (fetch OK,
      // mint absent); `holders + unknown` assumes every unresolved wallet still holds
      // (best case), so an RPC blip can never push the count below the threshold and
      // wrongly wipe a signal. Drop when ≥1 wallet confirmably exited AND even in that
      // best case fewer than signalMin (2) wallets still hold → confluence gone. Also
      // covers full exit (holders 0). Works on a flaky network without waiting for TTL.
      if (sold > 0 && (holders + unknown) < P.signalMin && (s.positions?.length || 0) > 0) {
        signals.delete(mint);
        continue;
      }
      // Still held (≥ signalMin) but not re-bought this sweep → refresh TTL so it
      // stays visible while smart money keeps holding.
      if (s.updatedAt < now && holders > 0) s.updatedAt = now;
    }
  }

  // 5) Time-based expiry — ALWAYS on, as an efficiency backstop so the list never
  // keeps dead tokens. `updatedAt` is bumped only when smart money is still
  // confirmably HOLDING (4.5, holders>0) or re-accumulated this sweep, so an
  // actively-held/accumulated token keeps refreshing and never expires — while a
  // token whose smart money has exited (or can't be confirmed because RPC blips
  // left wallets 'unknown', which the immediate-exit prune above can't act on)
  // stops being refreshed and ages out. This is what removes signals once nobody
  // is accumulating or holding them anymore, even on a flaky network.
  const cutoff = now - P.signalTtlMin * 60_000;
  for (const [mint, s] of signals) if (s.updatedAt < cutoff) signals.delete(mint);

  save(store);

  // Persistent PnL track (like Pro Radar's learn.js): snapshot each freshly-raised
  // signal's entry once, then grade matured records against the live price — so the
  // sniper's realized PnL survives signal expiry/exit. Must never break a sweep.
  const surfaced = getSignals(variant).signals;
  try {
    recordSignals(surfaced, variant, now);
    await gradeMatured(now);
  } catch { /* tracking is best-effort — a sweep never fails because of it */ }

  return { variant, swept: active.length, candidates: candidates.length, newSignals, signals: surfaced };
}

/** Current live signals (freshest first), plus config for the UI. */
export function getSignals(variant = "v2") {
  const P = profileFor(variant);
  const store = STORES[variant] || STORES.v2;
  // Batas minimal market cap ditegakkan juga di titik BACA — jadi menaikkan floor
  // langsung menyembunyikan sinyal lama yang mcap-nya di bawah ambang (tanpa nunggu
  // TTL). Hanya menyaring yang mcap-nya diketahui (>0); unverified diurus terpisah.
  const floor = P.minMcap > 0 ? P.minMcap : 0;
  // Rank by how many smart wallets are on the token — current holders if hold-tracking
  // is on, else the buy count — then composite strength, then recency as tiebreaks.
  const smCount = (s) => (s.holders != null ? s.holders : (s.walletCount || 0));
  const list = [...store.signals.values()]
    .filter((s) => !(floor > 0 && s.mcap > 0 && s.mcap < floor))
    .sort((a, b) =>
      smCount(b) - smCount(a) ||
      (b.walletCount || 0) - (a.walletCount || 0) ||
      (b.score || 0) - (a.score || 0) ||
      b.updatedAt - a.updatedAt
    );
  return {
    variant,
    count: list.length,
    signalMin: P.signalMin,
    maxMcap: P.maxMcap,
    pollMin: POLL_MIN,
    safetyGate: P.safetyGate,
    minMcap: P.minMcap,
    minLiquidity: P.minLiquidity,
    scoreMin: P.scoreMin,
    cobuyWindow: P.cobuyWindowMin,
    netBuyOnly: P.netBuyOnly,
    editable: variant !== "awal",
    signals: list,
  };
}
