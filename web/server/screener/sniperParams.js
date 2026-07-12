// Sniper Live v2 — central, runtime-editable parameter registry (Modul C).
//
// v1 scattered every tunable across ~15 module-level `const X = Number(process.env
// .SNIPER_X || def)` reads that were evaluated ONCE at import — so retuning meant
// editing code + .env + restarting. v2 replaces them with ONE metadata-described
// list, so:
//   - adding a parameter is a single PARAM_DEFS entry (extensible),
//   - the sweep reads values at RUN time (getParams()), so an edit takes effect on
//     the next sweep — no restart,
//   - the Settings UI renders itself from the same defs (data-driven), so a new
//     parameter shows up in the UI with no Vue change.
//
// Precedence per value: saved override (Settings UI) > env seed (SNIPER_*) > def.
// Overrides persist to a gitignored .sniper-params.json, fail-safe on a read-only
// FS exactly like ai/settings.js and the other screener state files.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STORE_PATH = fileURLToPath(new URL("./.sniper-params.json", import.meta.url));

// Each def: key (camelCase — used in code + JSON + UI), env (SNIPER_* seed),
// type ('int'|'float'|'bool'), def (fallback), min/max/step (number UI + clamp),
// group + label + hint (UI copy, Bahasa Indonesia).
export const PARAM_DEFS = [
  // ── Deteksi beli ─────────────────────────────────────────────────────────
  { key: "requireSwap", env: "SNIPER_REQUIRE_SWAP", type: "bool", def: true,
    group: "Deteksi", label: "Wajib swap asli",
    hint: "Hanya hitung beli dari transaksi swap yang benar-benar membayar (SOL/stable keluar). Membunuh airdrop, kiriman, dan transfer antar-wallet sendiri." },
  { key: "minBuyUsd", env: "SNIPER_MIN_BUY_USD", type: "float", def: 100, min: 0, max: 5000, step: 10,
    group: "Deteksi", label: "Beli minimum (USD)",
    hint: "Abaikan test-buy dust di bawah nilai ini. Beli yang ukurannya tak bisa dihitung (harga SOL tak diketahui) tetap dihitung." },
  { key: "netBuyOnly", env: "SNIPER_NET_BUY_ONLY", type: "bool", def: true,
    group: "Deteksi", label: "Hanya net-buy",
    hint: "Wallet yang beli lalu jual lagi di window yang sama (net ≤ 0) tidak dihitung sebagai akumulasi." },
  { key: "lookbackMin", env: "SNIPER_LOOKBACK_MIN", type: "int", def: 90, min: 15, max: 1440, step: 15,
    group: "Deteksi", label: "Jendela lihat-balik (menit)",
    hint: "Hanya perhitungkan beli yang lebih baru dari ini." },
  { key: "recentTx", env: "SNIPER_RECENT_TX", type: "int", def: 20, min: 5, max: 100, step: 5,
    group: "Deteksi", label: "Transaksi discan / wallet",
    hint: "Berapa transaksi terbaru per wallet yang dibaca dari Helius tiap sweep." },

  // ── Konfluensi & skor ────────────────────────────────────────────────────
  { key: "signalMin", env: "SNIPER_SIGNAL_MIN", type: "int", def: 2, min: 1, max: 10, step: 1,
    group: "Skor", label: "Wallet minimum",
    hint: "Jumlah wallet smart-money berbeda (net-buy) pada token yang sama agar jadi kandidat sinyal." },
  { key: "cobuyWindowMin", env: "SNIPER_COBUY_WINDOW_MIN", type: "int", def: 15, min: 1, max: 180, step: 1,
    group: "Skor", label: "Window co-buy (menit)",
    hint: "Beli dalam rentang ini dianggap terkoordinasi (konviksi) → menambah skor." },
  { key: "repWeighted", env: "SNIPER_REP_WEIGHTED", type: "bool", def: true,
    group: "Skor", label: "Skor tertimbang reputasi",
    hint: "Skor = Σ reputasi wallet (bukan sekadar jumlah kepala). Matikan untuk 50 poin datar per wallet." },
  { key: "scoreMin", env: "SNIPER_SCORE_MIN", type: "int", def: 150, min: 0, max: 1000, step: 10,
    group: "Skor", label: "Ambang skor",
    hint: "Sinyal di bawah skor komposit ini ditahan. Turunkan sementara jika watchlist masih baru (reputasi rendah)." },

  // ── Gate keamanan ────────────────────────────────────────────────────────
  { key: "safetyGate", env: "SNIPER_SAFETY_GATE", type: "bool", def: true,
    group: "Gate", label: "Gate keamanan",
    hint: "Wajibkan lolos cek DexScreener + RugCheck + Pump.fun (likuiditas, rug, honeypot) sebelum sinyal ditampilkan." },
  { key: "allowUnknownMcap", env: "SNIPER_ALLOW_UNKNOWN_MCAP", type: "bool", def: true,
    group: "Gate", label: "Izinkan mcap belum dikenal",
    hint: "Tampilkan token yang Birdeye belum kenal (fresh) dengan label 'unverified' — aman karena tetap wajib lolos gate keamanan." },
  { key: "minMcap", env: "SNIPER_MIN_MCAP", type: "int", def: 20000, min: 0, max: 1000000, step: 1000,
    group: "Gate", label: "Mcap minimum (USD)",
    hint: "Lantai bawah — buang token terlalu mikro/mati. Default $20.000." },
  { key: "maxMcap", env: "SNIPER_SIGNAL_MAX_MCAP", type: "int", def: 2000000, min: 100000, max: 50000000, step: 100000,
    group: "Gate", label: "Mcap maksimum (USD)",
    hint: "Batas atas — token sudah kebesaran = jendela early terlewat." },
  { key: "minLiquidity", env: "SNIPER_MIN_LIQUIDITY", type: "int", def: 8000, min: 0, max: 1000000, step: 1000,
    group: "Gate", label: "Likuiditas minimum (USD)",
    hint: "Lantai likuiditas (DexScreener) — kurangi honeypot/rug likuiditas tipis." },
  { key: "minLockedPct", env: "SNIPER_MIN_LOCKED_PCT", type: "int", def: 50, min: 0, max: 100, step: 5,
    group: "Gate", label: "LP locked minimum (%)",
    hint: "Tolak token dengan LP terkunci/burn di bawah ini (bila RugCheck punya datanya; token tak tercek fail-open). 0 = nonaktif." },
  { key: "rugMintRenounced", env: "SNIPER_RUG_MINT_RENOUNCED", type: "bool", def: true,
    group: "Gate", label: "Wajib mint authority renounce",
    hint: "Tolak token yang dev-nya masih bisa mencetak supply baru (rug klasik) — dari RugCheck." },
  { key: "rugNoFreeze", env: "SNIPER_RUG_NO_FREEZE", type: "bool", def: true,
    group: "Gate", label: "Tolak freeze authority aktif",
    hint: "Tolak token yang dev-nya bisa membekukan token-mu (honeypot — tak bisa dijual) — dari RugCheck." },
  { key: "rugBlockDanger", env: "SNIPER_RUG_BLOCK_DANGER", type: "bool", def: true,
    group: "Gate", label: "Tolak risiko 'danger' RugCheck",
    hint: "Tolak bila RugCheck menandai risiko level bahaya (LP unlocked, holder terlalu terpusat, honeypot, copycat, dll). Matikan jika terlalu ketat." },

  // ── Posisi (hold / exit) ─────────────────────────────────────────────────
  { key: "trackHolding", env: "SNIPER_TRACK_HOLDING", type: "bool", def: true,
    group: "Posisi", label: "Lacak hold / exit smart money",
    hint: "Tiap sweep cek saldo token wallet: buang sinyal saat SEMUA smart money sudah jual, dan pertahankan sinyal selama masih ada yang memegang (atau masih akumulasi)." },

  // ── Mesin ────────────────────────────────────────────────────────────────
  { key: "maxEnrich", env: "SNIPER_MAX_ENRICH", type: "int", def: 20, min: 1, max: 100, step: 1,
    group: "Mesin", label: "Kandidat di-enrich / sweep",
    hint: "Batas token teratas (by konfluensi) yang di-enrich Birdeye + gate tiap sweep (hemat kuota)." },
  { key: "signalTtlMin", env: "SNIPER_SIGNAL_TTL_MIN", type: "int", def: 360, min: 10, max: 2880, step: 10,
    group: "Mesin", label: "Umur sinyal / TTL (menit)",
    hint: "Sinyal yang tak terbarui lebih lama dari ini dihapus agar daftar tetap segar." },

  // ── Discovery (cari smart wallet otomatis — Modul A/B) ────────────────────
  // Dibaca saat runtime oleh discoverWallets.js + watchlist.js, jadi ubahan dari
  // Settings UI berlaku di siklus/panggilan berikutnya tanpa restart.
  { key: "discoveryTokens", env: "SNIPER_DISCOVERY_TOKENS", type: "int", def: 30, min: 5, max: 100, step: 5,
    group: "Discovery", label: "Token tren / siklus",
    hint: "Berapa mint trending ditarik tiap siklus discovery sebagai bahan auto-Bedah + panen top-trader." },
  { key: "autopsyPerCycle", env: "SNIPER_AUTOPSY_PER_CYCLE", type: "int", def: 3, min: 0, max: 20, step: 1,
    group: "Discovery", label: "Auto-Bedah / siklus",
    hint: "Batas token yang di-Bedah forensik penuh tiap siklus (mahal — paged Birdeye). Hanya winner yang lolos jadi 'catch'." },
  { key: "topTraderTokens", env: "SNIPER_TOPTRADER_TOKENS", type: "int", def: 8, min: 0, max: 50, step: 1,
    group: "Discovery", label: "Scan top-trader / siklus",
    hint: "Batas token yang dipanen top-trader-nya tiap siklus (murah, 1 call/mint). Wallet berkualitas (profit + net-buyer + bukan bundler) direkam sebagai 'sighting'." },
  { key: "discoveryThrottleMs", env: "SNIPER_DISCOVERY_THROTTLE_MS", type: "int", def: 400, min: 0, max: 5000, step: 50,
    group: "Discovery", label: "Jeda antar-call (ms)",
    hint: "Jeda antar panggilan Birdeye saat discovery agar tier gratis tak ke-burst." },
  { key: "watchSize", env: "SNIPER_WATCH_SIZE", type: "int", def: 0, min: 0, max: 2000, step: 10,
    group: "Discovery", label: "Wallet dipantau (0 = semua)",
    hint: "Berapa wallet teratas (by reputasi) yang dipantau monitor live. 0 = pantau SEMUA. Webhook Helius tetap dibatasi ~100 alamat." },
  { key: "winnerMinX", env: "SNIPER_WINNER_MIN_X", type: "int", def: 10, min: 2, max: 100, step: 1,
    group: "Discovery", label: "Ambang winner (x)",
    hint: "Token dianggap 'winner' (pembeli awalnya dapat 'catch') jika sudah pump ≥ ini dari launch. Naikkan untuk hanya belajar dari runner besar." },
  { key: "minCatches", env: "SNIPER_MIN_CATCHES", type: "int", def: 0, min: 0, max: 100, step: 1,
    group: "Discovery", label: "Minimal token winner berbeda",
    hint: "Hanya tampilkan wallet yang jadi winner di ≥ ini token BERBEDA (bukan kelipatan dalam 1 token). 0 = tampilkan semua. Contoh: 11 = hanya wallet dengan track record menang di lebih dari 10 token berbeda." },
];

const DEF_BY_KEY = new Map(PARAM_DEFS.map((d) => [d.key, d]));

// Coerce + clamp a raw value to a def's type/range. Used for env seeds, saved
// overrides, and incoming patches alike — one place, so they can't disagree.
function coerce(def, raw) {
  if (def.type === "bool") {
    if (typeof raw === "boolean") return raw;
    return String(raw) !== "false"; // "true"/anything → true, only "false" → false
  }
  let n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) n = def.def;
  if (def.type === "int") n = Math.round(n);
  if (typeof def.min === "number") n = Math.max(def.min, n);
  if (typeof def.max === "number") n = Math.min(def.max, n);
  return n;
}

// The env-seeded default for a def (before any saved override). Empty/unset env
// falls back to def.def — mirrors v1's `Number(process.env.X || def)` semantics.
function envDefault(def) {
  const raw = process.env[def.env];
  if (raw == null || raw === "") return def.def;
  return coerce(def, raw);
}

// ---- Persisted overrides (Settings UI) ------------------------------------
/** @type {Record<string, number|boolean>} key → override (already coerced). */
let overrides = {};
try {
  const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  if (saved && typeof saved === "object") {
    for (const [k, v] of Object.entries(saved)) {
      const def = DEF_BY_KEY.get(k);
      if (def) overrides[k] = coerce(def, v);
    }
  }
} catch { /* no file / unreadable — no overrides, env+def win */ }

function save() {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(overrides, null, 2), "utf8");
  } catch { /* read-only/ephemeral FS — overrides stay in-memory */ }
}

/** Resolved values `{ key: value }` for the engine. Cheap — call once per sweep. */
export function getParams() {
  const out = {};
  for (const def of PARAM_DEFS) {
    out[def.key] = def.key in overrides ? coerce(def, overrides[def.key]) : envDefault(def);
  }
  return out;
}

/** Defs + current value + env default — for the data-driven Settings UI. */
export function getParamDefs() {
  const values = getParams();
  return {
    params: PARAM_DEFS.map((def) => ({
      key: def.key, type: def.type, group: def.group, label: def.label, hint: def.hint,
      min: def.min, max: def.max, step: def.step,
      value: values[def.key],
      envDefault: envDefault(def),
      overridden: def.key in overrides,
    })),
    groups: [...new Set(PARAM_DEFS.map((d) => d.group))],
  };
}

/**
 * Apply a patch of { key: value } from the Settings UI. Unknown keys are ignored;
 * values are coerced + clamped to their def. A value of `null` RESETS that key to
 * its env default (removes the override). Persists, returns getParamDefs().
 */
export function applyParams(patch = {}) {
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      const def = DEF_BY_KEY.get(k);
      if (!def) continue;               // ignore unknown keys
      if (v === null) { delete overrides[k]; continue; } // reset to env default
      overrides[k] = coerce(def, v);
    }
  }
  save();
  return getParamDefs();
}
