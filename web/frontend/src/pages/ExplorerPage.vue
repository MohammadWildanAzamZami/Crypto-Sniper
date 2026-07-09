<script setup>
import { computed, ref } from "vue";
import AppButton from "../components/ui/AppButton.vue";
import StatList from "../components/ui/StatList.vue";
import ScreenerPanel from "../components/panels/ScreenerPanel.vue";
import RadarPanel from "../components/panels/RadarPanel.vue";
import ProRadarPanel from "../components/panels/ProRadarPanel.vue";
import AutopsyPanel from "../components/panels/AutopsyPanel.vue";
import WatchlistPanel from "../components/panels/WatchlistPanel.vue";
import SniperPanel from "../components/panels/SniperPanel.vue";
import RobinhoodPanel from "../components/panels/RobinhoodPanel.vue";
// import ChecklistPanel from "../components/panels/ChecklistPanel.vue"; // disembunyikan sementara
import { useResource } from "../composables/useSolscan.js";

const chain = useResource("chain-info");

const chainStats = computed(() => {
  const d = chain.data.value?.data;
  if (!d) return [];
  return [
    { label: "Absolute slot", value: d.absoluteSlot?.toLocaleString() ?? "—" },
    { label: "Block height", value: d.blockHeight?.toLocaleString() ?? "—" },
    { label: "Current epoch", value: d.currentEpoch ?? "—" },
    { label: "Total transactions", value: d.transactionCount?.toLocaleString() ?? "—" },
  ];
});

// Network status disembunyikan sementara — tidak perlu memuat chain-info.
// onMounted(() => chain.load());

// Tampilan aktif: "sol" = ekosistem Solana, "rh" = Robinhood Chain (EVM).
// Tombol melayang memindah antar keduanya (dulu tombol "Kalkulator manual").
const view = ref("sol");
function toggleView() { view.value = view.value === "sol" ? "rh" : "sol"; }
</script>

<template>
  <main class="page">
    <header class="page__head">
      <p class="eyebrow">{{ view === 'sol' ? 'Solana · DexScreener / RugCheck' : 'Robinhood Chain · EVM' }}</p>
      <h1>{{ view === 'sol' ? 'Screening Memecoin Solana' : 'Screening Robinhood Chain' }}</h1>
      <p class="page__sub">
        Tool Pencari Memecoin dengan teknologi AI Agent menggunakan logic Smart Money Tracking.
      </p>
    </header>

    <!-- ===== Tampilan Solana (ekosistem Solana) — dalam satu kotak, seperti Robinhood ===== -->
    <section v-if="view === 'sol'" class="sol-box" aria-label="Ekosistem Solana">
      <!-- GEM Score (ScreenerPanel) & 10x Radar (RadarPanel) disembunyikan di zona Solana
           atas permintaan. Hidupkan lagi dengan menghapus komentar ini.
      <ScreenerPanel />
      <RadarPanel />
      -->

      <ProRadarPanel />

      <AutopsyPanel />

      <WatchlistPanel />

      <SniperPanel />

      <!-- Checklist screening manual disembunyikan sementara (jangan tampilkan dulu)
      <ChecklistPanel />
      -->
    </section>

    <!-- ===== Tampilan Robinhood Chain (EVM) ===== -->
    <template v-else>
      <RobinhoodPanel />
    </template>

    <!-- Tombol melayang: pindah tampilan Solana ⇄ Robinhood Chain -->
    <button
      type="button"
      class="view-fab"
      :class="view === 'rh' ? 'view-fab--rh' : ''"
      :title="view === 'sol' ? 'Pindah ke Robinhood Chain' : 'Kembali ke Solana'"
      @click="toggleView"
    >
      {{ view === 'sol' ? '⛓️ Ke Robinhood Chain' : '◎ Ke Solana' }}
    </button>

    <!-- Network status disembunyikan sementara (jangan tampilkan dulu)
    <section class="panel" aria-labelledby="chain-h">
      <div class="panel__head">
        <h2 id="chain-h">Network status</h2>
        <AppButton variant="secondary" :loading="chain.loading.value" @click="chain.load()">
          Refresh
        </AppButton>
      </div>
      <p v-if="chain.error.value" class="panel__error" role="alert">{{ chain.error.value }}</p>
      <StatList :items="chainStats" :loading="chain.loading.value" />
    </section>
    -->
  </main>
</template>

<style scoped>
.page {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-6);
  display: grid;
  gap: var(--space-7);
}
.page__head { display: grid; gap: var(--space-3); }
.page__sub { margin: 0; color: var(--text-muted); font-size: var(--font-size-md); }
.eyebrow {
  margin: 0;
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-success);
}

.panel { display: grid; gap: var(--space-6); }
.panel__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); }
.panel__error { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }

/* Kotak pembungkus ekosistem Solana — sejajar dengan kotak Robinhood (.rh),
   aksen hijau. Semua panel Solana di dalamnya. */
.sol-box {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-6);
  background: color-mix(in srgb, var(--text-success) 5%, var(--bg-card));
  border: 1px solid color-mix(in srgb, var(--text-success) 28%, var(--border-default));
  border-radius: var(--radius-lg, 16px);
}
@media (max-width: 560px) {
  .sol-box { padding: var(--space-5); }
}

/* Tombol melayang: pemindah tampilan Solana ⇄ Robinhood Chain */
.view-fab {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: var(--space-6);
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full, 999px);
  color: var(--text-body);
  font: inherit;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  transition: border-color var(--motion-duration-instant) var(--motion-ease),
    transform var(--motion-duration-instant) var(--motion-ease);
}
.view-fab:hover { border-color: var(--text-success); transform: translateX(-50%) translateY(-1px); }
.view-fab:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
/* Di tampilan Robinhood, aksen tombol jadi hijau Robinhood — penanda chain aktif. */
.view-fab--rh { border-color: color-mix(in srgb, #00c805 55%, var(--border-default)); color: #00a804; }
.view-fab--rh:hover { border-color: #00c805; }
</style>
