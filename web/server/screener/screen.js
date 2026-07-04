// Orchestrator: pull market data, compute the GEM Score, and (optionally) alert.
// Kept framework-free so it can be reused by the Express proxy AND by an MCP
// server / CLI without dragging Express in.

import { fetchDexScreener, fetchSolscanHolders, fetchRugcheckLock, fetchPumpfun } from "./sources.js";
import { fetchSmartMoney } from "./smartMoney.js";
import { computeGemScore } from "./gemScore.js";
import { sendAlert, trojanBuyLink } from "./telegram.js";

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidMint(addr) {
  return typeof addr === "string" && SOLANA_ADDR.test(addr.trim());
}

/**
 * Screen a single token -> full GEM Score report.
 * @param {string} tokenAddress
 * @param {object} opts  { solscanKey, nowMs }
 */
export async function screenToken(tokenAddress, { solscanKey, nowMs, skipLock = false, birdeyeKey, heliusKey } = {}) {
  const addr = tokenAddress.trim();
  if (!isValidMint(addr)) throw new Error("Invalid Solana mint address (base58, 32–44 chars).");

  const metrics = await fetchDexScreener(addr);
  if (!metrics) {
    throw new Error("Token not listed on any Solana DEX (no DexScreener data). Too new or invalid.");
  }
  // Holder + lock + pump.fun + smart-money enrichment run in parallel; all degrade
  // to null on failure. skipLock skips the slower calls — used by the bulk scan so
  // it stays fast; enrichment/single-token screening fetches everything.
  // pump.fun is only queried for pump-origin mints; smart-money only when a
  // Birdeye key is configured.
  const looksPump = addr.toLowerCase().endsWith("pump") || String(metrics.dexId || "").includes("pump");
  const [holders, lock, pumpfun, smartMoney] = await Promise.all([
    fetchSolscanHolders(addr, solscanKey),
    skipLock ? Promise.resolve(null) : fetchRugcheckLock(addr),
    skipLock || !looksPump ? Promise.resolve(null) : fetchPumpfun(addr),
    skipLock || !birdeyeKey ? Promise.resolve(null) : fetchSmartMoney(addr, { birdeyeKey, heliusKey }),
  ]);
  const report = computeGemScore(metrics, holders, nowMs ?? null, lock);
  report.pumpfun = pumpfun;
  report.smartMoney = smartMoney;
  report.trojanLink = trojanBuyLink(addr);
  report.holdersEnriched = Boolean(holders);
  report.lockEnriched = Boolean(lock);
  report.pumpEnriched = Boolean(pumpfun);
  report.smartEnriched = Boolean(smartMoney);
  return report;
}

/** Screen then push a Telegram alert. Returns { report, alert }. */
export async function screenAndAlert(tokenAddress, { solscanKey, nowMs, telegram } = {}) {
  const report = await screenToken(tokenAddress, { solscanKey, nowMs });
  const alert = await sendAlert(report, telegram || {});
  return { report, alert };
}

/** Batch screen several tokens, ranked best-first. Failures become rows too. */
export async function batchScreen(addresses, opts = {}) {
  const results = await Promise.all(
    addresses.map(async (addr) => {
      try {
        const r = await screenToken(addr, opts);
        return { address: addr, ok: true, gemScore: r.gemScore, verdict: r.verdict.label, report: r };
      } catch (e) {
        return { address: addr, ok: false, error: String(e.message || e) };
      }
    })
  );
  return results.sort((a, b) => (b.gemScore || -1) - (a.gemScore || -1));
}
