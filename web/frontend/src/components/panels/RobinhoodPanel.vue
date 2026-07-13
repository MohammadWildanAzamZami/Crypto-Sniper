<script setup>
/**
 * RobinhoodPanel — ekosistem Robinhood Chain (EVM L2, mainnet 1 Juli 2026, permissionless,
 * "meme meta"). Pipeline lengkap dengan data on-chain NYATA (tanpa data palsu):
 * Discover (GeckoTerminal) → Screen/GEM (GeckoTerminal + Blockscout) → Bedah Coin
 * (transfer asc Blockscout) → Watchlist (reputasi) → Sniper Live (konfluensi beli),
 * plus auto-pilot yang menumbuhkan watchlist otomatis tiap interval.
 */
import { ref, onMounted, onBeforeUnmount } from "vue";
import { apiUrl } from "../../lib/api.js";

const scan = ref(null);           // { chain, count, pools, minLiquidity, scannedAt }
const loading = ref(false);
const error = ref("");

const usd = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");
const price = (n) => {
  if (typeof n !== "number" || !(n > 0)) return "—";
  if (n >= 1) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 0.01) return "$" + n.toFixed(4);
  return "$" + n.toPrecision(3);
};
function ageOf(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return `${Math.round(s / 60)} mnt`;
  if (s < 86400) return `${Math.round(s / 3600)} jam`;
  return `${Math.round(s / 86400)} hr`;
}

async function discover() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/robinhood/discover"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Discover gagal (${r.status})`;
    else scan.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

// Screen EVM per token (dipanggil dari daftar discover). tokenAddr → { loading, data, error }.
const screens = ref({});
function setScreen(t, patch) { screens.value = { ...screens.value, [t]: { ...(screens.value[t] || {}), ...patch } }; }
async function screenPool(p) {
  const t = p.tokenAddress;
  if (!t) return;
  const cur = screens.value[t];
  if (cur && (cur.loading || cur.data)) return;   // sudah ada / sedang jalan
  setScreen(t, { loading: true, error: "", data: null });
  try {
    const r = await fetch(apiUrl("/api/robinhood/screen?token=" + t));
    const body = await r.json();
    if (!r.ok) setScreen(t, { loading: false, error: body?.error || `Gagal (${r.status})` });
    else setScreen(t, { loading: false, data: body });
  } catch {
    setScreen(t, { loading: false, error: "Gangguan jaringan" });
  }
}
const verdictClass = (v) => (v === "STRONG" ? "rh__v--strong" : v === "WATCH" ? "rh__v--watch" : "rh__v--skip");

// Bedah Coin EVM — telusuri early buyer + kandidat smart wallet dari satu token winner.
const bedahToken = ref("");
const bedah = ref(null);
const bedahLoading = ref(false);
const bedahError = ref("");
const bedahRetryable = ref(false); // error transien (Blockscout sibuk) → tawarkan "Coba lagi"
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
async function runBedah(tokenArg) {
  const t = String(tokenArg || bedahToken.value || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) { bedahError.value = "Alamat token 0x… tidak valid."; bedahRetryable.value = false; return; }
  bedahToken.value = t;
  if (bedahLoading.value) return;
  bedahLoading.value = true;
  bedahError.value = "";
  bedahRetryable.value = false;
  bedah.value = null;
  try {
    const r = await fetch(apiUrl("/api/robinhood/bedah?token=" + t));
    const body = await r.json();
    if (!r.ok) { bedahError.value = body?.error || `Bedah gagal (${r.status})`; bedahRetryable.value = !!body?.retryable; }
    else bedah.value = body;
  } catch {
    bedahError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    bedahLoading.value = false;
  }
}
const copied = ref("");
let copiedTimer = null;
async function copyAddr(a) {
  try {
    await navigator.clipboard.writeText(a);
    copied.value = a;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = ""; }, 1500);
  } catch { /* blocked */ }
}

// Watchlist EVM (langkah #4) — rekam kandidat Bedah → reputasi → ranking.
const watchlist = ref(null);
const wlLoading = ref(false);
const recording = ref(false);
const recordMsg = ref("");
async function loadWatchlist() {
  if (wlLoading.value) return;
  wlLoading.value = true;
  try {
    const r = await fetch(apiUrl("/api/robinhood/watchlist"));
    if (r.ok) watchlist.value = await r.json();
  } catch { /* diamkan — panel tetap tampil */ }
  finally { wlLoading.value = false; }
}
async function recordToWatchlist() {
  const t = bedah.value?.token;
  if (!t || recording.value) return;
  recording.value = true;
  recordMsg.value = "";
  try {
    const r = await fetch(apiUrl("/api/robinhood/watchlist/record"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: t }),
    });
    const body = await r.json();
    if (!r.ok) recordMsg.value = body?.error || `Gagal (${r.status})`;
    else {
      recordMsg.value = body.winner
        ? `✅ ${body.recorded} wallet direkam (winner, mcap ${usd(body.mcapUsd)})`
        : `⏸️ Tidak direkam — mcap ${usd(body.mcapUsd)} di bawah ambang winner`;
      if (body.watchlist) watchlist.value = body.watchlist;
    }
  } catch {
    recordMsg.value = "Gangguan jaringan.";
  } finally {
    recording.value = false;
  }
}
// Sniper EVM (langkah #5) — pantau wallet aktif Watchlist borong token fresh yang sama.
const sniper = ref(null);
const sniperSweeping = ref(false);
const sniperError = ref("");
async function loadSniper() {
  try {
    const r = await fetch(apiUrl("/api/robinhood/sniper/signals"));
    if (r.ok) sniper.value = await r.json();
  } catch { /* diamkan */ }
}
async function sweepSniper() {
  if (sniperSweeping.value) return;
  sniperSweeping.value = true;
  sniperError.value = "";
  try {
    const r = await fetch(apiUrl("/api/robinhood/sniper/sweep"));
    const body = await r.json();
    if (!r.ok) sniperError.value = body?.error || `Sweep gagal (${r.status})`;
    else sniper.value = body;
  } catch {
    sniperError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    sniperSweeping.value = false;
  }
}

// Rekap PnL — performa sinyal sejak PERTAMA terdeteksi screener (harga kini vs entry).
// Fetch on-demand (menembak GeckoTerminal per token), bukan auto-refresh.
const pnl = ref(null);
const pnlLoading = ref(false);
const pnlError = ref("");
const pnlOpen = ref(false);
async function loadPnl() {
  if (pnlLoading.value) return;
  pnlOpen.value = true;
  pnlLoading.value = true;
  pnlError.value = "";
  try {
    const r = await fetch(apiUrl("/api/robinhood/sniper/pnl"));
    const body = await r.json();
    if (!r.ok) pnlError.value = body?.error || `Rekap PnL gagal (${r.status})`;
    else pnl.value = body;
  } catch {
    pnlError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    pnlLoading.value = false;
  }
}
const pct = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%");
const pnlClass = (n) => (n == null ? "" : n > 0 ? "rh__up" : n < 0 ? "rh__down" : "");
// Logo token gagal dimuat → sembunyikan (jangan tampilkan ikon broken image).
const hideImg = (e) => { e.target.style.display = "none"; };

// Chart melayang untuk sinyal sniper — embed GeckoTerminal (chartUrl dari server
// sudah berformat ?embed=1). Satu chart terbuka pada satu waktu; Esc menutup.
const openChart = ref("");
function toggleChart(s) {
  openChart.value = openChart.value === s.token ? "" : s.token;
}
// Link keluar ke halaman pool GeckoTerminal asli (tanpa query embed).
const geckoPoolUrl = (s) => (s.chartUrl ? s.chartUrl.split("?")[0] : "");
function onKeydown(e) {
  if (e.key === "Escape" && openChart.value) openChart.value = "";
}

// Auto-pilot (seed + sweep) berjalan otomatis di server dan TIDAK ditampilkan di UI;
// yang dipakai panel hanya status watcher real-time (untuk baris meta Sniper).
const rtStatus = ref(null); // watcher real-time server (eth_getLogs)
async function loadAuto() {
  try {
    const r = await fetch(apiUrl("/api/robinhood/auto/status"));
    if (r.ok) { const j = await r.json(); rtStatus.value = j.realtime || null; }
  } catch { /* diamkan */ }
}

// Server memantau beli smart money real-time (watcher eth_getLogs); panel ikut
// menyegarkan sinyal tiap 15 dtk — di-skip saat tab tersembunyi agar hemat.
let refreshTimer = null;
onMounted(() => {
  loadWatchlist(); loadSniper(); loadAuto();
  refreshTimer = setInterval(() => {
    if (!document.hidden) { loadSniper(); loadAuto(); }
  }, 15_000);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  clearInterval(refreshTimer);
  window.removeEventListener("keydown", onKeydown);
});

</script>

<template>
  <section class="rh" aria-labelledby="rh-h">
    <div class="rh__head">
      <div>
        <h2 id="rh-h">
          <span class="rh__dot" aria-hidden="true"></span>
          Robinhood Chain
        </h2>
      </div>
    </div>

    <!-- Auto-pilot (seed + sweep) & watcher real-time tetap aktif di server —
         sengaja tidak ditampilkan di UI. -->

    <!-- ===== Discover pool via GeckoTerminal ===== -->
    <div class="rh__disc">
      <div class="rh__disc-head">
        <span class="rh__disc-title">🚀 Discover pool</span>
        <button class="rh__btn" :disabled="loading" @click="discover">
          {{ loading ? "Memindai…" : "Scan Robinhood Chain" }}
        </button>
      </div>

      <p v-if="error" class="rh__err" role="alert">⚠️ {{ error }}</p>

      <p v-if="!scan && !loading && !error" class="rh__hint">
        Klik <b>Scan</b> untuk menarik pool memecoin trending &amp; baru dari Robinhood Chain (data GeckoTerminal, on-chain nyata).
      </p>

      <template v-if="scan">
        <p class="rh__meta">
          {{ scan.chain }} · <b>{{ scan.count }}</b> pool (likuiditas ≥ {{ usd(scan.minLiquidity) }}) · diurut volume 24j
        </p>
        <ul class="rh__pools">
          <li v-for="p in scan.pools" :key="p.poolAddress" class="rh__pool">
            <div class="rh__pool-row">
              <div class="rh__pool-main">
                <span class="rh__pool-name">{{ p.name }}</span>
                <span v-if="p.fresh" class="rh__pool-fresh">✨ baru {{ ageOf(p.createdAt) }}</span>
              </div>
              <div class="rh__pool-stats">
                <span>{{ price(p.priceUsd) }}</span>
                <span>Liq {{ usd(p.liquidityUsd) }}</span>
                <span>Vol24j {{ usd(p.volume24h) }}</span>
                <span v-if="p.change24h != null" :class="p.change24h >= 0 ? 'rh__up' : 'rh__down'">
                  {{ p.change24h >= 0 ? "+" : "" }}{{ Math.round(p.change24h) }}%
                </span>
              </div>
              <div class="rh__pool-actions">
                <button
                  v-if="p.tokenAddress"
                  class="rh__pool-btn"
                  type="button"
                  :disabled="screens[p.tokenAddress] && screens[p.tokenAddress].loading"
                  @click="screenPool(p)"
                >{{ screens[p.tokenAddress] && screens[p.tokenAddress].loading ? "…" : "🔬 screen" }}</button>
                <button v-if="p.tokenAddress" class="rh__pool-btn" type="button" @click="runBedah(p.tokenAddress)">🩻 bedah</button>
                <a v-if="p.geckoUrl" class="rh__pool-link" :href="p.geckoUrl" target="_blank" rel="noopener noreferrer">chart ↗</a>
              </div>
            </div>

            <!-- Hasil screen EVM (GEM Score + gate keamanan) -->
            <div v-if="screens[p.tokenAddress] && screens[p.tokenAddress].data" class="rh__screen">
              <span class="rh__v" :class="verdictClass(screens[p.tokenAddress].data.verdict)">
                GEM {{ screens[p.tokenAddress].data.score }} · {{ screens[p.tokenAddress].data.verdict }}
              </span>
              <span class="rh__srisk" :class="'rh__srisk--' + screens[p.tokenAddress].data.safety.risk">
                risk {{ screens[p.tokenAddress].data.safety.risk }}
              </span>
              <span v-if="screens[p.tokenAddress].data.holders != null">👥 {{ screens[p.tokenAddress].data.holders.toLocaleString() }}</span>
              <span v-if="screens[p.tokenAddress].data.concentration">top {{ screens[p.tokenAddress].data.concentration.topHolderPct }}%</span>
              <span v-if="screens[p.tokenAddress].data.safety.reasons.length" class="rh__down">
                ⚠ {{ screens[p.tokenAddress].data.safety.reasons.join("; ") }}
              </span>
            </div>
            <div v-else-if="screens[p.tokenAddress] && screens[p.tokenAddress].error" class="rh__screen rh__down">
              {{ screens[p.tokenAddress].error }}
            </div>
          </li>
        </ul>
      </template>
    </div>

    <!-- ===== Bedah Coin EVM: early buyer + kandidat smart wallet ===== -->
    <div class="rh__disc">
      <div class="rh__disc-head">
        <span class="rh__disc-title">🩻 Bedah Coin</span>
      </div>
      <p class="rh__hint">
        Tempel alamat token winner (0x…) atau klik <b>🩻 bedah</b> di daftar di atas — telusuri
        <b>early buyer</b> dari histori on-chain &amp; temukan wallet yang beli awal + <b>masih pegang</b> (calon watchlist EVM).
      </p>
      <div class="rh__bedah-form">
        <input
          v-model="bedahToken"
          class="rh__input"
          type="text"
          placeholder="0x… alamat token"
          spellcheck="false"
          @keyup.enter="runBedah()"
        />
        <button class="rh__btn" :disabled="bedahLoading" @click="runBedah()">
          {{ bedahLoading ? "Membedah…" : "Bedah" }}
        </button>
      </div>

      <p v-if="bedahError" class="rh__err" role="alert">
        ⚠️ {{ bedahError }}
        <button v-if="bedahRetryable" class="rh__btn rh__btn--retry" :disabled="bedahLoading" @click="runBedah()">
          {{ bedahLoading ? "Mencoba…" : "🔄 Coba lagi" }}
        </button>
      </p>

      <template v-if="bedah">
        <p class="rh__meta">
          <b>{{ bedah.name }}</b> · mcap {{ usd(bedah.mcapUsd) }} · launch {{ bedah.launchAt ? ageOf(new Date(bedah.launchAt).toISOString()) + " lalu" : "?" }}
          · {{ bedah.analyzedTransfers }} transfer dianalisis<span v-if="bedah.windowTruncated"> (window awal)</span>
          · <b>{{ bedah.earlyBuyers }}</b> early buyer
        </p>
        <p v-if="!bedah.smartCandidates.length" class="rh__hint">
          Tidak ada kandidat "early + masih pegang" di window ini. Coba token lain atau naikkan cakupan.
        </p>
        <ul v-else class="rh__cands">
          <li class="rh__cand rh__cand--head">
            <span>#beli</span><span>wallet</span><span>dibeli</span><span>status</span>
          </li>
          <li v-for="c in bedah.smartCandidates" :key="c.owner" class="rh__cand">
            <span class="rh__cand-idx">#{{ c.buyIdx }}</span>
            <button class="rh__cand-addr" type="button" :title="'Salin: ' + c.owner" @click="copyAddr(c.owner)">{{ shortAddr(c.owner) }}</button>
            <span class="rh__cand-amt">{{ Math.round(c.boughtTokens).toLocaleString() }}</span>
            <span class="rh__cand-hold">
              <span v-if="c.holdingNow === true" class="rh__up">🟢 pegang</span>
              <span v-else-if="c.soldPctWindow < 50" class="rh__cand-mut">jual {{ c.soldPctWindow }}%</span>
            </span>
          </li>
        </ul>
        <div v-if="bedah.smartCandidates.length" class="rh__bedah-actions">
          <button class="rh__btn" :disabled="recording" @click="recordToWatchlist">
            {{ recording ? "Merekam…" : "➕ Rekam ke Watchlist EVM" }}
          </button>
          <span v-if="recordMsg" class="rh__rec-msg">{{ recordMsg }}</span>
        </div>
        <p class="rh__note">{{ bedah.note }}</p>
      </template>
    </div>

    <!-- ===== Watchlist EVM: wallet 0x yang menangkap winner (langkah #4) ===== -->
    <div class="rh__disc">
      <div class="rh__disc-head">
        <span class="rh__disc-title">👛 Watchlist EVM</span>
        <button class="rh__pool-btn" type="button" :disabled="wlLoading" @click="loadWatchlist">↻ Segarkan</button>
      </div>

      <template v-if="watchlist">
        <p class="rh__meta">
          <b>{{ watchlist.total }}</b> wallet terekam · <b>semua dipantau</b> (tanpa batas)
          · winner = mcap ≥ {{ usd(watchlist.winnerMinMcap) }}
        </p>
        <p v-if="!watchlist.wallets.length" class="rh__hint">
          Belum ada wallet. <b>Bedah</b> token winner di atas lalu <b>Rekam ke Watchlist</b> — smart wallet-nya masuk ke sini.
        </p>
        <ul v-else class="rh__cands">
          <li class="rh__cand rh__cand--wl rh__cand--head"><span>#</span><span>wallet</span><span>rep</span><span>winner</span></li>
          <li v-for="w in watchlist.wallets" :key="w.owner" class="rh__cand rh__cand--wl" :class="w.active ? 'rh__cand--active' : ''">
            <span class="rh__cand-idx">{{ w.rank }}</span>
            <button class="rh__cand-addr" type="button" :title="'Salin: ' + w.owner" @click="copyAddr(w.owner)">{{ shortAddr(w.owner) }}</button>
            <span class="rh__cand-rep">{{ w.reputation }}</span>
            <span class="rh__cand-catch">
              🎯 {{ w.catches }}<span v-if="w.bestCatch" class="rh__cand-mut"> · {{ w.bestCatch.symbol }}</span>
              <span v-if="w.active" class="rh__wl-active">dipantau</span>
            </span>
          </li>
        </ul>
      </template>
      <p class="rh__note">
        Reputasi = jumlah winner ditangkap + seberapa awal beli. <b>Semua wallet terdaftar dipantau</b>
        oleh <b>Sniper EVM</b> (tanpa batas). Heuristik, DYOR.
      </p>
    </div>

    <!-- ===== Sniper Live EVM: konfluensi beli wallet aktif Watchlist (langkah #5) ===== -->
    <div class="rh__disc">
      <div class="rh__disc-head">
        <span class="rh__disc-title">🎯 Sniper Live</span>
        <div class="rh__disc-actions">
          <button class="rh__pool-btn rh__pool-btn--plain" type="button" :disabled="pnlLoading" @click="loadPnl">
            {{ pnlLoading ? "Menghitung…" : "📊 PnL" }}
          </button>
          <button class="rh__btn" :disabled="sniperSweeping" @click="sweepSniper">
            {{ sniperSweeping ? "Menyapu…" : "🔍 Sweep sekarang" }}
          </button>
        </div>
      </div>
      <p class="rh__hint">By. Robinhood Chain</p>

      <p v-if="sniperError" class="rh__err" role="alert">⚠️ {{ sniperError }}</p>

      <template v-if="sniper">
        <p class="rh__meta">
          <b>{{ sniper.count }}</b> sinyal · ≥{{ sniper.signalMin }} wallet sepakat · maks mcap {{ usd(sniper.maxMcap) }}
          <template v-if="sniper.minGem"> · GEM ≥ {{ sniper.minGem }}</template>
          · gate {{ sniper.safetyGate ? "aktif" : "off" }}
          <template v-if="rtStatus"> · ⚡ real-time (cek tiap {{ rtStatus.pollSec }} dtk)</template>
        </p>
        <p v-if="!sniper.signals.length" class="rh__hint">
          Belum ada sinyal. Monitor menunggu ≥{{ sniper.signalMin }} wallet Watchlist membeli token fresh yang sama.
          Makin banyak winner yang di-Bedah → makin banyak &amp; aktif wallet → makin tajam sinyal.
        </p>
        <ul v-else class="rh__pools">
          <li v-for="s in sniper.signals" :key="s.token" class="rh__pool">
            <div class="rh__pool-row">
              <div class="rh__pool-main">
                <span class="rh__cand-idx">{{ s.walletCount }}👛</span>
                <img v-if="s.logoUrl" class="rh__logo" :src="s.logoUrl" alt="" loading="lazy" referrerpolicy="no-referrer" @error="hideImg" />
                <button
                  class="rh__pool-name rh__pool-name--copy"
                  type="button"
                  :title="'Klik untuk salin alamat token: ' + s.token"
                  @click="copyAddr(s.token)"
                >{{ copied === s.token ? "✓ tersalin" : (s.symbol || shortAddr(s.token)) }}</button>
                <span v-if="s.isNew" class="rh__pool-fresh">BARU</span>
                <span v-if="s.verdict" class="rh__v" :class="verdictClass(s.verdict)">GEM {{ s.gemScore }} · {{ s.verdict }}</span>
              </div>
              <div class="rh__pool-stats">
                <span v-if="s.holders != null" class="rh__up">🖐 {{ s.holders }}/{{ s.walletCount }} pegang</span>
                <span>mcap {{ usd(s.mcap) }}</span>
                <span v-if="s.liquidityUsd">liq {{ usd(s.liquidityUsd) }}</span>
                <span>skor {{ s.score }}</span>
              </div>
              <button
                v-if="s.chartUrl"
                type="button"
                class="rh__pool-btn"
                :aria-expanded="openChart === s.token"
                :title="'Lihat chart live ' + (s.symbol || shortAddr(s.token))"
                @click="toggleChart(s)"
              >{{ openChart === s.token ? "📊 tutup" : "📈 chart" }}</button>
            </div>

            <!-- Chart GeckoTerminal: overlay melayang (teleport ke body agar tak
                 terpotong stacking context / overflow panel mana pun). -->
            <Teleport to="body">
            <div v-if="openChart === s.token" class="rhchart">
              <div class="rhchart__backdrop" aria-hidden="true" @click="toggleChart(s)"></div>
              <div class="rhchart__panel" role="dialog" aria-modal="true" :aria-label="'Chart ' + (s.symbol || shortAddr(s.token))">
                <div class="rhchart__head">
                  <span class="rhchart__title">
                    <img v-if="s.logoUrl" class="rh__logo" :src="s.logoUrl" alt="" referrerpolicy="no-referrer" @error="hideImg" />
                    {{ s.symbol || shortAddr(s.token) }} chart
                  </span>
                  <div class="rhchart__actions">
                    <a class="rhchart__open" :href="geckoPoolUrl(s)" target="_blank" rel="noopener noreferrer">GeckoTerminal ↗</a>
                    <button type="button" class="rhchart__close" aria-label="Tutup chart" @click="toggleChart(s)">✕</button>
                  </div>
                </div>
                <div class="rhchart__frame">
                  <iframe
                    :src="s.chartUrl"
                    :title="`Chart harga ${s.symbol || shortAddr(s.token)} di GeckoTerminal`"
                    loading="lazy"
                    allow="clipboard-write"
                    referrerpolicy="no-referrer"
                  />
                </div>
                <p class="rh__note">
                  Chart live pool likuiditas-terbesar token ini (GeckoTerminal). Heuristik — bukan nasihat keuangan. DYOR.
                </p>
              </div>
            </div>
            </Teleport>
          </li>
        </ul>
      </template>

      <!-- Rekap PnL: performa sinyal sejak pertama terdeteksi screener -->
      <div v-if="pnlOpen" class="rh__pnl">
        <div class="rh__pnl-head">
          <b>📊 Rekap PnL</b>
          <button type="button" class="rh__pool-btn rh__pool-btn--plain" aria-label="Tutup rekap PnL" @click="pnlOpen = false">✕ Tutup</button>
        </div>
        <p v-if="pnlError" class="rh__err" role="alert">⚠️ {{ pnlError }}</p>
        <p v-else-if="pnlLoading && !pnl" class="rh__hint">Menghitung PnL — mengambil harga kini tiap token…</p>
        <template v-if="pnl">
          <p class="rh__meta">
            📊 <b>{{ pnl.counted }}</b>/{{ pnl.totalTracked }} sinyal terhitung
            · win rate <b :class="pnlClass(pnl.avgPnlPct)">{{ pnl.winRate != null ? pnl.winRate + "%" : "—" }}</b> ({{ pnl.wins }} profit)
            · rata-rata <b :class="pnlClass(pnl.avgPnlPct)">{{ pct(pnl.avgPnlPct) }}</b>
            · terbaik <span class="rh__up">{{ pct(pnl.bestPnlPct) }}</span>
            · terburuk <span class="rh__down">{{ pct(pnl.worstPnlPct) }}</span>
          </p>
          <p v-if="!pnl.rows.length" class="rh__hint">Belum ada riwayat sinyal untuk direkap.</p>
          <ul v-else class="rh__cands">
            <li class="rh__cand rh__cand--pnl rh__cand--head">
              <span>token</span><span>GEM</span><span>terdeteksi</span><span>mcap awal</span><span>mcap kini</span><span>PnL</span>
            </li>
            <li v-for="r in pnl.rows" :key="r.token + '-' + r.firstDetectedAt" class="rh__cand rh__cand--pnl">
              <span class="rh__pnl-tok">
                <img v-if="r.logoUrl" class="rh__logo rh__logo--sm" :src="r.logoUrl" alt="" loading="lazy" referrerpolicy="no-referrer" @error="hideImg" />
                <button class="rh__cand-addr" type="button" :title="'Salin: ' + r.token" @click="copyAddr(r.token)">
                  {{ copied === r.token ? "✓" : (r.symbol || shortAddr(r.token)) }}
                </button>
                <span v-if="!r.active" class="rh__cand-mut" title="Sinyal sudah keluar dari daftar live">keluar</span>
              </span>
              <span>{{ r.gemScore ?? "—" }}</span>
              <span class="rh__cand-mut">{{ r.firstDetectedAt ? ageOf(new Date(r.firstDetectedAt).toISOString()) + " lalu" : "—" }}</span>
              <span>{{ usd(r.entryMcap) }}</span>
              <span>{{ usd(r.mcapNow) }}</span>
              <span :class="pnlClass(r.pnlPct)"><b>{{ pct(r.pnlPct) }}</b></span>
            </li>
          </ul>
          <p class="rh__note">
            PnL = harga kini vs harga saat sinyal <b>pertama terdeteksi</b> screener (riwayat bertahan
            walau sinyal live sudah keluar). "—" = harga kini tak tersedia (pool hilang / fetch gagal). DYOR.
          </p>
        </template>
      </div>

    </div>

    <p class="rh__note">By. Robinhood Chain</p>
  </section>
</template>

<style scoped>
/* Robinhood-brand accent hijau; dipakai hemat sebagai penanda zona terpisah. */
.rh {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-6);
  background: color-mix(in srgb, #00c805 6%, var(--bg-card));
  border: 1px solid color-mix(in srgb, #00c805 30%, var(--border-default));
  border-radius: var(--radius-lg, 16px);
}
.rh__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
.rh__head h2 { margin: 0; font-size: var(--font-size-lg); display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh__dot { width: 10px; height: 10px; border-radius: 50%; background: #00c805; box-shadow: 0 0 8px #00c805; flex: none; }
/* Discover */
.rh__disc { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--control-radius); }
.rh__disc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.rh__disc-title { font-weight: 700; color: var(--text-heading); display: inline-flex; align-items: center; gap: var(--space-2); }
.rh__btn {
  flex: none; padding: 0 var(--space-5); height: var(--control-height);
  border: 1px solid #00a804; border-radius: var(--control-radius);
  background: #00c805; color: #04210a; font: inherit; font-weight: var(--font-weight-medium); cursor: pointer;
}
.rh__btn:hover:not(:disabled) { filter: brightness(1.06); }
.rh__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.rh__btn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.rh__err { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.rh__btn--retry { margin-left: var(--space-3); padding: 2px 10px; vertical-align: middle; }
.rh__hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.rh__meta { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.rh__pools { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); max-height: 340px; overflow-y: auto; scrollbar-width: thin; }
.rh__pool {
  display: grid; gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
}
.rh__pool-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh__pool-main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.rh__pool-name { font-weight: 700; color: var(--text-body); }
/* Nama token sebagai tombol salin alamat — klik nama → alamat token ke clipboard. */
.rh__pool-name--copy {
  font: inherit; font-weight: 700; padding: 0; background: none; border: 0;
  cursor: pointer; text-align: left;
  text-decoration: underline dotted; text-underline-offset: 3px;
}
.rh__pool-name--copy:hover { color: #00a804; }
.rh__pool-name--copy:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: var(--radius-sm); }
.rh__pool-fresh { font-size: var(--font-size-xs); font-weight: 700; color: #00a804; }
.rh__pool-stats { display: flex; gap: var(--space-4); flex: 1; flex-wrap: wrap; color: var(--text-muted); font-size: var(--font-size-xs); font-variant-numeric: tabular-nums; }
.rh__up { color: var(--text-success); }
.rh__down { color: var(--text-error); }
.rh__pool-actions { display: flex; align-items: center; gap: var(--space-3); flex: none; }
.rh__pool-btn {
  font: inherit; font-size: var(--font-size-xs); cursor: pointer; white-space: nowrap;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: #00a804; padding: 2px 8px;
}
.rh__pool-btn:hover:not(:disabled) { border-color: #00c805; }
.rh__pool-btn:disabled { opacity: 0.6; cursor: not-allowed; }
/* Varian netral tombol (tanpa aksen hijau) — dipakai tombol PnL & tutup rekap. */
.rh__pool-btn--plain { color: var(--text-body); }
.rh__pool-link { color: #00a804; text-decoration: none; font-size: var(--font-size-xs); white-space: nowrap; }
.rh__pool-link:hover { text-decoration: underline; }
.rh__screen { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: var(--font-size-xs); padding-top: 2px; border-top: 1px dashed var(--border-default); color: var(--text-muted); }
/* Verdict GEM — teks kecil polos (tanpa blok warna) supaya tidak mencolok. */
.rh__v { font-size: var(--font-size-xs); font-weight: 600; }
.rh__v--strong { color: #00a804; }
.rh__v--watch { color: #b45309; }
.rh__v--skip { color: var(--text-error, #ef4444); }
.rh__srisk { padding: 1px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border-default); }
.rh__srisk--low { color: var(--text-success); }
.rh__srisk--med { color: #d97706; }
.rh__srisk--high { color: var(--text-error); }

/* Bedah Coin EVM */
.rh__bedah-form { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.rh__input {
  flex: 1; min-width: 220px; height: var(--control-height);
  padding: 0 var(--space-3); font: inherit; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: var(--font-size-sm);
  background: var(--bg-card); color: var(--text-body);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.rh__input:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; border-color: #00c805; }
.rh__cands { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 300px; overflow-y: auto; scrollbar-width: thin; }
.rh__cand {
  display: grid; grid-template-columns: 48px 1fr auto auto; align-items: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs); font-variant-numeric: tabular-nums;
}
.rh__cand--head { background: none; border: 0; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
.rh__cand-idx { font-weight: 700; color: #00a804; }
.rh__cand-addr { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-body); padding: 2px 6px; cursor: pointer; text-align: left; }
.rh__cand-addr:hover { border-color: #00c805; color: #00a804; }
.rh__cand-amt { color: var(--text-body); }
.rh__cand-hold { text-align: right; }
.rh__cand-mut { color: var(--text-muted); }
.rh__bedah-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh__rec-msg { color: var(--text-muted); font-size: var(--font-size-xs); }
/* Watchlist rows: grid 4 kolom (#, wallet, rep, winner) */
.rh__cand--wl { grid-template-columns: 34px auto 44px 1fr; }
.rh__cand--active { border-color: color-mix(in srgb, #00c805 45%, var(--border-default)); }
/* Logo token (GeckoTerminal) — di baris sinyal, judul chart, dan tabel PnL. */
.rh__logo { width: 20px; height: 20px; flex: none; border-radius: var(--radius-full, 999px); object-fit: cover; background: var(--bg-raised); }
.rh__logo--sm { width: 16px; height: 16px; }
/* Rekap PnL: grid 6 kolom (token, GEM, terdeteksi, mcap awal, mcap kini, PnL). */
.rh__disc-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.rh__pnl { display: grid; gap: var(--space-2); border-top: 1px dashed var(--border-default); padding-top: var(--space-3); }
.rh__pnl-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.rh__cand--pnl { grid-template-columns: minmax(0, 1fr) 36px 70px 84px 84px 70px; }
.rh__cand--pnl > :nth-child(n + 4) { text-align: right; }
.rh__pnl-tok { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.rh__cand-rep {
  text-align: center; font-weight: 700; color: #00a804;
  background: color-mix(in srgb, #00c805 12%, transparent); border-radius: var(--radius-sm); padding: 1px 4px;
}
.rh__cand-catch { color: var(--text-muted); display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.rh__wl-active { font-size: 10px; font-weight: 700; color: var(--text-on-accent, #04210a); background: #00c805; padding: 1px 5px; border-radius: var(--radius-sm); }

.rh__note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

/* Chart GeckoTerminal — overlay melayang (modal terpusat), gaya sama dengan
   chart sniper Solana tapi ber-aksen hijau Robinhood. */
.rhchart { display: contents; }
.rhchart__backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px);
}
.rhchart__panel {
  position: fixed; z-index: 201;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 2 * var(--space-6)));
  max-height: 88vh; overflow: auto;
  display: grid; gap: var(--space-3);
  padding: var(--space-5);
  background: var(--bg-raised);
  border: 1px solid color-mix(in srgb, #00c805 30%, var(--border-default));
  border-radius: var(--radius-md, 12px);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}
.rhchart__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rhchart__title { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-heading); font-weight: var(--font-weight-medium); }
.rhchart__actions { display: flex; align-items: center; gap: var(--space-4); }
.rhchart__open { color: #00a804; text-decoration: none; font-size: var(--font-size-sm); white-space: nowrap; }
.rhchart__open:hover { text-decoration: underline; }
.rhchart__open:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.rhchart__close {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: none; padding: 0;
  border: 1px solid var(--border-default); border-radius: 999px;
  background: var(--bg-card); color: var(--text-body); font-size: 15px; line-height: 1; cursor: pointer;
}
.rhchart__close:hover { border-color: var(--text-error); color: var(--text-error); }
.rhchart__close:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.rhchart__frame {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10; max-height: 460px;
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  overflow: hidden; background: var(--bg-card);
}
.rhchart__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

@media (max-width: 560px) {
  .rh { padding: var(--space-5); }

  .rhchart__panel {
    top: 12px; left: 10px; right: 10px; transform: none;
    width: auto; max-height: 86vh; padding: var(--space-4);
  }
  .rhchart__frame { aspect-ratio: auto; height: 62vh; max-height: none; }
}
</style>
