<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import AppButton from "../components/ui/AppButton.vue";
import StatList from "../components/ui/StatList.vue";
import ScreenerPanel from "../components/panels/ScreenerPanel.vue";
import RadarPanel from "../components/panels/RadarPanel.vue";
import ProRadarPanel from "../components/panels/ProRadarPanel.vue";
import AutopsyPanel from "../components/panels/AutopsyPanel.vue";
import WatchlistPanel from "../components/panels/WatchlistPanel.vue";
import SniperPanel from "../components/panels/SniperPanel.vue";
import ManualScoringPanel from "../components/panels/ManualScoringPanel.vue";
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

// Kalkulator manual melayang: tampil saat tombol "Kalkulator manual" ditekan.
const showCalc = ref(false);
function openCalc() { showCalc.value = true; }
function closeCalc() { showCalc.value = false; }

function onKeydown(e) {
  if (e.key === "Escape" && showCalc.value) closeCalc();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <main class="page">
    <header class="page__head">
      <p class="eyebrow">Solana · DexScreener / RugCheck</p>
      <h1>Screening Memecoin Solana</h1>
      <p class="page__sub">
        Tool Pencari Memecoin dengan teknologi AI Agent menggunakan logic Smart Money Tracking.
      </p>
    </header>

    <ScreenerPanel />

    <RadarPanel />

    <ProRadarPanel />

    <AutopsyPanel />

    <WatchlistPanel />

    <SniperPanel />

    <!-- Checklist screening manual disembunyikan sementara (jangan tampilkan dulu)
    <ChecklistPanel />
    -->

    <!-- Tombol melayang: tekan untuk membuka Kalkulator manual -->
    <button
      type="button"
      class="calc-fab"
      :aria-expanded="showCalc"
      aria-haspopup="dialog"
      @click="openCalc"
    >
      🧮 Kalkulator manual
    </button>

    <!-- Panel Kalkulator manual melayang (drawer) -->
    <Teleport to="body">
      <div v-if="showCalc" class="calc-overlay" @click.self="closeCalc">
        <div class="calc-drawer" role="dialog" aria-modal="true" aria-labelledby="calc-drawer-h">
          <div class="calc-drawer__head">
            <h2 id="calc-drawer-h">🧮 Kalkulator manual</h2>
            <button type="button" class="calc-drawer__close" aria-label="Tutup" @click="closeCalc">✕</button>
          </div>
          <div class="calc-drawer__body">
            <ManualScoringPanel />
          </div>
        </div>
      </div>
    </Teleport>

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
.page__divider { height: 1px; background: var(--border-default); margin: var(--space-3) 0; }
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

/* Tombol melayang pembuka Kalkulator manual */
.calc-fab {
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
.calc-fab:hover { border-color: var(--text-success); transform: translateX(-50%) translateY(-1px); }
.calc-fab:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

/* Overlay + drawer melayang */
.calc-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}
.calc-drawer {
  width: min(560px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base, var(--bg-card));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 16px);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.calc-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border-default);
}
.calc-drawer__head h2 { margin: 0; font-size: var(--font-size-lg); }
.calc-drawer__close {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
}
.calc-drawer__close:hover { border-color: var(--text-error); color: var(--text-error); }
.calc-drawer__close:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.calc-drawer__body { flex: 1; overflow-y: auto; padding: var(--space-6); }

@media (max-width: 560px) {
  .calc-overlay { padding: var(--space-4); }
  .calc-drawer { width: 100%; max-height: 92vh; }
}
</style>
