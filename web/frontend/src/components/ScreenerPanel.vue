<script setup>
/**
 * ScreenerPanel — runs the GEM Score™ screener for a single token and renders
 * the score, pillar breakdown, verdict, a Telegram-alert action, and a Trojan
 * buy deep-link. Talks to the Express proxy (/api/screen, /api/screen-and-alert)
 * so no API key ever reaches the browser. Trojan stays a manual deep-link —
 * the UI never handles a wallet or private key.
 */
import { ref, computed } from "vue";
import AppButton from "./AppButton.vue";
import AppInput from "./AppInput.vue";

// USDC mint as a safe, always-listed default so the panel demos out-of-the-box.
const address = ref("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const inputError = ref("");
const loading = ref(false);
const error = ref("");
const report = ref(null);

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const verdictColor = computed(() => {
  const l = report.value?.verdict?.label;
  if (l === "STRONG") return "var(--text-success)";
  if (l === "WATCH") return "var(--text-warning)";
  if (l === "SKIP") return "var(--text-error)";
  return "var(--text-muted)";
});

// Liquidity-lock summary (from RugCheck). Drives the dedicated lock badge.
const lock = computed(() => report.value?.liquidityLock || null);
const lockColor = computed(() => {
  const p = lock.value?.lockedPct;
  if (p == null) return "var(--text-muted)";
  if (p >= 95) return "var(--text-success)";
  if (p >= 50) return "var(--text-warning)";
  return "var(--text-error)";
});
const lockIcon = computed(() => {
  const p = lock.value?.lockedPct;
  if (p == null) return "🔓";
  if (p >= 95) return "🔒";
  if (p >= 50) return "🔐";
  return "⚠️";
});
const usd = (n) =>
  typeof n === "number" ? "$" + Math.round(n).toLocaleString() : "—";

// DexScreener embeddable chart for the deepest pair of the searched token.
const chartUrl = computed(() => report.value?.token?.chartUrl || null);

function validate() {
  const v = address.value.trim();
  if (!SOLANA_ADDR.test(v)) {
    inputError.value = "Enter a valid Solana mint (base58, 32–44 chars).";
    return null;
  }
  inputError.value = "";
  return v;
}

async function screen() {
  const v = validate();
  if (!v) return;
  loading.value = true;
  error.value = "";
  report.value = null;
  try {
    const res = await fetch(`/api/screen?token_address=${encodeURIComponent(v)}`);
    const body = await res.json();
    if (!res.ok) {
      error.value = body?.error || `Request failed (${res.status})`;
    } else {
      report.value = body;
    }
  } catch {
    error.value = "Network error — is the proxy running on :8787?";
  } finally {
    loading.value = false;
  }
}

</script>

<template>
  <section class="panel" aria-labelledby="screener-h">
    <div class="panel__head">
      <div>
        <h2 id="screener-h">GEM Score™ Screener</h2>
        <p class="panel__sub">
          Heuristic 0–100 score from live DexScreener market data. Not financial advice.
        </p>
      </div>
    </div>

    <form class="lookup" @submit.prevent="screen">
      <AppInput
        id="screener-address"
        v-model="address"
        label="Token mint address"
        placeholder="e.g. EPjFWdd5Aufq…TDt1v"
        :error="inputError"
        @submit="screen"
      />
      <AppButton type="submit" :loading="loading">Screen</AppButton>
    </form>

    <p v-if="error" class="panel__error" role="alert">{{ error }}</p>

    <div v-if="report" class="result">
      <!-- Score + verdict -->
      <div class="score">
        <div class="score__ring" :style="{ '--c': verdictColor, '--c-pct': report.gemScore }">
          <span class="score__num">{{ report.gemScore }}</span>
          <span class="score__den">/100</span>
        </div>
        <div class="score__meta">
          <p class="score__name">
            {{ report.token.name }} <span class="score__sym">({{ report.token.symbol }})</span>
          </p>
          <p class="score__verdict" :style="{ color: verdictColor }">
            {{ report.verdict.emoji }} {{ report.verdict.label }} — {{ report.verdict.action }}
          </p>
          <p class="score__price" v-if="report.token.priceUsd">
            Price: ${{ report.token.priceUsd }}
          </p>
          <p class="score__src">
            Holder data: {{ report.holdersEnriched ? "Solscan ✓" : "n/a (DexScreener only)" }}
          </p>
        </div>
      </div>

      <!-- DexScreener live chart -->
      <div class="chart" v-if="chartUrl">
        <div class="chart__head">
          <span class="chart__title">📊 {{ report.token.symbol }} chart</span>
          <a class="chart__open" :href="report.token.url" target="_blank" rel="noopener">
            Open on DexScreener ↗
          </a>
        </div>
        <div class="chart__frame">
          <iframe
            :src="chartUrl"
            :title="`${report.token.symbol} price chart on DexScreener`"
            loading="lazy"
            allow="clipboard-write"
            referrerpolicy="no-referrer"
          />
        </div>
      </div>
      <p class="chart__na" v-else>📊 Chart unavailable — no DexScreener pair found for this token.</p>

      <!-- Liquidity lock badge -->
      <div class="lock" :style="{ '--lc': lockColor }">
        <div class="lock__top">
          <span class="lock__title">
            <span class="lock__icon" aria-hidden="true">{{ lockIcon }}</span>
            Liquidity Locked
          </span>
          <span class="lock__pct">
            {{ lock ? lock.lockedPct + "%" : "n/a" }}
          </span>
        </div>
        <div
          v-if="lock"
          class="lock__bar"
          role="progressbar"
          :aria-valuenow="lock.lockedPct"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="lock__fill" :style="{ width: lock.lockedPct + '%' }" />
        </div>
        <p class="lock__meta" v-if="lock">
          {{ lock.status }} · {{ usd(lock.lockedUsd) }} of {{ usd(lock.totalLpUsd) }} LP locked
          <span class="lock__src">· {{ lock.source }}</span>
        </p>
        <p class="lock__meta" v-else>
          RugCheck data unavailable for this token (neutral score applied).
        </p>
      </div>

      <!-- Pillars -->
      <ul class="pillars">
        <li v-for="p in report.pillars" :key="p.name" class="pillar">
          <div class="pillar__head">
            <span class="pillar__name">{{ p.name }}</span>
            <span class="pillar__val">{{ p.score }} / {{ p.weight }}</span>
          </div>
          <div class="pillar__bar" role="progressbar" :aria-valuenow="p.score" :aria-valuemax="p.weight">
            <div class="pillar__fill" :style="{ width: (p.score / p.weight) * 100 + '%' }" />
          </div>
          <ul class="pillar__reasons">
            <li v-for="(r, i) in p.reasons" :key="i">{{ r }}</li>
          </ul>
        </li>
      </ul>

      <!-- Actions -->
      <div class="actions">
        <a class="link link--buy" :href="report.trojanLink" target="_blank" rel="noopener">
          🤖 Buy via Trojan
        </a>
      </div>

      <p class="disclaimer">{{ report.disclaimer }}</p>
    </div>
  </section>
</template>

<style scoped>
.panel { display: grid; gap: var(--space-6); }
.panel__head { display: flex; justify-content: space-between; gap: var(--space-6); }
.panel__sub { margin: var(--space-2) 0 0; color: var(--text-muted); font-size: var(--font-size-sm); }
.panel__error { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.panel__note { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

.lookup { display: flex; align-items: flex-end; gap: var(--space-5); flex-wrap: wrap; }
.lookup > :first-child { flex: 1; min-width: 240px; }

.result { display: grid; gap: var(--space-6); }

.score { display: flex; align-items: center; gap: var(--space-6); }
.score__ring {
  display: grid;
  place-items: center;
  width: 96px; height: 96px;
  border-radius: 50%;
  background:
    radial-gradient(closest-side, var(--bg-card) 78%, transparent 79%),
    conic-gradient(var(--c) calc(var(--c-pct, 0) * 1%), var(--border-default) 0);
  border: 1px solid var(--border-default);
}
.score__num { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-heading); }
.score__den { font-size: var(--font-size-xs); color: var(--text-muted); margin-top: -4px; }
.score__meta { display: grid; gap: var(--space-2); }
.score__name { margin: 0; font-size: var(--font-size-lg); color: var(--text-heading); font-weight: var(--font-weight-medium); }
.score__sym { color: var(--text-muted); }
.score__verdict { margin: 0; font-weight: var(--font-weight-medium); }
.score__price, .score__src { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }

.chart { display: grid; gap: var(--space-3); }
.chart__head { display: flex; justify-content: space-between; align-items: baseline; }
.chart__title { color: var(--text-heading); font-weight: var(--font-weight-medium); }
.chart__open { color: var(--text-link); text-decoration: none; font-size: var(--font-size-sm); }
.chart__open:hover { color: var(--text-link-hover); }
.chart__frame {
  position: relative;
  width: 100%;
  /* 16:10-ish responsive height, capped for big screens */
  aspect-ratio: 16 / 10;
  max-height: 460px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-raised);
}
.chart__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.chart__na { margin: 0; font-size: var(--font-size-sm); color: var(--text-muted); }

.lock {
  display: grid; gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--lc);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
}
.lock__top { display: flex; justify-content: space-between; align-items: center; }
.lock__title { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-heading); font-weight: var(--font-weight-medium); }
.lock__icon { font-size: var(--font-size-lg); }
.lock__pct { color: var(--lc); font-weight: var(--font-weight-bold); font-variant-numeric: tabular-nums; }
.lock__bar { height: 8px; border-radius: var(--radius-xs); background: var(--bg-card); overflow: hidden; }
.lock__fill { height: 100%; background: var(--lc); }
.lock__meta { margin: 0; font-size: var(--font-size-xs); color: var(--text-muted); }
.lock__src { opacity: 0.8; }

.pillars { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-5); }
.pillar__head { display: flex; justify-content: space-between; font-size: var(--font-size-sm); }
.pillar__name { color: var(--text-body); font-weight: var(--font-weight-medium); }
.pillar__val { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pillar__bar {
  margin: var(--space-2) 0;
  height: 8px; border-radius: var(--radius-xs);
  background: var(--bg-raised); overflow: hidden;
}
.pillar__fill { height: 100%; background: var(--bg-accent); }
.pillar__reasons { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.pillar__reasons li { font-size: var(--font-size-xs); color: var(--text-muted); }

.actions { display: flex; gap: var(--space-5); flex-wrap: wrap; }
.link { color: var(--text-link); text-decoration: none; font-size: var(--font-size-sm); }
.link:hover { color: var(--text-link-hover); }
.link--buy {
  padding: var(--space-2) var(--space-5);
  border: 1px solid #16a34a; border-radius: var(--radius-sm);
  background: #16a34a; color: #fff; font-weight: var(--font-weight-medium);
}
.link--buy:hover { background: #15803d; color: #fff; }

.disclaimer { margin: 0; font-size: var(--font-size-xs); color: var(--text-muted); font-style: italic; }

@media (max-width: 560px) {
  .lookup { flex-direction: column; align-items: stretch; }
  .score { flex-direction: column; text-align: center; }
}
</style>
