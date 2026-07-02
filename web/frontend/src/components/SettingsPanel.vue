<script setup>
/**
 * SettingsPanel — slide-over for configuring keys and AI mode at runtime.
 * Keys are POSTed to the proxy and stored SERVER-SIDE only; the browser keeps
 * just a "configured" boolean + masked preview. GET returns status, never secrets.
 */
import { ref, reactive, onMounted } from "vue";
import AppButton from "./AppButton.vue";
import { apiUrl, authHeaders, getAdminToken, setAdminToken } from "../lib/api.js";

const emit = defineEmits(["close", "updated"]);

const status = reactive({
  solscanConfigured: false,
  solscanTier: "unknown",
  aiMode: "api",
  aiProvider: "claude",
  aiConfigured: false,
  model: "claude-fable-5",
  telegramConfigured: false,
});

// Local form state. Secret fields stay blank unless the user types a new value
// (blank = "leave unchanged" on the server).
const form = reactive({ solscanKey: "", aiMode: "api", aiProvider: "claude", aiKey: "", model: "claude-fable-5" });
const saving = ref(false);
const testMsg = reactive({ solscan: "", ai: "" });
const showSolscan = ref(false);
const showAi = ref(false);
// Admin token (only needed when the backend has ADMIN_TOKEN set, e.g. public host).
const adminToken = ref(getAdminToken());
const showAdmin = ref(false);
const saveMsg = ref("");

const MODELS = ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"];

async function load() {
  const r = await fetch(apiUrl("/api/settings"));
  const s = await r.json();
  Object.assign(status, s);
  form.aiMode = s.aiMode;
  form.aiProvider = s.aiProvider;
  form.model = s.model;
}

// Persist the admin token to this browser whenever it changes.
function persistAdminToken() {
  setAdminToken(adminToken.value);
}

async function save() {
  saving.value = true;
  saveMsg.value = "";
  persistAdminToken();
  try {
    const r = await fetch(apiUrl("/api/settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(form),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 401/403 → admin gate. Tell the user to set the admin token.
      saveMsg.value = `⚠️ ${body.error || `Gagal menyimpan (${r.status})`}`;
      return false;
    }
    Object.assign(status, body);
    form.solscanKey = "";
    form.aiKey = "";
    saveMsg.value = "✅ Tersimpan";
    emit("updated", { ...status });
    return true;
  } catch {
    saveMsg.value = "⚠️ Network error — backend tidak terjangkau.";
    return false;
  } finally {
    saving.value = false;
  }
}

async function test(target) {
  testMsg[target] = "Testing…";
  // Save first so the server has the latest values to test against.
  const ok = await save();
  if (!ok) { testMsg[target] = saveMsg.value; return; }
  const r = await fetch(apiUrl("/api/settings/test"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ target }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { testMsg[target] = `⚠️ ${out.error || `Gagal (${r.status})`}`; return; }
  testMsg[target] = `${out.ok ? "✅" : "⚠️"} ${out.detail}`;
  await load();
}

onMounted(load);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <aside class="sheet" role="dialog" aria-label="Settings" aria-modal="true">
      <header class="sheet__head">
        <h2>Settings</h2>
        <AppButton variant="ghost" @click="emit('close')">Close ✕</AppButton>
      </header>

      <!-- Admin access (only needed when the backend sets ADMIN_TOKEN) -->
      <section class="grp">
        <h3>Admin access</h3>
        <p class="hint">
          Hanya perlu jika backend di-host publik dan menyetel <code>ADMIN_TOKEN</code>.
          Token disimpan di browser ini saja dan dikirim sebagai Bearer saat menyimpan/menguji.
        </p>
        <div class="row">
          <input
            class="inp"
            :type="showAdmin ? 'text' : 'password'"
            v-model="adminToken"
            @change="persistAdminToken"
            placeholder="admin token…"
            autocomplete="off"
          />
          <AppButton variant="ghost" @click="showAdmin = !showAdmin">{{ showAdmin ? "Hide" : "Show" }}</AppButton>
        </div>
      </section>

      <!-- Solscan -->
      <section class="grp">
        <div class="grp__head">
          <h3>Solscan API key</h3>
          <span class="pill" :class="status.solscanConfigured ? 'pill--ok' : 'pill--off'">
            {{ status.solscanConfigured ? (status.solscanTier === "pro" ? "✓ Pro" : status.solscanTier === "free" ? "free tier" : "✓ set") : "not configured" }}
          </span>
        </div>
        <p class="hint">Used for all Solana data calls. The screener works without it (DexScreener).</p>
        <div class="row">
          <input
            class="inp"
            :type="showSolscan ? 'text' : 'password'"
            v-model="form.solscanKey"
            placeholder="paste key to replace…"
            autocomplete="off"
          />
          <AppButton variant="ghost" @click="showSolscan = !showSolscan">{{ showSolscan ? "Hide" : "Show" }}</AppButton>
          <AppButton variant="secondary" @click="test('solscan')">Test</AppButton>
        </div>
        <p v-if="testMsg.solscan" class="hint">{{ testMsg.solscan }}</p>
      </section>

      <!-- AI mode -->
      <section class="grp">
        <h3>AI analyst</h3>
        <div class="row">
          <label class="radio"><input type="radio" value="api" v-model="form.aiMode" /> API mode (deployable)</label>
          <label class="radio"><input type="radio" value="local" v-model="form.aiMode" /> Local mode (Claude CLI)</label>
        </div>

        <template v-if="form.aiMode === 'api'">
          <div class="row">
            <label class="lbl">Provider</label>
            <select class="inp" v-model="form.aiProvider">
              <option value="claude">Claude (recommended)</option>
              <option value="openai">OpenAI (not in v1)</option>
              <option value="gemini">Gemini (not in v1)</option>
            </select>
          </div>
          <div class="row">
            <label class="lbl">Model</label>
            <select class="inp" v-model="form.model">
              <option v-for="m in MODELS" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="grp__head">
            <label class="lbl">{{ form.aiProvider }} API key</label>
            <span class="pill" :class="status.aiConfigured ? 'pill--ok' : 'pill--off'">
              {{ status.aiConfigured ? "✓ set" : "not configured" }}
            </span>
          </div>
          <div class="row">
            <input
              class="inp"
              :type="showAi ? 'text' : 'password'"
              v-model="form.aiKey"
              placeholder="paste AI key to replace…"
              autocomplete="off"
            />
            <AppButton variant="ghost" @click="showAi = !showAi">{{ showAi ? "Hide" : "Show" }}</AppButton>
            <AppButton variant="secondary" @click="test('ai')">Test</AppButton>
          </div>
        </template>
        <p v-else class="hint">Local mode runs your Claude Code CLI — no API key, billed to your subscription. Best for personal use.</p>
        <p v-if="testMsg.ai" class="hint">{{ testMsg.ai }}</p>
      </section>

      <footer class="sheet__foot">
        <span class="hint" aria-live="polite">{{ saveMsg }}</span>
        <AppButton :loading="saving" @click="save">Save</AppButton>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 20;
  background: rgba(0,0,0,0.55);
  display: flex; justify-content: flex-end;
}
.sheet {
  width: min(440px, 100%);
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-default);
  padding: var(--space-6);
  overflow-y: auto;
  display: grid;
  gap: var(--space-7);
  align-content: start;
}
.sheet__head, .sheet__foot { display: flex; align-items: center; justify-content: space-between; }
.sheet__head h2 { margin: 0; }

.grp { display: grid; gap: var(--space-4); }
.grp__head { display: flex; align-items: center; justify-content: space-between; }
.grp h3 { margin: 0; font-size: var(--font-size-lg); }
.hint { margin: 0; font-size: var(--font-size-xs); color: var(--text-muted); }
.hint code { font-family: var(--font-family-mono); color: var(--text-body); }
.lbl { font-size: var(--font-size-sm); color: var(--text-body); }

.row { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.inp {
  flex: 1; min-width: 160px;
  height: var(--control-height);
  padding: 0 var(--control-padding-x);
  background: var(--bg-page);
  color: var(--text-body);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  font-family: var(--font-family-stack);
  font-size: var(--font-size-sm);
}
.inp:focus-visible { border-color: var(--border-focus); outline: none; }
.radio { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--text-body); }

.pill {
  font-size: var(--font-size-xs);
  padding: 2px var(--space-4);
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
}
.pill--ok { color: var(--text-success); border-color: var(--text-success); }
.pill--off { color: var(--text-muted); }
</style>
