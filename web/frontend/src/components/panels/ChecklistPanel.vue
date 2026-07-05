<script setup>
/**
 * ChecklistPanel — the 6-stage manual memecoin screening checklist, as an
 * interactive, progress-tracked list. Check state is persisted to localStorage
 * so a refresh doesn't wipe your progress on the token you're vetting.
 *
 * Ported from checklist-screening-memecoin-solana.md, rebuilt on the design
 * tokens. A risk-screening aid, NOT a prediction and NOT financial advice.
 */
import { reactive, computed } from "vue";

const STAGES = [
  {
    title: "Tahap 1 · Filter Awal di DexScreener",
    note: "Buka dexscreener.com/solana, set filter:",
    items: [
      "Liquidity: $10K – $100K",
      "Age: 1 – 48 jam",
      "Volume 24h: minimal 2–3x dari Liquidity",
    ],
  },
  {
    title: "Tahap 2 · Cek Tiap Kandidat (pair page)",
    items: [
      "Buy/Sell ratio sehat & konsisten (cek 1h & 6h)",
      "Volume/Liquidity > 2x (momentum nyata)",
      "Unique makers banyak — bukan wash trading",
      "Top 10 holder < 40% supply (di luar LP/burn)",
      "Market cap masih kecil (< $500K untuk target 10x)",
    ],
  },
  {
    title: "Tahap 3 · Keamanan Kontrak (RugCheck.xyz)",
    items: [
      "Mint authority: revoked / tidak aktif",
      "Freeze authority: revoked / tidak aktif",
      "LP locked / burned: ya",
      'Status keseluruhan "Good" (bukan Danger/Warning mayor)',
      "Tidak ada cluster wallet sniper/bundle besar di top holder",
    ],
  },
  {
    title: "Tahap 4 · Narasi & Komunitas",
    items: [
      "Ada link Twitter/Telegram aktif (bukan placeholder)",
      "Engagement riil (bukan bot emoji spam)",
      "Ada KOL/influencer mulai membahas",
      "Nama/simbol tidak mirip token terkenal (anti clone/scam)",
    ],
  },
  {
    title: "Tahap 5 · Red Flag — skip kalau ada salah satu",
    danger: true,
    items: [
      "Buy/sell tax tidak wajar tinggi",
      "Tidak ada social link sama sekali",
      "Volume spike tiba-tiba tanpa kenaikan holder",
      "Mint/freeze authority masih aktif",
      "LP tidak locked/burned",
      "Top holder terkonsentrasi ekstrem",
    ],
  },
  {
    title: "Tahap 6 · Sizing & Exit Plan (sebelum masuk)",
    items: [
      "Tentukan ukuran posisi — anggap bisa hilang 100%",
      "Target take profit sebagian (mis. jual 50% di 3x)",
      "Exit plan kalau salah (liquidity drop / holder utama jual besar)",
    ],
  },
];

const LINKS = [
  ["DexScreener Solana", "https://dexscreener.com/solana"],
  ["RugCheck", "https://rugcheck.xyz"],
  ["Solsniffer", "https://solsniffer.com"],
];

const STORAGE_KEY = "memecoin-checklist-v1";
const total = STAGES.reduce((n, s) => n + s.items.length, 0);

// checked["si:ii"] = true. Seeded from localStorage; persisted on every change.
const checked = reactive(load());

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  } catch {
    /* storage blocked (private mode) — checklist still works in-session */
  }
}
function toggle(si, ii) {
  const key = `${si}:${ii}`;
  checked[key] = !checked[key];
  persist();
}
function reset() {
  for (const k of Object.keys(checked)) delete checked[k];
  persist();
}

const doneCount = computed(() => Object.values(checked).filter(Boolean).length);
const pct = computed(() => (total ? Math.round((doneCount.value / total) * 100) : 0));
</script>

<template>
  <section class="panel" aria-labelledby="checklist-h">
    <div class="panel__head">
      <div>
        <h2 id="checklist-h">✅ Checklist Screening Manual</h2>
        <p class="panel__sub">
          Alur 6 tahap menyaring risiko jelas (rug, wash trading, liquidity trap). Bukan prediksi 10x.
        </p>
      </div>
    </div>

    <!-- Progress -->
    <div class="progress">
      <div class="progress__top">
        <span>{{ doneCount }} / {{ total }} selesai</span>
        <button type="button" class="reset" @click="reset">Reset checklist</button>
      </div>
      <div class="progress__bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
        <div class="progress__fill" :style="{ width: pct + '%' }" />
      </div>
    </div>

    <!-- Stages -->
    <fieldset v-for="(stage, si) in STAGES" :key="si" class="group" :class="{ 'group--danger': stage.danger }">
      <legend>{{ stage.title }}</legend>
      <p v-if="stage.note" class="note">{{ stage.note }}</p>
      <label v-for="(item, ii) in stage.items" :key="ii" class="check">
        <input
          type="checkbox"
          :class="{ 'check--danger': stage.danger }"
          :checked="!!checked[`${si}:${ii}`]"
          @change="toggle(si, ii)"
        />
        <span :class="{ 'is-done': checked[`${si}:${ii}`] }">{{ item }}</span>
      </label>
    </fieldset>

    <div class="links">
      <a v-for="[label, href] in LINKS" :key="href" :href="href" target="_blank" rel="noopener">{{ label }} ↗</a>
    </div>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: var(--space-6); }
.panel__head { display: flex; justify-content: space-between; gap: var(--space-6); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); }

.progress { display: grid; gap: var(--space-3); }
.progress__top { display: flex; justify-content: space-between; align-items: center; font-size: var(--font-size-sm); color: var(--text-body); font-variant-numeric: tabular-nums; }
.progress__bar { height: 8px; border-radius: var(--radius-xs); background: var(--bg-raised); overflow: hidden; }
.progress__fill { height: 100%; background: var(--text-success); transition: width var(--motion-duration-instant) var(--motion-ease); }

.group {
  margin: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  display: grid;
  gap: var(--space-1);
  background: var(--bg-card);
}
.group--danger { border-left: 3px solid var(--text-error); }
.group legend {
  padding: 0 var(--space-3);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-weight: var(--font-weight-medium);
}
.note { margin: 0 0 var(--space-3); font-size: var(--font-size-sm); color: var(--text-muted); }

.check { display: flex; align-items: flex-start; gap: var(--space-4); padding: var(--space-3) 0; cursor: pointer; font-size: var(--font-size-sm); border-bottom: 1px solid var(--border-subtle); }
.check:last-child { border-bottom: none; }
.check input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--text-success); flex: none; }
.check input.check--danger { accent-color: var(--text-error); }
.check span { line-height: 1.4; }
.check .is-done { color: var(--text-muted); text-decoration: line-through; }

.reset {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  color: var(--text-muted);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.reset:hover { border-color: var(--text-error); color: var(--text-error); }
.reset:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.links { display: flex; gap: var(--space-5); flex-wrap: wrap; }
.links a {
  flex: 1; text-align: center; min-width: 120px;
  padding: var(--space-4);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  color: var(--text-body);
  text-decoration: none;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}
.links a:hover { border-color: var(--text-link); color: var(--text-link); }
</style>
