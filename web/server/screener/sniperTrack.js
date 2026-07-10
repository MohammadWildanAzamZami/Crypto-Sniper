// Persistent PnL track record for the Live Sniper (SNIPER ENGINE Modul C).
//
// Mirrors the Pro Radar's learn.js: every signal is snapshotted with its ENTRY
// (mcap + price at first detection — i.e. "the moment the tool signalled") and
// graded a few hours later against the live price. The record survives even after
// the signal expires (TTL) or its smart money exits, so the sniper's realized PnL
// is captured automatically instead of vanishing with the live signal.
//
// This is evidence, NOT prediction, and NOT financial advice. Unlike learn.js it does
// not tune anything — the sniper's thresholds live in sniperParams.js; this module
// only measures outcomes so the operator can see "when a signal fired, PnL = ?".
//
// Persistence mirrors the sniper store: file-backed (`.sniper-track.json`) with an
// in-memory fallback on a read-only/ephemeral filesystem.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchDexScreener } from "./sources.js";

const FILE_PATH = fileURLToPath(new URL("./.sniper-track.json", import.meta.url));

// How long a signal "matures" before we grade it. Memecoins move fast; a few hours
// is enough to see whether the accumulation ran, dumped, or died.
const GRADE_AFTER_MS = Number(process.env.SNIPER_GRADE_AFTER_MIN || 180) * 60_000;
// A signal is only snapshotted as a fresh ENTRY if we catch it near its first
// detection — otherwise (e.g. after a restart re-surfaces an old live signal) its
// current price is NOT its entry and we'd mislabel PnL. Better to miss than mislabel.
const FRESH_ENTRY_MS = Number(process.env.SNIPER_FRESH_ENTRY_MIN || 20) * 60_000;

const MAX_RECORDS = 800;        // cap stored history
const MAX_GRADE_PER_RUN = 12;   // bound the price-refetch work per sweep
const GRADE_CONCURRENCY = 6;

// Outcome classification (return = (now - entry) / entry) — same cuts as Pro Radar
// so the two track records are directly comparable.
const RUG_PRICE_FLOOR = 0.1;    // <=10% of entry (or delisted) counts as a rug
const LOSS_THRESHOLD = -0.25;   // <=-25% is a loss
const WIN_THRESHOLD = 0.5;      // >=+50% is a win

const keyOf = (variant, mint) => `${variant}|${mint}`;

// ---- Persistence ----------------------------------------------------------
let mem = { records: [] };
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (saved && Array.isArray(saved.records)) mem.records = saved.records;
} catch { /* no file yet — start fresh */ }

function save() {
  try { writeFileSync(FILE_PATH, JSON.stringify(mem, null, 2), "utf8"); }
  catch { /* read-only FS — keep state in-memory for this process */ }
}

// ---- Public: snapshot the signals a sweep surfaced ------------------------
/**
 * Record each NEWLY-raised signal's entry once. Idempotent per (variant, mint)
 * while an un-graded record is open — a re-detection only updates the running peak
 * (best price seen while the signal was live), never the entry. Entry is taken from
 * the signal's own mcap/price at first detection, so it reflects the exact moment
 * the confluence was flagged. Returns how many new entries were added.
 */
export function recordSignals(signalList, variant, nowMs) {
  const now = nowMs ?? Date.now();
  const open = new Map(
    mem.records.filter((r) => !r.outcome).map((r) => [keyOf(r.variant, r.mint), r])
  );
  let added = 0, touchedPeak = false;
  for (const s of signalList || []) {
    if (!s?.mint) continue;
    const price = Number(s.priceUsd) || 0;
    const mcap = Number(s.mcap) || 0;
    const existing = open.get(keyOf(variant, s.mint));
    if (existing) {
      // Update the peak-exit reference while the signal is still live.
      if (price > 0 && price > (existing.peakPriceUsd || 0)) {
        existing.peakPriceUsd = price;
        existing.peakMcap = mcap || existing.peakMcap || 0;
        existing.peakAt = now;
        touchedPeak = true;
      }
      continue;
    }
    // New entry only if usable price AND caught fresh (else we can't trust "entry").
    if (price <= 0) continue;
    const detectedAt = s.firstDetectedAt || now;
    if (now - detectedAt > FRESH_ENTRY_MS) continue; // stale re-surface → skip, don't mislabel
    mem.records.push({
      variant,
      mint: s.mint,
      symbol: s.symbol || "",
      entryPriceUsd: price,
      entryMcap: mcap,
      walletCount: s.walletCount || (Array.isArray(s.wallets) ? s.wallets.length : 0),
      score: s.score ?? null,
      peakPriceUsd: price,
      peakMcap: mcap,
      peakAt: now,
      firstDetectedAt: detectedAt,
      scannedAt: now,
      outcome: null,
    });
    added++;
  }
  if (mem.records.length > MAX_RECORDS) mem.records = mem.records.slice(-MAX_RECORDS);
  if (added || touchedPeak) save();
  return added;
}

// ---- Grading --------------------------------------------------------------
async function gradeOne(rec, now) {
  let current = 0;
  try {
    const m = await fetchDexScreener(rec.mint);
    current = m?.priceUsd || 0;
  } catch { current = 0; /* delisted / gone → treated as a rug below */ }

  const entry = rec.entryPriceUsd || 0;
  const peak = Math.max(rec.peakPriceUsd || 0, current);
  let status, returnPct;
  if (!current || entry <= 0 || current <= entry * RUG_PRICE_FLOOR) {
    status = "rug";
    returnPct = entry > 0 && current ? (current - entry) / entry : -1;
  } else {
    returnPct = (current - entry) / entry;
    if (returnPct <= LOSS_THRESHOLD) status = "loss";
    else if (returnPct >= WIN_THRESHOLD) status = "win";
    else status = "flat";
  }
  const peakReturnPct = entry > 0 && peak > 0 ? (peak - entry) / entry : null;
  rec.outcome = {
    status,
    returnPct: Number(returnPct.toFixed(3)),
    multiple: entry > 0 && current > 0 ? Number((current / entry).toFixed(3)) : null,
    peakReturnPct: peakReturnPct != null ? Number(peakReturnPct.toFixed(3)) : null,
    peakMultiple: entry > 0 && peak > 0 ? Number((peak / entry).toFixed(3)) : null,
    currentPrice: current,
    gradedAt: now,
  };
}

async function mapPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { await fn(items[idx]); } catch { /* retry next sweep */ } }
  });
  await Promise.all(workers);
}

/**
 * Grade any records past their maturation window. Bounded price-refetch work per
 * sweep (a handful of DexScreener calls). Returns how many were graded this run.
 */
export async function gradeMatured(nowMs) {
  const now = nowMs ?? Date.now();
  const due = mem.records
    .filter((r) => !r.outcome && now - r.scannedAt >= GRADE_AFTER_MS)
    .slice(0, MAX_GRADE_PER_RUN);
  if (due.length) {
    await mapPool(due, GRADE_CONCURRENCY, (r) => gradeOne(r, now));
    save();
  }
  return due.length;
}

// ---- Public: track-record summary for the UI / API ------------------------
function summarize(records) {
  const graded = records.filter((r) => r.outcome);
  const n = graded.length;
  const by = (s) => graded.filter((r) => r.outcome.status === s).length;
  const wins = by("win"), losses = by("loss"), rugs = by("rug");
  const avg = n ? graded.reduce((s, r) => s + r.outcome.returnPct, 0) / n : 0;
  const avgPeak = n ? graded.reduce((s, r) => s + (r.outcome.peakReturnPct ?? r.outcome.returnPct), 0) / n : 0;
  let best = null;
  for (const r of graded) if (!best || r.outcome.returnPct > best.returnPct) {
    best = { symbol: r.symbol, returnPct: r.outcome.returnPct, multiple: r.outcome.multiple };
  }
  return {
    graded: n,
    open: records.length - n,
    wins, losses, rugs, flats: n - wins - losses - rugs,
    winRate: n ? Number((wins / n).toFixed(2)) : null,
    avgReturnPct: n ? Number((avg * 100).toFixed(1)) : null,
    avgPeakReturnPct: n ? Number((avgPeak * 100).toFixed(1)) : null,
    best,
  };
}

export function getSniperTrack() {
  const graded = mem.records.filter((r) => r.outcome);
  return {
    overall: summarize(mem.records),
    v2: summarize(mem.records.filter((r) => r.variant === "v2")),
    awal: summarize(mem.records.filter((r) => r.variant === "awal")),
    gradeAfterMin: GRADE_AFTER_MS / 60_000,
    open: mem.records.filter((r) => !r.outcome).length,
    graded: graded.length,
    // Freshest closed trades first, for a UI list.
    recent: [...graded]
      .sort((a, b) => (b.outcome.gradedAt || 0) - (a.outcome.gradedAt || 0))
      .slice(0, 20)
      .map((r) => ({
        variant: r.variant, symbol: r.symbol, mint: r.mint,
        entryMcap: r.entryMcap, walletCount: r.walletCount, score: r.score,
        status: r.outcome.status, returnPct: r.outcome.returnPct,
        multiple: r.outcome.multiple, peakMultiple: r.outcome.peakMultiple,
        gradedAt: r.outcome.gradedAt,
      })),
  };
}
