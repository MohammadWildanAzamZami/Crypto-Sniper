<script setup>
/**
 * ChatPanel — the sidebar AI analyst. Sends the chat history to /api/chat and
 * renders the streamed reply (text deltas + tool-call chips). The Anthropic key
 * never reaches here; the proxy holds it. Includes a Settings slide-over.
 *
 * States: empty (suggested prompts), streaming (typing indicator + chips),
 * error (inline, never crashes), disabled (no key → hint to open Settings).
 */
import { ref, reactive, nextTick, onMounted } from "vue";
import ChatMessage from "./ChatMessage.vue";
import ChatComposer from "./ChatComposer.vue";
import SettingsPanel from "./SettingsPanel.vue";
import AppButton from "./AppButton.vue";

// items: { kind:'msg', role, text } | { kind:'tool', name, status, isError } | { kind:'error', text }
const items = ref([]);
const streaming = ref(false);
const showSettings = ref(false);
const status = reactive({ aiMode: "api", aiConfigured: false, model: "" });
const scroller = ref(null);

const SUGGESTIONS = [
  "Screen this token: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Who are the top holders of DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?",
  "What's the current Solana network status?",
];

async function loadStatus() {
  try {
    const s = await (await fetch("/api/settings")).json();
    Object.assign(status, s);
  } catch { /* offline; composer still usable, errors surface on send */ }
}

function historyForApi() {
  return items.value
    .filter((it) => it.kind === "msg")
    .map((it) => ({ role: it.role, content: it.text }));
}

async function scrollDown() {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}

async function send(text) {
  if (streaming.value) return;
  items.value.push({ kind: "msg", role: "user", text });
  streaming.value = true;
  scrollDown();

  const payload = { messages: historyForApi() };
  let assistant = null; // current streaming assistant msg item

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      items.value.push({ kind: "error", text: body.error || `Request failed (${res.status})` });
      streaming.value = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const ev of events) {
        const line = ev.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line.slice(5).trim()); } catch { continue; }
        handleEvent(msg, () => assistant, (a) => (assistant = a));
        scrollDown();
      }
    }
  } catch (e) {
    items.value.push({ kind: "error", text: "Network error — is the proxy running on :8787?" });
  } finally {
    streaming.value = false;
    scrollDown();
  }
}

function handleEvent(msg, getAssistant, setAssistant) {
  if (msg.type === "text") {
    let a = getAssistant();
    if (!a) {
      a = { kind: "msg", role: "assistant", text: "" };
      items.value.push(a);
      setAssistant(a);
    }
    a.text += msg.text;
  } else if (msg.type === "tool") {
    if (msg.status === "start") {
      items.value.push({ kind: "tool", name: msg.name, status: "start", isError: false });
    } else {
      // mark the most recent matching start as done
      for (let i = items.value.length - 1; i >= 0; i--) {
        const it = items.value[i];
        if (it.kind === "tool" && it.name === msg.name && it.status === "start") {
          it.status = "done";
          it.isError = Boolean(msg.isError);
          break;
        }
      }
      setAssistant(null); // a new assistant text block follows the tool round
    }
  } else if (msg.type === "error") {
    items.value.push({ kind: "error", text: msg.error });
  } else if (msg.type === "done") {
    setAssistant(null);
  }
}

function clearChat() {
  items.value = [];
}

onMounted(loadStatus);
</script>

<template>
  <aside class="chat" aria-label="AI analyst">
    <header class="chat__head">
      <div>
        <h2>Analyst</h2>
        <p class="chat__sub">{{ status.aiMode === "local" ? "local · Claude CLI" : status.model || "Claude" }}</p>
      </div>
      <div class="chat__actions">
        <AppButton variant="ghost" @click="clearChat" v-if="items.length">Clear</AppButton>
        <AppButton variant="ghost" @click="showSettings = true" aria-label="Settings">⚙</AppButton>
      </div>
    </header>

    <p v-if="status.aiMode === 'api' && !status.aiConfigured" class="notice" role="status">
      No AI key configured. Open <button class="link" @click="showSettings = true">Settings ⚙</button>
      to add an Anthropic key, or switch to Local mode.
    </p>

    <div class="chat__scroll" ref="scroller">
      <div v-if="!items.length" class="empty">
        <p>Ask about any Solana token, wallet, or transaction. Try:</p>
        <button v-for="s in SUGGESTIONS" :key="s" class="suggest" @click="send(s)">{{ s }}</button>
      </div>

      <template v-for="(it, i) in items" :key="i">
        <ChatMessage v-if="it.kind === 'msg'" :role="it.role" :text="it.text" />
        <ChatMessage v-else-if="it.kind === 'tool'" role="tool" :tool="it" />
        <p v-else class="err" role="alert">⚠️ {{ it.text }}</p>
      </template>

      <div v-if="streaming" class="typing" aria-live="polite">analyst is thinking<span>…</span></div>
    </div>

    <ChatComposer :disabled="streaming" @send="send" />

    <SettingsPanel v-if="showSettings" @close="showSettings = false" @updated="(s) => Object.assign(status, s)" />
  </aside>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: var(--space-5);
  height: 100%;
  min-height: 0;
}
.chat__head { display: flex; align-items: flex-start; justify-content: space-between; }
.chat__head h2 { margin: 0; }
.chat__sub { margin: 2px 0 0; font-size: var(--font-size-xs); color: var(--text-muted); }
.chat__actions { display: flex; gap: var(--space-2); }

.notice {
  margin: 0; padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-xs); color: var(--text-muted);
  background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
}
.link { background: none; border: none; color: var(--text-link); cursor: pointer; padding: 0; font: inherit; }

.chat__scroll {
  overflow-y: auto;
  min-height: 0;
  display: grid;
  gap: var(--space-5);
  align-content: start;
  padding-right: var(--space-2);
}

.empty { display: grid; gap: var(--space-4); color: var(--text-muted); font-size: var(--font-size-sm); }
.suggest {
  text-align: left;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-body);
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-xs);
  cursor: pointer;
  word-break: break-all;
}
.suggest:hover { border-color: var(--border-focus); }

.err { margin: 0; color: var(--text-error); font-size: var(--font-size-sm); }
.typing { font-size: var(--font-size-xs); color: var(--text-muted); }
.typing span { animation: blink 1.2s steps(3) infinite; }
@keyframes blink { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
