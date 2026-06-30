<script setup>
/**
 * RadarPanel — "10x Radar". Auto-screens trending Solana tokens and lists the
 * ones with high-upside potential. Scan manually, and the backend also scans on
 * an interval and pushes new picks to Telegram.
 * Heuristic only — memecoins are extremely risky. Not financial advice.
 */
import { ref } from "vue";

const scan = ref({ scannedAt: 0, candidatesScanned: 0, matches: [] });
const loading = ref(false);
const error = ref("");
const copied = ref("");

const usd = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");

function ago(ms) {
  if (!ms) return "belum pernah";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  return `${Math.round(s / 3600)} jam lalu`;
}

function closeScan() {
  scan.value = { scannedAt: 0, candidatesScanned: 0, matches: [] };
  error.value = "";
  copied.value = "";
}

async function runScan() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch("/api/auto-screen");
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Scan gagal (${r.status})`;
    else scan.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

async function buy(m) {
  try {
    await navigator.clipboard.writeText(m.address);
    copied.value = m.address;
    setTimeout(() => { if (copied.value === m.address) copied.value = ""; }, 2500);
  } catch { /* clipboard blocked; user can still open the bot */ }
  window.open("https://t.me/solana_trojanbot", "_blank", "noopener");
}
</script>

<template>
  <section class="panel" aria-labelledby="radar-h">
    <div class="panel__head">
      <div>
        <h2 id="radar-h">🚀 10x Radar</h2>
        <p class="panel__sub">
          Auto-screening token Solana berpotensi tinggi. Heuristik, bukan nasihat keuangan — DYOR.
        </p>
      </div>
      <div class="head-actions">
        <button class="scanbtn" :disabled="loading" @click="runScan">
          {{ loading ? "Memindai…" : "Scan Sekarang" }}
        </button>
        <button v-if="scan.scannedAt" class="closebtn" :disabled="loading" @click="closeScan">
          Tutup
        </button>
      </div>
    </div>

    <p v-if="!scan.scannedAt && !loading && !error" class="hint">
      Klik <b>Scan Sekarang</b> untuk memulai pemindaian.
    </p>

    <p v-if="scan.scannedAt" class="meta">
      Pindai terakhir: <b>{{ ago(scan.scannedAt) }}</b>
      · {{ scan.candidatesScanned }} dicek · <b>{{ scan.matches.length }}</b> kandidat
      <span v-if="scan.preset">· mode {{ scan.preset }}</span>
    </p>

    <p v-if="error" class="err" role="alert">⚠️ {{ error }}</p>

    <p v-if="!loading && scan.scannedAt && !scan.matches.length" class="empty">
      Belum ada kandidat yang lolos filter saat ini. Coba lagi nanti — pasar bergerak cepat.
    </p>

    <ul v-if="scan.matches.length" class="list">
      <li v-for="m in scan.matches" :key="m.address" class="card">
        <div class="card__top">
          <div class="card__id">
            <div class="card__line1">
              <span class="card__sym">{{ m.symbol }}</span>
              <span class="card__name">{{ m.name }}</span>
            </div>
            <code class="card__addr" :title="m.address">{{ m.address }}</code>
          </div>
          <div class="card__badges">
            <span class="badge badge--x" v-if="m.upsideX">~{{ m.upsideX }}x potensi</span>
            <span class="badge badge--gem">GEM {{ m.gemScore }}</span>
          </div>
        </div>

        <div class="card__stats">
          <span>MC {{ usd(m.marketCap) }}</span>
          <span>Liq {{ usd(m.liquidityUsd) }}</span>
          <span v-if="m.lockedPct != null">🔒 {{ m.lockedPct }}%</span>
          <span :style="{ color: 'var(--text-muted)' }">{{ m.verdict?.label }}</span>
        </div>

        <ul class="reasons">
          <li v-for="(r, i) in m.reasons" :key="i">{{ r }}</li>
        </ul>

        <div class="card__actions">
          <a class="lnk" :href="m.url" target="_blank" rel="noopener">📈 Chart</a>
          <button class="buy" @click="buy(m)">
            {{ copied === m.address ? "✅ Alamat disalin — paste di Trojan" : "🤖 Buy via Trojan" }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: var(--space-5); }
.panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); flex-wrap: wrap; }
.panel__head h2 { margin: 0; }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); max-width: 52ch; }

.scanbtn {
  flex: none;
  padding: 0 var(--space-6);
  height: var(--control-height);
  border: 1px solid #0057b7;
  border-radius: var(--control-radius);
  background: #0057b7;
  color: #fff;
  font: inherit;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}
.scanbtn:hover { background: #004494; }
.scanbtn:disabled { opacity: 0.6; cursor: not-allowed; }
.scanbtn:focus-visible { outline: 2px solid #4d9fff; outline-offset: 2px; }

.head-actions { display: flex; gap: var(--space-3); flex: none; }
.closebtn {
  padding: 0 var(--space-5);
  height: var(--control-height);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  background: transparent;
  color: var(--text-body);
  font: inherit;
  cursor: pointer;
}
.closebtn:hover { 
  border-color: var(--text-error); 
  background: rgba(239, 68, 68, 0.08);
  color: var(--text-error); 
}
.closebtn:disabled { opacity: 0.5; cursor: not-allowed; }
.closebtn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.meta { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }
.hint { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }
.err { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

.list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); }
.card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-left: 3px solid #0057b7;
  border-radius: var(--radius-sm);
}
.card__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.card__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.card__line1 { display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.card__sym { font-weight: var(--font-weight-bold); color: var(--text-heading); font-size: var(--font-size-lg); }
.card__name { color: var(--text-muted); font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 11px; color: var(--text-muted); word-break: break-all; }
.card__badges { display: flex; gap: var(--space-2); flex: none; }
.badge { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: 999px; font-weight: var(--font-weight-medium); }
.badge--x { background: #16a34a; color: #fff; }
.badge--gem { background: rgba(0, 87, 183, 0.18); color: #4d9fff; border: 1px solid rgba(0, 87, 183, 0.5); }

.card__stats { display: flex; gap: var(--space-5); flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--text-body); font-variant-numeric: tabular-nums; }

.reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.reasons li { font-size: var(--font-size-xs); color: var(--text-muted); }
.reasons li::before { content: "• "; color: #16a34a; }

.card__actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.lnk { color: var(--text-link); text-decoration: none; font-size: var(--font-size-sm); }
.lnk:hover { color: var(--text-link-hover); }
.buy {
  padding: var(--space-2) var(--space-5);
  border: 1px solid #16a34a; border-radius: var(--radius-sm);
  background: #16a34a; color: #fff; font: inherit; font-weight: var(--font-weight-medium);
  cursor: pointer;
}
.buy:hover { background: #15803d; }
.buy:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }

@media (max-width: 560px) {
  .panel__head { flex-direction: column; }
  .head-actions { width: 100%; }
  .scanbtn { flex: 1; }
}
</style>