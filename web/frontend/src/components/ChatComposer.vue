<script setup>
/**
 * ChatComposer — WhatsApp-style input bar. Enter sends, Shift+Enter = newline,
 * disabled while the analyst is streaming. Auto-grows up to a few lines.
 */
import { ref } from "vue";

const props = defineProps({
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["send"]);

const text = ref("");

function send() {
  const v = text.value.trim();
  if (!v || props.disabled) return;
  emit("send", v);
  text.value = "";
}

function onKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="send">
    <label class="sr-only" for="chat-input">Tulis pesan</label>
    <textarea
      id="chat-input"
      v-model="text"
      class="composer__input"
      rows="1"
      placeholder="Ketik pesan"
      :disabled="disabled"
      @keydown="onKeydown"
    />
    <button
      class="composer__send"
      type="submit"
      :disabled="disabled || !text.trim()"
      aria-label="Kirim"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
      </svg>
    </button>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 10px;
  background: #0f1830;
}
.composer__input {
  flex: 1;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  padding: 11px 16px;
  background: #1e293b;
  color: #e9edf1;
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: 21px;
  font-family: var(--font-family-stack, system-ui, sans-serif);
  font-size: 14px;
  line-height: 20px;
}
.composer__input::placeholder { color: #8696a0; }
.composer__input:focus-visible { outline: none; border-color: #2563eb; }
.composer__input:disabled { opacity: 0.6; cursor: not-allowed; }

.composer__send {
  flex: none;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s ease, transform 0.1s ease;
}
.composer__send:hover { background: #1d4ed8; }
.composer__send:active { transform: scale(0.94); }
.composer__send:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
.composer__send:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }

.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
</style>
