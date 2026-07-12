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
  return all.filter((t) => (t.owner || "").toLowerCase().includes(q) || (t.mint || "").toLowerCase().includes(q));
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
const dexUrl = (mint) => `https://dexscreener.com/solana/${mint}`;

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
          Buffer bergulir (yang lama otomatis dibuang). Heuristik, bukan nasihat keuangan.
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
            <a class="tx-mint" :href="dexUrl(t.mint)" target="_blank" rel="noopener noreferrer" :title="'Buka chart: ' + t.mint">
              {{ shortAddr(t.mint) }}
            </a>
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
          </li>
        </ul>
      </div>
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
.tx-owner:focus-visible, .tx-mint:focus-visible, .tx-scan:focus-visible {
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
  --tx-row-h: 40px;
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
.tx-mint {
  flex: none; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: var(--font-size-sm);
  color: var(--text-body); text-decoration: none;
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
</style>
