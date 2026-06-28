<script setup>
/**
 * ChatMessage — one chat bubble (dark black/blue theme).
 *   user      — outgoing bubble (blue, right)
 *   assistant — incoming bubble (dark, left, rendered markdown)
 *   tool      — a centered system pill ("memakai screen_token")
 */
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown.js";

const props = defineProps({
  role: { type: String, required: true }, // user | assistant | tool
  text: { type: String, default: "" },
  tool: { type: Object, default: null },  // { name, status, isError }
  time: { type: String, default: "" },
});

const html = computed(() => (props.role === "assistant" ? renderMarkdown(props.text) : ""));
</script>

<template>
  <!-- tool call: centered system-style pill -->
  <div v-if="role === 'tool'" class="wa-sys">
    <span class="wa-sys__pill" :class="{ 'wa-sys__pill--err': tool?.isError }">
      <span class="wa-sys__spin" v-if="tool?.status === 'start'" aria-hidden="true" />
      <span v-else aria-hidden="true">{{ tool?.isError ? "⚠️" : "✓" }}</span>
      {{ tool?.status === "start" ? "memanggil" : "memakai" }} {{ tool?.name }}
    </span>
  </div>

  <!-- message bubble -->
  <div v-else class="wa-row" :class="role === 'user' ? 'wa-row--out' : 'wa-row--in'">
    <div class="wa-bubble" :class="role === 'user' ? 'wa-bubble--out' : 'wa-bubble--in'">
      <div v-if="role === 'assistant'" class="wa-bubble__text" v-html="html" />
      <div v-else class="wa-bubble__text wa-bubble__text--plain">{{ text }}</div>
      <span v-if="time" class="wa-bubble__time">{{ time }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ---- rows / alignment ---- */
.wa-row { display: flex; padding: 1px 4px; }
.wa-row--out { justify-content: flex-end; }
.wa-row--in { justify-content: flex-start; }

/* ---- bubble ---- */
.wa-bubble {
  position: relative;
  max-width: 82%;
  padding: 6px 9px 7px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 19px;
  color: #e9edf1;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.wa-bubble--out { background: #0057b7; border-top-right-radius: 0; color: #ffffff; }
.wa-bubble--in  { background: #1e293b; border-top-left-radius: 0; }

/* little tails at the top corner */
.wa-bubble--out::before {
  content: "";
  position: absolute; top: 0; right: -8px;
  width: 0; height: 0;
  border-left: 8px solid #0057b7;
  border-bottom: 8px solid transparent;
}
.wa-bubble--in::before {
  content: "";
  position: absolute; top: 0; left: -8px;
  width: 0; height: 0;
  border-right: 8px solid #1e293b;
  border-bottom: 8px solid transparent;
}

.wa-bubble__text--plain { white-space: pre-wrap; }
.wa-bubble__time {
  display: block;
  text-align: right;
  font-size: 11px;
  color: rgba(233, 237, 241, 0.6);
  margin-top: 2px;
  line-height: 1;
}

/* ---- markdown inside assistant bubbles (light text on dark) ---- */
.wa-bubble__text :deep(p) { margin: 0 0 6px; }
.wa-bubble__text :deep(p:last-child) { margin-bottom: 0; }
.wa-bubble__text :deep(ul), .wa-bubble__text :deep(ol) { margin: 4px 0; padding-left: 20px; }
.wa-bubble__text :deep(code) {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 0.9em;
  background: rgba(255, 255, 255, 0.12);
  padding: 1px 4px;
  border-radius: 4px;
  word-break: break-all;
}
.wa-bubble__text :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  margin: 4px 0;
}
.wa-bubble__text :deep(pre code) { background: none; padding: 0; word-break: normal; }
.wa-bubble__text :deep(a) { color: #60a5fa; }
.wa-bubble__text :deep(strong) { font-weight: 600; }

/* ---- tool / system pill ---- */
.wa-sys { display: flex; justify-content: center; padding: 4px; }
.wa-sys__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9fb3c8;
  background: rgba(30, 41, 59, 0.9);
  border-radius: 999px;
  padding: 4px 12px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
}
.wa-sys__pill--err { color: #fca5a5; }
.wa-sys__spin {
  width: 10px; height: 10px;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: wa-spin 0.6s linear infinite;
}
@keyframes wa-spin { to { transform: rotate(360deg); } }
</style>
