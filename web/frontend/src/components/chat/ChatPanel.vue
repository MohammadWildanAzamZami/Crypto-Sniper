<script setup>
/**
 * ChatPanel — the AI analyst chat, styled like WhatsApp. Sends the chat history
 * to /api/chat and renders the streamed reply (text deltas + tool chips). The
 * Anthropic key never reaches here; the proxy holds it. The header lives in the
 * wrapping ChatWidget; this panel exposes openSettings()/clearChat() to it.
 */
import { ref, reactive, nextTick, onMounted } from "vue";
import ChatMessage from "./ChatMessage.vue";
import ChatComposer from "./ChatComposer.vue";
import SettingsPanel from "../panels/SettingsPanel.vue";
import { apiUrl } from "../../lib/api.js";

// items: { kind:'msg', role, text, time } | { kind:'tool', name, status, isError } | { kind:'error', text }
const items = ref([]);
const streaming = ref(false);
const showSettings = ref(false);
const status = reactive({ aiMode: "api", aiConfigured: false, model: "" });
const scroller = ref(null);

const SUGGESTIONS = [
  "Screen token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Siapa top holder DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?",
  "Bagaimana status jaringan Solana sekarang?",
];

function nowHM() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadStatus() {
  try {
    const s = await (await fetch(apiUrl("/api/settings"))).json();
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
  items.value.push({ kind: "msg", role: "user", text, time: nowHM() });
  streaming.value = true;
  scrollDown();

  const payload = { messages: historyForApi() };
  let assistant = null; // current streaming assistant msg item

  try {
    const res = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      items.value.push({ kind: "error", text: body.error || `Request gagal (${res.status})` });
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
    items.value.push({ kind: "error", text: "Gangguan jaringan — coba lagi." });
  } finally {
    streaming.value = false;
    scrollDown();
  }
}

function handleEvent(msg, getAssistant, setAssistant) {
  if (msg.type === "text") {
    let a = getAssistant();
    if (!a) {
      a = { kind: "msg", role: "assistant", text: "", time: nowHM() };
      items.value.push(a);
      setAssistant(a);
    }
    a.text += msg.text;
  } else if (msg.type === "tool") {
    if (msg.status === "start") {
      items.value.push({ kind: "tool", name: msg.name, status: "start", isError: false });
    } else {
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

// Let the wrapping widget drive the header buttons.
defineExpose({
  clearChat,
  openSettings: () => { showSettings.value = true; },
});

onMounted(loadStatus);
</script>

<template>
  <section class="wa" aria-label="AI analyst">
    <div class="wa__scroll" ref="scroller">
      <p v-if="status.aiMode === 'api' && !status.aiConfigured" class="wa__notice" role="status">
        Belum ada API key AI. Buka
        <button class="wa__link" @click="showSettings = true">Pengaturan ⚙</button>
        untuk menambahkan key Anthropic.
      </p>

      <div v-if="!items.length" class="wa__empty">
        <p>Tanya apa saja soal token, wallet, atau transaksi Solana. Coba:</p>
        <button v-for="s in SUGGESTIONS" :key="s" class="wa__suggest" @click="send(s)">{{ s }}</button>
      </div>

      <template v-for="(it, i) in items" :key="i">
        <ChatMessage v-if="it.kind === 'msg'" :role="it.role" :text="it.text" :time="it.time" />
        <ChatMessage v-else-if="it.kind === 'tool'" role="tool" :tool="it" />
        <div v-else class="wa__err" role="alert">⚠️ {{ it.text }}</div>
      </template>

      <div v-if="streaming" class="wa__typing" aria-live="polite">
        <span></span><span></span><span></span>
      </div>
    </div>

    <ChatComposer :disabled="streaming" @send="send" />

    <SettingsPanel v-if="showSettings" @close="showSettings = false" @updated="(s) => Object.assign(status, s)" />
  </section>
</template>

<style scoped>
.wa {
  display: grid;
  grid-template-rows: 1fr auto;
  height: 100%;
  min-height: 0;
  background-color: #000000;
}

.wa__scroll {
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
}

.wa__notice {
  margin: 0 auto 8px;
  max-width: 90%;
  padding: 7px 12px;
  font-size: 12px;
  color: #cdd9e5;
  text-align: center;
  background: rgba(0, 87, 183, 0.22);
  border: 1px solid rgba(0, 87, 183, 0.5);
  border-radius: 8px;
}
.wa__link { background: none; border: none; color: #60a5fa; cursor: pointer; padding: 0; font: inherit; }

.wa__empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 88%;
  text-align: center;
  color: #9fb3c8;
  font-size: 13px;
}
.wa__suggest {
  text-align: left;
  background: #1e293b;
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: 8px;
  color: #e9edf1;
  padding: 9px 12px;
  font-size: 12px;
  cursor: pointer;
  word-break: break-all;
}
.wa__suggest:hover { background: #24344d; border-color: rgba(96, 165, 250, 0.6); }

.wa__err {
  align-self: center;
  margin: 4px 0;
  padding: 6px 12px;
  background: rgba(220, 38, 38, 0.2);
  color: #fca5a5;
  border-radius: 8px;
  font-size: 12px;
  max-width: 90%;
}

/* typing dots */
.wa__typing {
  align-self: flex-start;
  display: inline-flex;
  gap: 4px;
  background: #1e293b;
  padding: 9px 12px;
  border-radius: 8px;
  border-top-left-radius: 0;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  margin: 2px 4px;
}
.wa__typing span {
  width: 7px; height: 7px;
  background: #64748b;
  border-radius: 50%;
  animation: wa-bounce 1.2s infinite ease-in-out;
}
.wa__typing span:nth-child(2) { animation-delay: 0.2s; }
.wa__typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes wa-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
}
</style>
