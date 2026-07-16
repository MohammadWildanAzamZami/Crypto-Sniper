<script setup>
/**
 * SniperPanel — live sniper signals (SNIPER ENGINE Modul C). Shows tokens that
 * multiple ACTIVE watchlist wallets (proven early winners, from Modul B) are
 * buying RIGHT NOW while still small — i.e. smart money accumulating before the
 * pump. The server sweeps on a background interval; this panel reads the signals
 * and can trigger a sweep on demand. Heuristic — NOT financial advice. DYOR.
 */
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { apiUrl } from "../../lib/api.js";

const data = ref(null);
// Sembunyikan token `unverified` dari tampilan (sementara). Engine tetap
// menghasilkannya — ini murni filter tampilan, jadi gampang dihidupkan lagi.
const visibleSignals = computed(() => (data.value?.signals || []).filter((s) => !s.unverified));
const hiddenUnverified = computed(() => (data.value?.signals || []).filter((s) => s.unverified).length);
const loading = ref(false);   // manual sweep in progress
const refreshing = ref(false);
const error = ref("");
const copied = ref("");
let timer = null;

// Two independent signal streams (server-side). "v2" = sharp (net-buy + dust + safety
// gate + weighted score); "awal" = original v1 headcount behaviour. Switching tabs
// just points refresh()/sweep() at the other endpoint set.
const variant = ref("v2");
const VARIANTS = [
  { id: "v2", label: "v2 · tajam", hint: "Net-buy + dust + safety gate + skor tertimbang. Sedikit tapi tajam." },
  { id: "awal", label: "Awal · ramai", hint: "Perilaku v1 asli: headcount wallet, tanpa net-buy/dust/gate. Banyak & mentah." },
];
const sniperBase = () => "/api/sniper" + (variant.value === "awal" ? "/awal" : "");
function setVariant(v) {
  if (variant.value === v) return;
  variant.value = v;
  data.value = null;   // avoid showing the other stream's list during the swap
  error.value = "";
  refresh();
}

const money = (n) => (typeof n === "number" && n > 0 ? "$" + Math.round(n).toLocaleString() : "—");
const xFmt = (n) => (typeof n === "number" && n > 0 ? (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n >= 10 ? 0 : 1)) + "×" : "—");
const pnlClass = (x) => (!x ? "" : x >= 1 ? "pos__pnl--up" : "pos__pnl--down");
// Percent formatter for the PnL track strip (values already in percent units).
const fmtPct = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + v + "%");
const pctClass = (v) => (v == null ? "" : v >= 0 ? "sn-track__up" : "sn-track__down");

// Persistent PnL track record — real outcomes of past signals (entry snapshotted at
// signal → graded vs live price a few hours later). Read-only; grading runs server-side
// inside each sweep. `curTrack` = the stats for the currently-selected stream.
const track = ref(null);
const curTrack = computed(() => {
  const t = track.value;
  if (!t) return null;
  return variant.value === "awal" ? t.awal : t.v2;
});
async function fetchTrack() {
  try {
    const r = await fetch(apiUrl("/api/sniper/track"));
    if (r.ok) track.value = await r.json();
  } catch { /* keep last track; a blip shouldn't clear the strip */ }
}
const shortMint = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
// Embedded GMGN kline chart for a mint (gmgn.cc allows iframing; Axiom does not).
const chartUrl = (mint) => `https://www.gmgn.cc/kline/sol/${mint}?theme=dark`;
// Axiom's own chart can't be embedded (it sends X-Frame-Options + is wallet-login
// gated), so we deep-link out to it in a new tab instead.
const axiomUrl = (mint) => `https://axiom.trade/t/${mint}`;

// Mint of the signal whose chart is currently expanded (one at a time). Click a
// signal's chart button to embed its live GMGN chart inline; click again
// to collapse it.
const openChart = ref("");
function toggleChart(s) {
  openChart.value = openChart.value === s.mint ? "" : s.mint;
}

// AI "Jelaskan sinyal ini". One expanded at a time; results cached per mint so
// re-opening doesn't re-hit (and re-bill) the API.
const openExplain = ref("");
const explains = ref({}); // mint -> { loading, text, error }
function setExplain(mint, patch) {
  explains.value = { ...explains.value, [mint]: { ...(explains.value[mint] || {}), ...patch } };
}
async function explain(s) {
  const mint = s.mint;
  openExplain.value = openExplain.value === mint ? "" : mint;
  if (openExplain.value !== mint) return;          // collapsed
  const cur = explains.value[mint];
  if (cur && (cur.loading || cur.text)) return;    // already have it / in flight
  setExplain(mint, { loading: true, text: "", error: "" });
  try {
    const r = await fetch(apiUrl("/api/sniper/explain"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint }),
    });
    const body = await r.json();
    if (!r.ok) setExplain(mint, { loading: false, error: body?.error || `Gagal (${r.status})` });
    else setExplain(mint, { loading: false, text: body.text || "", error: "" });
  } catch {
    setExplain(mint, { loading: false, error: "Gangguan jaringan — apakah backend (:8787) jalan?" });
  }
}

// Lettered avatar fallback when a token has no logo (or the image fails to load).
const failedLogos = ref(new Set());
function initials(s) {
  return (s.symbol || s.mint || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
}
function logoFailed(mint) {
  failedLogos.value = new Set(failedLogos.value).add(mint);
}

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
    const r = await fetch(apiUrl(sniperBase() + "/signals"));
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
    const r = await fetch(apiUrl(sniperBase() + "/sweep"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Sweep gagal (${r.status})`;
    else { data.value = { ...body, signalMin: body.signalMin, count: body.signals.length }; fetchTrack(); }
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

function onKeydown(e) {
  if (e.key === "Escape" && openChart.value) openChart.value = "";
}

onMounted(() => {
  refresh();
  fetchTrack();
  timer = setInterval(() => { refresh(); fetchTrack(); }, 60_000); // keep signals + PnL track fresh
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  timer && clearInterval(timer);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <section class="panel" aria-labelledby="sniper-h">
    <div class="panel__head">
      <div>
        <h2 id="sniper-h">🎯 Sinyal Sniper Live <span class="tag">Live</span></h2>
        <p class="panel__sub">
          Token yang <b>sedang diborong beberapa smart wallet sekaligus</b> (dari Watchlist) selagi masih kecil —
          sinyal akumulasi <b>sebelum</b> pump.
        </p>
      </div>
      <button class="scanbtn" :disabled="loading" @click="sweep">
        {{ loading ? "🔍 Menyapu…" : "🔍 Sweep sekarang" }}
      </button>
    </div>

    <!-- Stream switch: sharp v2 vs original headcount ("awal") -->
    <div class="sn-tabs" role="tablist" aria-label="Versi sinyal sniper">
      <button
        v-for="v in VARIANTS"
        :key="v.id"
        type="button"
        role="tab"
        class="sn-tab"
        :class="{ 'sn-tab--active': variant === v.id }"
        :aria-selected="variant === v.id"
        :title="v.hint"
        @click="setVariant(v.id)"
      >{{ v.label }}</button>
      <span class="sn-tabs__hint">{{ VARIANTS.find(v => v.id === variant).hint }}</span>
    </div>

    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <template v-if="data">
      <div class="sn-summary">
        <div class="sn-chip"><b>{{ visibleSignals.length }}</b> sinyal aktif</div>
        <div
          v-if="hiddenUnverified"
          class="sn-chip"
          title="Token unverified (data pasar belum terverifikasi) sedang disembunyikan dari tampilan."
        >⚠ <b>{{ hiddenUnverified }}</b> unverified disembunyikan</div>
        <div class="sn-chip">≥<b>{{ data.signalMin }}</b> wallet sepakat</div>
        <div class="sn-chip">maks mcap <b>{{ money(data.maxMcap) }}</b></div>
        <div
          v-if="data.safetyGate"
          class="sn-chip sn-chip--safe"
          :title="'Gate keamanan aktif: cek rug/honeypot + likuiditas ≥ ' + money(data.minLiquidity) + ', mcap ≥ ' + money(data.minMcap)"
        >🛡️ gate aman</div>
        <div
          v-if="data.scoreMin"
          class="sn-chip"
          :title="'Hanya sinyal dengan skor kekuatan (reputasi + ukuran beli + kerapatan co-buy ' + data.cobuyWindow + 'm) ≥ ambang'"
        >skor ≥ <b>{{ data.scoreMin }}</b></div>
        <div
          v-if="data.netBuyOnly"
          class="sn-chip"
          title="Hanya net-buy: wallet yang beli lalu jual di window sama tidak dihitung."
        >net-buy</div>
      </div>

      <!-- PnL track: real outcomes of past signals (entry at signal → graded vs live). -->
      <div v-if="curTrack" class="sn-track">
        <div class="sn-track__line">
          <span class="sn-track__tag">📊 Rekam PnL</span>
          <template v-if="curTrack.graded">
            <span class="sn-track__stat">
              Win rate
              <b :class="curTrack.winRate >= 0.5 ? 'sn-track__up' : curTrack.winRate <= 0.2 ? 'sn-track__down' : ''">
                {{ Math.round((curTrack.winRate || 0) * 100) }}%
              </b>
              <span class="sn-track__note">({{ curTrack.wins }}W · {{ curTrack.losses }}L · {{ curTrack.rugs }} rug dari {{ curTrack.graded }} dinilai)</span>
            </span>
            <span class="sn-track__stat">Avg <b :class="pctClass(curTrack.avgReturnPct)">{{ fmtPct(curTrack.avgReturnPct) }}</b></span>
            <span v-if="curTrack.avgPeakReturnPct != null" class="sn-track__stat sn-track__note">peak avg {{ fmtPct(curTrack.avgPeakReturnPct) }}</span>
            <span v-if="curTrack.best" class="sn-track__stat">
              Terbaik <b class="sn-track__up">{{ curTrack.best.symbol || '—' }} {{ curTrack.best.multiple ? xFmt(curTrack.best.multiple) : fmtPct(Math.round(curTrack.best.returnPct * 100)) }}</b>
            </span>
            <span v-if="curTrack.open" class="sn-track__note">· {{ curTrack.open }} dilacak</span>
          </template>
          <span v-else class="sn-track__note">
            Belum ada sinyal matang untuk dinilai<template v-if="curTrack.open"> ({{ curTrack.open }} sedang dilacak)</template> —
            PnL terekam otomatis ~{{ track.gradeAfterMin }} mnt setelah sinyal muncul.
          </span>
        </div>
        <p class="sn-track__foot">Entry di-snapshot saat tool memberi sinyal, dinilai vs harga live.</p>
      </div>

      <p v-if="!visibleSignals.length" class="sn-empty">
        <template v-if="hiddenUnverified">
          {{ hiddenUnverified }} sinyal ada tapi semuanya <b>unverified</b> — sedang disembunyikan.
          Tunggu sampai token terverifikasi, atau tampilkan lagi token unverified.
        </template>
        <template v-else>
          Belum ada sinyal. Monitor menunggu ≥{{ data.signalMin }} wallet Watchlist membeli token kecil yang sama.
        </template>
      </p>

      <!-- Scroll box: tampil 4 sinyal default, sisanya di-scroll di dalam kotak.
           Saat sebuah penjelasan AI dibuka, kotak otomatis melebar (tambah tinggi)
           sebesar ruang penjelasan agar 4 token tetap terlihat + teksnya muat. -->
      <div
        v-else
        class="sn-scroll"
        :class="[visibleSignals.length > 4 ? 'sn-scroll--more' : '', openExplain ? 'sn-scroll--explaining' : '']"
      >
        <ul class="sn-list">
        <li v-for="s in visibleSignals" :key="s.mint" class="sn-row" :class="s.isNew ? 'sn-row--new' : ''">
          <div class="sn-top">
            <div class="sn-main">
              <button
                type="button"
                class="sn-logo"
                :title="'Klik untuk lihat chart ' + (s.symbol || shortMint(s.mint))"
                :aria-expanded="openChart === s.mint"
                @click="toggleChart(s)"
              >
                <img
                  v-if="s.logoUrl && !failedLogos.has(s.mint)"
                  :src="s.logoUrl"
                  :alt="s.symbol"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="logoFailed(s.mint)"
                />
                <span v-else class="sn-logo-fallback">{{ initials(s) }}</span>
              </button>
              <span class="sn-count" :title="s.walletCount + ' smart wallet membeli'">{{ s.walletCount }}👛</span>
              <span
                v-if="s.score"
                class="sn-score"
                :title="'Skor kekuatan sinyal' + (s.why && s.why.length ? ':\n· ' + s.why.join('\n· ') : '')"
              >🔥 {{ s.score }}</span>
              <button
                class="sn-sym sn-sym--copy"
                type="button"
                :title="'Klik untuk salin alamat token: ' + s.mint"
                @click="copy(s.mint)"
              >{{ copied === s.mint ? "✓ tersalin" : (s.symbol || shortMint(s.mint)) }}</button>
              <span v-if="s.isNew" class="sn-badge">BARU</span>
              <span
                v-if="s.insider"
                class="sn-insider"
                title="SEMUA wallet pemicu sinyal ini terklasifikasi INSIDER (beli pra-likuiditas / berulang di token deployer yang sama). Mereka tahu duluan — ini informasi, bukan analisis. Ekstra hati-hati."
              >⚠ insider</span>
              <span
                v-if="s.unverified"
                class="sn-unverified"
                title="Data pasar belum terverifikasi — token belum bisa dikenali sumber mana pun (kemungkinan baru launch). Ekstra hati-hati, DYOR."
              >⚠ unverified</span>
              <span
                v-else-if="s.safetyChecked && !s.riskUnknown"
                class="sn-safe"
                title="Lolos gate keamanan: bukan rug/honeypot, mint/freeze authority aman, LP terkunci, likuiditas & mcap di atas batas."
              >🛡️</span>
              <span
                v-else-if="s.safetyChecked && s.riskUnknown"
                class="sn-riskunknown"
                title="RugCheck belum punya data untuk token ini (kemungkinan baru launch) — cek rug belum bisa dijalankan. Lolos gate lain, tapi rug BELUM diverifikasi. Ekstra hati-hati, DYOR."
              >🛡️? rug belum tercek</span>
              <span
                v-if="s.holders != null"
                class="sn-hold"
                :class="s.soldOff > 0 ? 'sn-hold--mixed' : 'sn-hold--all'"
                :title="s.holders + ' dari ' + (s.positions ? s.positions.length : s.holders) + ' smart wallet masih memegang token ini'
                  + (s.soldOff > 0 ? ' · ' + s.soldOff + ' sudah jual' : '')"
              >🖐 {{ s.holders }}/{{ s.positions ? s.positions.length : s.holders }} pegang</span>
              <span class="sn-mcap">
                {{ s.unverified ? "mcap ?" : money(s.mcap) }}<span v-if="s.liquidityUsd" class="sn-liq"> · liq {{ money(s.liquidityUsd) }}</span>
              </span>
            </div>
            <div class="sn-meta">
              <span class="sn-time">{{ ago(s.lastBuyAt) }}</span>
              <button class="sn-copy" type="button" :title="'Salin mint: ' + s.mint" @click="copy(s.mint)">
                {{ copied === s.mint ? "✓ tersalin" : shortMint(s.mint) }}
              </button>
              <button
                type="button"
                class="sn-explainbtn"
                :aria-expanded="openExplain === s.mint"
                title="Minta Claude menjelaskan kenapa ini jadi sinyal"
                @click="explain(s)"
              >
                {{ openExplain === s.mint ? "🧠 tutup" : "🧠 Jelaskan" }}
              </button>
              <button
                type="button"
                class="sn-chartbtn"
                :aria-expanded="openChart === s.mint"
                @click="toggleChart(s)"
              >
                {{ openChart === s.mint ? "📊 tutup" : "📈 chart" }}
              </button>
            </div>
          </div>

          <!-- AI explanation of this signal (Claude). Expands inline under the row. -->
          <div v-if="openExplain === s.mint" class="sn-explain">
            <p v-if="explains[s.mint] && explains[s.mint].loading" class="sn-explain__status">🧠 Claude sedang menganalisis…</p>
            <p v-else-if="explains[s.mint] && explains[s.mint].error" class="sn-explain__error" role="alert">{{ explains[s.mint].error }}</p>
            <p v-else class="sn-explain__text">{{ explains[s.mint] && explains[s.mint].text }}</p>
          </div>

          <!-- GMGN chart: floating overlay (teleported to body so no
               ancestor stacking context can clip it). -->
          <Teleport to="body">
          <div v-if="openChart === s.mint" class="chart">
            <div class="chart__backdrop" aria-hidden="true" @click="toggleChart(s)"></div>
            <div class="chart__panel" role="dialog" aria-modal="true">
              <div class="chart__head">
                <span class="chart__title">
                  <span class="chart__logo" aria-hidden="true">
                    <img
                      v-if="s.logoUrl && !failedLogos.has(s.mint)"
                      :src="s.logoUrl"
                      :alt="s.symbol"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      @error="logoFailed(s.mint)"
                    />
                    <span v-else class="chart__logo-fallback">{{ initials(s) }}</span>
                  </span>
                  {{ s.symbol || shortMint(s.mint) }} chart
                </span>
                <div class="chart__head-actions">
                  <a
                    class="chart__open chart__open--axiom"
                    :href="axiomUrl(s.mint)"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Buka chart Axiom (perlu login wallet) — bisa lihat posisi wallet. Axiom tak bisa di-embed."
                  >
                    Axiom ↗
                  </a>
                  <button type="button" class="chart__close" aria-label="Tutup chart" @click="toggleChart(s)">✕</button>
                </div>
              </div>
              <div class="chart__frame">
                <iframe
                  :src="chartUrl(s.mint)"
                  :title="`Chart harga ${s.symbol || shortMint(s.mint)} di GMGN`"
                  loading="lazy"
                  allow="clipboard-write"
                  referrerpolicy="no-referrer"
                />
              </div>

              <!-- Posisi Smart Money — entri tiap wallet Watchlist di sinyal ini.
                   (Tak bisa digambar di dalam chart GMGN yang cross-origin,
                   jadi ditampilkan sebagai tabel posisi di bawahnya.) -->
              <div v-if="s.positions && s.positions.length" class="pos">
                <div class="pos__head">
                  👛 Posisi Smart Money <span class="pos__n">{{ s.positions.length }} wallet</span>
                </div>
                <ul class="pos__list">
                  <li v-for="p in s.positions" :key="p.owner" class="pos__row" :class="p.holding === false ? 'pos__row--sold' : ''">
                    <span
                      class="pos__hold"
                      :class="p.holding === true ? 'pos__hold--in' : p.holding === false ? 'pos__hold--out' : ''"
                      :title="p.holding === true ? 'Masih memegang token' : p.holding === false ? 'Sudah menjual' : 'Status hold tidak diketahui'"
                    >{{ p.holding === true ? "🟢" : p.holding === false ? "🔴" : "·" }}</span>
                    <span class="pos__rep" :title="'Reputasi ' + p.reputation + (p.established ? ' · wallet mapan' : '')">{{ p.reputation }}</span>
                    <button class="pos__addr" type="button" :title="'Salin: ' + p.owner" @click="copy(p.owner)">
                      {{ copied === p.owner ? "✓" : shortMint(p.owner) }}
                    </button>
                    <span class="pos__at">{{ ago(p.at) }}</span>
                    <span class="pos__entry">
                      {{ p.entryMcap ? "@ " + money(p.entryMcap) : (p.sizeUsd ? "beli " + money(p.sizeUsd) : "entry ?") }}
                    </span>
                    <span class="pos__pnl" :class="pnlClass(p.pnlX)">{{ p.pnlX ? xFmt(p.pnlX) : "—" }}</span>
                  </li>
                </ul>
                <p class="pos__note">Entri = pembelian pertama wallet dalam jendela pantau; harga/PnL perkiraan.</p>
              </div>
            </div>
          </div>
          </Teleport>
        </li>
        </ul>
      </div>
      <p v-if="visibleSignals.length > 4" class="sn-scroll-hint">
        Menampilkan 4 dari <b>{{ visibleSignals.length }}</b> sinyal — scroll di dalam kotak untuk lihat sisanya.
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

.sn-tabs { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
.sn-tab {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  color: var(--text-muted); font-size: var(--font-size-sm); cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.sn-tab:hover { color: var(--text-body); border-color: var(--border-strong, var(--border-default)); }
.sn-tab:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.sn-tab--active {
  color: var(--text-body); font-weight: 600;
  border-color: color-mix(in srgb, var(--text-accent, var(--text-success)) 55%, var(--border-default));
  background: color-mix(in srgb, var(--text-accent, var(--text-success)) 14%, transparent);
}
.sn-tabs__hint { font-size: var(--font-size-xs); color: var(--text-muted); flex: 1 1 100%; }
@media (min-width: 560px) { .sn-tabs__hint { flex: 1 1 auto; } }

.sn-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.sn-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.sn-chip b { color: var(--text-body); }
.sn-chip--safe {
  color: var(--text-success); cursor: help;
  border-color: color-mix(in srgb, var(--text-success) 40%, var(--border-default));
  background: color-mix(in srgb, var(--text-success) 12%, transparent);
}

.sn-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; }

/* PnL track strip — real graded outcomes of past signals. */
.sn-track {
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  background: var(--bg-raised); padding: var(--space-3) var(--space-4);
  display: grid; gap: var(--space-2);
}
.sn-track__line { display: flex; align-items: center; gap: var(--space-3) var(--space-4); flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--text-muted); }
.sn-track__tag {
  font-weight: var(--font-weight-medium); color: var(--text-body);
  padding: 2px 8px; border-radius: var(--radius-full, 999px);
  background: color-mix(in srgb, var(--text-accent, var(--text-success)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-accent, var(--text-success)) 40%, var(--border-default));
}
.sn-track__stat { color: var(--text-body); }
.sn-track__stat b { font-variant-numeric: tabular-nums; }
.sn-track__note { color: var(--text-muted); font-size: var(--font-size-xs); }
.sn-track__up { color: var(--text-success); }
.sn-track__down { color: var(--text-error); }
.sn-track__foot { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

/* Scroll box: tampilkan tepat 4 sinyal default, sisanya di-scroll di dalam kotak.
   Tinggi dihitung dari (jumlah baris × tinggi baris) + gap + padding kotak, jadi
   selalu pas 4 baris berapa pun panjang daftarnya. */
.sn-scroll {
  --sn-rows: 4;          /* jumlah sinyal terlihat sebelum harus scroll */
  --sn-row-h: 50px;      /* perkiraan tinggi satu baris sinyal */
  --sn-explain-extra: 0px; /* tambahan tinggi saat penjelasan AI terbuka */
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  background: var(--bg-raised); padding: var(--space-2);
  transition: max-height var(--motion-duration-fast, 0.2s) var(--motion-ease, ease);
}
.sn-scroll--more {
  max-height: calc(
    var(--sn-rows) * var(--sn-row-h)
    + (var(--sn-rows) - 1) * var(--space-2)
    + 2 * var(--space-2)
    + var(--sn-explain-extra)
  );
  overflow-y: auto;
  scrollbar-width: thin; scrollbar-gutter: stable;
}
/* Penjelasan AI terbuka → kotak melebar sebesar ruang teks, jadi 4 token tetap
   tampil dan penjelasannya muat tanpa menghimpit daftar. */
.sn-scroll--explaining { --sn-explain-extra: 190px; }
.sn-scroll--more::-webkit-scrollbar { width: 8px; }
.sn-scroll--more::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 999px; }
.sn-scroll-hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); }
.sn-scroll-hint b { color: var(--text-body); }

.sn-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.sn-row {
  display: grid; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.sn-row--new { border-color: color-mix(in srgb, var(--text-success) 55%, var(--border-default)); }
.sn-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.sn-main { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.sn-logo {
  flex: none; width: 30px; height: 30px; padding: 0; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-raised); border: 1px solid var(--border-default);
  cursor: pointer;
}
.sn-logo:hover { border-color: var(--text-success); }
.sn-logo:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.sn-logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sn-logo-fallback { font-size: 10px; font-weight: 700; color: var(--text-success); letter-spacing: 0.2px; }
.sn-count {
  flex: none; font-weight: 700; color: var(--text-success); font-size: var(--font-size-sm);
  background: color-mix(in srgb, var(--text-success) 14%, transparent);
  padding: 2px 8px; border-radius: var(--radius-sm);
}
.sn-sym { font-weight: 700; color: var(--text-body); }
/* Nama token sebagai tombol salin alamat — klik nama → mint ke clipboard. */
.sn-sym--copy {
  font: inherit; font-weight: 700; padding: 0; background: none; border: 0;
  cursor: pointer; text-align: left;
  text-decoration: underline dotted; text-underline-offset: 3px;
}
.sn-sym--copy:hover { color: var(--text-success); }
.sn-sym--copy:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: var(--radius-sm); }
.sn-mcap { color: var(--text-muted); font-size: var(--font-size-sm); font-variant-numeric: tabular-nums; }
.sn-liq { color: var(--text-muted); opacity: 0.8; }
.sn-safe { flex: none; font-size: var(--font-size-sm); cursor: help; }
.sn-riskunknown {
  flex: none; font-size: var(--font-size-xs); font-weight: 700; cursor: help; white-space: nowrap;
  color: var(--text-warning, var(--text-error));
  background: color-mix(in srgb, var(--text-warning, var(--text-error)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-warning, var(--text-error)) 40%, transparent);
  padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-hold {
  flex: none; font-size: var(--font-size-xs); font-weight: 700; cursor: help; white-space: nowrap;
  padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-hold--all {
  color: var(--text-success);
  background: color-mix(in srgb, var(--text-success) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-success) 40%, transparent);
}
.sn-hold--mixed {
  color: var(--text-warning, var(--text-body));
  background: color-mix(in srgb, var(--text-warning, var(--text-muted)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-warning, var(--text-muted)) 40%, transparent);
}
.sn-score {
  flex: none; font-weight: 700; font-size: var(--font-size-xs); cursor: help; white-space: nowrap;
  color: var(--text-accent, var(--text-body)); font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--text-accent, var(--bg-accent)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-accent, var(--bg-accent)) 35%, transparent);
  padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-badge {
  font-size: var(--font-size-xs); font-weight: 700; color: var(--text-on-accent);
  background: var(--bg-accent); padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-unverified {
  font-size: var(--font-size-xs); font-weight: 700; cursor: help; white-space: nowrap;
  color: var(--text-warning, var(--text-error));
  background: color-mix(in srgb, var(--text-warning, var(--text-error)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-warning, var(--text-error)) 40%, transparent);
  padding: 1px 6px; border-radius: var(--radius-sm);
}
/* Wallet Intelligence v2 — semua wallet pemicu terklasifikasi INSIDER. */
.sn-insider {
  font-size: var(--font-size-xs); font-weight: 700; cursor: help; white-space: nowrap;
  color: var(--text-warning, var(--text-error));
  background: color-mix(in srgb, var(--text-warning, var(--text-error)) 20%, transparent);
  border: 1px dashed color-mix(in srgb, var(--text-warning, var(--text-error)) 55%, transparent);
  padding: 1px 6px; border-radius: var(--radius-sm);
}
.sn-meta { display: flex; align-items: center; gap: var(--space-3); flex: none; }
.sn-time { color: var(--text-muted); font-size: var(--font-size-xs); }
.sn-copy {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 2px 8px; cursor: pointer; font-size: var(--font-size-xs);
}
.sn-copy:hover { border-color: var(--text-success); color: var(--text-success); }
.sn-chartbtn {
  font: inherit; font-size: var(--font-size-xs); white-space: nowrap; cursor: pointer;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-success); padding: 2px 8px;
}
.sn-chartbtn:hover { border-color: var(--text-success); }
.sn-chartbtn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.sn-explainbtn {
  font: inherit; font-size: var(--font-size-xs); white-space: nowrap; cursor: pointer;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-accent, var(--text-body)); padding: 2px 8px;
}
.sn-explainbtn:hover { border-color: var(--text-accent, var(--text-success)); }
.sn-explainbtn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.sn-explain {
  margin-top: var(--space-1, 4px);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  border-left: 3px solid var(--text-accent, var(--bg-accent));
  border-radius: var(--radius-sm);
}
.sn-explain__status { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.sn-explain__error { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.sn-explain__text { margin: 0; color: var(--text-body); font-size: var(--font-size-sm); line-height: 1.6; white-space: pre-wrap; }


/* GMGN chart embed — always a floating overlay (centered modal). */
.chart { display: contents; }
.chart__backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px);
}
.chart__panel {
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
.chart__head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.chart__title { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-heading); font-weight: var(--font-weight-medium); }
.chart__logo { flex: none; width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: var(--bg-card); border: 1px solid var(--border-default); }
.chart__logo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chart__logo-fallback { font-size: 9px; font-weight: var(--font-weight-bold); color: var(--text-muted); letter-spacing: 0.2px; }
.chart__head-actions { display: flex; align-items: center; gap: var(--space-4); }
.chart__open { color: var(--text-success); text-decoration: none; font-size: var(--font-size-sm); white-space: nowrap; }
.chart__open:hover { text-decoration: underline; }
.chart__open--axiom { color: var(--text-link, #86efb8); }
.chart__close {
  display: grid; place-items: center;
  width: 30px; height: 30px; flex: none; padding: 0;
  border: 1px solid var(--border-default); border-radius: 999px;
  background: var(--bg-card); color: var(--text-body); font-size: 15px; line-height: 1; cursor: pointer;
}
.chart__close:hover { border-color: var(--text-error); color: var(--text-error); }
.chart__close:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.chart__frame {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10; max-height: 460px;
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  overflow: hidden; background: var(--bg-card);
}
.chart__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

/* Smart-money positions table under the chart. */
.pos { display: grid; gap: var(--space-2); }
.pos__head {
  display: flex; align-items: baseline; gap: var(--space-2);
  color: var(--text-heading); font-weight: var(--font-weight-medium); font-size: var(--font-size-sm);
}
.pos__n { color: var(--text-muted); font-size: var(--font-size-xs); font-weight: 400; }
.pos__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 200px; overflow-y: auto; scrollbar-width: thin; }
.pos__row {
  display: grid; align-items: center; gap: var(--space-3);
  grid-template-columns: auto auto auto 1fr auto auto;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}
.pos__row--sold { opacity: 0.55; }
.pos__hold { font-size: 10px; text-align: center; min-width: 14px; }
.pos__hold.pos__hold--out { filter: grayscale(0.1); }
.pos__rep {
  min-width: 26px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--text-success); background: color-mix(in srgb, var(--text-success) 14%, transparent);
  padding: 1px 4px; border-radius: var(--radius-sm);
}
.pos__addr {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 1px 6px; cursor: pointer; font-size: var(--font-size-xs);
}
.pos__addr:hover { border-color: var(--text-success); color: var(--text-success); }
.pos__addr:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.pos__at { color: var(--text-muted); }
.pos__entry { color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pos__pnl { font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; min-width: 44px; color: var(--text-muted); }
.pos__pnl--up { color: var(--text-success); }
.pos__pnl--down { color: var(--text-error); }
.pos__note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.4; }

@media (max-width: 560px) {
  .pos__row { grid-template-columns: auto auto 1fr auto; row-gap: 2px; }
  .pos__at { grid-column: 2; }
  .pos__entry { grid-column: 2 / 4; }
}

@media (max-width: 560px) {
  .sn-top { align-items: flex-start; }
  .sn-meta { flex-wrap: wrap; }
  /* Baris bisa membungkus jadi lebih tinggi di layar kecil → naikkan perkiraan
     tinggi baris agar tetap ~4 sinyal yang terlihat. */
  .sn-scroll { --sn-row-h: 76px; }
  /* Teks penjelasan membungkus lebih panjang di HP → beri ruang lebih besar. */
  .sn-scroll--explaining { --sn-explain-extra: 260px; }

  .chart__panel {
    top: 12px; left: 10px; right: 10px; transform: none;
    width: auto; max-height: 86vh; padding: var(--space-4);
  }
  .chart__frame { aspect-ratio: auto; height: 62vh; max-height: none; }
}
</style>
