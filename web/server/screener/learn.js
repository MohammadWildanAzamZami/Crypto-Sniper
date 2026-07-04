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

// Target win rate the controller chases (setpoint). Default 0.9 — aspirational;
// the controller pushes toward it by tightening, which mainly means FEWER, safer
// picks (memecoins can't actually be won 90% of the time — see README/HANDOVER).
const DEFAULT_TARGET = clampWinRate(process.env.RADAR_TARGET_WINRATE);

// Tuning starts here and is clamped to these bounds. Bounds are wide so the
// controller can get genuinely strict when it's below target, but never absurd.
const DEFAULT_TUNING = {
  minLiquidity: 12_000, minVolume: 15_000, minTx: 60, minLockedPct: 20,
  minConviction: 45, minGem: 60, maxDrawdownFromAth: 80,
};
const BOUNDS = {
  minLiquidity: [8_000, 250_000],
  minVolume: [8_000, 400_000],
  minTx: [40, 800],
  minLockedPct: [0, 92],       // never demand a literally-impossible 100%
  minConviction: [35, 82],     // capped so a strong pick can still clear the bar
  minGem: [55, 80],
  maxDrawdownFromAth: [45, 95], // lower = stricter (reject bigger dumps from ATH)
};

// If the radar surfaces nothing this many scans in a row, it has over-tightened
// (chasing an unreachable target) — relax a step so the funnel reopens and can
// keep learning. Without this the gate can strangle itself into permanent empty.
const STARVE_LIMIT = 2;

function clampWinRate(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0.9;
  return Math.min(0.95, Math.max(0.3, n));
}

function clamp(key, v) {
  const [lo, hi] = BOUNDS[key];
  const n = Math.round(Number(v));
  return Math.min(hi, Math.max(lo, Number.isNaN(n) ? DEFAULT_TUNING[key] : n));
}

// ---- Persistence ----------------------------------------------------------
let mem = {
  tuning: { ...DEFAULT_TUNING, requirePumpComplete: false },
  targetWinRate: DEFAULT_TARGET,
  picks: [], lastRetuneAt: 0, retunes: 0, starvation: 0,
};
try {
  const saved = JSON.parse(readFileSync(FILE_PATH, "utf8"));
  if (saved && typeof saved === "object") {
    mem.tuning = { ...DEFAULT_TUNING, requirePumpComplete: false, ...(saved.tuning || {}) };
    mem.targetWinRate = clampWinRate(saved.targetWinRate ?? DEFAULT_TARGET);
    mem.picks = Array.isArray(saved.picks) ? saved.picks : [];
    mem.lastRetuneAt = saved.lastRetuneAt || 0;
    mem.retunes = saved.retunes || 0;
  }
} catch {
  /* no memory file yet — start fresh */
}
// Env target always wins on boot (lets the operator re-point the setpoint).
if (process.env.RADAR_TARGET_WINRATE) mem.targetWinRate = DEFAULT_TARGET;
// Normalise numeric tuning to bounds on load (in case DEFAULT/BOUNDS changed).
for (const k of Object.keys(DEFAULT_TUNING)) mem.tuning[k] = clamp(k, mem.tuning[k]);
mem.tuning.requirePumpComplete = Boolean(mem.tuning.requirePumpComplete);

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

// ---- Public: starvation guard ---------------------------------------------
/**
 * Called after each scan with how many picks it surfaced. If the radar keeps
 * coming up empty, it has over-tightened — relax a step so the funnel reopens
 * (otherwise it can never gather the outcomes it needs to improve).
 */
export function noteScanYield(shownCount, nowMs) {
  const now = nowMs ?? Date.now();
  if (shownCount > 0) {
    if (mem.starvation) { mem.starvation = 0; save(); }
    return;
  }
  mem.starvation = (mem.starvation || 0) + 1;
  if (mem.starvation < STARVE_LIMIT) { save(); return; }

  mem.starvation = 0;
  const t = { ...mem.tuning };
  t.minConviction = clamp("minConviction", t.minConviction - 8);
  t.minGem = clamp("minGem", t.minGem - 5);
  t.minLockedPct = clamp("minLockedPct", t.minLockedPct - 15);
  t.minLiquidity = clamp("minLiquidity", t.minLiquidity * 0.8);
  t.minVolume = clamp("minVolume", t.minVolume * 0.8);
  t.minTx = clamp("minTx", t.minTx - 40);
  t.maxDrawdownFromAth = clamp("maxDrawdownFromAth", t.maxDrawdownFromAth + 10);
  t.requirePumpComplete = false;
  mem.tuning = t;
  mem.lastRetuneAt = now;
  save();
}

// ---- Public: the FIRST time we ever surfaced a token ----------------------
/**
 * Earliest recorded snapshot for an address (across the whole history, graded or
 * not). Lets the UI show the entry price at first detection so the operator can
 * see whether a screened pick actually ran toward a 10x from where the radar
 * first flagged it. Returns null if we have no valid price on record.
 */
export function getFirstSeen(address) {
  let first = null;
  for (const p of mem.picks) {
    if (p.address !== address) continue;
    if (p.entryPriceUsd == null || p.entryPriceUsd <= 0) continue;
    if (!first || p.scannedAt < first.scannedAt) first = p;
  }
  if (!first) return null;
  return { priceUsd: first.entryPriceUsd, marketCap: first.entryMc || null, at: first.scannedAt };
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

// Closed-loop controller: drive the gate thresholds toward the target win rate.
// Below target → tighten EVERY lever proportionally to the gap (bigger miss =
// bigger step). Above target → relax slightly so the funnel isn't bone-dry. All
// clamped. The honest effect of chasing a high target is FEWER, safer picks.
function retune(now) {
  const graded = mem.picks.filter((p) => p.outcome);
  if (graded.length < MIN_GRADED_TO_TUNE) return;

  const n = graded.length;
  const wins = graded.filter((p) => p.outcome.status === "win").length;
  const rugs = graded.filter((p) => p.outcome.status === "rug").length;
  const winRate = wins / n;
  const rugRate = rugs / n;
  const target = mem.targetWinRate;
  const gap = target - winRate; // >0 → below target (tighten), <0 → above (relax)

  const t = { ...mem.tuning };

  if (gap > 0.02) {
    // Proportional tightening. g is the capped gap used as the step scale.
    const g = Math.min(0.6, gap);
    t.minConviction = clamp("minConviction", t.minConviction + Math.ceil(g * 50));
    t.minLockedPct = clamp("minLockedPct", t.minLockedPct + Math.ceil(g * 70));
    t.minLiquidity = clamp("minLiquidity", t.minLiquidity * (1 + g));
    t.minVolume = clamp("minVolume", t.minVolume * (1 + g));
    t.minTx = clamp("minTx", t.minTx + Math.ceil(g * 120));
    t.minGem = clamp("minGem", t.minGem + Math.ceil(g * 25));
    t.maxDrawdownFromAth = clamp("maxDrawdownFromAth", t.maxDrawdownFromAth - Math.ceil(g * 45));
    // Deep miss or rugging → escalate to graduated-only pump.fun tokens.
    if (gap > 0.25 || rugRate > 0.2) t.requirePumpComplete = true;
  } else if (gap < -0.05) {
    // Comfortably above target → widen the funnel a little.
    t.minConviction = clamp("minConviction", t.minConviction - 2);
    t.minLiquidity = clamp("minLiquidity", t.minLiquidity * 0.96);
    t.minLockedPct = clamp("minLockedPct", t.minLockedPct - 3);
    t.minGem = clamp("minGem", t.minGem - 1);
    t.maxDrawdownFromAth = clamp("maxDrawdownFromAth", t.maxDrawdownFromAth + 3);
    if (rugRate === 0) t.requirePumpComplete = false;
  }

  const changed = JSON.stringify(t) !== JSON.stringify(mem.tuning);
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

  const winRate = n ? wins / n : null;
  return {
    tuning: { ...mem.tuning },
    targetWinRate: mem.targetWinRate,
    belowTarget: winRate != null ? winRate < mem.targetWinRate : null,
    retunes: mem.retunes,
    lastRetuneAt: mem.lastRetuneAt,
    graded: n,
    open: open.length,
    wins,
    losses,
    rugs,
    flats: n - wins - losses - rugs,
    winRate: winRate != null ? Number(winRate.toFixed(2)) : null,
    avgReturnPct: n ? Number((avgReturn * 100).toFixed(1)) : null,
    best,
  };
}
