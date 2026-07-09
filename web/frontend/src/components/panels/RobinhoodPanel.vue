<script setup>
/**
 * RobinhoodPanel — zona TERPISAH untuk ekosistem Robinhood Chain (EVM L2, mainnet
 * 1 Juli 2026). Menandai batas antara fitur Solana (di atas) dan porting ke
 * Robinhood Chain (EVM permissionless, sedang "meme meta").
 *
 * LANGKAH #1 sudah LIVE: discover pool memecoin trending/fresh via GeckoTerminal
 * (network "robinhood") lewat /api/robinhood/discover. Sisa roadmap (screen/sniper)
 * masih rencana. Tidak ada data palsu — discover memakai data on-chain nyata.
 */
import { ref } from "vue";
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
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
async function runBedah(tokenArg) {
  const t = String(tokenArg || bedahToken.value || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) { bedahError.value = "Alamat token 0x… tidak valid."; return; }
  bedahToken.value = t;
  if (bedahLoading.value) return;
  bedahLoading.value = true;
  bedahError.value = "";
  bedah.value = null;
  try {
    const r = await fetch(apiUrl("/api/robinhood/bedah?token=" + t));
    const body = await r.json();
    if (!r.ok) bedahError.value = body?.error || `Bedah gagal (${r.status})`;
    else bedah.value = body;
  } catch {
    bedahError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    bedahLoading.value = false;
  }
}
async function copyAddr(a) {
  try { await navigator.clipboard.writeText(a); } catch { /* blocked */ }
}

// Rencana tool yang akan di-port ke Robinhood Chain (EVM), dari termudah → tersulit.
const roadmap = [
  { icon: "🚀", name: "10x Radar EVM", status: "prototipe",
    desc: "Discover pool trending/fresh via GeckoTerminal — SUDAH LIVE di bawah. Berikutnya: skor momentum & filter." },
  { icon: "💎", name: "GEM Score EVM", status: "prototipe",
    desc: "Skor 0–100 + gate keamanan heuristik (likuiditas, holder, konsentrasi, honeypot) — LIVE via tombol 🔬 di tiap pool. GoPlus/Honeypot.is belum dukung chain ini." },
  { icon: "🩻", name: "Bedah Coin EVM", status: "prototipe",
    desc: "Lacak early buyer winner via transfer on-chain (Blockscout asc) + konfirmasi saldo — LIVE di bawah. Menyemai watchlist EVM." },
  { icon: "🎯", name: "Sniper Smart Money EVM", status: "riset",
    desc: "Pantau wallet 0x borong token fresh. Tantangan: sumber data 'top trader per-wallet' untuk chain sebaru ini masih perlu dicari." },
];

// Infrastruktur padanan (EVM) — rujukan, bukan koneksi live.
const infra = [
  { k: "Chain", v: "EVM L2 (Arbitrum stack), gas ETH" },
  { k: "Sifat", v: "Permissionless — siapa pun bisa deploy" },
  { k: "DEX utama", v: "Uniswap (+ 1inch, Lighter, Rialto, Arcus)" },
  { k: "Launchpad", v: "fun.noxa.fi/robinhood" },
  { k: "Data pool", v: "GeckoTerminal API" },
  { k: "Explorer/API", v: "robinhoodchain.blockscout.com" },
];

const explorerUrl = "https://robinhoodchain.blockscout.com";
const geckoUrl = "https://www.geckoterminal.com";
const docsUrl = "https://docs.robinhood.com/chain/";
</script>

<template>
  <section class="rh" aria-labelledby="rh-h">
    <div class="rh__head">
      <div>
        <h2 id="rh-h">
          <span class="rh__dot" aria-hidden="true"></span>
          Robinhood Chain
          <span class="rh__tag">EVM · L2</span>
          <span class="rh__badge">Dalam pembangunan</span>
        </h2>
        <p class="rh__sub">
          Zona terpisah untuk membangun ekosistem <b>Robinhood Chain</b> (EVM permissionless,
          mainnet 1 Juli 2026 — sedang "meme meta"). Engine di atas masih <b>100% Solana</b>;
          bagian ini adalah <b>peta rencana port</b> ke EVM. Belum ada data live.
        </p>
      </div>
    </div>

    <!-- ===== Prototipe LIVE: discover pool via GeckoTerminal ===== -->
    <div class="rh__disc">
      <div class="rh__disc-head">
        <span class="rh__disc-title">🚀 Discover pool <span class="rh__proto">prototipe live</span></span>
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
        <span class="rh__disc-title">🩻 Bedah Coin <span class="rh__proto">prototipe live</span></span>
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

      <p v-if="bedahError" class="rh__err" role="alert">⚠️ {{ bedahError }}</p>

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
        <p class="rh__note">{{ bedah.note }} Berikutnya (langkah #4): rekam kandidat ini ke <b>Watchlist EVM</b> → pantau untuk <b>Sniper EVM</b>.</p>
      </template>
    </div>

    <!-- Roadmap tool yang akan di-port -->
    <ul class="rh__list">
      <li v-for="r in roadmap" :key="r.name" class="rh__item">
        <span class="rh__icon" aria-hidden="true">{{ r.icon }}</span>
        <div class="rh__body">
          <div class="rh__line1">
            <span class="rh__name">{{ r.name }}</span>
            <span class="rh__st" :class="'rh__st--' + r.status">
              {{ r.status === "riset" ? "🔎 riset" : "🚧 rencana" }}
            </span>
          </div>
          <p class="rh__desc">{{ r.desc }}</p>
        </div>
      </li>
    </ul>

    <!-- Rujukan infrastruktur EVM -->
    <div class="rh__infra">
      <div v-for="i in infra" :key="i.k" class="rh__chip">
        <span class="rh__chip-k">{{ i.k }}</span>
        <span class="rh__chip-v">{{ i.v }}</span>
      </div>
    </div>

    <div class="rh__links">
      <a :href="docsUrl" target="_blank" rel="noopener noreferrer">📄 Docs</a>
      <a :href="explorerUrl" target="_blank" rel="noopener noreferrer">🔎 Blockscout</a>
      <a :href="geckoUrl" target="_blank" rel="noopener noreferrer">📊 GeckoTerminal</a>
    </div>

    <p class="rh__note">
      Catatan: konsep Sniper Smart Money relevan di sini (chain permissionless + memecoin aktif),
      tapi butuh <b>adapter chain EVM</b> + ganti sumber data (Helius→Blockscout/RPC,
      DexScreener/Birdeye→GeckoTerminal, RugCheck→GoPlus). Bukan nasihat keuangan. DYOR.
    </p>
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
.rh__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.55; max-width: 66ch; }
.rh__tag {
  font-size: var(--font-size-xs); font-weight: var(--font-weight-medium);
  color: #00c805; background: color-mix(in srgb, #00c805 14%, transparent);
  border: 1px solid color-mix(in srgb, #00c805 45%, transparent);
  padding: 2px 8px; border-radius: var(--radius-full, 999px);
}
.rh__badge {
  font-size: var(--font-size-xs); font-weight: 700; color: var(--text-on-accent, #000);
  background: #00c805; padding: 2px 8px; border-radius: var(--radius-full, 999px);
}

/* Discover prototipe live */
.rh__disc { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--control-radius); }
.rh__disc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.rh__disc-title { font-weight: 700; color: var(--text-heading); display: inline-flex; align-items: center; gap: var(--space-2); }
.rh__proto { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #00a804; background: color-mix(in srgb, #00c805 14%, transparent); border: 1px solid color-mix(in srgb, #00c805 40%, transparent); padding: 1px 6px; border-radius: var(--radius-sm); }
.rh__btn {
  flex: none; padding: 0 var(--space-5); height: var(--control-height);
  border: 1px solid #00a804; border-radius: var(--control-radius);
  background: #00c805; color: #04210a; font: inherit; font-weight: var(--font-weight-medium); cursor: pointer;
}
.rh__btn:hover:not(:disabled) { filter: brightness(1.06); }
.rh__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.rh__btn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.rh__err { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
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
.rh__pool-link { color: #00a804; text-decoration: none; font-size: var(--font-size-xs); white-space: nowrap; }
.rh__pool-link:hover { text-decoration: underline; }
.rh__screen { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: var(--font-size-xs); padding-top: 2px; border-top: 1px dashed var(--border-default); color: var(--text-muted); }
.rh__v { font-weight: 700; padding: 1px 6px; border-radius: var(--radius-sm); }
.rh__v--strong { color: #04210a; background: #00c805; }
.rh__v--watch { color: #7c5b00; background: #f5c518; }
.rh__v--skip { color: #fff; background: var(--text-error, #ef4444); }
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

.rh__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
.rh__item {
  display: flex; gap: var(--space-3); align-items: flex-start;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.rh__icon { flex: none; font-size: 20px; line-height: 1.3; }
.rh__body { display: grid; gap: 2px; min-width: 0; }
.rh__line1 { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.rh__name { font-weight: 700; color: var(--text-heading); }
.rh__st { font-size: var(--font-size-xs); font-weight: 700; padding: 1px 6px; border-radius: var(--radius-sm); white-space: nowrap; }
.rh__st--rencana { color: var(--text-muted); background: var(--bg-card); border: 1px solid var(--border-default); }
.rh__st--riset { color: #d97706; background: color-mix(in srgb, #d97706 14%, transparent); border: 1px solid color-mix(in srgb, #d97706 40%, transparent); }
.rh__desc { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5; }

.rh__infra { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.rh__chip {
  display: inline-flex; align-items: baseline; gap: var(--space-2);
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-xs);
}
.rh__chip-k { color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
.rh__chip-v { color: var(--text-body); font-weight: var(--font-weight-medium); }

.rh__links { display: flex; gap: var(--space-4); flex-wrap: wrap; }
.rh__links a { color: #00a804; text-decoration: none; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.rh__links a:hover { text-decoration: underline; }
.rh__links a:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.rh__note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

@media (max-width: 560px) {
  .rh { padding: var(--space-5); }
}
</style>
