<script setup>
/**
 * RadarPanel — "10x Radar". Auto-screens trending Solana tokens and lists the
 * ones with high-upside potential. Scan manually, and the backend also scans on
 * an interval and pushes new picks to Telegram.
 * Heuristic only — memecoins are extremely risky. Not financial advice.
 */
import { ref } from "vue";
import { apiUrl } from "../lib/api.js";

const scan = ref({ scannedAt: 0, candidatesScanned: 0, matches: [] });
const loading = ref(false);
const error = ref("");
const copiedAddr = ref("");
const failedLogos = ref(new Set());

const usd = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");

// Lettered avatar fallback when a token has no logo (or the image fails to load).
function initials(m) {
  return (m.symbol || m.name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
}
function logoFailed(addr) {
  failedLogos.value = new Set(failedLogos.value).add(addr);
}

// Click the address to copy it to the clipboard (no need to open Trojan).
async function copyAddr(m) {
  try {
    await navigator.clipboard.writeText(m.address);
    copiedAddr.value = m.address;
    setTimeout(() => { if (copiedAddr.value === m.address) copiedAddr.value = ""; }, 1800);
  } catch { /* clipboard blocked */ }
}

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
}

async function runScan() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/auto-screen"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Scan gagal (${r.status})`;
    else scan.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
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
          <div class="card__idwrap">
            <span class="card__logo" aria-hidden="true">
              <img
                v-if="m.logoUrl && !failedLogos.has(m.address)"
                :src="m.logoUrl"
                :alt="m.symbol"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="logoFailed(m.address)"
              />
              <span v-else class="card__logo-fallback">{{ initials(m) }}</span>
            </span>
            <div class="card__id">
              <div class="card__line1">
                <span class="card__sym">{{ m.symbol }}</span>
                <span class="card__name">{{ m.name }}</span>
              </div>
              <button
                type="button"
                class="card__addr"
                :title="'Klik untuk salin alamat: ' + m.address"
                @click="copyAddr(m)"
              >
                <span class="card__addr-text">{{ m.address }}</span>
                <span class="card__addr-copy">{{ copiedAddr === m.address ? "✅ disalin" : "📋 salin" }}</span>
              </button>
            </div>
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
.card__idwrap { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.card__logo { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid var(--border-default); }
.card__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__logo-fallback { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: #4d9fff; letter-spacing: 0.3px; }
.card__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.card__line1 { display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.card__sym { font-weight: var(--font-weight-bold); color: var(--text-heading); font-size: var(--font-size-lg); }
.card__name { color: var(--text-muted); font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr { display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 11px; color: var(--text-muted);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.card__addr-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr-copy { flex: none; color: var(--text-link); font-family: inherit; }
.card__addr:hover .card__addr-text { color: var(--text-body); }
.card__addr:hover .card__addr-copy { color: var(--text-link-hover); }
.card__addr:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: var(--radius-xs); }
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

@media (max-width: 560px) {
  .panel__head { flex-direction: column; }
  .head-actions { width: 100%; }
  .scanbtn { flex: 1; }
}
</style>