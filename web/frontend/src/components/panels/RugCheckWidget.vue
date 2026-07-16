<script setup>
/**
 * RugCheckWidget — dashboard layar-penuh pemeriksa keamanan token, meniru
 * bahasa visual demo GMGN aitrader (banner → header+jam → strip KPI → tabel
 * hasil → panel detail kanan → live log). Ditulis ulang dari nol — bukan
 * salinan kode demo (repo aslinya tanpa lisensi).
 *
 *  - FAB pil "rugcheck" di kiri-bawah membuka/menutup dashboard,
 *  - tiap SCAN memanggil GET /api/screen dan menambah baris tabel + log,
 *  - klik baris → detail gate token itu di panel kanan.
 */
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { apiUrl } from "../../lib/api.js";

const open = ref(false);
const mint = ref("");
const loading = ref(false);
const error = ref("");

const rows = ref([]);        // hasil scan menumpuk, terbaru di atas
const selectedId = ref(""); // address baris yang dibuka di panel detail
const logs = ref([]);        // live scan log, terbaru di atas

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- Jam header (UTC, ala demo) --------------------------------------------
const clock = ref("--:--:--Z");
let clockTimer = null;
function tick() {
  clock.value = new Date().toISOString().slice(11, 19) + "Z";
}
onMounted(() => { tick(); clockTimer = setInterval(tick, 1000); });
onBeforeUnmount(() => clockTimer && clearInterval(clockTimer));

const stamp = () => new Date().toISOString().slice(11, 19);
function pushLog(tag, text, cls = "") {
  logs.value.unshift({ t: stamp(), tag, text, cls });
  if (logs.value.length > 60) logs.value.length = 60;
}

// ---- Derivasi gate anti-rug dari liquidityLock (RugCheck) -------------------
const money = (n) => (typeof n === "number" ? "$" + Math.round(n).toLocaleString() : "—");

function deriveGates(l) {
  if (!l) {
    return [{
      name: "DATA RUGCHECK", st: "warn", chip: "NO DATA",
      detail: "RugCheck tidak punya laporan token ini (mungkin terlalu baru) — anggap berisiko tinggi.",
    }];
  }
  const rows = [];
  rows.push(l.rugged
    ? { name: "STATUS RUG", st: "fail", chip: "RUGGED", detail: "Sudah tercatat rug oleh RugCheck — jauhi." }
    : { name: "STATUS RUG", st: "pass", chip: "CLEAN", detail: "Belum tercatat rug." });
  rows.push(l.mintEnabled
    ? { name: "MINT AUTHORITY", st: "fail", chip: "AKTIF", detail: "Dev masih bisa mencetak supply baru kapan saja." }
    : { name: "MINT AUTHORITY", st: "pass", chip: "RENOUNCED", detail: "Supply tidak bisa ditambah." });
  rows.push(l.freezeEnabled
    ? { name: "FREEZE AUTHORITY", st: "fail", chip: "AKTIF", detail: "Dev bisa membekukan token di wallet kamu." }
    : { name: "FREEZE AUTHORITY", st: "pass", chip: "RENOUNCED", detail: "Token tidak bisa dibekukan." });
  const pct = typeof l.lockedPct === "number" ? l.lockedPct : null;
  if (pct != null) {
    rows.push(pct >= 95
      ? { name: "LP LOCK", st: "pass", chip: pct + "%", detail: `Likuiditas terkunci/dibakar — ${money(l.lockedUsd)} dari ${money(l.totalLpUsd)}.` }
      : pct >= 50
        ? { name: "LP LOCK", st: "warn", chip: pct + "%", detail: `Hanya sebagian terkunci (${money(l.lockedUsd)} dari ${money(l.totalLpUsd)}) — sisanya bisa ditarik.` }
        : { name: "LP LOCK", st: "fail", chip: pct + "%", detail: `Nyaris bebas — likuiditas bisa ditarik kapan saja (${money(l.lockedUsd)} dari ${money(l.totalLpUsd)}).` });
  }
  for (const r of l.dangerRisks || []) rows.push({ name: "RUGCHECK DANGER", st: "fail", chip: "FLAG", detail: r });
  return rows;
}

function deriveDecision(l, gates) {
  const fail = gates.filter((g) => g.st === "fail").length;
  const warn = gates.filter((g) => g.st === "warn").length;
  if (!l) return { cls: "warn", label: "NO DATA" };
  if (l.rugged || fail >= 2) return { cls: "fail", label: "AVOID" };
  if (fail === 1 || warn > 0) return { cls: "warn", label: "CAUTION" };
  return { cls: "pass", label: "PASS" };
}

// ---- Aksi scan --------------------------------------------------------------
async function check() {
  const addr = mint.value.trim();
  if (!MINT_RE.test(addr)) {
    error.value = "Alamat token tidak valid (base58 Solana 32–44 karakter).";
    return;
  }
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(apiUrl(`/api/screen?token_address=${addr}`));
    const body = await r.json();
    if (!r.ok) {
      error.value = body?.error || `Gagal memeriksa (${r.status})`;
      pushLog("ERROR", `${addr.slice(0, 8)}… — ${error.value}`, "fail");
      return;
    }
    const gates = deriveGates(body.liquidityLock);
    const decision = deriveDecision(body.liquidityLock, gates);
    const sym = body.token.symbol || addr.slice(0, 6) + "…";
    // Baris baru (address sama → ganti yang lama biar tak dobel).
    rows.value = rows.value.filter((x) => x.report.token.address !== body.token.address);
    rows.value.unshift({ at: stamp(), report: body, gates, decision });
    selectedId.value = body.token.address;
    mint.value = "";
    pushLog("SCAN", `${sym} — ${gates.length} gate dicek, GEM ${body.gemScore}`);
    for (const g of gates.filter((x) => x.st !== "pass")) {
      pushLog("FILTER", `${sym} — ${g.name.toLowerCase()}: ${g.detail}`, g.st);
    }
    pushLog(decision.label, `${sym} — keputusan gerbang keamanan`, decision.cls);
  } catch {
    error.value = "Gangguan jaringan — apakah backend (:8787) jalan?";
  } finally {
    loading.value = false;
  }
}

const selected = computed(() => rows.value.find((x) => x.report.token.address === selectedId.value) || null);
const counts = computed(() => ({
  total: rows.value.length,
  pass: rows.value.filter((x) => x.decision.label === "PASS").length,
  caution: rows.value.filter((x) => x.decision.cls === "warn").length,
  avoid: rows.value.filter((x) => x.decision.label === "AVOID").length,
}));

const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const lockOf = (x) => x.report.liquidityLock || null;
const lpPct = (x) => {
  const l = lockOf(x);
  return l && typeof l.lockedPct === "number" ? l.lockedPct + "%" : "—";
};
</script>

<template>
  <!-- Dashboard layar penuh -->
  <transition name="rc-pop">
    <div v-if="open" class="rc__window" role="dialog" aria-label="RugCheck">
      <!-- Banner atas ala Demo Mode -->
      <div class="rc__banner">
        ⚠ <b>Heuristik on-chain</b> · data RugCheck + DexScreener · gerbang deterministik memeriksa tanda rug — bukan fitur trading
      </div>

      <!-- Header bar -->
      <div class="rc__bar">
        <div class="rc__brand">
          <span class="rc__brand-ic" aria-hidden="true">🛡️</span>
          <div class="rc__brand-tx">
            <b>RUGCHECK <span class="rc__sep">//</span> Token Safety Scan</b>
            <small>gerbang deterministik · LP lock · mint/freeze authority · flag bahaya</small>
          </div>
        </div>
        <div class="rc__bar-right">
          <span class="rc__clock">{{ clock }}</span>
          <span class="rc__pill"><i class="rc__dot" aria-hidden="true"></i> CHAIN <b>SOL</b></span>
          <span class="rc__pill">SCANNED <b>{{ counts.total }}</b></span>
          <button class="rc__close" type="button" title="Tutup" aria-label="Tutup RugCheck" @click="open = false">✕</button>
        </div>
      </div>

      <div class="rc__scroll">
        <!-- Strip KPI -->
        <div class="rc__kpis">
          <div class="rc__kpi">
            <small>⌕ Total scanned</small>
            <b>{{ counts.total }}</b>
            <span>sesi ini</span>
          </div>
          <div class="rc__kpi rc__kpi--pass">
            <small>◎ Pass</small>
            <b>{{ counts.pass }}</b>
            <span>semua gate lolos</span>
          </div>
          <div class="rc__kpi rc__kpi--warn">
            <small>⚠ Caution</small>
            <b>{{ counts.caution }}</b>
            <span>ada tanda bahaya</span>
          </div>
          <div class="rc__kpi rc__kpi--fail">
            <small>⛔ Avoid</small>
            <b>{{ counts.avoid }}</b>
            <span>risiko rug tinggi</span>
          </div>
          <div class="rc__kpi">
            <small>◈ GEM terakhir</small>
            <b>{{ rows[0] ? rows[0].report.gemScore : "—" }}</b>
            <span>{{ rows[0] ? rows[0].report.verdict.label : "menunggu scan" }}</span>
          </div>
          <div class="rc__kpi" :class="rows[0] ? 'rc__kpi--' + rows[0].decision.cls : ''">
            <small>◍ Decision terakhir</small>
            <b>{{ rows[0] ? rows[0].decision.label : "—" }}</b>
            <span>{{ rows[0] ? (rows[0].report.token.symbol || "") : "menunggu scan" }}</span>
          </div>
        </div>

        <!-- Grid utama: tabel hasil + detail kanan -->
        <div class="rc__main">
          <!-- Tabel hasil scan -->
          <section class="rc__sect">
            <div class="rc__sect-head">
              <span>≡ Scan Results · klik baris untuk detail</span>
              <form class="rc__form" @submit.prevent="check">
                <input
                  v-model="mint"
                  class="rc__input"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="alamat mint Solana…"
                  aria-label="Alamat token (mint)"
                  :disabled="loading"
                />
                <button class="rc__go" type="submit" :disabled="loading">
                  {{ loading ? "SCANNING…" : "⚡ SCAN" }}
                </button>
              </form>
            </div>

            <p v-if="error" class="rc__error" role="alert">⚠ {{ error }}</p>

            <div v-if="rows.length" class="rc__tablewrap">
              <table class="rc__table">
                <thead>
                  <tr>
                    <th>TOKEN</th>
                    <th>GATES</th>
                    <th>LP</th>
                    <th>MINT</th>
                    <th>FREEZE</th>
                    <th>GEM</th>
                    <th>DECISION</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="x in rows"
                    :key="x.report.token.address"
                    :class="{ 'rc__tr--sel': x.report.token.address === selectedId }"
                    @click="selectedId = x.report.token.address"
                  >
                    <td>
                      <div class="rc__cell-token">
                        <img v-if="x.report.token.logoUrl" class="rc__logo" :src="x.report.token.logoUrl" alt="" />
                        <div class="rc__cell-id">
                          <b>{{ x.report.token.symbol || "?" }}</b>
                          <small>{{ shortAddr(x.report.token.address) }} · {{ x.at }}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="rc__gicons">
                        <i
                          v-for="(g, i) in x.gates" :key="i"
                          class="rc__gicon" :class="'rc__gicon--' + g.st"
                          :title="g.name + ': ' + g.chip"
                        >{{ g.st === "pass" ? "✓" : g.st === "warn" ? "!" : "✗" }}</i>
                      </span>
                    </td>
                    <td class="rc__num">{{ lpPct(x) }}</td>
                    <td>
                      <span v-if="lockOf(x)" :class="lockOf(x).mintEnabled ? 'rc__bad' : 'rc__ok'">
                        {{ lockOf(x).mintEnabled ? "aktif" : "✓ renounced" }}
                      </span><span v-else>—</span>
                    </td>
                    <td>
                      <span v-if="lockOf(x)" :class="lockOf(x).freezeEnabled ? 'rc__bad' : 'rc__ok'">
                        {{ lockOf(x).freezeEnabled ? "aktif" : "✓ renounced" }}
                      </span><span v-else>—</span>
                    </td>
                    <td class="rc__num">{{ x.report.gemScore }}</td>
                    <td><span class="rc__chip" :class="'rc__chip--' + x.decision.cls">{{ x.decision.label }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else-if="!error" class="rc__empty">
              Belum ada token discan. Tempel alamat mint di kanan atas tabel lalu tekan <b>⚡ SCAN</b>.
            </p>
          </section>

          <!-- Panel detail kanan (ala Position Escape Monitor) -->
          <aside class="rc__sect rc__detail">
            <div class="rc__sect-head"><span>🔎 Gate Detail</span></div>
            <template v-if="selected">
              <div class="rc__d-token">
                <img v-if="selected.report.token.logoUrl" class="rc__logo" :src="selected.report.token.logoUrl" alt="" />
                <b>{{ selected.report.token.symbol || "?" }}</b>
                <span class="rc__chip" :class="'rc__chip--' + selected.decision.cls">{{ selected.decision.label }}</span>
                <a
                  v-if="selected.report.token.url" class="rc__ext"
                  :href="selected.report.token.url" target="_blank" rel="noopener noreferrer"
                >chart ↗</a>
              </div>
              <code class="rc__d-addr" :title="selected.report.token.address">{{ selected.report.token.address }}</code>
              <ul class="rc__d-gates">
                <li v-for="(g, i) in selected.gates" :key="i" class="rc__d-gate" :class="'rc__d-gate--' + g.st">
                  <div class="rc__d-gate-top">
                    <span class="rc__d-gate-name">{{ g.name }}</span>
                    <span class="rc__chip" :class="'rc__chip--' + g.st">{{ g.chip }}</span>
                  </div>
                  <p class="rc__d-gate-tx">{{ g.detail }}</p>
                </li>
              </ul>
              <p v-if="lockOf(selected)" class="rc__d-lp">
                LP total {{ money(lockOf(selected).totalLpUsd) }} · terkunci {{ money(lockOf(selected).lockedUsd) }}
                ({{ lockOf(selected).status }}) · sumber RugCheck
              </p>
            </template>
            <p v-else class="rc__empty">Scan sebuah token — rincian tiap gate muncul di sini.</p>
          </aside>
        </div>

        <!-- Live scan log -->
        <section class="rc__sect">
          <div class="rc__sect-head"><span>⌁ Live Scan Log</span></div>
          <div v-if="logs.length" class="rc__log">
            <div v-for="(l, i) in logs" :key="i" class="rc__log-line">
              <span class="rc__log-t">{{ l.t }}</span>
              <span class="rc__log-tag" :class="'rc__log-tag--' + (l.cls || 'info')">{{ l.tag }}</span>
              <span class="rc__log-tx">{{ l.text }}</span>
            </div>
          </div>
          <p v-else class="rc__empty">Log scan muncul di sini — SCAN / FILTER / keputusan tiap token.</p>
        </section>
      </div>
    </div>
  </transition>

  <!-- FAB pil kiri-bawah -->
  <button
    class="rc__fab"
    type="button"
    :class="{ 'rc__fab--open': open }"
    :aria-expanded="open"
    :aria-label="open ? 'Tutup RugCheck' : 'Buka RugCheck'"
    @click="open = !open"
  >
    <span aria-hidden="true">🛡️</span> rugcheck
  </button>
</template>

<style scoped>
/* ---- FAB pil (kiri-bawah) ---- */
.rc__fab {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 18px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-on-accent);
  background: var(--bg-accent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease, background 0.15s ease;
}
.rc__fab:hover { transform: scale(1.04); background: var(--bg-accent-hover); }
.rc__fab:active { transform: scale(0.97); }
.rc__fab:focus-visible { outline: 3px solid var(--border-focus); outline-offset: 3px; }
.rc__fab--open { background: var(--bg-raised); color: var(--text-body); border: 1px solid var(--border-default); }

/* ---- Dashboard layar penuh ---- */
.rc__window {
  position: fixed;
  inset: 12px;
  z-index: 1000;
  display: grid;
  grid-template-rows: auto auto 1fr;
  background: var(--bg-page);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.65);
  overflow: hidden;
}

/* Banner atas ala "Demo Mode" */
.rc__banner {
  padding: var(--space-3) var(--space-5);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rc__banner b { color: var(--text-body); }

/* Header bar */
.rc__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
}
.rc__brand { display: flex; align-items: center; gap: var(--space-4); min-width: 0; }
.rc__brand-ic {
  flex: none; display: grid; place-items: center;
  width: 38px; height: 38px; font-size: 19px;
  background: var(--bg-accent); border-radius: var(--radius-sm);
}
.rc__brand-tx { display: grid; min-width: 0; }
.rc__brand-tx b {
  color: var(--text-body); font-size: var(--font-size-lg);
  letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rc__sep { color: var(--text-success); }
.rc__brand-tx small {
  color: var(--text-muted); font-size: var(--font-size-xs);
  font-family: var(--font-family-mono); letter-spacing: 0.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rc__bar-right { display: flex; align-items: center; gap: var(--space-3); flex: none; }
.rc__clock {
  font-family: var(--font-family-mono); font-weight: 700;
  font-size: var(--font-size-lg); color: var(--text-body); letter-spacing: 0.05em;
}
.rc__pill {
  display: flex; align-items: center; gap: 6px;
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
  color: var(--text-muted); letter-spacing: 0.05em;
  background: var(--bg-raised); border: 1px solid var(--border-default);
  border-radius: var(--radius-sm); white-space: nowrap;
}
.rc__pill b { color: var(--text-body); }
.rc__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-success); }
.rc__close {
  width: 32px; height: 32px;
  border: 1px solid var(--border-default); background: var(--bg-raised); cursor: pointer;
  color: var(--text-muted); border-radius: var(--radius-sm);
  font-size: 14px; line-height: 1;
}
.rc__close:hover { color: var(--text-body); border-color: var(--text-success); }
.rc__close:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }

/* Area scroll konten */
.rc__scroll {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
  display: grid;
  gap: var(--space-5);
  align-content: start;
}

/* Strip KPI */
.rc__kpis {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-3);
}
.rc__kpi {
  display: grid; gap: 2px; align-content: start;
  padding: var(--space-4);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
.rc__kpi small {
  color: var(--text-muted); font-size: var(--font-size-xs);
  font-family: var(--font-family-mono); letter-spacing: 0.04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rc__kpi b {
  color: var(--text-body); font-size: var(--font-size-xl); line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.rc__kpi span {
  color: var(--text-muted); font-size: var(--font-size-xs);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rc__kpi--pass b { color: var(--text-success); }
.rc__kpi--pass { border-bottom: 2px solid var(--text-success); }
.rc__kpi--warn b { color: var(--text-warning); }
.rc__kpi--warn { border-bottom: 2px solid var(--text-warning); }
.rc__kpi--fail b { color: var(--text-error); }
.rc__kpi--fail { border-bottom: 2px solid var(--text-error); }

/* Grid utama */
.rc__main {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
  gap: var(--space-5);
  align-items: start;
}

/* Seksi berbingkai */
.rc__sect {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-card);
}
.rc__sect-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-body); font-size: var(--font-size-xs); font-weight: 700;
  font-family: var(--font-family-mono); letter-spacing: 0.06em; text-transform: uppercase;
}

/* Form scan di header tabel */
.rc__form { display: flex; gap: var(--space-2); flex: 1 1 auto; max-width: 420px; }
.rc__input {
  flex: 1 1 auto; min-width: 0; padding: var(--space-2) var(--space-3);
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
  background: var(--bg-page); color: var(--text-body);
  border: 1px solid var(--border-default); border-radius: var(--radius-xs);
}
.rc__input::placeholder { color: var(--text-muted); }
.rc__input:hover:not(:disabled) { border-color: var(--text-success); }
.rc__input:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.rc__go {
  flex: none; padding: var(--space-2) var(--space-4);
  font: inherit; font-weight: 700; font-size: var(--font-size-xs); letter-spacing: 0.05em;
  cursor: pointer; border: 1px solid transparent; border-radius: var(--radius-xs);
  background: var(--bg-accent); color: var(--text-on-accent);
}
.rc__go:hover:not(:disabled) { background: var(--bg-accent-hover); }
.rc__go:disabled { opacity: 0.55; cursor: not-allowed; }
.rc__go:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

.rc__error {
  margin: var(--space-4); padding: var(--space-3) var(--space-4);
  color: var(--text-error); font-size: var(--font-size-sm);
  font-family: var(--font-family-mono);
  border: 1px solid color-mix(in srgb, var(--text-error) 45%, transparent);
  border-radius: var(--radius-sm);
}

/* Tabel hasil */
.rc__tablewrap { overflow-x: auto; }
.rc__table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.rc__table th {
  padding: var(--space-3) var(--space-4); text-align: left;
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
  font-weight: 700; letter-spacing: 0.06em; color: var(--text-muted);
  border-bottom: 1px solid var(--border-default); white-space: nowrap;
}
.rc__table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-body); white-space: nowrap; vertical-align: middle;
}
.rc__table tbody tr { cursor: pointer; }
.rc__table tbody tr:hover td { background: var(--bg-raised); }
.rc__tr--sel td { background: var(--bg-raised); }
.rc__table tbody tr:last-child td { border-bottom: none; }
.rc__cell-token { display: flex; align-items: center; gap: var(--space-3); }
.rc__logo { width: 24px; height: 24px; border-radius: 50%; flex: none; }
.rc__cell-id { display: grid; }
.rc__cell-id b { font-size: var(--font-size-sm); }
.rc__cell-id small {
  color: var(--text-muted); font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
}
.rc__num { font-family: var(--font-family-mono); font-variant-numeric: tabular-nums; }
.rc__ok { color: var(--text-success); font-size: var(--font-size-xs); }
.rc__bad { color: var(--text-error); font-size: var(--font-size-xs); font-weight: 700; }

/* Deret ikon gate mini (ala kolom RULE→RANK→LLM) */
.rc__gicons { display: inline-flex; gap: 4px; }
.rc__gicon {
  display: grid; place-items: center;
  width: 20px; height: 20px; font-style: normal;
  font-size: 11px; font-weight: 700; border-radius: var(--radius-xs);
  border: 1px solid var(--border-default); cursor: help;
}
.rc__gicon--pass {
  color: var(--text-success);
  border-color: color-mix(in srgb, var(--text-success) 55%, transparent);
  background: color-mix(in srgb, var(--text-success) 12%, transparent);
}
.rc__gicon--warn {
  color: var(--text-warning);
  border-color: color-mix(in srgb, var(--text-warning) 55%, transparent);
  background: color-mix(in srgb, var(--text-warning) 12%, transparent);
}
.rc__gicon--fail {
  color: var(--text-error);
  border-color: color-mix(in srgb, var(--text-error) 55%, transparent);
  background: color-mix(in srgb, var(--text-error) 12%, transparent);
}

/* Chip keputusan */
.rc__chip {
  font-family: var(--font-family-mono); font-size: var(--font-size-xs); font-weight: 700;
  letter-spacing: 0.05em; padding: 2px 9px; border-radius: var(--radius-xs);
  border: 1px solid var(--border-default); white-space: nowrap;
}
.rc__chip--pass {
  color: var(--text-on-accent); background: var(--bg-accent); border-color: transparent;
}
.rc__chip--warn {
  color: var(--text-warning);
  border-color: color-mix(in srgb, var(--text-warning) 55%, transparent);
  background: color-mix(in srgb, var(--text-warning) 12%, transparent);
}
.rc__chip--fail {
  color: var(--text-error);
  border-color: color-mix(in srgb, var(--text-error) 55%, transparent);
  background: color-mix(in srgb, var(--text-error) 12%, transparent);
}

/* Panel detail kanan */
.rc__detail { display: grid; align-content: start; }
.rc__d-token {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-4) 0;
}
.rc__d-token b { font-size: var(--font-size-md); }
.rc__ext { margin-left: auto; color: var(--text-link); font-size: var(--font-size-xs); text-decoration: none; }
.rc__ext:hover { color: var(--text-link-hover); text-decoration: underline; }
.rc__ext:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.rc__d-addr {
  margin: var(--space-2) var(--space-4) 0;
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
  color: var(--text-muted); word-break: break-all; display: block;
}
.rc__d-gates {
  list-style: none; margin: 0; padding: var(--space-4);
  display: grid; gap: var(--space-3);
}
.rc__d-gate {
  padding: var(--space-3) var(--space-4);
  background: var(--bg-page);
  border: 1px solid var(--border-default);
  border-left-width: 3px;
  border-radius: var(--radius-xs);
}
.rc__d-gate--pass { border-left-color: var(--text-success); }
.rc__d-gate--warn { border-left-color: var(--text-warning); }
.rc__d-gate--fail { border-left-color: var(--text-error); }
.rc__d-gate-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.rc__d-gate-name {
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
  color: var(--text-muted); letter-spacing: 0.04em;
}
.rc__d-gate-tx { margin: var(--space-2) 0 0; font-size: var(--font-size-sm); color: var(--text-body); line-height: 1.45; }
.rc__d-lp {
  margin: 0; padding: 0 var(--space-4) var(--space-4);
  color: var(--text-muted); font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
}

/* Live scan log */
.rc__log { display: grid; max-height: 200px; overflow-y: auto; }
.rc__log-line {
  display: grid;
  grid-template-columns: 78px 84px 1fr;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  font-family: var(--font-family-mono); font-size: var(--font-size-xs);
}
.rc__log-line:last-child { border-bottom: none; }
.rc__log-t { color: var(--text-muted); }
.rc__log-tag { font-weight: 700; letter-spacing: 0.04em; }
.rc__log-tag--info { color: var(--text-success); }
.rc__log-tag--pass { color: var(--text-success); }
.rc__log-tag--warn { color: var(--text-warning); }
.rc__log-tag--fail { color: var(--text-error); }
.rc__log-tx { color: var(--text-muted); line-height: 1.45; }

.rc__empty {
  margin: 0; padding: var(--space-5);
  color: var(--text-muted); font-size: var(--font-size-sm); line-height: 1.5;
}
.rc__empty b { color: var(--text-body); }

/* Animasi buka/tutup */
.rc-pop-enter-active, .rc-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.rc-pop-enter-from, .rc-pop-leave-to { opacity: 0; transform: translateY(12px) scale(0.985); }

@media (max-width: 900px) {
  .rc__kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rc__main { grid-template-columns: 1fr; }
  .rc__sect-head { flex-wrap: wrap; }
  .rc__form { max-width: none; flex-basis: 100%; }
}
@media (max-width: 560px) {
  .rc__window { inset: 8px; }
  .rc__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rc__bar-right .rc__pill { display: none; }
  .rc__fab { left: 16px; bottom: 16px; padding: 10px 14px; }
}
</style>
