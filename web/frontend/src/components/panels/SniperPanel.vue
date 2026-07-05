<script setup>
/**
 * SniperPanel — live sniper signals (SNIPER ENGINE Modul C). Shows tokens that
 * multiple ACTIVE watchlist wallets (proven early winners, from Modul B) are
 * buying RIGHT NOW while still small — i.e. smart money accumulating before the
 * pump. The server sweeps on a background interval; this panel reads the signals
 * and can trigger a sweep on demand. Heuristic — NOT financial advice. DYOR.
 */
import { ref, onMounted, onBeforeUnmount } from "vue";
import { apiUrl } from "../../lib/api.js";

const data = ref(null);
const loading = ref(false);   // manual sweep in progress
const refreshing = ref(false);
const error = ref("");
const copied = ref("");
let timer = null;

const money = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");
const shortMint = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const dexUrl = (mint) => `https://dexscreener.com/solana/${mint}`;

function ago(ms) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  return `${Math.round(s / 3600)} jam lalu`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ""; }, 1600);
  } catch { /* clipboard blocked */ }
}

// Cheap read of the current signals (no API sweep).
async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const r = await fetch(apiUrl("/api/sniper/signals"));
    const body = await r.json();
    if (r.ok) { data.value = body; error.value = ""; }
  } catch { /* keep last data; a transient blip shouldn't clear the panel */ }
  finally { refreshing.value = false; }
}

// Trigger a fresh sweep now (heavier — polls each active wallet via Helius).
async function sweep() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/sniper/sweep"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Sweep gagal (${r.status})`;
    else data.value = { ...body, signalMin: body.signalMin, count: body.signals.length };
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 60_000); // keep signals fresh while the panel is open
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <section class="panel" aria-labelledby="sniper-h">
    <div class="panel__head">
      <div>
        <h2 id="sniper-h">🎯 Sinyal Sniper Live <span class="tag">Live</span></h2>
        <p class="panel__sub">
          Token yang <b>sedang diborong beberapa smart wallet sekaligus</b> (dari Watchlist) selagi masih kecil —
          sinyal akumulasi <b>sebelum</b> pump. Server memantau otomatis; tekan tombol untuk cek sekarang. Bukan nasihat keuangan.
        </p>
      </div>
      <button class="scanbtn" :disabled="loading" @click="sweep">
        {{ loading ? "🔍 Menyapu…" : "🔍 Sweep sekarang" }}
      </button>
    </div>

    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <template v-if="data">
      <div class="sn-summary">
        <div class="sn-chip"><b>{{ data.count }}</b> sinyal aktif</div>
        <div class="sn-chip">≥<b>{{ data.signalMin }}</b> wallet sepakat</div>
        <div class="sn-chip">maks mcap <b>{{ money(data.maxMcap) }}</b></div>
        <div class="sn-chip">auto tiap <b>{{ data.pollMin }}m</b></div>
      </div>

      <p v-if="!data.signals.length" class="sn-empty">
        Belum ada sinyal. Monitor menunggu ≥{{ data.signalMin }} wallet Watchlist membeli token kecil yang sama.
        Makin banyak winner yang kamu Bedah → makin pintar Watchlist → makin tajam sinyalnya.
      </p>

      <ul v-else class="sn-list">
        <li v-for="s in data.signals" :key="s.mint" class="sn-row" :class="s.isNew ? 'sn-row--new' : ''">
          <div class="sn-main">
            <span class="sn-count" :title="s.walletCount + ' smart wallet membeli'">{{ s.walletCount }}👛</span>
            <span class="sn-sym">{{ s.symbol || shortMint(s.mint) }}</span>
            <span v-if="s.isNew" class="sn-badge">BARU</span>
            <span class="sn-mcap">{{ money(s.mcap) }}</span>
          </div>
          <div class="sn-meta">
            <span class="sn-time">{{ ago(s.lastBuyAt) }}</span>
            <button class="sn-copy" type="button" :title="'Salin mint: ' + s.mint" @click="copy(s.mint)">
              {{ copied === s.mint ? "✓ tersalin" : shortMint(s.mint) }}
            </button>
            <a class="sn-link" :href="dexUrl(s.mint)" target="_blank" rel="noopener noreferrer">chart ↗</a>
          </div>
        </li>
      </ul>

      <p class="sn-note">
        Sinyal = beberapa wallet berpengalaman menumpuk token yang sama saat masih kecil. <b>Tetap DYOR</b> —
        smart wallet bisa salah, dan token kecil sangat berisiko. Bukan nasihat keuangan.
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
  cursor: pointer; border: 1px solid transparent; background: var(--bg-accent); color: var(--text-on-accent);
  transition: transform var(--motion-duration-instant) var(--motion-ease);
}
.scanbtn:hover:not(:disabled) { transform: translateY(-1px); }
.scanbtn:disabled { opacity: 0.6; cursor: not-allowed; }
.scanbtn:focus-visible, .sn-copy:focus-visible, .sn-link:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.sn-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.sn-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.sn-chip b { color: var(--text-body); }

.sn-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; }

.sn-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.sn-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.sn-row--new { border-color: color-mix(in srgb, var(--text-success) 55%, var(--border-default)); }
.sn-main { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.sn-count {
  flex: none; font-weight: 700; color: var(--text-success); font-size: var(--font-size-sm);
  background: color-mix(in srgb, var(--text-success) 14%, transparent);
  padding: 2px 8px; border-radius: var(--radius-sm);
}
.sn-sym { font-weight: 700; color: var(--text-body); }
.sn-mcap { color: var(--text-muted); font-size: var(--font-size-sm); font-variant-numeric: tabular-nums; }
.sn-badge {
  font-size: var(--font-size-xs); font-weight: 700; color: var(--text-on-accent);
  background: var(--bg-accent); padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-meta { display: flex; align-items: center; gap: var(--space-3); flex: none; }
.sn-time { color: var(--text-muted); font-size: var(--font-size-xs); }
.sn-copy {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 2px 8px; cursor: pointer; font-size: var(--font-size-xs);
}
.sn-copy:hover { border-color: var(--text-success); color: var(--text-success); }
.sn-link { color: var(--text-success); font-size: var(--font-size-sm); text-decoration: none; white-space: nowrap; }
.sn-link:hover { text-decoration: underline; }

.sn-note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

@media (max-width: 560px) {
  .sn-row { align-items: flex-start; }
  .sn-meta { flex-wrap: wrap; }
}
</style>
