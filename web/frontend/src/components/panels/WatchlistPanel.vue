<script setup>
/**
 * WatchlistPanel — the smart-wallet watchlist (SNIPER ENGINE Modul B). Shows the
 * self-learning ranking: wallets auto-recorded from "Bedah Coin" autopsies of real
 * winners, ordered by reputation (how many winners each caught early). The top
 * WATCH_SIZE are flagged ACTIVE — the set the live monitor (Modul C) will follow.
 * Heuristic track record — NOT financial advice.
 */
import { ref, onMounted } from "vue";
import { apiUrl } from "../../lib/api.js";

const data = ref(null);
const loading = ref(false);
const error = ref("");
const copied = ref("");

const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const xFmt = (n) => (typeof n === "number" && n > 0 ? (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + "x" : "—");

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ""; }, 1600);
  } catch { /* clipboard blocked */ }
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/watchlist"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Gagal memuat (${r.status})`;
    else data.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="panel" aria-labelledby="watchlist-h">
    <div class="panel__head">
      <div>
        <h2 id="watchlist-h">🎯 Watchlist Smart Wallet <span class="tag">Sniper</span></h2>
        <p class="panel__sub">
          Wallet yang <b>berulang kali menangkap winner lebih awal</b> — direkam otomatis dari Bedah Coin,
          diperingkat sesuai rekam jejak. Yang teratas = <b>aktif dipantau</b> (untuk monitor live berikutnya).
        </p>
      </div>
      <button class="scanbtn" :disabled="loading" @click="load">
        {{ loading ? "Memuat…" : "↻ Segarkan" }}
      </button>
    </div>

    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <template v-if="data">
      <!-- Config strip -->
      <div class="wl-summary">
        <div class="wl-chip"><b>{{ data.total }}</b> wallet terekam</div>
        <div class="wl-chip wl-chip--ok"><b>{{ data.active }}</b> / {{ data.watchSize }} aktif dipantau</div>
        <div class="wl-chip">cek tiap <b>{{ data.pollMin }}m</b></div>
        <div class="wl-chip">winner = <b>≥{{ data.winnerMinX }}x</b></div>
      </div>

      <!-- Empty state -->
      <p v-if="!data.wallets.length" class="wl-empty">
        Belum ada wallet. Buka <b>🔬 Bedah Coin</b> dan bedah beberapa token yang sudah pump besar (≥{{ data.winnerMinX }}x) —
        smart wallet-nya akan otomatis masuk ke sini.
      </p>

      <!-- Ranked list -->
      <ul v-else class="wl-list">
        <li v-for="w in data.wallets" :key="w.owner" class="wl-row" :class="w.active ? 'wl-row--active' : ''">
          <span class="wl-rank">#{{ w.rank }}</span>
          <button class="wl-addr" type="button" :title="'Salin: ' + w.owner" @click="copy(w.owner)">
            {{ copied === w.owner ? "✓ tersalin" : shortAddr(w.owner) }}
          </button>
          <span class="wl-rep">
            <span class="wl-rep__bar"><span class="wl-rep__fill" :style="{ width: w.reputation + '%' }"></span></span>
            <span class="wl-rep__n">{{ w.reputation }}</span>
          </span>
          <span class="wl-catches">
            🎯 {{ w.catches }} winner
            <span v-if="w.bestCatch" class="wl-best">· best {{ w.bestCatch.symbol }} {{ xFmt(w.bestCatch.xFromEntry) }}</span>
          </span>
          <span class="wl-flags">
            <span v-if="w.established" class="wl-badge wl-badge--ok">mapan</span>
            <span v-if="w.active" class="wl-badge wl-badge--active">dipantau</span>
          </span>
        </li>
      </ul>

      <p class="wl-note">
        ⏳ Monitor live (alert saat wallet ini mulai borong token baru) belum aktif — itu tahap berikutnya (Modul C).
        Track record heuristik, bukan nasihat keuangan.
      </p>
    </template>
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
.scanbtn {
  flex: none; padding: var(--space-3) var(--space-5);
  border-radius: var(--control-radius); font: inherit; font-weight: var(--font-weight-medium);
  cursor: pointer; border: 1px solid var(--border-default);
  background: var(--bg-raised); color: var(--text-body);
  transition: border-color var(--motion-duration-instant) var(--motion-ease);
}
.scanbtn:hover:not(:disabled) { border-color: var(--text-success); }
.scanbtn:disabled { opacity: 0.55; cursor: not-allowed; }
.scanbtn:focus-visible, .wl-addr:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.wl-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.wl-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.wl-chip b { color: var(--text-body); }
.wl-chip--ok b { color: var(--text-success); }

.wl-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; }

.wl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.wl-row {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.wl-row--active { border-color: color-mix(in srgb, var(--text-success) 45%, var(--border-default)); }
.wl-rank {
  flex: none; min-width: 30px; font-weight: 700; color: var(--text-muted); font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}
.wl-addr {
  flex: none; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 2px 8px; cursor: pointer; font-size: var(--font-size-sm);
}
.wl-addr:hover { border-color: var(--text-success); color: var(--text-success); }

.wl-rep { display: flex; align-items: center; gap: var(--space-2); flex: none; }
.wl-rep__bar { width: 64px; height: 6px; background: var(--bg-raised); border-radius: 999px; overflow: hidden; }
.wl-rep__fill { display: block; height: 100%; background: var(--text-success); }
.wl-rep__n { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-body); min-width: 22px; }

.wl-catches { flex: 1; min-width: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.wl-best { color: var(--text-success); }
.wl-flags { display: flex; gap: var(--space-2); flex: none; }
.wl-badge {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: var(--radius-sm);
  background: var(--bg-raised); color: var(--text-muted); border: 1px solid var(--border-default);
}
.wl-badge--ok { color: var(--text-success); border-color: var(--text-success); }
.wl-badge--active { color: var(--text-on-accent); background: var(--bg-accent); border-color: transparent; }

.wl-note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

@media (max-width: 560px) {
  .wl-catches { flex-basis: 100%; order: 5; }
}
</style>
