<script setup>
/**
 * TxLogPanel — riwayat transaksi wallet dipantau (SNIPER ENGINE Modul C).
 * Menampilkan SETIAP swap (beli & jual) yang dilihat monitor live dari wallet
 * yang dipantau, terbaru di atas. Server merekamnya ke buffer bergulir
 * (.sniper-txs.json); panel ini hanya membaca /api/sniper/txs. Read-only, heuristik.
 */
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { apiUrl } from "../../lib/api.js";

const data = ref(null);
const error = ref("");
const refreshing = ref(false);
const copied = ref("");
let timer = null;

// Server-side filter arah + limit; pencarian wallet/mint disaring di klien atas
// baris yang sudah ditarik (limit besar → cukup untuk pencarian cepat).
const side = ref("");        // "" | "buy" | "sell"
const query = ref("");       // substring wallet / mint
const LIMIT = 500;
const SIDES = [
  { id: "", label: "Semua" },
  { id: "buy", label: "Beli" },
  { id: "sell", label: "Jual" },
];

const rows = computed(() => {
  const all = data.value?.txs || [];
  const q = query.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter((t) =>
    (t.owner || "").toLowerCase().includes(q) ||
    (t.mint || "").toLowerCase().includes(q) ||
    (t.symbol || "").toLowerCase().includes(q)
  );
});

const money = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");
const amount = (n) => {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(2);
};
const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const solscanTx = (sig) => `https://solscan.io/tx/${sig}`;
// Chart melayang: embed GMGN (mengizinkan iframe); Axiom hanya deep-link keluar
// (X-Frame-Options + login wallet, tak bisa di-embed) — pola sama dgn SniperPanel.
const gmgnChart = (mint) => `https://www.gmgn.cc/kline/sol/${mint}?theme=dark`;
const axiomUrl = (mint) => `https://axiom.trade/t/${mint}`;

// Mint yang chart melayangnya sedang terbuka ("" = tertutup, satu per waktu).
const chartMint = ref("");
function toggleChart(mint) {
  chartMint.value = chartMint.value === mint ? "" : mint;
}
// Baris tx milik mint yang chartnya terbuka — untuk logo + simbol di judul chart.
const chartTx = computed(() => rows.value.find((t) => t.mint === chartMint.value) || null);

// Avatar token: logo dari server (cache token-meta), jatuh balik ke inisial huruf
// saat token tak punya logo / gambarnya gagal dimuat — pola sama dgn SniperPanel.
const failedLogos = ref(new Set());
function initials(t) {
  return (t.symbol || t.mint || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
}
function logoFailed(mint) {
  failedLogos.value = new Set(failedLogos.value).add(mint);
}
const tokenLabel = (t) => t.symbol || shortAddr(t.mint);

// `at` = detik (timestamp Helius). Jatuh balik ke `logged` (ms) bila tak ada.
function ago(t) {
  const ms = t.at ? t.at * 1000 : t.logged || 0;
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hr lalu`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ""; }, 1600);
  } catch { /* clipboard blocked */ }
}

async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const qs = new URLSearchParams({ limit: String(LIMIT) });
    if (side.value) qs.set("side", side.value);
    const r = await fetch(apiUrl("/api/sniper/txs?" + qs.toString()));
    const body = await r.json();
    if (r.ok) { data.value = body; error.value = ""; }
    else error.value = body?.error || `Gagal memuat (${r.status})`;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally { refreshing.value = false; }
}

function setSide(s) {
  if (side.value === s) return;
  side.value = s;
  refresh();
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 30_000); // buffer bergulir — jaga tetap segar
});
onBeforeUnmount(() => { timer && clearInterval(timer); });
</script>

<template>
  <section class="panel" aria-labelledby="txlog-h">
    <div class="panel__head">
      <div>
        <h2 id="txlog-h">🧾 Riwayat Transaksi Wallet <span class="tag">Log</span></h2>
        <p class="panel__sub">
          Setiap <b>beli &amp; jual</b> dari wallet yang dipantau yang dilihat monitor live — terbaru di atas.
          Buffer bergulir (yang lama otomatis dibuang).
        </p>
      </div>
      <button class="scanbtn" :disabled="refreshing" @click="refresh">
        {{ refreshing ? "⏳ Memuat…" : "↻ Segarkan" }}
      </button>
    </div>

    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <template v-if="data">
      <!-- Ringkasan + filter -->
      <div class="tx-summary">
        <div class="tx-chip"><b>{{ data.stored }}</b> / {{ data.max }} tersimpan</div>
        <div v-if="query.trim()" class="tx-chip"><b>{{ rows.length }}</b> cocok</div>
        <div class="tx-sides" role="group" aria-label="Filter arah transaksi">
          <button
            v-for="s in SIDES"
            :key="s.id"
            type="button"
            class="tx-side"
            :class="{ 'tx-side--on': side === s.id }"
            :aria-pressed="side === s.id"
            @click="setSide(s.id)"
          >{{ s.label }}</button>
        </div>
        <input
          v-model="query"
          class="tx-search"
          type="text"
          spellcheck="false"
          placeholder="Cari wallet / mint…"
          aria-label="Cari wallet atau mint"
        />
      </div>

      <!-- Kosong -->
      <p v-if="!rows.length" class="tx-empty">
        {{ data.stored
          ? "Tidak ada transaksi yang cocok dengan filter."
          : "Belum ada transaksi terekam. Data terisi saat wallet dipantau melakukan swap (via webhook Helius)." }}
      </p>

      <!-- Daftar — scroll box, ~6 baris terlihat default -->
      <div v-else class="tx-scroll" :class="rows.length > 6 ? 'tx-scroll--more' : ''">
        <ul class="tx-list">
          <li v-for="(t, i) in rows" :key="(t.sig || 'x') + ':' + t.mint + ':' + t.side + ':' + i" class="tx-row">
            <span class="tx-side-badge" :class="t.side === 'buy' ? 'tx-side-badge--buy' : 'tx-side-badge--sell'">
              {{ t.side === 'buy' ? 'BELI' : 'JUAL' }}
            </span>
            <button
              type="button"
              class="tx-logo"
              :title="'Lihat chart ' + tokenLabel(t)"
              :aria-pressed="chartMint === t.mint"
              @click="toggleChart(t.mint)"
            >
              <img
                v-if="t.logoUrl && !failedLogos.has(t.mint)"
                :src="t.logoUrl"
                :alt="t.symbol || 'token'"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="logoFailed(t.mint)"
              />
              <span v-else class="tx-logo-fallback">{{ initials(t) }}</span>
            </button>
            <button class="tx-mint" type="button" :title="'Salin alamat token: ' + t.mint" @click="copy(t.mint)">
              {{ copied === t.mint ? "✓ tersalin" : tokenLabel(t) }}
            </button>
            <span class="tx-amt" :title="'Jumlah token'">{{ amount(t.tokens) }}</span>
            <span class="tx-usd" :title="'Nilai (USD) saat transaksi'">{{ money(t.sizeUsd) }}</span>
            <button class="tx-owner" type="button" :title="'Salin wallet: ' + t.owner" @click="copy(t.owner)">
              {{ copied === t.owner ? "✓ tersalin" : "👛 " + shortAddr(t.owner) }}
            </button>
            <span class="tx-time">{{ ago(t) }}</span>
            <a
              v-if="t.sig"
              class="tx-scan"
              :href="solscanTx(t.sig)"
              target="_blank"
              rel="noopener noreferrer"
              title="Lihat transaksi di Solscan"
            >↗</a>
            <button
              class="tx-chart"
              type="button"
              :title="'Lihat chart melayang: ' + shortAddr(t.mint)"
              :aria-pressed="chartMint === t.mint"
              @click="toggleChart(t.mint)"
            >📈</button>
          </li>
        </ul>
      </div>

      <!-- Chart melayang (teleport ke body agar tak terpotong stacking context).
           Embed GMGN + deep link Axiom (posisi wallet; Axiom tak bisa di-embed). -->
      <Teleport to="body">
        <div v-if="chartMint" class="txchart">
          <div class="txchart__backdrop" aria-hidden="true" @click="chartMint = ''"></div>
          <div class="txchart__panel" role="dialog" aria-modal="true" :aria-label="'Chart ' + shortAddr(chartMint)">
            <div class="txchart__head">
              <span class="txchart__title">
                <span class="txchart__logo" aria-hidden="true">
                  <img
                    v-if="chartTx && chartTx.logoUrl && !failedLogos.has(chartMint)"
                    :src="chartTx.logoUrl"
                    :alt="chartTx.symbol || 'token'"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="logoFailed(chartMint)"
                  />
                  <span v-else class="txchart__logo-fallback">{{ chartTx ? initials(chartTx) : "?" }}</span>
                </span>
                {{ chartTx ? tokenLabel(chartTx) : shortAddr(chartMint) }} chart
              </span>
              <div class="txchart__actions">
                <a
                  class="txchart__open"
                  :href="axiomUrl(chartMint)"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Buka chart Axiom (perlu login wallet) — bisa lihat posisi wallet."
                >Axiom ↗</a>
                <button type="button" class="txchart__close" aria-label="Tutup chart" @click="chartMint = ''">✕</button>
              </div>
            </div>
            <div class="txchart__frame">
              <iframe
                :src="gmgnChart(chartMint)"
                :title="'Chart harga ' + shortAddr(chartMint) + ' di GMGN'"
                loading="lazy"
                allow="clipboard-write"
                referrerpolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      </Teleport>
      <p v-if="rows.length > 6" class="tx-scroll-hint">
        Menampilkan 6 dari <b>{{ rows.length }}</b> transaksi — scroll di dalam kotak untuk lihat sisanya.
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
.scanbtn:focus-visible, .tx-side:focus-visible, .tx-search:focus-visible,
.tx-owner:focus-visible, .tx-mint:focus-visible, .tx-scan:focus-visible,
.tx-chart:focus-visible, .txchart__close:focus-visible, .txchart__open:focus-visible {
  outline: 2px solid var(--border-focus); outline-offset: 2px;
}

/* Ringkasan + filter */
.tx-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; }
.tx-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.tx-chip b { color: var(--text-body); }

.tx-sides { display: flex; gap: var(--space-2); }
.tx-side {
  padding: var(--space-2) var(--space-4); font: inherit; font-size: var(--font-size-sm); cursor: pointer;
  background: var(--bg-raised); color: var(--text-muted);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  transition: border-color var(--motion-duration-instant) var(--motion-ease), color var(--motion-duration-instant) var(--motion-ease);
}
.tx-side:hover { color: var(--text-body); border-color: var(--text-success); }
.tx-side--on { color: var(--text-on-accent); background: var(--bg-accent); border-color: transparent; }

.tx-search {
  flex: 1 1 180px; min-width: 0; padding: var(--space-2) var(--space-4);
  font: inherit; font-size: var(--font-size-sm);
  background: var(--bg-raised); color: var(--text-body);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.tx-search::placeholder { color: var(--text-muted); }
.tx-search:hover { border-color: var(--text-success); }

.tx-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; }

/* Scroll box: 6 baris default, sisanya di-scroll di dalam kotak. */
.tx-scroll {
  --tx-rows: 6;
  --tx-row-h: 46px; /* avatar logo 26px + padding baris */
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  background: var(--bg-raised); padding: var(--space-2);
}
.tx-scroll--more {
  max-height: calc(
    var(--tx-rows) * var(--tx-row-h)
    + (var(--tx-rows) - 1) * var(--space-2)
    + 2 * var(--space-2)
  );
  overflow-y: auto;
  scrollbar-width: thin; scrollbar-gutter: stable;
}
.tx-scroll--more::-webkit-scrollbar { width: 8px; }
.tx-scroll--more::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 999px; }
.tx-scroll-hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); }
.tx-scroll-hint b { color: var(--text-body); }

.tx-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.tx-row {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.tx-side-badge {
  flex: none; font-size: var(--font-size-xs); font-weight: 700; letter-spacing: 0.04em;
  padding: 1px 8px; border-radius: var(--radius-sm); min-width: 44px; text-align: center;
}
.tx-side-badge--buy {
  color: var(--text-success);
  background: color-mix(in srgb, var(--text-success) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-success) 35%, transparent);
}
.tx-side-badge--sell {
  color: var(--text-error);
  background: color-mix(in srgb, var(--text-error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-error) 32%, transparent);
}
/* Avatar token — logo bulat kecil, klik = buka chart melayang. Jatuh balik ke
   inisial huruf saat token tanpa logo (pola sama dgn SniperPanel). */
.tx-logo {
  flex: none; width: 26px; height: 26px; padding: 0; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-raised); border: 1px solid var(--border-default);
  cursor: pointer;
}
.tx-logo:hover { border-color: var(--text-success); }
.tx-logo:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.tx-logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tx-logo-fallback { font-size: 9px; font-weight: 700; color: var(--text-success); letter-spacing: 0.2px; }
.tx-mint {
  flex: none; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: var(--font-size-sm);
  color: var(--text-body); cursor: pointer;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  padding: 2px 8px;
}
.tx-mint:hover { border-color: var(--text-success); color: var(--text-success); }
.tx-amt { flex: none; font-size: var(--font-size-sm); color: var(--text-body); font-variant-numeric: tabular-nums; }
.tx-usd {
  flex: none; font-size: var(--font-size-sm); font-weight: 600; color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.tx-owner {
  flex: 1 1 auto; min-width: 0; text-align: left;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: var(--font-size-sm);
  background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm);
  color: var(--text-muted); padding: 2px 6px; cursor: pointer;
}
.tx-owner:hover { color: var(--text-success); border-color: var(--border-default); }
.tx-time { flex: none; font-size: var(--font-size-xs); color: var(--text-muted); white-space: nowrap; }
.tx-scan {
  flex: none; color: var(--text-muted); text-decoration: none; font-size: var(--font-size-sm);
  padding: 0 4px; border-radius: var(--radius-sm);
}
.tx-scan:hover { color: var(--text-success); }

/* Tombol chart di ujung baris → buka chart melayang. */
.tx-chart {
  flex: none; font: inherit; font-size: var(--font-size-sm); line-height: 1; cursor: pointer;
  padding: 2px 6px; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  background: var(--bg-raised); color: var(--text-body);
}
.tx-chart:hover { border-color: var(--text-success); }

/* Chart melayang — pola sama dengan overlay chart SniperPanel. */
.txchart__backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px);
}
.txchart__panel {
  position: fixed; z-index: 201;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 2 * var(--space-6)));
  max-height: 88vh; overflow: auto;
  display: grid; gap: var(--space-3);
  padding: var(--space-5);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md, 12px);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}
.txchart__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.txchart__title {
  display: inline-flex; align-items: center; gap: var(--space-2);
  color: var(--text-heading); font-weight: var(--font-weight-medium);
}
.txchart__logo { flex: none; width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid var(--border-default); }
.txchart__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.txchart__logo-fallback { font-size: 9px; font-weight: var(--font-weight-bold); color: var(--text-muted); letter-spacing: 0.2px; }
.txchart__actions { display: flex; align-items: center; gap: var(--space-4); }
.txchart__open { color: var(--text-link, #86efb8); text-decoration: none; font-size: var(--font-size-sm); white-space: nowrap; }
.txchart__open:hover { text-decoration: underline; }
.txchart__close {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: none; padding: 0;
  border: 1px solid var(--border-default); border-radius: 999px;
  background: var(--bg-card); color: var(--text-body); font-size: 15px; line-height: 1; cursor: pointer;
}
.txchart__close:hover { border-color: var(--text-error); color: var(--text-error); }
.txchart__frame {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10; max-height: 460px;
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  overflow: hidden; background: var(--bg-card);
}
.txchart__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
@media (max-width: 640px) {
  .txchart__panel {
    top: 12px; left: 10px; right: 10px; transform: none;
    width: auto; max-height: 86vh; padding: var(--space-4);
  }
  .txchart__frame { aspect-ratio: auto; height: 62vh; max-height: none; }
}
</style>
