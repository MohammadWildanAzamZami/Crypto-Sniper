<script setup>
/**
 * ManualScoringPanel — a manual screening calculator. You type the numbers you
 * read directly off DexScreener / RugCheck for a token, and it computes a 0–100
 * risk-filter score with a transparent +/- breakdown. This complements the
 * automated GEM Score screener: use it when you're eyeballing a pair by hand.
 *
 * Ported from the standalone screening-memecoin-solana.html, rebuilt on the
 * design tokens (no raw hex). It's a heuristic risk filter, NOT a price
 * prediction and NOT financial advice.
 */
import { reactive, computed } from "vue";

// Numeric inputs (kept as strings; num() parses to number|null).
const f = reactive({ liq: "", mcap: "", vol24: "", age: "", buys1h: "", sells1h: "", makers: "", top10: "" });
// Contract-safety toggles.
const state = reactive({ mint: null, freeze: null, lp: null });
// Extra red-flag checkboxes.
const flags = reactive({ tax: false, social: false, clone: false, bundle: false });

const num = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};

// A toggle is a "danger" choice when it represents the risky option.
function isDanger(group, value) {
  return (group === "mint" && value === "active") ||
    (group === "freeze" && value === "active") ||
    (group === "lp" && value === "no");
}
function pick(group, value) {
  state[group] = state[group] === value ? null : value;
}

function reset() {
  for (const k of Object.keys(f)) f[k] = "";
  state.mint = state.freeze = state.lp = null;
  flags.tax = flags.social = flags.clone = flags.bundle = false;
}

// The whole score is a pure function of the inputs → a computed.
const result = computed(() => {
  const liq = num(f.liq), mcap = num(f.mcap), vol24 = num(f.vol24), age = num(f.age);
  const buys = num(f.buys1h), sells = num(f.sells1h), makers = num(f.makers), top10 = num(f.top10);

  const anyFilled =
    [liq, mcap, vol24, age, buys, sells, makers, top10].some((v) => v !== null) ||
    state.mint || state.freeze || state.lp ||
    flags.tax || flags.social || flags.clone || flags.bundle;

  if (!anyFilled) return null;

  let score = 50; // neutral baseline
  const lines = [];
  const add = (pts, label) => { score += pts; lines.push({ pts, label }); };

  // Liquidity
  if (liq !== null) {
    if (liq >= 10000 && liq <= 100000) add(8, "Liquidity di rentang ideal");
    else if (liq < 10000) add(-15, "Liquidity terlalu kecil, rawan manipulasi");
    else add(-3, "Liquidity besar — ruang 10x lebih berat");
  }
  // Volume / Liquidity ratio
  if (liq !== null && vol24 !== null && liq > 0) {
    const ratio = vol24 / liq;
    if (ratio >= 2) add(12, `Volume/Liquidity ratio sehat (${ratio.toFixed(1)}x)`);
    else if (ratio >= 1) add(2, `Volume/Liquidity ratio pas-pasan (${ratio.toFixed(1)}x)`);
    else add(-10, "Volume terlalu rendah dibanding liquidity");
  }
  // Market cap for 10x headroom
  if (mcap !== null) {
    if (mcap < 200000) add(10, "Market cap kecil — ruang 10x realistis");
    else if (mcap < 1000000) add(2, "Market cap menengah");
    else add(-8, "Market cap besar — 10x makin berat");
  }
  // Age
  if (age !== null) {
    if (age < 1) add(-8, "Sangat baru — fase paling rawan rug");
    else if (age <= 48) add(6, "Umur token di rentang yang sudah disaring awal");
    else add(0, "Token sudah cukup lama, momentum awal mungkin lewat");
  }
  // Buy/Sell ratio
  if (buys !== null && sells !== null && buys + sells > 0) {
    const ratio = sells > 0 ? buys / sells : buys;
    if (ratio >= 2) add(12, `Buy mendominasi sell (${ratio.toFixed(1)}:1)`);
    else if (ratio >= 1) add(3, "Buy/sell cukup seimbang");
    else add(-12, "Sell mendominasi buy — momentum melemah");
  }
  // Makers vs tx (wash-trading indicator)
  if (makers !== null && buys !== null && sells !== null) {
    const totalTx = buys + sells;
    if (totalTx > 0) {
      const txPerMaker = totalTx / Math.max(makers, 1);
      if (txPerMaker > 8) add(-10, "Tx per wallet tinggi — indikasi wash trading");
      else add(6, "Aktivitas tersebar di banyak wallet unik");
    }
  }
  // Holder concentration
  if (top10 !== null) {
    if (top10 < 20) add(12, "Distribusi holder sehat (top10 < 20%)");
    else if (top10 < 40) add(4, "Konsentrasi holder sedang");
    else add(-18, "Top 10 holder terlalu terkonsentrasi — risiko dump");
  }
  // Mint / Freeze / LP
  if (state.mint === "revoked") add(10, "Mint authority sudah revoked");
  if (state.mint === "active") add(-25, "Mint authority masih aktif — risiko tinggi");
  if (state.freeze === "revoked") add(8, "Freeze authority sudah revoked");
  if (state.freeze === "active") add(-20, "Freeze authority masih aktif — risiko tinggi");
  if (state.lp === "yes") add(15, "LP locked/burned");
  if (state.lp === "no") add(-30, "LP tidak locked/burned — risiko rug sangat tinggi");
  // Red flags
  if (flags.tax) add(-12, "Tax beli/jual tidak wajar");
  if (flags.social) add(-10, "Tidak ada social link");
  if (flags.clone) add(-20, "Kemungkinan token clone/scam");
  if (flags.bundle) add(-18, "Cluster wallet sniper/bundle terdeteksi");

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level, verdict, sub;
  if (score >= 70) {
    level = "good";
    verdict = "Lolos filter dasar — lanjut due diligence manual";
    sub = "Tetap cek narasi komunitas & posisi kecil. Skor tinggi ≠ pasti naik.";
  } else if (score >= 45) {
    level = "mid";
    verdict = "Campuran — perlu kehati-hatian ekstra";
    sub = "Ada beberapa sinyal kurang ideal. Periksa ulang poin minus di bawah.";
  } else {
    level = "bad";
    verdict = "Risiko tinggi — sebaiknya dilewati";
    sub = "Banyak red flag terdeteksi. Lebih baik cari kandidat lain.";
  }

  lines.sort((a, b) => a.pts - b.pts);
  return { score, level, verdict, sub, lines };
});

const TOGGLES = {
  mint: [["revoked", "Revoked"], ["active", "Masih aktif"], ["unknown", "Belum cek"]],
  freeze: [["revoked", "Revoked"], ["active", "Masih aktif"], ["unknown", "Belum cek"]],
  lp: [["yes", "Ya"], ["no", "Tidak"], ["unknown", "Belum cek"]],
};
</script>

<template>
  <section class="panel" aria-labelledby="manual-h">
    <div class="panel__head">
      <div>
        <h2 id="manual-h">🧮 Kalkulator Screening Manual</h2>
        <p class="panel__sub">
          Masukkan angka yang kamu lihat langsung di DexScreener &amp; RugCheck. Skor risiko
          dihitung otomatis — heuristik, bukan prediksi harga.
        </p>
      </div>
    </div>

    <p class="disclaimer">
      <strong>Bukan jaminan profit.</strong> Skor tinggi cuma berarti "lolos filter risiko dasar",
      bukan "akan naik 10x". Mayoritas memecoin baru tetap gagal walau lolos semua kriteria. Selalu
      posisi kecil dan anggap modal bisa hilang 100%.
    </p>

    <!-- 1 · Market & Liquidity -->
    <fieldset class="group">
      <legend>1 · Market &amp; Liquidity</legend>
      <div class="grid2">
        <label class="field"><span>Liquidity (USD)</span>
          <input type="number" inputmode="decimal" v-model="f.liq" placeholder="cth: 25000" /></label>
        <label class="field"><span>Market Cap (USD)</span>
          <input type="number" inputmode="decimal" v-model="f.mcap" placeholder="cth: 150000" /></label>
        <label class="field"><span>Volume 24h (USD)</span>
          <input type="number" inputmode="decimal" v-model="f.vol24" placeholder="cth: 80000" /></label>
        <label class="field"><span>Umur token (jam)</span>
          <input type="number" inputmode="decimal" v-model="f.age" placeholder="cth: 6" /></label>
      </div>
    </fieldset>

    <!-- 2 · Aktivitas Trading -->
    <fieldset class="group">
      <legend>2 · Aktivitas Trading (1 jam terakhir)</legend>
      <div class="grid2">
        <label class="field"><span>Jumlah Buys</span>
          <input type="number" inputmode="decimal" v-model="f.buys1h" placeholder="cth: 120" /></label>
        <label class="field"><span>Jumlah Sells</span>
          <input type="number" inputmode="decimal" v-model="f.sells1h" placeholder="cth: 40" /></label>
      </div>
      <label class="field"><span>Unique makers / traders (jika terlihat)</span>
        <input type="number" inputmode="decimal" v-model="f.makers" placeholder="cth: 95 — kosongkan jika tidak terlihat" />
        <small class="hint">Cek di tab pair DexScreener. Tx tinggi tapi maker sedikit → indikasi wash trading.</small>
      </label>
    </fieldset>

    <!-- 3 · Holder -->
    <fieldset class="group">
      <legend>3 · Holder Distribution</legend>
      <label class="field"><span>Top 10 holder pegang berapa % supply (di luar LP/burn)?</span>
        <input type="number" inputmode="decimal" v-model="f.top10" placeholder="cth: 28" /></label>
    </fieldset>

    <!-- 4 · Keamanan Kontrak -->
    <fieldset class="group">
      <legend>4 · Keamanan Kontrak (cek di RugCheck.xyz)</legend>
      <div class="field" v-for="(opts, group) in TOGGLES" :key="group">
        <span class="field__label">{{ group === 'mint' ? 'Mint authority' : group === 'freeze' ? 'Freeze authority' : 'LP locked / burned' }}</span>
        <div class="toggles" role="group">
          <button
            v-for="[value, text] in opts"
            :key="value"
            type="button"
            class="toggle"
            :class="{ active: state[group] === value && !isDanger(group, value), danger: state[group] === value && isDanger(group, value) }"
            :aria-pressed="state[group] === value"
            @click="pick(group, value)"
          >{{ text }}</button>
        </div>
      </div>
    </fieldset>

    <!-- 5 · Red flags -->
    <fieldset class="group">
      <legend>5 · Red Flag Tambahan</legend>
      <label class="check"><input type="checkbox" v-model="flags.tax" /><span>Buy/sell tax tidak wajar tinggi (&gt;10%)</span></label>
      <label class="check"><input type="checkbox" v-model="flags.social" /><span>Tidak ada link Twitter/Telegram sama sekali</span></label>
      <label class="check"><input type="checkbox" v-model="flags.clone" /><span>Nama/simbol mirip token terkenal (kemungkinan clone/scam)</span></label>
      <label class="check"><input type="checkbox" v-model="flags.bundle" /><span>Ada cluster wallet sniper/bundle besar di top holder</span></label>
    </fieldset>

    <!-- Result -->
    <div class="result" :class="result ? `lvl-${result.level}` : 'lvl-mid'" aria-live="polite">
      <div class="result__label">Skor Screening</div>
      <div class="result__score">{{ result ? result.score + "/100" : "—" }}</div>
      <div class="result__verdict">{{ result ? result.verdict : "Isi data di atas" }}</div>
      <div class="result__sub">{{ result ? result.sub : "Skor muncul otomatis saat kamu mengisi field" }}</div>
      <div v-if="result && result.lines.length" class="breakdown">
        <div v-for="(l, i) in result.lines" :key="i">
          <span>{{ l.label }}</span>
          <span :class="l.pts < 0 ? 'neg' : 'pos'">{{ l.pts > 0 ? "+" : "" }}{{ l.pts }}</span>
        </div>
      </div>
    </div>

    <div class="links">
      <a href="https://dexscreener.com/solana" target="_blank" rel="noopener">Buka DexScreener ↗</a>
      <a href="https://rugcheck.xyz" target="_blank" rel="noopener">Buka RugCheck ↗</a>
    </div>
    <button type="button" class="reset" @click="reset">Reset semua field</button>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: var(--space-6); }
.panel__head { display: flex; justify-content: space-between; gap: var(--space-6); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); }

.disclaimer {
  margin: 0;
  padding: var(--space-5);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--text-warning);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.disclaimer strong { color: var(--text-body); }

.group {
  margin: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  display: grid;
  gap: var(--space-5);
  background: var(--bg-card);
}
.group legend {
  padding: 0 var(--space-3);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-weight: var(--font-weight-medium);
}
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }

.field { display: grid; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--text-body); }
.field > span, .field__label { color: var(--text-body); }
.field input[type="number"] {
  width: 100%;
  height: var(--control-height);
  padding: 0 var(--control-padding-x);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  color: var(--text-body);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.field input[type="number"]:focus { outline: none; border-color: var(--border-focus); }
.hint { color: var(--text-muted); font-size: var(--font-size-xs); }

.toggles { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.toggle {
  flex: 1; min-width: 90px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  background: var(--bg-raised);
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
  transition: all var(--motion-duration-instant) var(--motion-ease);
}
.toggle:hover { border-color: var(--text-muted); }
.toggle.active { border-color: var(--text-success); background: rgba(74, 222, 128, 0.12); color: var(--text-success); font-weight: var(--font-weight-medium); }
.toggle.danger { border-color: var(--text-error); background: rgba(248, 113, 113, 0.12); color: var(--text-error); font-weight: var(--font-weight-medium); }
.toggle:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.check { display: flex; align-items: flex-start; gap: var(--space-4); padding: var(--space-3) 0; cursor: pointer; font-size: var(--font-size-sm); }
.check input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--text-error); flex: none; }

.result {
  position: sticky;
  bottom: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  text-align: center;
  display: grid;
  gap: var(--space-2);
  background: var(--bg-card);
  transition: all var(--motion-duration-instant) var(--motion-ease);
}
.result__label {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}
.result__score {
  font-family: var(--font-family-mono);
  font-size: 42px;
  font-weight: var(--font-weight-bold);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.result__verdict { font-weight: var(--font-weight-medium); }
.result__sub { font-size: var(--font-size-sm); color: var(--text-muted); }
.lvl-good { background: radial-gradient(circle at 50% 0%, rgba(124, 242, 176, 0.16), var(--bg-card)); border-color: var(--text-success); }
.lvl-good .result__score { color: var(--text-success); }
.lvl-mid { background: radial-gradient(circle at 50% 0%, rgba(242, 183, 116, 0.16), var(--bg-card)); border-color: var(--text-warning); }
.lvl-mid .result__score { color: var(--text-warning); }
.lvl-bad { background: radial-gradient(circle at 50% 0%, rgba(242, 124, 124, 0.16), var(--bg-card)); border-color: var(--text-error); }
.lvl-bad .result__score { color: var(--text-error); }

.breakdown { margin-top: var(--space-4); border-top: 1px solid var(--border-default); padding-top: var(--space-4); text-align: left; display: grid; gap: var(--space-1); font-size: var(--font-size-xs); }
.breakdown > div { display: flex; justify-content: space-between; gap: var(--space-4); color: var(--text-muted); }
.breakdown .neg { color: var(--text-error); font-variant-numeric: tabular-nums; }
.breakdown .pos { color: var(--text-success); font-variant-numeric: tabular-nums; }

.links { display: flex; gap: var(--space-5); flex-wrap: wrap; }
.links a {
  flex: 1; text-align: center; min-width: 140px;
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

.reset {
  width: 100%;
  padding: var(--space-4);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}
.reset:hover { border-color: var(--text-error); color: var(--text-error); }
.reset:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

@media (max-width: 560px) {
  .grid2 { grid-template-columns: 1fr; }
}
</style>
