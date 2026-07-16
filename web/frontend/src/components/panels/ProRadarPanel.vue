<script setup>
/**
 * ProRadarPanel — "Pro Radar" powered by Fable 5. Fokus: token yang SEDANG
 * trending — trafik transaksi masih ramai di jendela 5 mnt / 1 jam / 6 jam /
 * 24 jam dan smart money / whale sedang akumulasi terus-menerus. Discovery
 * funnel sama dengan 10x Radar, lalu Fable 5 menilai conviction tiap finalis
 * (thesis, catalysts, red flags). Falls back to heuristic ordering if the AI is
 * unavailable. Heuristic + AI opinion — NOT financial advice. DYOR.
 */
import { ref } from "vue";
import { apiUrl } from "../../lib/api.js";

const scan = ref({ scannedAt: 0, candidatesScanned: 0, matches: [], aiUsed: false, aiMode: "none", model: null });

const loading = ref(false);
const error = ref("");
const copiedAddr = ref("");
const failedLogos = ref(new Set());
// Address of the token whose GMGN chart is currently expanded (one at a
// time). Click a token (logo/name) to embed its live chart inline; click again
// to collapse it.
const openChart = ref("");

function toggleChart(m) {
  openChart.value = openChart.value === m.address ? "" : m.address;
}

const usd = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");

// Momentum: label pace ("×1.8 dari rata-rata harian") + band warna skor.
const paceLabel = (p) => (typeof p === "number" ? "×" + p.toFixed(1) : "—");
function momClass(s) {
  const n = Number(s) || 0;
  return "mom--" + (n >= 60 ? "hi" : n >= 30 ? "mid" : "lo");
}

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
// Smart money strength band → drives bar/label color. Aligns with the +12
// Quality tailwind: ≥70 is a strong accumulation signal, <40 is weak/noise.
function smartClass(s) {
  const n = Number(s) || 0;
  return "smart--" + (n >= 70 ? "hi" : n >= 40 ? "mid" : "lo");
}

function closeScan() {
  scan.value = { scannedAt: 0, candidatesScanned: 0, matches: [], aiUsed: false, aiMode: "none", model: null };
  error.value = "";
  openChart.value = "";
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
    else { scan.value = body; openChart.value = ""; }
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="proradar-h">
    <div class="panel__head">
      <div>
        <h2 id="proradar-h">🧠 Pro Radar <span class="tag">AI</span></h2>
        <p class="panel__sub">
          Radar bertenaga AI, fokus token yang <b>sedang trending</b>: trafik transaksi masih ramai
          di jendela 5 mnt / 1 jam / 6 jam / 24 jam &amp; smart money / whale sedang akumulasi
          terus-menerus.
        </p>
      </div>
      <div class="head-actions">
        <button class="scanbtn" :disabled="loading" @click="runScan">
          {{ loading ? "🧠 AI menganalisis…" : "Scan AI" }}
        </button>
        <button v-if="scan.scannedAt" class="closebtn" :disabled="loading" @click="closeScan">
          Tutup
        </button>
      </div>
    </div>

    <p v-if="scan.scannedAt" class="meta">
      Pindai terakhir: <b>{{ ago(scan.scannedAt) }}</b>
      · {{ scan.candidatesScanned }} dicek
      <span v-if="scan.rejected">· <b>{{ scan.rejected }}</b> dibuang gerbang kualitas</span>
      · <b>{{ scan.matches.length }}</b> lolos
      <span v-if="scan.aiUsed" class="meta-ai ok">· ✅ diperingkat AI</span>
      <span v-else class="meta-ai warn">· ⚠️ AI tak aktif — urutan heuristik (aktifkan mode AI di Settings)</span>
      <span v-if="scan.smartMoneyEnabled" class="meta-ai ok">· 🧠 smart money aktif</span>
      <span v-else class="meta-ai warn">· 🧠 smart money off (tambah Birdeye key di Settings)</span>
    </p>

    <p v-if="error" class="err" role="alert">⚠️ {{ error }}</p>

    <p v-if="!loading && scan.scannedAt && !scan.matches.length" class="empty">
      Tidak ada token yang lolos gerbang kualitas saat ini
      <span v-if="scan.rejected">({{ scan.rejected }} dibuang karena rug/likuiditas tipis/dump)</span>.
      Ini normal — radar lebih memilih kosong daripada menampilkan sampah. Coba lagi nanti.
    </p>

    <ul v-if="scan.matches.length" class="list">
      <li v-for="m in scan.matches" :key="m.address" class="card">
        <div class="card__top">
          <div class="card__idwrap">
            <button
              type="button"
              class="card__logo card__logo--btn"
              :title="'Klik untuk lihat chart ' + m.symbol"
              :aria-expanded="openChart === m.address"
              @click="toggleChart(m)"
            >
              <img
                v-if="m.logoUrl && !failedLogos.has(m.address)"
                :src="m.logoUrl"
                :alt="m.symbol"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="logoFailed(m.address)"
              />
              <span v-else class="card__logo-fallback">{{ initials(m) }}</span>
            </button>
            <div class="card__id">
              <button
                type="button"
                class="card__line1 card__line1--btn"
                :title="'Klik untuk lihat chart ' + m.symbol"
                :aria-expanded="openChart === m.address"
                @click="toggleChart(m)"
              >
                <span v-if="m.ai" :class="tierClass(m.ai.tier)">{{ m.ai.tier }}</span>
                <span class="card__sym">{{ m.symbol }}</span>
                <span class="card__name">{{ m.name }}</span>
                <span class="card__caret" aria-hidden="true">{{ openChart === m.address ? "▾" : "▸" }}</span>
              </button>
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
            <span
              v-if="m.smart && m.smart.accumulating > 0"
              class="badge badge--smart"
              :title="`Smart money score ${m.smart.score}/100 — ${m.smart.accumulating} top trader akumulasi`
                + (m.smart.whales ? `, ${m.smart.whales} whale` : '')
                + (m.smart.profitable ? `, ${m.smart.profitable} trader profit` : '')
                + (m.smart.netBuyUsd ? `, net ${m.smart.netBuyUsd >= 0 ? 'beli' : 'jual'} $${Math.abs(Math.round(m.smart.netBuyUsd)).toLocaleString()}` : '')
                + (m.smart.established != null ? `, ${m.smart.established} wallet mapan (Helius)` : '')"
            >🧠 Smart {{ m.smart.score }}<span v-if="m.smart.whales">· 🐋{{ m.smart.whales }}</span></span>
            <span v-if="m.pump?.graduated" class="badge badge--grad" title="Lulus bonding curve Pump.fun (graduated)">🎓 grad</span>
            <span
              v-if="m.momentum?.hotWindows?.length"
              class="badge badge--hot"
              :title="'Trafik terakselerasi di jendela: ' + m.momentum.hotWindows.join(', ')"
            >🔥 {{ m.momentum.hotWindows.join(" · ") }}</span>
            <span v-if="m.quality != null" class="badge badge--q" :title="'Skor kualitas gabungan (GEM + conviction + momentum)'">Q {{ m.quality }}</span>
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

        <!-- Smart money meter: smartScore bar + signal chips (Birdeye + Helius) -->
        <div v-if="m.smart" class="smart">
          <div class="smart__row">
            <span class="smart__label">🧠 Smart money</span>
            <div
              class="smart__bar"
              role="progressbar"
              :aria-valuenow="m.smart.score"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`Skor smart money ${m.smart.score} dari 100`"
            >
              <div class="smart__fill" :class="smartClass(m.smart.score)" :style="{ width: m.smart.score + '%' }"></div>
            </div>
            <span class="smart__num" :class="smartClass(m.smart.score)">{{ m.smart.score }}/100</span>
          </div>
          <div class="smart__chips">
            <span
              v-if="m.smart.netBuyUsd"
              class="smart__chip"
              :class="m.smart.netBuyUsd >= 0 ? 'is-buy' : 'is-sell'"
            >{{ m.smart.netBuyUsd >= 0 ? "📈 net beli" : "📉 net jual" }}
              ${{ Math.abs(Math.round(m.smart.netBuyUsd)).toLocaleString() }}</span>
            <span v-if="m.smart.accumulating" class="smart__chip">🟢 {{ m.smart.accumulating }} akumulasi</span>
            <span v-if="m.smart.whales" class="smart__chip">🐋 {{ m.smart.whales }} whale</span>
            <span v-if="m.smart.profitable" class="smart__chip">✅ {{ m.smart.profitable }} profit</span>
            <span v-if="m.smart.established != null" class="smart__chip" title="Wallet terverifikasi mapan via Helius">🛡️ {{ m.smart.established }} mapan</span>
          </div>
        </div>

        <p v-if="m.ai?.thesis" class="thesis">“{{ m.ai.thesis }}”</p>

        <div class="card__stats">
          <span>MC {{ usd(m.marketCap) }}</span>
          <span>Liq {{ usd(m.liquidityUsd) }}</span>
          <span v-if="m.lockedPct != null">🔒 {{ m.lockedPct }}%</span>
        </div>

        <!-- Momentum multi-timeframe: trafik masih ramai sekarang? -->
        <div v-if="m.momentum" class="mom">
          <div class="mom__row">
            <span class="mom__label">🔥 Momentum</span>
            <div
              class="mom__bar"
              role="progressbar"
              :aria-valuenow="m.momentum.score"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`Skor momentum ${m.momentum.score} dari 100`"
            >
              <div class="mom__fill" :class="momClass(m.momentum.score)" :style="{ width: m.momentum.score + '%' }"></div>
            </div>
            <span class="mom__num" :class="momClass(m.momentum.score)">{{ m.momentum.score }}/100</span>
          </div>
          <div class="mom__chips">
            <span class="mom__chip" :title="'Transaksi 5 menit terakhir'">5m: {{ m.momentum.tx.m5 }} tx</span>
            <span class="mom__chip" :title="'Transaksi 1 jam terakhir'">1j: {{ m.momentum.tx.h1 }} tx · {{ usd(m.momentum.vol.h1) }}</span>
            <span class="mom__chip" :title="'Transaksi 24 jam'">24j: {{ m.momentum.tx.h24 }} tx · {{ usd(m.momentum.vol.h24) }}</span>
            <span
              v-if="m.momentum.pace.h1 != null"
              class="mom__chip"
              :class="m.momentum.pace.h1 >= 1 ? 'is-up' : 'is-down'"
              :title="'Laju volume 1 jam terakhir vs rata-rata harian (×1 = sama)'"
            >laju 1j {{ paceLabel(m.momentum.pace.h1) }}</span>
            <span
              v-if="m.momentum.buyRatio.h1 != null"
              class="mom__chip"
              :class="m.momentum.buyRatio.h1 >= 0.5 ? 'is-up' : 'is-down'"
              :title="'Porsi beli dari semua transaksi 1 jam terakhir'"
            >{{ Math.round(m.momentum.buyRatio.h1 * 100) }}% beli</span>
          </div>
        </div>

        <div v-if="m.ai && (m.ai.catalysts.length || m.ai.redFlags.length)" class="tags">
          <span v-for="(c, i) in m.ai.catalysts" :key="'c'+i" class="chip chip--good">▲ {{ c }}</span>
          <span v-for="(f, i) in m.ai.redFlags" :key="'f'+i" class="chip chip--bad">▼ {{ f }}</span>
        </div>

        <ul v-else class="reasons">
          <li v-for="(r, i) in m.reasons" :key="i">{{ r }}</li>
        </ul>

        <!-- GMGN chart (embed): inline on desktop, floating overlay on mobile -->
        <div v-if="openChart === m.address && m.chartUrl" class="chart">
          <div class="chart__backdrop" aria-hidden="true" @click="toggleChart(m)"></div>
          <div class="chart__panel">
            <div class="chart__head">
              <span class="chart__title">
                <span class="chart__logo" aria-hidden="true">
                  <img
                    v-if="m.logoUrl && !failedLogos.has(m.address)"
                    :src="m.logoUrl"
                    :alt="m.symbol"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="logoFailed(m.address)"
                  />
                  <span v-else class="chart__logo-fallback">{{ initials(m) }}</span>
                </span>
                {{ m.symbol }} chart
              </span>
              <div class="chart__head-actions">
                <a
                  class="chart__open"
                  :href="`https://axiom.trade/t/${m.address}`"
                  target="_blank"
                  rel="noopener"
                  title="Buka chart Axiom (perlu login wallet) — bisa lihat posisi wallet."
                >
                  Buka di Axiom ↗
                </a>
                <button type="button" class="chart__close" aria-label="Tutup chart" @click="toggleChart(m)">✕</button>
              </div>
            </div>
            <div class="chart__frame">
              <iframe
                :src="m.chartUrl"
                :title="`Chart harga ${m.symbol} di GMGN`"
                loading="lazy"
                allow="clipboard-write"
                referrerpolicy="no-referrer"
              />
            </div>
          </div>
        </div>
        <p v-else-if="openChart === m.address" class="chart__na">
          📊 Chart tak tersedia untuk token ini.
        </p>

        <div class="card__actions">
          <button type="button" class="lnk lnkbtn" @click="toggleChart(m)">
            {{ openChart === m.address ? "📊 Sembunyikan chart" : "📈 Lihat chart" }}
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
  background: linear-gradient(90deg, #00a804, #00c805); color: #04210a; font-weight: var(--font-weight-medium); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); max-width: 60ch; }

.scanbtn {
  flex: none; padding: 0 var(--space-6); height: var(--control-height);
  border: 1px solid #00a804; border-radius: var(--control-radius);
  background: linear-gradient(90deg, #00a804, #00c805); color: #04210a;
  font: inherit; font-weight: var(--font-weight-medium); cursor: pointer;
}
.scanbtn:hover { filter: brightness(1.08); }
.scanbtn:disabled { opacity: 0.6; cursor: not-allowed; }
.scanbtn:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; }

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
  border-left: 3px solid #00c805; border-radius: var(--radius-sm);
}
.card__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.card__idwrap { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.card__logo { flex: none; width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid rgba(0, 200, 5, 0.5); }
.card__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__logo-fallback { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: #86efb8; letter-spacing: 0.3px; }
.card__logo--btn { padding: 0; cursor: pointer; transition: border-color 120ms, transform 120ms; }
.card__logo--btn:hover { border-color: #00c805; transform: scale(1.05); }
.card__logo--btn:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; }
.card__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.card__line1 { display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.card__line1--btn { background: none; border: 0; padding: 0; font: inherit; cursor: pointer; text-align: left; }
.card__line1--btn:hover .card__sym { color: #00c805; }
.card__line1--btn:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; border-radius: var(--radius-xs); }
.card__caret { flex: none; align-self: center; font-size: 11px; color: #86efb8; }
.card__sym { font-weight: var(--font-weight-bold); color: var(--text-heading); font-size: var(--font-size-lg); }
.card__name { color: var(--text-muted); font-size: var(--font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr { display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 11px; color: var(--text-muted);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
.card__addr-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__addr-copy { flex: none; color: #86efb8; font-family: inherit; }
.card__addr:hover .card__addr-text { color: var(--text-body); }
.card__addr:hover .card__addr-copy { color: #00c805; }
.card__addr:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; border-radius: var(--radius-xs); }
.card__badges { display: flex; gap: var(--space-2); flex: none; align-items: center; }

/* Tier chip (S/A/B/C) */
.tier { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); width: 20px; height: 20px;
  display: grid; place-items: center; border-radius: 6px; color: #fff; align-self: center; }
.tier--s { background: #f59e0b; }
.tier--a { background: #16a34a; }
.tier--b { background: #0a7a2e; }
.tier--c { background: #6b7280; }

/* Action badge */
.act { font-size: 8.6px; padding: 1px var(--space-2); border-radius: 999px; font-weight: var(--font-weight-medium); }
.act--ape { background: #16a34a; color: #fff; }
.act--watch { background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.5); }
.act--avoid { background: rgba(239, 68, 68, 0.15); color: var(--text-error); border: 1px solid rgba(239, 68, 68, 0.5); }

.badge { font-size: var(--font-size-xs); padding: 2px var(--space-3); border-radius: 999px; font-weight: var(--font-weight-medium); }
.badge--x { background: #16a34a; color: #fff; }
.badge--gem { background: rgba(0, 200, 5, 0.16); color: #86efb8; border: 1px solid rgba(0, 200, 5, 0.5); }
.badge--q { background: rgba(16, 163, 74, 0.16); color: #4ade80; border: 1px solid rgba(16, 163, 74, 0.5); }
.badge--grad { background: rgba(0, 200, 5, 0.14); color: #7be0a0; border: 1px solid rgba(0, 200, 5, 0.42); }
.badge--smart { background: rgba(234, 179, 8, 0.18); color: #fde047; border: 1px solid rgba(234, 179, 8, 0.55); }
.badge--hot { background: rgba(249, 115, 22, 0.18); color: #fdba74; border: 1px solid rgba(249, 115, 22, 0.55);
  font-size: 8.6px; padding: 1px var(--space-2); }
/* Shrink the WATCH / grad / Q / GEM badges ~28% */
.badge--gem, .badge--q, .badge--grad { font-size: 8.6px; padding: 1px var(--space-2); }

/* Conviction meter */
.conv { display: flex; align-items: center; gap: var(--space-3); }
.conv__bar { flex: 1; height: 8px; background: rgba(0, 200, 5, 0.15); border-radius: 999px; overflow: hidden; }
.conv__fill { height: 100%; background: linear-gradient(90deg, #00a804, #00c805); border-radius: 999px; }
.conv__num { flex: none; font-size: var(--font-size-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }

/* Smart money meter — mirrors the conviction meter but colour-banded by strength. */
.smart { display: flex; flex-direction: column; gap: var(--space-2); }
.smart__row { display: flex; align-items: center; gap: var(--space-3); }
.smart__label { flex: none; font-size: var(--font-size-xs); color: var(--text-muted); }
.smart__bar { flex: 1; height: 8px; background: rgba(234, 179, 8, 0.12); border-radius: 999px; overflow: hidden; }
.smart__fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
.smart__fill.smart--hi { background: linear-gradient(90deg, #16a34a, #4ade80); }
.smart__fill.smart--mid { background: linear-gradient(90deg, #eab308, #fde047); }
.smart__fill.smart--lo { background: linear-gradient(90deg, #a16207, #d97706); }
.smart__num { flex: none; font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; font-weight: var(--font-weight-medium); }
.smart__num.smart--hi { color: #4ade80; }
.smart__num.smart--mid { color: #fde047; }
.smart__num.smart--lo { color: #d97706; }
.smart__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.smart__chip { font-size: 9px; padding: 1px var(--space-2); border-radius: 999px; background: rgba(148, 163, 184, 0.14); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.28); font-variant-numeric: tabular-nums; }
.smart__chip.is-buy { background: rgba(16, 163, 74, 0.16); color: #4ade80; border-color: rgba(16, 163, 74, 0.5); }
.smart__chip.is-sell { background: rgba(220, 38, 38, 0.16); color: #f87171; border-color: rgba(220, 38, 38, 0.5); }

.thesis { margin: 0; font-size: var(--font-size-sm); color: var(--text-body); font-style: italic; }

.card__stats { display: flex; gap: var(--space-5); flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--text-body); font-variant-numeric: tabular-nums; }

/* Momentum multi-timeframe — mirrors the smart money meter, orange-banded. */
.mom { display: flex; flex-direction: column; gap: var(--space-2); }
.mom__row { display: flex; align-items: center; gap: var(--space-3); }
.mom__label { flex: none; font-size: var(--font-size-xs); color: var(--text-muted); }
.mom__bar { flex: 1; height: 8px; background: rgba(249, 115, 22, 0.12); border-radius: 999px; overflow: hidden; }
.mom__fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
.mom__fill.mom--hi { background: linear-gradient(90deg, #ea580c, #fb923c); }
.mom__fill.mom--mid { background: linear-gradient(90deg, #d97706, #fbbf24); }
.mom__fill.mom--lo { background: linear-gradient(90deg, #78716c, #a8a29e); }
.mom__num { flex: none; font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; font-weight: var(--font-weight-medium); }
.mom__num.mom--hi { color: #fb923c; }
.mom__num.mom--mid { color: #fbbf24; }
.mom__num.mom--lo { color: #a8a29e; }
.mom__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.mom__chip { font-size: 9px; padding: 1px var(--space-2); border-radius: 999px;
  background: rgba(148, 163, 184, 0.14); color: var(--text-muted);
  border: 1px solid rgba(148, 163, 184, 0.28); font-variant-numeric: tabular-nums; }
.mom__chip.is-up { background: rgba(16, 163, 74, 0.16); color: #4ade80; border-color: rgba(16, 163, 74, 0.5); }
.mom__chip.is-down { background: rgba(220, 38, 38, 0.16); color: #f87171; border-color: rgba(220, 38, 38, 0.5); }

.tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip { font-size: 8.6px; padding: 1px var(--space-2); border-radius: var(--radius-sm); }
.chip--good { background: rgba(22, 163, 74, 0.15); color: #4ade80; }
.chip--bad { background: rgba(239, 68, 68, 0.12); color: #fca5a5; }

.reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.reasons li { font-size: var(--font-size-xs); color: var(--text-muted); }
.reasons li::before { content: "• "; color: #00c805; }

/* GMGN chart embed (inline on desktop) */
.chart { display: grid; gap: var(--space-3); }
.chart__backdrop { display: none; } /* only used as a full-screen overlay on mobile */
.chart__panel { display: grid; gap: var(--space-3); }
.chart__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.chart__title { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-heading); font-weight: var(--font-weight-medium); }
.chart__logo { flex: none; width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid var(--border-default); }
.chart__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chart__logo-fallback { font-size: 9px; font-weight: var(--font-weight-bold); color: var(--text-muted); letter-spacing: 0.2px; }
.chart__head-actions { display: flex; align-items: center; gap: var(--space-4); }
.chart__open { color: #86efb8; text-decoration: none; font-size: var(--font-size-sm); }
.chart__open:hover { color: #00c805; }
.chart__close {
  display: none; /* shown on mobile overlay */
  width: 30px; height: 30px; flex: none; padding: 0;
  border: 1px solid var(--border-default); border-radius: 999px;
  background: var(--bg-card); color: var(--text-body); font-size: 15px; line-height: 1; cursor: pointer;
}
.chart__close:hover { border-color: #00c805; color: #00c805; }
.chart__close:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; }
.chart__frame {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10; max-height: 460px;
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  overflow: hidden; background: var(--bg-card);
}
.chart__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.chart__na { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }

.card__actions { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.lnk { color: var(--text-link); text-decoration: none; font-size: var(--font-size-sm); }
.lnk:hover { color: var(--text-link-hover); }
.lnkbtn { background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
.lnkbtn:focus-visible { outline: 2px solid #86efb8; outline-offset: 2px; border-radius: var(--radius-xs); }

@media (max-width: 560px) {
  .panel__head { flex-direction: column; }
  .head-actions { width: 100%; }
  .scanbtn { flex: 1; }

  /* Chart floats on top of the page as an overlay on mobile. */
  .chart__backdrop {
    display: block; position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.65); z-index: 200;
  }
  .chart__panel {
    position: fixed; z-index: 201;
    top: 12px; left: 10px; right: 10px;
    padding: var(--space-4);
    background: var(--bg-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md, 12px);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    max-height: 86vh; overflow: auto;
  }
  .chart__close { display: grid; place-items: center; }
  .chart__frame { aspect-ratio: auto; height: 62vh; max-height: none; }
}
</style>
