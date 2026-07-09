<script setup>
/**
 * WatchlistPanel — the smart-wallet watchlist (SNIPER ENGINE Modul B). Shows the
 * self-learning ranking: wallets auto-recorded from "Bedah Coin" autopsies of real
 * winners, ordered by reputation (how many winners each caught early). The top
 * WATCH_SIZE are flagged ACTIVE — the set the live monitor (Modul C) will follow.
 * Heuristic track record — NOT financial advice.
 */
import { ref, onMounted } from "vue";
import { apiUrl } from "../../lib/api.js";

// Tab: "smart" = self-learning smart-wallet ranking (Modul B); "influencer" =
// manually tracked influencer wallets (Modul B2).
const mode = ref("smart");
// Sembunyikan tombol/tab Influencer (Modul B2) dari UI — sementara. Kode, state,
// dan endpoint tetap utuh; set true untuk memunculkannya lagi.
const SHOW_INFLUENCER = false;

const data = ref(null);
const loading = ref(false);
const discovering = ref(false); // on-demand auto-discovery sweep in progress
const error = ref("");
const copied = ref("");

// Influencer tab state.
const inf = ref(null);           // { total, influencers: [...] }
const infLoading = ref(false);
const infError = ref("");
const form = ref({ owner: "", label: "", handle: "" });
const adding = ref(false);

const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const xFmt = (n) => (typeof n === "number" && n > 0 ? (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + "x" : "—");

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => { if (copied.value === text) copied.value = ""; }, 1600);
  } catch { /* clipboard blocked */ }
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/watchlist"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Gagal memuat (${r.status})`;
    else data.value = body;
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}
// Trigger one on-chain discovery cycle (auto-Bedah + top-trader harvest), then
// reload the watchlist so any newly-found wallets show up immediately.
async function discover() {
  if (discovering.value) return;
  discovering.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl("/api/watchlist/discover"));
    const body = await r.json();
    if (!r.ok) error.value = body?.error || `Pencarian gagal (${r.status})`;
    else await load();
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    discovering.value = false;
  }
}

// ---- Influencer tab (Modul B2) --------------------------------------------
async function loadInfluencers() {
  if (infLoading.value) return;
  infLoading.value = true;
  infError.value = "";
  try {
    const r = await fetch(apiUrl("/api/influencers"));
    const body = await r.json();
    if (!r.ok) infError.value = body?.error || `Gagal memuat (${r.status})`;
    else inf.value = body;
  } catch {
    infError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    infLoading.value = false;
  }
}

async function addInfluencer() {
  if (adding.value) return;
  const owner = form.value.owner.trim();
  const label = form.value.label.trim();
  if (!owner || !label) { infError.value = "Alamat wallet dan label wajib diisi."; return; }
  adding.value = true;
  infError.value = "";
  try {
    const r = await fetch(apiUrl("/api/influencers"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, label, handle: form.value.handle.trim() }),
    });
    const body = await r.json();
    if (!r.ok) infError.value = body?.error || `Gagal menambah (${r.status})`;
    else { form.value = { owner: "", label: "", handle: "" }; await loadInfluencers(); }
  } catch {
    infError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    adding.value = false;
  }
}

async function removeInfluencer(owner) {
  infError.value = "";
  try {
    const r = await fetch(apiUrl(`/api/influencers/${owner}`), { method: "DELETE" });
    if (!r.ok) { const b = await r.json().catch(() => ({})); infError.value = b?.error || `Gagal menghapus (${r.status})`; return; }
    await loadInfluencers();
  } catch {
    infError.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  }
}

function switchMode(m) {
  mode.value = m;
  if (m === "influencer" && !inf.value) loadInfluencers();
}

onMounted(load);
</script>

<template>
  <section class="panel" aria-labelledby="watchlist-h">
    <div class="panel__head">
      <div>
        <h2 id="watchlist-h">🎯 Watchlist Wallet <span class="tag">Sniper</span></h2>
        <p v-if="mode === 'smart'" class="panel__sub">
          Wallet yang <b>berulang kali menangkap winner lebih awal</b> — direkam otomatis dari Bedah Coin,
          diurutkan dari <b>total kelipatan winner terbesar</b> (Σ) ke terkecil. Semua wallet <b>aktif dipantau</b> monitor live.
        </p>
        <p v-else class="panel__sub">
          Wallet <b>influencer yang kamu masukkan sendiri</b> — dipantau monitor live. <b>Satu</b> influencer beli
          token fresh sudah cukup memunculkan sinyal (tak perlu menunggu ≥2 wallet). Heuristik, bukan nasihat keuangan.
        </p>
      </div>
      <div class="wl-head-actions">
        <button
          v-if="mode === 'smart'"
          class="scanbtn scanbtn--ghost"
          :disabled="discovering"
          title="Cari smart money baru dari on-chain sekarang (auto-Bedah + top-trader) tanpa Bedah manual"
          @click="discover"
        >
          {{ discovering ? "🛰️ Mencari…" : "🛰️ Cari wallet" }}
        </button>
        <button
          class="scanbtn"
          :disabled="mode === 'smart' ? loading : infLoading"
          @click="mode === 'smart' ? load() : loadInfluencers()"
        >
          {{ (mode === 'smart' ? loading : infLoading) ? "Memuat…" : "↻ Segarkan" }}
        </button>
      </div>
    </div>

    <!-- Tab switch: smart-wallet ranking (Modul B) vs manual influencers (Modul B2).
         Seluruh bar disembunyikan saat SHOW_INFLUENCER=false — tanpa tab Influencer,
         hanya "Smart Wallet" yang tersisa jadi tak perlu switcher. -->
    <div v-if="SHOW_INFLUENCER" class="wl-tabs" role="tablist" aria-label="Mode watchlist">
      <button
        class="wl-tab" :class="mode === 'smart' ? 'wl-tab--on' : ''"
        role="tab" :aria-selected="mode === 'smart'" @click="switchMode('smart')"
      >Smart Wallet</button>
      <button
        v-if="SHOW_INFLUENCER"
        class="wl-tab" :class="mode === 'influencer' ? 'wl-tab--on' : ''"
        role="tab" :aria-selected="mode === 'influencer'" @click="switchMode('influencer')"
      >⭐ Influencer</button>
    </div>

    <!-- ============ TAB: SMART WALLET (Modul B) ============ -->
    <template v-if="mode === 'smart'">
    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <template v-if="data">
      <!-- Config strip -->
      <div class="wl-summary">
        <div class="wl-chip"><b>{{ data.total }}</b> wallet terekam</div>
        <div class="wl-chip wl-chip--ok"><b>{{ data.active }}</b> / {{ data.watchSize }} aktif dipantau</div>
        <div class="wl-chip">cek tiap <b>{{ data.pollMin }}m</b></div>
        <div class="wl-chip">winner = <b>≥{{ data.winnerMinX }}x</b></div>
        <div
          v-if="data.discovery"
          class="wl-chip wl-chip--auto"
          :title="'Auto-discovery on-chain: Bedah ' + (data.discovery.winnersRecorded||0) + ' winner + panen ' + (data.discovery.walletsAdded||0) + ' top-trader (siklus terakhir). Isi watchlist tanpa Bedah manual.'"
        >🛰️ auto-discovery{{ discovering ? " …" : "" }}</div>
      </div>

      <!-- Empty state -->
      <p v-if="!data.wallets.length" class="wl-empty">
        Belum ada wallet. Tekan <b>🛰️ Cari wallet</b> untuk memancing smart money langsung dari on-chain
        (auto-Bedah + top-trader) — atau buka <b>🔬 Bedah Coin</b> dan bedah token yang sudah pump besar
        (≥{{ data.winnerMinX }}x). Watchlist juga terisi otomatis di background tiap beberapa menit.
      </p>

      <!-- Ranked list — scroll box, ~4 wallet terlihat default -->
      <div v-else class="wl-scroll" :class="data.wallets.length > 4 ? 'wl-scroll--more' : ''">
        <ul class="wl-list">
        <li v-for="w in data.wallets" :key="w.owner" class="wl-row" :class="w.active ? 'wl-row--active' : ''">
          <span class="wl-rank">#{{ w.rank }}</span>
          <button class="wl-addr" type="button" :title="'Salin: ' + w.owner" @click="copy(w.owner)">
            {{ copied === w.owner ? "✓ tersalin" : shortAddr(w.owner) }}
          </button>
          <span class="wl-rep">
            <span class="wl-rep__bar"><span class="wl-rep__fill" :style="{ width: w.reputation + '%' }"></span></span>
            <span class="wl-rep__n">{{ w.reputation }}</span>
          </span>
          <span
            v-if="w.winnerScore"
            class="wl-total"
            :title="'Total kelipatan semua winner (dari entry) — dasar urutan'"
          >Σ {{ xFmt(w.winnerScore) }}</span>
          <span class="wl-catches">
            🎯 {{ w.catches }} winner
            <span v-if="w.bestCatch" class="wl-best">· best {{ w.bestCatch.symbol }} {{ xFmt(w.bestCatch.xFromEntry) }}</span>
          </span>
          <span class="wl-flags">
            <span
              class="wl-badge wl-badge--src"
              :title="w.source === 'toptrader' ? 'Ditemukan dari top-trader token trending (Path B) — ' + (w.sightings||0) + ' kemunculan' : 'Ditemukan dari Bedah Coin winner (Modul A)'"
            >{{ w.source === 'toptrader' ? 'top-trader' : 'bedah' }}</span>
            <span v-if="w.established" class="wl-badge wl-badge--ok">mapan</span>
            <span v-if="w.active" class="wl-badge wl-badge--active">dipantau</span>
          </span>
        </li>
        </ul>
      </div>
      <p v-if="data.wallets.length > 4" class="wl-scroll-hint">
        Menampilkan 4 dari <b>{{ data.wallets.length }}</b> wallet — scroll di dalam kotak untuk lihat sisanya.
      </p>

      <p class="wl-note">
        ⏳ Monitor live (alert saat wallet ini mulai borong token baru) belum aktif — itu tahap berikutnya (Modul C).
        Track record heuristik, bukan nasihat keuangan.
      </p>
    </template>
    </template>

    <!-- ============ TAB: INFLUENCER (Modul B2) ============ -->
    <template v-else>
      <p v-if="infError" class="panel__error" role="alert">{{ infError }}</p>

      <!-- Add form -->
      <form class="inf-form" @submit.prevent="addInfluencer">
        <input
          v-model="form.owner" class="inf-input inf-input--addr" type="text" spellcheck="false"
          placeholder="Alamat wallet (base58 Solana)" aria-label="Alamat wallet influencer"
        />
        <input
          v-model="form.label" class="inf-input" type="text"
          placeholder="Nama / label (mis. Ansem)" aria-label="Nama atau label influencer"
        />
        <input
          v-model="form.handle" class="inf-input inf-input--handle" type="text" spellcheck="false"
          placeholder="@handle X (opsional)" aria-label="Handle X influencer (opsional)"
        />
        <button class="inf-add" type="submit" :disabled="adding">{{ adding ? "Menambah…" : "+ Tambah" }}</button>
      </form>

      <template v-if="inf">
        <div class="wl-summary">
          <div class="wl-chip"><b>{{ inf.total }}</b> influencer dipantau</div>
          <div class="wl-chip wl-chip--ok">1 beli = <b>sinyal</b></div>
        </div>

        <!-- Empty state + cara mendapatkan alamat -->
        <div v-if="!inf.influencers.length" class="inf-empty">
          <p>Belum ada influencer. Tambahkan alamat wallet di atas untuk mulai memantaunya secara live.</p>
          <p class="inf-empty__hint">
            <b>Cara dapat alamatnya (verifikasi silang, jangan percaya satu sumber):</b>
          </p>
          <ul class="inf-empty__list">
            <li>Influencer publikasi sendiri — bio/pinned tweet X, link “my wallet”.</li>
            <li>Platform intel: <b>Arkham</b> & <b>Nansen</b> yang melabeli wallet entity.</li>
            <li>Domain <b>SNS</b> (<code>.sol</code>) atau thread doxx komunitas yang terverifikasi.</li>
            <li><b>Awas:</b> influencer sering pakai burner/rotasi wallet — perlakukan sebagai heuristik.</li>
          </ul>
        </div>

        <!-- List -->
        <div v-else class="wl-scroll" :class="inf.influencers.length > 4 ? 'wl-scroll--more' : ''">
          <ul class="wl-list">
            <li v-for="f in inf.influencers" :key="f.owner" class="wl-row inf-row">
              <span class="inf-star" aria-hidden="true">⭐</span>
              <span class="inf-name">
                {{ f.label }}
                <a
                  v-if="f.handle" class="inf-handle" :href="'https://x.com/' + f.handle"
                  target="_blank" rel="noopener noreferrer"
                >@{{ f.handle }}</a>
              </span>
              <button class="wl-addr" type="button" :title="'Salin: ' + f.owner" @click="copy(f.owner)">
                {{ copied === f.owner ? "✓ tersalin" : shortAddr(f.owner) }}
              </button>
              <span class="inf-spacer"></span>
              <button class="inf-del" type="button" :title="'Hapus ' + f.label" @click="removeInfluencer(f.owner)">
                Hapus
              </button>
            </li>
          </ul>
        </div>
        <p v-if="inf.influencers.length > 4" class="wl-scroll-hint">
          Menampilkan 4 dari <b>{{ inf.influencers.length }}</b> influencer — scroll untuk lihat sisanya.
        </p>

        <p class="wl-note">
          Sinyal “influencer beli” muncul di panel <b>🎯 Sinyal Sniper Live</b>. Tetap DYOR — bukan nasihat keuangan.
        </p>
      </template>
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
.scanbtn:focus-visible, .wl-addr:focus-visible,
.wl-tab:focus-visible, .inf-input:focus-visible, .inf-add:focus-visible, .inf-del:focus-visible {
  outline: 2px solid var(--border-focus); outline-offset: 2px;
}

/* Tabs */
.wl-tabs { display: flex; gap: var(--space-2); }
.wl-tab {
  padding: var(--space-2) var(--space-4); font: inherit; font-size: var(--font-size-sm); cursor: pointer;
  background: var(--bg-raised); color: var(--text-muted);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  transition: border-color var(--motion-duration-instant) var(--motion-ease), color var(--motion-duration-instant) var(--motion-ease);
}
.wl-tab:hover { color: var(--text-body); border-color: var(--text-success); }
.wl-tab--on { color: var(--text-on-accent); background: var(--bg-accent); border-color: transparent; }

/* Influencer add form */
.inf-form { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.inf-input {
  flex: 1 1 160px; min-width: 0; padding: var(--space-3) var(--space-4);
  font: inherit; font-size: var(--font-size-sm);
  background: var(--bg-raised); color: var(--text-body);
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.inf-input::placeholder { color: var(--text-muted); }
.inf-input:hover { border-color: var(--text-success); }
.inf-input--addr { flex-basis: 100%; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; }
.inf-input--handle { flex-basis: 140px; }
.inf-add {
  flex: none; padding: var(--space-3) var(--space-5); font: inherit; font-weight: var(--font-weight-medium);
  cursor: pointer; border: 1px solid transparent; border-radius: var(--control-radius);
  background: var(--bg-accent); color: var(--text-on-accent);
}
.inf-add:hover:not(:disabled) { opacity: 0.92; }
.inf-add:disabled { opacity: 0.55; cursor: not-allowed; }

.inf-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; display: grid; gap: var(--space-2); }
.inf-empty p { margin: 0; }
.inf-empty__hint { color: var(--text-body); }
.inf-empty__list { margin: 0; padding-left: var(--space-5); display: grid; gap: var(--space-1, 4px); }
.inf-empty__list code {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.9em;
  background: var(--bg-raised); padding: 0 4px; border-radius: var(--radius-sm);
}

/* Influencer row */
.inf-row { gap: var(--space-3); }
.inf-star { flex: none; }
.inf-name { flex: 1 1 auto; min-width: 0; color: var(--text-body); font-weight: 600; font-size: var(--font-size-sm); }
.inf-handle { color: var(--text-link, #86efb8); text-decoration: none; font-weight: 400; margin-left: var(--space-2); }
.inf-handle:hover { text-decoration: underline; }
.inf-spacer { flex: 1 1 auto; }
.inf-del {
  flex: none; padding: 2px 10px; font: inherit; font-size: var(--font-size-xs); cursor: pointer;
  background: var(--bg-raised); color: var(--text-muted);
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
}
.inf-del:hover { color: var(--text-error); border-color: var(--text-error); }

.wl-summary { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.wl-chip {
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-full, 999px);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  font-size: var(--font-size-sm); color: var(--text-muted);
}
.wl-chip b { color: var(--text-body); }
.wl-chip--ok b { color: var(--text-success); }

.wl-empty { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.6; }

/* Scroll box: tampilkan tepat 4 wallet default, sisanya di-scroll di dalam kotak.
   Tinggi dihitung dari (jumlah baris × tinggi baris) + gap antar-baris + padding
   kotak, jadi selalu pas 4 baris berapa pun panjang daftarnya. */
.wl-scroll {
  --wl-rows: 4;          /* jumlah wallet terlihat sebelum harus scroll */
  --wl-row-h: 44px;      /* perkiraan tinggi satu baris wallet */
  border: 1px solid var(--border-default); border-radius: var(--control-radius);
  background: var(--bg-raised); padding: var(--space-2);
}
.wl-scroll--more {
  max-height: calc(
    var(--wl-rows) * var(--wl-row-h)
    + (var(--wl-rows) - 1) * var(--space-2)
    + 2 * var(--space-2)
  );
  overflow-y: auto;
  scrollbar-width: thin; scrollbar-gutter: stable;
}
.wl-scroll--more::-webkit-scrollbar { width: 8px; }
.wl-scroll--more::-webkit-scrollbar-thumb {
  background: var(--border-default); border-radius: 999px;
}
.wl-scroll-hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); }
.wl-scroll-hint b { color: var(--text-body); }

.wl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.wl-row {
  display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--control-radius);
}
.wl-row--active { border-color: color-mix(in srgb, var(--text-success) 45%, var(--border-default)); }
.wl-rank {
  flex: none; min-width: 30px; font-weight: 700; color: var(--text-muted); font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}
.wl-addr {
  flex: none; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-body); padding: 2px 8px; cursor: pointer; font-size: var(--font-size-sm);
}
.wl-addr:hover { border-color: var(--text-success); color: var(--text-success); }

.wl-rep { display: flex; align-items: center; gap: var(--space-2); flex: none; }
.wl-rep__bar { width: 64px; height: 6px; background: var(--bg-raised); border-radius: 999px; overflow: hidden; }
.wl-rep__fill { display: block; height: 100%; background: var(--text-success); }
.wl-rep__n { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-body); min-width: 22px; }

.wl-total {
  flex: none; font-weight: 700; font-size: var(--font-size-xs); white-space: nowrap; cursor: help;
  color: var(--text-success); font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--text-success) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-success) 35%, transparent);
  padding: 1px 7px; border-radius: var(--radius-sm);
}
.wl-catches { flex: 1; min-width: 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.wl-best { color: var(--text-success); }
.wl-flags { display: flex; gap: var(--space-2); flex: none; }
.wl-badge {
  font-size: var(--font-size-xs); padding: 1px 6px; border-radius: var(--radius-sm);
  background: var(--bg-raised); color: var(--text-muted); border: 1px solid var(--border-default);
}
.wl-badge--ok { color: var(--text-success); border-color: var(--text-success); }
.wl-badge--active { color: var(--text-on-accent); background: var(--bg-accent); border-color: transparent; }
.wl-badge--src { color: var(--text-muted); border-style: dashed; cursor: help; }

/* Auto-discovery: head action buttons + status chip */
.wl-head-actions { display: flex; gap: var(--space-3); flex: none; flex-wrap: wrap; justify-content: flex-end; }
.scanbtn--ghost { background: transparent; color: var(--text-muted); }
.scanbtn--ghost:hover:not(:disabled) { color: var(--text-body); border-color: var(--text-success); }
.wl-chip--auto {
  color: var(--text-success); cursor: help;
  border-color: color-mix(in srgb, var(--text-success) 40%, var(--border-default));
  background: color-mix(in srgb, var(--text-success) 12%, transparent);
}

.wl-note { margin: 0; color: var(--text-muted); font-size: var(--font-size-xs); line-height: 1.5; }

@media (max-width: 560px) {
  .wl-catches { flex-basis: 100%; order: 5; }
  /* Baris jadi 2 baris di layar kecil (catches turun ke bawah) → naikkan
     perkiraan tinggi baris agar tetap ~4 wallet yang terlihat. */
  .wl-scroll { --wl-row-h: 68px; }
}
</style>
