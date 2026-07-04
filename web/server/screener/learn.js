// Self-improving loop for the Pro Radar. The radar can't predict the future, but
// it CAN learn from its own track record: every pick it surfaces is recorded with
// its entry price, then graded a few hours later against the live price. From the
// aggregate outcomes it auto-tunes the quality-gate thresholds — tightening after
// rugs/dumps, relaxing gently when the hit-rate is healthy — so the radar gets
// stricter about the patterns that actually lost money.
//
// This is evidence-based tuning, NOT a profit guarantee. Memecoins are random and
// adversarial; the goal is fewer obvious junk picks over time, not perfection.
//
// Persistence mirrors radarStore: file-backed (`.radar-memory.json`) with an
// in-memory fallback for read-only/ephemeral filesystems.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchDexScreener } from "./sources.js";

const FILE_PATH = fileURLToPath(new URL("./.radar-memory.json", import.meta.url));

// How long a pick "matures" before we grade it. Memecoins move fast; a few hours
// is enough to see whether a pick ran, dumped, or died.
const GRADE_AFTER_MS = Number(process.env.RADAR_GRADE_AFTER_MIN || 180) * 60_000;
const MAX_PICKS = 600;          // cap stored history
const MAX_GRADE_PER_RUN = 12;   // bound the price-refetch work per scan
const GRADE_CONCURRENCY = 6;
const MIN_GRADED_TO_TUNE = 8;   // don't tune on noise

// Outcome classification (return = (now - entry) / entry).
const RUG_PRICE_FLOOR = 0.1;    // <=10% of entry (or delisted) counts as a rug
const LOSS_THRESHOLD = -0.25;   // <=-25% is a loss
const WIN_THRESHOLD = 0.5;      // >=+50% is a win

// Tuning starts here and is clamped to these bounds so learning can nudge but
// never run away to absurd values.
const DEFAULT_TUNING = { minLiquidity: 12_000, minVolume: 15_000, minTx: 60, minLockedPct: 20, minConviction: 45 };
const BOUNDS = {
  minLiquidity: [8_000, 120_000],
  minVolume: [8_000, 250_000],
  minTx: [40, 500],
  minLockedPct: [0, 90],
  minConviction: [35, 78],
};

function clamp(key, v) {
  const [lo, hi] = BOUNDS[key];
  const n = Math.round(Number(v));
  return Math.min(hi, Math.max(lo, Number.isNaN(n) ? DEFAULT_TUNING[key] : n));
}

// ---- Persistence ----------------------------------------------------------
let mem = { tuning: { ...DEFAULT_TUNING }, picks: [], lastRetuneAt: 0, retunes: 0 };
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (saved && typeof saved === "object") {
    mem.tuning = { ...DEFAULT_TUNING, ...(saved.tuning || {}) };
    mem.picks = Array.isArray(saved.picks) ? saved.picks : [];
    mem.lastRetuneAt = saved.lastRetuneAt || 0;
    mem.retunes = saved.retunes || 0;
  }
} catch {
  /* no memory file yet — start fresh */
}
// Normalise tuning to bounds on load (in case DEFAULT/BOUNDS changed).
for (const k of Object.keys(DEFAULT_TUNING)) mem.tuning[k] = clamp(k, mem.tuning[k]);

function save() {
  try {
    writeFileSync(FILE_PATH, JSON.stringify(mem, null, 2), "utf8");
  } catch {
    /* read-only FS — keep state in-memory for this process */
  }
}

// ---- Public: current tuned thresholds -------------------------------------
export function getTuning() {
  return { ...mem.tuning };
}

// ---- Public: record the picks a scan surfaced -----------------------------
/**
 * Snapshot each displayed match so we can grade it later. Idempotent per address
 * within the maturation window — re-scanning the same token won't reset its clock
 * or duplicate it.
 */
export function recordPicks(matches, nowMs) {
  const now = nowMs ?? Date.now();
  const open = new Set(mem.picks.filter((p) => !p.outcome).map((p) => p.address));
  for (const m of matches) {
    if (!m?.address || m.priceUsd == null || m.priceUsd <= 0) continue;
    if (open.has(m.address)) continue; // already tracking an un-graded snapshot
    mem.picks.push({
      address: m.address,
      symbol: m.symbol,
      entryPriceUsd: m.priceUsd,
      entryMc: m.marketCap || 0,
      gemScore: m.gemScore,
      conviction: m.ai?.conviction ?? null,
      action: m.ai?.action ?? null,
      tier: m.ai?.tier ?? null,
      lockedPct: m.lockedPct ?? null,
      liquidityUsd: m.liquidityUsd || 0,
      scannedAt: now,
      outcome: null,
    });
  }
  if (mem.picks.length > MAX_PICKS) mem.picks = mem.picks.slice(-MAX_PICKS);
  save();
}

// ---- Public: grade matured picks, then retune -----------------------------
async function gradeOne(pick, now) {
  let current = null;
  try {
    const m = await fetchDexScreener(pick.address);
    current = m?.priceUsd || 0;
  } catch {
    current = 0; // delisted / gone → treat as a rug below
  }
  const entry = pick.entryPriceUsd || 0;
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
  pick.outcome = { status, returnPct: Number(returnPct.toFixed(3)), currentPrice: current, gradedAt: now };
}

async function mapPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); } catch { /* leave un-graded, retry next scan */ }
    }
  });
  await Promise.all(workers);
}

/**
 * Grade any picks past their maturation window, then re-tune thresholds from the
 * full graded history. Time-bounded (only a handful of price-refetches per run).
 */
export async function gradeAndRetune(nowMs) {
  const now = nowMs ?? Date.now();
  const due = mem.picks
    .filter((p) => !p.outcome && now - p.scannedAt >= GRADE_AFTER_MS)
    .slice(0, MAX_GRADE_PER_RUN);

  if (due.length) {
    await mapPool(due, GRADE_CONCURRENCY, (p) => gradeOne(p, now));
    retune(now);
    save();
  }
  return getTrackRecord();
}

// Adjust the gate thresholds from aggregate outcomes. Conservative, clamped.
function retune(now) {
  const graded = mem.picks.filter((p) => p.outcome);
  if (graded.length < MIN_GRADED_TO_TUNE) return;

  const n = graded.length;
  const rugs = graded.filter((p) => p.outcome.status === "rug");
  const losses = graded.filter((p) => p.outcome.status === "loss");
  const wins = graded.filter((p) => p.outcome.status === "win");
  const rugRate = rugs.length / n;
  const lossRate = losses.length / n;
  const winRate = wins.length / n;

  const t = { ...mem.tuning };

  if (rugRate > 0.25) {
    // Too many rugs → demand more locked LP and deeper liquidity/activity.
    t.minLockedPct = clamp("minLockedPct", t.minLockedPct + 10);
    t.minLiquidity = clamp("minLiquidity", t.minLiquidity * 1.15);
    t.minTx = clamp("minTx", t.minTx + 20);
  } else if (rugRate < 0.08 && winRate > 0.33) {
    // Clean, productive track record → relax slightly to widen the funnel.
    t.minLiquidity = clamp("minLiquidity", t.minLiquidity * 0.94);
    t.minLockedPct = clamp("minLockedPct", t.minLockedPct - 5);
  }

  if (lossRate + rugRate > 0.5) {
    // More than half the graded picks lost money → require thicker volume.
    t.minVolume = clamp("minVolume", t.minVolume * 1.15);
  }

  // If the AI was confident on the losers, raise the conviction floor.
  const badPicks = [...rugs, ...losses].filter((p) => typeof p.conviction === "number");
  if (badPicks.length >= 4) {
    const avgBadConv = badPicks.reduce((s, p) => s + p.conviction, 0) / badPicks.length;
    if (avgBadConv >= t.minConviction) t.minConviction = clamp("minConviction", t.minConviction + 5);
  }

  const changed = Object.keys(DEFAULT_TUNING).some((k) => t[k] !== mem.tuning[k]);
  mem.tuning = t;
  if (changed) {
    mem.lastRetuneAt = now;
    mem.retunes += 1;
  }
}

// ---- Public: track-record summary for the UI ------------------------------
export function getTrackRecord() {
  const graded = mem.picks.filter((p) => p.outcome);
  const open = mem.picks.filter((p) => !p.outcome);
  const n = graded.length;
  const by = (s) => graded.filter((p) => p.outcome.status === s).length;
  const wins = by("win");
  const rugs = by("rug");
  const losses = by("loss");
  const avgReturn = n ? graded.reduce((s, p) => s + p.outcome.returnPct, 0) / n : 0;

  let best = null;
  for (const p of graded) if (!best || p.outcome.returnPct > best.returnPct) {
    best = { symbol: p.symbol, returnPct: p.outcome.returnPct };
  }

  return {
    tuning: { ...mem.tuning },
    retunes: mem.retunes,
    lastRetuneAt: mem.lastRetuneAt,
    graded: n,
    open: open.length,
    wins,
    losses,
    rugs,
    flats: n - wins - losses - rugs,
    winRate: n ? Number((wins / n).toFixed(2)) : null,
    avgReturnPct: n ? Number((avgReturn * 100).toFixed(1)) : null,
    best,
  };
}
