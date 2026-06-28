<script setup>
import { computed } from "vue";
import AppButton from "../components/AppButton.vue";
import StatList from "../components/StatList.vue";
import ScreenerPanel from "../components/ScreenerPanel.vue";
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
</script>

<template>
  <main class="page">
    <header class="page__head">
      <h1>Solana Token Screener</h1>
      <p class="page__sub">TOKEN lookup</p>
    </header>

    <ScreenerPanel />

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

.panel { display: grid; gap: var(--space-6); }
.panel__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); }
.panel__error { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
</style>
