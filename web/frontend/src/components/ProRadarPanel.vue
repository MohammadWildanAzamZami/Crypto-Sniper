<script setup>
/**
 * ProRadarPanel — "Pro Radar" powered by Fable 5. Runs the same discovery funnel
 * as the 10x Radar, then a Fable 5 pass ranks the finalists by conviction and
 * explains each (thesis, catalysts, red flags). Falls back to heuristic ordering
 * if the AI is unavailable. Heuristic + AI opinion — NOT financial advice. DYOR.
 */
import { ref } from "vue";
import { apiUrl } from "../lib/api.js";

const scan = ref({ scannedAt: 0, candidatesScanned: 0, matches: [], aiUsed: false, aiMode: "none", model: null });
const loading = ref(false);
const error = ref("");
const copied = ref("");
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

function tierClass(t) { return "tier tier--" + (t || "C").toLowerCase(); }
function actionClass(a) { return "act act--" + (a || "WATCH").toLowerCase(); }
function actionLabel(a) {
  return a === "APE" ? "🚀 APE" : a === "AVOID" ? "🛑 AVOID" : "👀 WATCH";
}

function closeScan() {
  scan.value = { scannedAt: 0, candidatesScanned: 0, matches: [], aiUsed: false, aiMode: "none", model: null };
  error.value = "";
  copied.value = "";
}

async function runScan() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    // Pro Radar does full enrichment + an AI pass, so it can take a while.
    const r = await fetch(apiUrl("/api/pro-radar"));
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
  <section class="panel" aria-labelledby="proradar-h">
    <div class="panel__head">
      <div>
        <h2 id="proradar-h">🧠 Pro Radar <span class="tag">Fable 5</span></h2>
        <p class="panel__sub">
          Radar bertenaga AI: memindai token trending, cek likuiditas &amp; lock, lalu <b>Fable 5</b>
          menilai conviction, tesis, katalis, dan red flag tiap token. Heuristik + opini AI — bukan nasihat keuangan.
        </p>
      </div>
      <div class="head-actions">
        <button class="scanbtn" :disabled="loading" @click="runScan">
          {{ loading ? "🧠 Fable 5 menganalisis…" : "Scan AI" }}
        </button>
        <button v-if="scan.scannedAt" class="closebtn" :disabled="loading" @click="closeScan">
          Tutup
        </button>
      </div>
    </div>

    <p v-if="!scan.scannedAt && !loading && !error" class="hint">
      Klik <b>Scan AI</b> — analisis Fable 5 butuh beberapa detik lebih lama dari 10x Radar biasa.
    </p>

    <p v-if="scan.scannedAt" class="meta">
      Pindai terakhir: <b>{{ ago(scan.scannedAt) }}</b>
      · {{ scan.candidatesScanned }} dicek · <b>{{ scan.matches.length }}</b> finalis
      <span v-if="scan.aiUsed" class="meta-ai ok">· ✅ diperingkat {{ scan.model || 'Fable 5' }}</span>
      <span v-else class="meta-ai warn">· ⚠️ AI tak aktif — urutan heuristik (aktifkan mode AI di Settings)</span>
    </p>

    <p v-if="error" class="err" role="alert">⚠️ {{ error }}</p>

    <p v-if="!loading && scan.scannedAt && !scan.matches.length" class="empty">
      Belum ada finalis yang lolos saat ini. Coba lagi nanti — pasar bergerak cepat.
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
                <span v-if="m.ai" :class="tierClass(m.ai.tier)">{{ m.ai.tier }}</span>
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
            <span v-if="m.ai" :class="actionClass(m.ai.action)">{{ actionLabel(m.ai.action) }}</span>
            <span class="badge badge--gem">GEM {{ m.gemScore }}</span>
            <span class="badge badge--x" v-if="m.upsideX">~{{ m.upsideX }}x</span>
          </div>
        </div>

        <!-- AI conviction meter -->
        <div v-if="m.ai" class="conv">
          <div class="conv__bar" role="progressbar" :aria-valuenow="m.ai.conviction" aria-valuemin="0" aria-valuemax="100">
            <div class="conv__fill" :style="{ width: m.ai.conviction + '%' }"></div>
          </div>
          <span class="conv__num">Conviction {{ m.ai.conviction }}/100</span>
        </div>

        <p v-if="m.ai?.thesis" class="thesis">“{{ m.ai.thesis }}”</p>

        <div class="card__stats">
          <span>MC {{ usd(m.marketCap) }}</span>
          <span>Liq {{ usd(m.liquidityUsd) }}</span>
          <span v-if="m.lockedPct != null">🔒 {{ m.lockedPct }}%</span>
        </div>

        <div v-if="m.ai && (m.ai.catalysts.length || m.ai.redFlags.length)" class="tags">
          <span v-for="(c, i) in m.ai.catalysts" :key="'c'+i" class="chip chip--good">▲ {{ c }}</span>
          <span v-for="(f, i) in m.ai.redFlags" :key="'f'+i" class="chip chip--bad">▼ {{ f }}</span>
        </div>

        <ul v-else class="reasons">
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
.panel__head h2 { margin: 0; display: flex; align-items: center; gap: var(--space-3); }
.tag { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: 999px;
  background: linear-gradient(90deg, #7c3aed, #a855f7); color: #fff; font-weight: var(--font-weight-medium); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); max-width: 60ch; }

.scanbtn {
  flex: none; padding: 0 var(--space-6); height: var(--control-height);
  border: 1px solid #7c3aed; border-radius: var(--control-radius);
  background: linear-gradient(90deg, #7c3aed, #a855f7); color: #fff;
  font: inherit; font-weight: var(--font-weight-medium); cursor: pointer;
}
.scanbtn:hover { filter: brightness(1.08); }
.scanbtn:disabled { opacity: 0.6; cursor: not-allowed; }
.scanbtn:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 2px; }

.head-actions { display: flex; gap: var(--space-3); flex: none; }
.closebtn {
  padding: 0 var(--space-5); height: var(--control-height);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  background: transparent; color: var(--text-body); font: inherit; cursor: pointer;
}
.closebtn:hover { border-color: var(--text-error); background: rgba(239, 68, 68, 0.08); color: var(--text-error); }
.closebtn:disabled { opacity: 0.5; cursor: not-allowed; }
.closebtn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.meta { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }
.meta-ai.ok { color: var(--text-success, #16a34a); }
.meta-ai.warn { color: #f59e0b; }
.hint { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }
.err { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

.list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-4); }
.card {
  display: grid; gap: var(--space-3); padding: var(--space-5);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  border-left: 3px solid #a855f7; border-radius: var(--radius-sm);
}
.card__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.card__idwrap { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.card__logo { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid rgba(124, 58, 237, 0.5); }
.card__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__logo-fallback { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: #c4b5fd; letter-spacing: 0.3px; }
.card__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.card__line1 { display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.card__sym { font-weight: var(--font-weight-bold); color: var(--text-heading); font-size: var(--font-size-lg); }
.card__name { color: var(--text-muted); font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr { display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 11px; color: var(--text-muted);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.card__addr-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr-copy { flex: none; color: #c4b5fd; font-family: inherit; }
.card__addr:hover .card__addr-text { color: var(--text-body); }
.card__addr:hover .card__addr-copy { color: #a855f7; }
.card__addr:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 2px; border-radius: var(--radius-xs); }
.card__badges { display: flex; gap: var(--space-2); flex: none; align-items: center; }

/* Tier chip (S/A/B/C) */
.tier { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); width: 20px; height: 20px;
  display: grid; place-items: center; border-radius: 6px; color: #fff; align-self: center; }
.tier--s { background: #f59e0b; }
.tier--a { background: #16a34a; }
.tier--b { background: #0057b7; }
.tier--c { background: #6b7280; }

/* Action badge */
.act { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: 999px; font-weight: var(--font-weight-medium); }
.act--ape { background: #16a34a; color: #fff; }
.act--watch { background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.5); }
.act--avoid { background: rgba(239, 68, 68, 0.15); color: var(--text-error); border: 1px solid rgba(239, 68, 68, 0.5); }

.badge { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: 999px; font-weight: var(--font-weight-medium); }
.badge--x { background: #16a34a; color: #fff; }
.badge--gem { background: rgba(124, 58, 237, 0.18); color: #c4b5fd; border: 1px solid rgba(124, 58, 237, 0.5); }

/* Conviction meter */
.conv { display: flex; align-items: center; gap: var(--space-3); }
.conv__bar { flex: 1; height: 8px; background: rgba(124, 58, 237, 0.15); border-radius: 999px; overflow: hidden; }
.conv__fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7); border-radius: 999px; }
.conv__num { flex: none; font-size: var(--font-size-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }

.thesis { margin: 0; font-size: var(--font-size-sm); color: var(--text-body); font-style: italic; }

.card__stats { display: flex; gap: var(--space-5); flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--text-body); font-variant-numeric: tabular-nums; }

.tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: var(--radius-sm); }
.chip--good { background: rgba(22, 163, 74, 0.15); color: #4ade80; }
.chip--bad { background: rgba(239, 68, 68, 0.12); color: #fca5a5; }

.reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.reasons li { font-size: var(--font-size-xs); color: var(--text-muted); }
.reasons li::before { content: "• "; color: #a855f7; }

.card__actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.lnk { color: var(--text-link); text-decoration: none; font-size: var(--font-size-sm); }
.lnk:hover { color: var(--text-link-hover); }
.buy {
  padding: var(--space-2) var(--space-5); border: 1px solid #16a34a; border-radius: var(--radius-sm);
  background: #16a34a; color: #fff; font: inherit; font-weight: var(--font-weight-medium); cursor: pointer;
}
.buy:hover { background: #15803d; }
.buy:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }

@media (max-width: 560px) {
  .panel__head { flex-direction: column; }
  .head-actions { width: 100%; }
  .scanbtn { flex: 1; }
}
</style>
