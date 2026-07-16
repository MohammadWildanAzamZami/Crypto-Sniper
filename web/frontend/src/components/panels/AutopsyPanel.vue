<script setup>
/**
 * AutopsyPanel — "Bedah Coin" (SNIPER ENGINE Modul A). Given a mint that has
 * already run, GET /api/autopsy reconstructs WHO bought it early (while mcap was
 * small) and HOW. The star output is the smart-wallet candidate list: established,
 * clean, still-holding early buyers worth following into the next pump (the seed
 * of a future watchlist). Heuristic on-chain forensics — NOT financial advice.
 */
import { ref } from "vue";
import { apiUrl } from "../../lib/api.js";

const mint = ref("");
const report = ref(null);
const loading = ref(false);
const error = ref("");
const copied = ref("");
const showBuyers = ref(false);

const money = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");
const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const xFmt = (n) => (typeof n === "number" && n > 0 ? (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + "x" : "—");
const tierLabel = (t) => (t === "ultra-early" ? "⚡ ultra-early" : "early");
const scoreClass = (s) => "score--" + (s >= 80 ? "hi" : s >= 60 ? "mid" : "lo");

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ""; }, 1600);
  } catch { /* clipboard blocked */ }
}

async function run() {
  const m = mint.value.trim();
  if (!m || loading.value) return;
  loading.value = true;
  error.value = "";
  report.value = null;
  showBuyers.value = false;
  try {
    const r = await fetch(apiUrl(`/api/autopsy?mint=${encodeURIComponent(m)}`));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Bedah gagal (${r.status})`;
    else report.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

function reset() {
  report.value = null;
  error.value = "";
  mint.value = "";
}
</script>

<template>
  <section class="panel" aria-labelledby="autopsy-h">
    <div class="panel__head">
      <div>
        <h2 id="autopsy-h">🔬 Bedah Coin <span class="tag">Sniper</span></h2>
        <p class="panel__sub">
          Tempel alamat token yang sudah naik → dibongkar <b>siapa yang beli lebih awal</b> (saat market cap masih kecil)
          dan siapa yang <b>hold vs jual</b>.
        </p>
      </div>
    </div>

    <!-- Input -->
    <form class="ac-form" @submit.prevent="run">
      <input
        v-model="mint"
        class="ac-input"
        type="text"
        inputmode="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="Alamat token Solana (mint) — mis. 4SnKwnz…k2Jpump"
        aria-label="Alamat token (mint)"
        :disabled="loading"
      />
      <button class="scanbtn" type="submit" :disabled="loading || !mint.trim()">
        {{ loading ? "🔬 Membedah…" : "Bedah" }}
      </button>
      <button v-if="report" class="closebtn" type="button" :disabled="loading" @click="reset">Reset</button>
    </form>

    <p v-if="loading" class="ac-hint">Menarik riwayat trade dari awal &amp; verifikasi wallet — biasanya 10–20 detik.</p>
    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <!-- Report -->
    <div v-if="report" class="ac-report">
      <!-- Token header -->
      <div class="ac-token">
        <div class="ac-token__id">
          <span class="ac-token__sym">{{ report.token.symbol || "?" }}</span>
          <span class="ac-token__name">{{ report.token.name || "" }}</span>
        </div>
        <div class="ac-token__nums">
          <div class="ac-stat">
            <span class="ac-stat__l">Market cap sekarang</span>
            <span class="ac-stat__v">{{ money(report.token.currentMcap) }}</span>
          </div>
          <div class="ac-stat">
            <span class="ac-stat__l">Market cap launch</span>
            <span class="ac-stat__v">{{ money(report.token.launchMcap) }}</span>
          </div>
          <div v-if="report.token.launchToNowX" class="ac-stat ac-stat--hero">
            <span class="ac-stat__l">Launch → sekarang</span>
            <span class="ac-stat__v">{{ xFmt(report.token.launchToNowX) }}</span>
          </div>
        </div>
      </div>

      <!-- Watchlist learning feedback -->
      <p v-if="report.watchlist && report.watchlist.recorded > 0" class="ac-learned" role="status">
        🎯 Winner terdeteksi — <b>{{ report.watchlist.recorded }} smart wallet</b> ditambahkan ke Watchlist (lihat panel di bawah).
      </p>
      <p v-else-if="report.watchlist && !report.watchlist.winner && report.token.launchToNowX" class="ac-learned ac-learned--muted" role="status">
        Token ini belum cukup naik untuk dihitung winner (butuh ≥10x) — wallet-nya tidak dimasukkan Watchlist.
      </p>

      <!-- No-early-data guard -->
      <p v-if="report.token.noEarlyData" class="ac-warn" role="note">
        ⚠️ Riwayat trade paling awal token ini sudah di atas $100k market cap — fase early tidak tersedia di data.
        Tool ini paling akurat untuk token yang <b>baru saja</b> naik.
      </p>

      <!-- Summary -->
      <div class="ac-summary">
        <div class="ac-chip"><b>{{ report.summary.earlyWallets }}</b> early wallet</div>
        <div class="ac-chip ac-chip--ultra"><b>{{ report.summary.ultraEarlyWallets }}</b> ultra-early</div>
        <div class="ac-chip ac-chip--ok"><b>{{ report.summary.establishedWallets }}</b> mapan
          <span class="ac-chip__sub">/ {{ report.summary.walletsChecked }} dicek</span>
        </div>
        <div class="ac-chip ac-chip--warn"><b>{{ report.summary.bundledWallets }}</b> bundle
          <span class="ac-chip__sub">({{ report.summary.bundleClusters }} cluster)</span>
        </div>
      </div>

      <!-- Smart wallet candidates (the star) -->
      <div class="ac-block">
        <h3 class="ac-h3">⭐ Kandidat smart wallet <span class="ac-h3__sub">— layak dibuntuti ke pump berikutnya</span></h3>
        <p v-if="!report.smartWalletCandidates.length" class="ac-empty">
          Tidak ada kandidat bersih — early buyer-nya didominasi bundle/bot atau sudah jual di awal.
        </p>
        <ul v-else class="ac-cands">
          <li v-for="(w, i) in report.smartWalletCandidates" :key="w.owner" class="ac-cand">
            <span class="ac-cand__rank">{{ i + 1 }}</span>
            <button class="ac-cand__addr" type="button" :title="'Salin: ' + w.owner" @click="copy(w.owner)">
              {{ copied === w.owner ? "✓ tersalin" : shortAddr(w.owner) }}
            </button>
            <span class="ac-cand__meta">
              <span class="ac-tier" :class="w.tier === 'ultra-early' ? 'ac-tier--ultra' : ''">{{ tierLabel(w.tier) }}</span>
              <span class="ac-cand__entry">entry {{ money(w.firstBuyMcap) }}</span>
              <span v-if="w.xFromEntry" class="ac-cand__x">{{ xFmt(w.xFromEntry) }}</span>
              <span v-if="w.established === true" class="ac-badge ac-badge--ok">mapan</span>
              <span v-else-if="w.established === false" class="ac-badge ac-badge--warn">fresh</span>
            </span>
            <span class="ac-cand__score" :class="scoreClass(w.score)">{{ w.score }}</span>
          </li>
        </ul>
      </div>

      <!-- Coordination / bundle -->
      <div v-if="report.coordination.clusters.length" class="ac-block">
        <h3 class="ac-h3">🔗 Koordinasi / bundle terdeteksi</h3>
        <ul class="ac-clusters">
          <li v-for="(c, i) in report.coordination.clusters" :key="i" class="ac-cluster">
            <b>{{ c.walletCount }} wallet</b> beli barengan @ {{ money(c.avgMcap) }}
            <span class="ac-cluster__u">keseragaman {{ Math.round(c.uniformity * 100) }}%</span>
          </li>
        </ul>
      </div>

      <!-- Early buyers detail (collapsible) -->
      <div class="ac-block">
        <button class="ac-toggle" type="button" @click="showBuyers = !showBuyers">
          {{ showBuyers ? "▾" : "▸" }} Semua early buyer ({{ report.earlyBuyers.length }})
        </button>
        <div v-if="showBuyers" class="ac-table-wrap">
          <table class="ac-table">
            <thead>
              <tr><th>Wallet</th><th>Tier</th><th>Entry mcap</th><th>Beli (USD)</th><th>x</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr v-for="w in report.earlyBuyers" :key="w.owner">
                <td>
                  <button class="ac-cand__addr" type="button" @click="copy(w.owner)">
                    {{ copied === w.owner ? "✓" : shortAddr(w.owner) }}
                  </button>
                </td>
                <td>{{ w.tier === "ultra-early" ? "⚡" : "•" }}</td>
                <td>{{ money(w.firstBuyMcap) }}</td>
                <td>{{ money(w.totalBuyUsd) }}</td>
                <td>{{ xFmt(w.xFromEntry) }}</td>
                <td>
                  <span v-if="w.bundleSuspected" class="ac-badge ac-badge--warn">bundle</span>
                  <span v-else-if="w.soldInWindow" class="ac-badge">jual awal</span>
                  <span v-else class="ac-badge ac-badge--ok">hold</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Notes / caveats -->
      <ul class="ac-notes">
        <li v-for="(n, i) in report.notes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: var(--space-5); }
.panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
.panel__head h2 { margin: 0; font-size: var(--font-size-lg); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }
.panel__error { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.tag {
  font-size: var(--font-size-xs); font-weight: var(--font-weight-medium);
  color: var(--text-on-accent); background: var(--bg-accent);
  padding: 2px 8px; border-radius: var(--radius-full, 999px); vertical-align: middle;
}

/* Input row */
.ac-form { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.ac-input {
  flex: 1 1 320px; min-width: 0;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-raised); color: var(--text-body);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  font: inherit;
}
.ac-input::placeholder { color: var(--text-muted); }
.ac-input:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; border-color: var(--border-focus); }
.ac-input:disabled { opacity: 0.6; }

.scanbtn, .closebtn {
  flex: none; padding: var(--space-3) var(--space-5);
  border-radius: var(--control-radius); font: inherit; font-weight: var(--font-weight-medium);
  cursor: pointer; border: 1px solid var(--border-default);
  transition: border-color var(--motion-duration-instant) var(--motion-ease),
    transform var(--motion-duration-instant) var(--motion-ease);
}
.scanbtn { background: var(--bg-accent); color: var(--text-on-accent); border-color: transparent; }
.scanbtn:hover:not(:disabled) { transform: translateY(-1px); }
.closebtn { background: var(--bg-raised); color: var(--text-muted); }
.closebtn:hover:not(:disabled) { border-color: var(--text-error); color: var(--text-error); }
.scanbtn:disabled, .closebtn:disabled { opacity: 0.55; cursor: not-allowed; }
.scanbtn:focus-visible, .closebtn:focus-visible, .ac-toggle:focus-visible, .ac-cand__addr:focus-visible {
  outline: 2px solid var(--border-focus); outline-offset: 2px;
}
.ac-hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

/* Report */
.ac-report { display: grid; gap: var(--space-5); }

.ac-token {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); flex-wrap: wrap;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-lg, 12px);
}
.ac-token__id { display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.ac-token__sym { font-size: var(--font-size-lg); font-weight: 700; color: var(--text-body); }
.ac-token__name { color: var(--text-muted); font-size: var(--font-size-sm); }
.ac-token__nums { display: flex; gap: var(--space-5); flex-wrap: wrap; }
.ac-stat { display: grid; gap: 2px; }
.ac-stat__l { font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.ac-stat__v { font-size: var(--font-size-md); font-weight: 600; color: var(--text-body); font-variant-numeric: tabular-nums; }
.ac-stat--hero .ac-stat__v { color: var(--text-success); font-size: var(--font-size-lg); }

.ac-learned {
  margin: 0; padding: var(--space-3) var(--space-4);
  background: color-mix(in srgb, var(--text-success) 12%, transparent);
  border: 1px solid var(--text-success); border-radius: var(--control-radius);
  color: var(--text-body); font-size: var(--font-size-sm);
}
.ac-learned--muted {
  background: var(--bg-raised); border-color: var(--border-default); color: var(--text-muted);
}

.ac-warn {
  margin: 0; padding: var(--space-3) var(--space-4);
  background: color-mix(in srgb, var(--text-error) 12%, transparent);
  border: 1px solid var(--text-error); border-radius: var(--control-radius);
  color: var(--text-body); font-size: var(--font-size-sm);
}

/* Summary chips */
.ac-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.ac-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.ac-chip b { color: var(--text-body); }
.ac-chip__sub { opacity: 0.7; font-size: var(--font-size-xs); }
.ac-chip--ultra { border-color: var(--text-success); }
.ac-chip--ultra b { color: var(--text-success); }
.ac-chip--ok b { color: var(--text-success); }
.ac-chip--warn b { color: var(--text-error); }

/* Blocks */
.ac-block { display: grid; gap: var(--space-3); }
.ac-h3 { margin: 0; font-size: var(--font-size-md); color: var(--text-body); }
.ac-h3__sub { font-weight: 400; color: var(--text-muted); font-size: var(--font-size-sm); }
.ac-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

/* Candidate list */
.ac-cands { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.ac-cand {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.ac-cand__rank {
  flex: none; width: 22px; height: 22px; display: grid; place-items: center;
  background: var(--bg-raised); border-radius: var(--radius-full, 999px);
  font-size: var(--font-size-xs); color: var(--text-muted); font-weight: 600;
}
.ac-cand__addr {
  flex: none; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 2px 8px; cursor: pointer; font-size: var(--font-size-sm);
}
.ac-cand__addr:hover { border-color: var(--text-success); color: var(--text-success); }
.ac-cand__meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; flex: 1; min-width: 0; }
.ac-cand__entry { color: var(--text-muted); font-size: var(--font-size-sm); }
.ac-cand__x { color: var(--text-success); font-weight: 600; font-size: var(--font-size-sm); }
.ac-cand__score {
  flex: none; margin-left: auto; min-width: 34px; text-align: center;
  padding: 2px 8px; border-radius: var(--radius-sm); font-weight: 700; font-size: var(--font-size-sm);
}
.score--hi { background: color-mix(in srgb, var(--text-success) 20%, transparent); color: var(--text-success); }
.score--mid { background: var(--bg-raised); color: var(--text-body); }
.score--lo { background: var(--bg-raised); color: var(--text-muted); }

.ac-tier { font-size: var(--font-size-xs); color: var(--text-muted); }
.ac-tier--ultra { color: var(--text-success); font-weight: 600; }
.ac-badge {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: var(--radius-sm);
  background: var(--bg-raised); color: var(--text-muted); border: 1px solid var(--border-default);
}
.ac-badge--ok { color: var(--text-success); border-color: var(--text-success); }
.ac-badge--warn { color: var(--text-error); border-color: var(--text-error); }

/* Clusters */
.ac-clusters { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.ac-cluster {
  padding: var(--space-2) var(--space-4); border-radius: var(--control-radius);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.ac-cluster b { color: var(--text-body); }
.ac-cluster__u { margin-left: var(--space-2); font-size: var(--font-size-xs); opacity: 0.7; }

/* Toggle + table */
.ac-toggle {
  justify-self: start; background: none; border: none; color: var(--text-muted);
  font: inherit; font-size: var(--font-size-sm); cursor: pointer; padding: 0;
}
.ac-toggle:hover { color: var(--text-body); }
.ac-table-wrap { overflow-x: auto; }
.ac-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.ac-table th, .ac-table td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-default); white-space: nowrap; }
.ac-table th { color: var(--text-muted); font-weight: var(--font-weight-medium); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.04em; }
.ac-table td { color: var(--text-body); font-variant-numeric: tabular-nums; }

/* Notes */
.ac-notes { margin: 0; padding-left: var(--space-5); display: grid; gap: 2px; }
.ac-notes li { color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

@media (max-width: 560px) {
  .ac-token { align-items: flex-start; }
  .ac-cand__score { margin-left: 0; }
}
</style>
