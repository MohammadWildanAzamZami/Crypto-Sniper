// Wallet Intelligence v2 — runtime-editable parameter registry.
//
// Meniru persis pola sniperParams.js: SATU daftar ber-metadata, dibaca saat
// RUNTIME via getWiParams() (perubahan dari Settings UI berlaku di tick
// berikutnya tanpa restart), Settings UI merender dirinya dari defs yang sama.
// Precedence per nilai: override tersimpan (Settings UI) > env seed (WI_*) > def.
// Override dipersist ke .wallet-intel-params.json (gitignored), fail-safe pada
// FS read-only — persis pola sniperParams.js / ai/settings.js.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STORE_PATH = fileURLToPath(new URL("./.wallet-intel-params.json", import.meta.url));

// Tiap def: key (camelCase — dipakai kode + JSON + UI), env (WI_* seed),
// type ('int'|'float'|'bool'), def, min/max/step (clamp + UI angka),
// group + label + hint (teks UI, bahasa Indonesia sederhana).
export const WI_PARAM_DEFS = [
  // ── Kandidat (pintu masuk) ────────────────────────────────────────────────
  { key: "recurMinHits", env: "WI_RECUR_MIN_HITS", type: "int", def: 3, min: 1, max: 20, step: 1,
    group: "Kandidat", label: "Minimal kemunculan berulang",
    hint: "Wallet yang terlihat sebagai early buyer di ≥ ini token BERBEDA otomatis jadi kandidat untuk divetting + diaudit." },

  // ── Vetting KTP ───────────────────────────────────────────────────────────
  { key: "minWalletAgeDays", env: "WI_MIN_WALLET_AGE_DAYS", type: "int", def: 7, min: 0, max: 365, step: 1,
    group: "Vetting", label: "Umur wallet minimal (hari)",
    hint: "Transaksi pertama-terlihat wallet harus lebih tua dari ini. Wallet kemarin sore = burner/sybil, ditolak." },
  { key: "minTxSpanDays", env: "WI_MIN_TX_SPAN_DAYS", type: "int", def: 3, min: 0, max: 90, step: 1,
    group: "Vetting", label: "Rentang aktivitas minimal (hari)",
    hint: "Jarak waktu 20 transaksi terakhir minimal segini. Semua tx menumpuk dalam 1 jam = bot sekali pakai." },
  { key: "fundingCheckDepth", env: "WI_FUNDING_DEPTH", type: "int", def: 1, min: 0, max: 1, step: 1,
    group: "Vetting", label: "Lapis penelusuran sumber dana",
    hint: "1 = cek siapa pengirim SOL masuk pertama; beberapa kandidat yang dibiayai induk yang sama ditandai 'sharedFunding' (indikasi jaringan sybil). 0 = matikan." },

  // ── Audit akurasi ─────────────────────────────────────────────────────────
  { key: "auditLookbackDays", env: "WI_AUDIT_LOOKBACK_DAYS", type: "int", def: 30, min: 3, max: 90, step: 1,
    group: "Audit", label: "Jendela riwayat audit (hari)",
    hint: "Hanya entry early di dalam jendela ini yang dihitung saat mengaudit akurasi historis wallet." },
  { key: "auditMinSample", env: "WI_AUDIT_MIN_SAMPLE", type: "int", def: 5, min: 1, max: 50, step: 1,
    group: "Audit", label: "Minimal sampel entry early",
    hint: "Wallet dengan entry early lebih sedikit dari ini belum bisa dinilai (UNRATED) — menunggu data tambahan." },
  { key: "hitrateMinPct", env: "WI_HITRATE_MIN_PCT", type: "int", def: 25, min: 0, max: 100, step: 1,
    group: "Audit", label: "Hit-rate minimal (%)",
    hint: "Akurasi historis (winner ÷ semua entry early) minimal agar wallet lolos jadi SMART_MONEY. Di bawah ini = REJECTED." },
  { key: "auditMaxPerTick", env: "WI_AUDIT_MAX_PER_TICK", type: "int", def: 3, min: 1, max: 20, step: 1,
    group: "Audit", label: "Jatah audit per putaran",
    hint: "Audit itu MAHAL (banyak call API). Antrean kandidat diproses maksimal segini tiap putaran — tidak pernah massal." },

  // ── Deteksi insider ───────────────────────────────────────────────────────
  { key: "insiderPreliq", env: "WI_INSIDER_PRELIQ", type: "bool", def: true,
    group: "Insider", label: "Beli pra-likuiditas = insider",
    hint: "Wallet yang membeli SEBELUM pool likuiditas publik ada hampir pasti orang dalam. Tetap dipantau, tapi sinyalnya berlabel ⚠." },
  { key: "insiderSameDeployerMin", env: "WI_INSIDER_SAME_DEPLOYER", type: "int", def: 2, min: 2, max: 10, step: 1,
    group: "Insider", label: "Minimal token deployer sama",
    hint: "Early di ≥ ini token dari deployer yang SAMA = insider (kenal devnya, bukan analisis). Deployer dicek dari tx pembuat mint." },

  // ── Karantina & siklus hidup ──────────────────────────────────────────────
  { key: "quarantineSignals", env: "WI_QUARANTINE_SIGNALS", type: "int", def: 3, min: 1, max: 20, step: 1,
    group: "Karantina", label: "Sinyal ternilai sebelum ACTIVE",
    hint: "Wallet baru masuk QUARANTINE dulu; setelah ikut ≥ ini sinyal yang sudah dinilai (win/rug/dll) baru naik ACTIVE." },
  { key: "quarantineWeightPct", env: "WI_QUARANTINE_WEIGHT", type: "int", def: 50, min: 0, max: 100, step: 5,
    group: "Karantina", label: "Bobot reputasi saat karantina (%)",
    hint: "Selama karantina reputasi wallet hanya dihitung sekian persen di skor sinyal — percaya tapi belum penuh." },
  { key: "evictRepMin", env: "WI_EVICT_REP_MIN", type: "int", def: 20, min: 0, max: 100, step: 1,
    group: "Karantina", label: "Ambang evict (rep efektif)",
    hint: "Wallet yang reputasi efektifnya (setelah decay + bobot) jatuh di bawah ini digusur (EVICTED) dari pemantauan." },
  { key: "fastTrackSample", env: "WI_FASTTRACK_SAMPLE", type: "int", def: 15, min: 5, max: 100, step: 1,
    group: "Karantina", label: "Sampel fast-track",
    hint: "Bukti sejarah kuat: ≥ ini sampel DAN hit-rate ≥40% DAN bukan insider → karantina cukup 1 sinyal dengan bobot 80%." },

  // ── Umpan balik track record ──────────────────────────────────────────────
  { key: "trackCredit", env: "WI_TRACK_CREDIT", type: "int", def: 8, min: 0, max: 50, step: 1,
    group: "Umpan Balik", label: "Kredit per sinyal winner",
    hint: "Tiap sinyal yang dinilai WIN oleh track record menambah reputasi setiap wallet pemicunya sebesar ini." },
  { key: "trackDebitRug", env: "WI_TRACK_DEBIT_RUG", type: "int", def: 15, min: 0, max: 50, step: 1,
    group: "Umpan Balik", label: "Debit per sinyal rug",
    hint: "Tiap sinyal yang berakhir RUG mengurangi reputasi setiap wallet pemicunya sebesar ini (hukuman lebih berat dari hadiah)." },
  { key: "repDecayHalflifeDays", env: "WI_DECAY_HALFLIFE", type: "int", def: 30, min: 1, max: 365, step: 1,
    group: "Umpan Balik", label: "Half-life reputasi (hari)",
    hint: "Reputasi membusuk eksponensial: tanpa bukti baru, setelah sekian hari nilainya tinggal separuh. Edge kemarin bukan edge selamanya." },
];

const DEF_BY_KEY = new Map(WI_PARAM_DEFS.map((d) => [d.key, d]));

// Coerce + clamp nilai mentah ke type/range def-nya — satu tempat untuk env seed,
// override tersimpan, dan patch masuk (identik dengan sniperParams.coerce).
function coerce(def, raw) {
  if (def.type === "bool") {
    if (typeof raw === "boolean") return raw;
    return String(raw) !== "false";
  }
  let n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) n = def.def;
  if (def.type === "int") n = Math.round(n);
  if (typeof def.min === "number") n = Math.max(def.min, n);
  if (typeof def.max === "number") n = Math.min(def.max, n);
  return n;
}

function envDefault(def) {
  const raw = process.env[def.env];
  if (raw == null || raw === "") return def.def;
  return coerce(def, raw);
}

// ---- Override persisten (Settings UI) --------------------------------------
/** @type {Record<string, number|boolean>} key → override (sudah di-coerce). */
let overrides = {};
try {
  const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  if (saved && typeof saved === "object") {
    for (const [k, v] of Object.entries(saved)) {
      const def = DEF_BY_KEY.get(k);
      if (def) overrides[k] = coerce(def, v);
    }
  }
} catch { /* belum ada file / FS tak terbaca — env+def yang menang */ }

function save() {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(overrides, null, 2), "utf8");
  } catch { /* FS read-only — override bertahan in-memory untuk proses ini */ }
}

/** Nilai terresolusi `{ key: value }` untuk mesin. Murah — panggil per tick. */
export function getWiParams() {
  const out = {};
  for (const def of WI_PARAM_DEFS) {
    out[def.key] = def.key in overrides ? coerce(def, overrides[def.key]) : envDefault(def);
  }
  return out;
}

/** Defs + nilai kini + default env — untuk Settings UI data-driven. */
export function getWiParamDefs() {
  const values = getWiParams();
  return {
    params: WI_PARAM_DEFS.map((def) => ({
      key: def.key, type: def.type, group: def.group, label: def.label, hint: def.hint,
      min: def.min, max: def.max, step: def.step,
      value: values[def.key],
      envDefault: envDefault(def),
      overridden: def.key in overrides,
    })),
    groups: [...new Set(WI_PARAM_DEFS.map((d) => d.group))],
  };
}

/**
 * Terapkan patch { key: value } dari Settings UI. Key tak dikenal diabaikan;
 * nilai di-coerce + clamp. `null` me-RESET key itu ke default env. Persist,
 * kembalikan getWiParamDefs() — identik dengan applyParams sniper.
 */
export function applyWiParams(patch = {}) {
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      const def = DEF_BY_KEY.get(k);
      if (!def) continue;
      if (v === null) { delete overrides[k]; continue; }
      overrides[k] = coerce(def, v);
    }
  }
  save();
  return getWiParamDefs();
}
