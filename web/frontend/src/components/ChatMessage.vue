<script setup>
/**
 * ChatMessage — one chat bubble. Variants:
 *   user      — the question
 *   assistant — the answer (rendered markdown, may stream in)
 *   tool      — a "🔧 fetched X…" chip shown while/after the AI calls a tool
 * Assistant answers go through a safe markdown renderer (HTML-escaped).
 */
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown.js";

const props = defineProps({
  role: { type: String, required: true }, // user | assistant | tool
  text: { type: String, default: "" },
  tool: { type: Object, default: null }, // { name, status, isError }
});

const html = computed(() => (props.role === "assistant" ? renderMarkdown(props.text) : ""));
</script>

<template>
  <div v-if="role === 'tool'" class="chip" :class="{ 'chip--err': tool?.isError }">
    <span class="chip__spin" v-if="tool?.status === 'start'" aria-hidden="true" />
    <span v-else aria-hidden="true">{{ tool?.isError ? "⚠️" : "✓" }}</span>
    <span>{{ tool?.status === "start" ? "calling" : "used" }} <code>{{ tool?.name }}</code></span>
  </div>

  <div v-else class="msg" :class="`msg--${role}`">
    <div class="msg__role">{{ role === "user" ? "You" : "Analyst" }}</div>
    <div v-if="role === 'assistant'" class="msg__body" v-html="html" />
    <div v-else class="msg__body msg__body--plain">{{ text }}</div>
  </div>
</template>

<style scoped>
.msg { display: grid; gap: var(--space-2); }
.msg__role { font-size: var(--font-size-xs); color: var(--text-muted); }
.msg__body { font-size: var(--font-size-sm); color: var(--text-body); line-height: var(--line-height-base); }
.msg__body--plain { white-space: pre-wrap; word-break: break-word; }

.msg--user .msg__body {
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-5);
}

/* Markdown elements inside assistant answers */
.msg__body :deep(p) { margin: 0 0 var(--space-3); }
.msg__body :deep(p:last-child) { margin-bottom: 0; }
.msg__body :deep(code) {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 0.92em;
  background: var(--bg-raised);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  word-break: break-all;
}
.msg__body :deep(pre) {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
  overflow-x: auto;
}
.msg__body :deep(pre code) { background: none; padding: 0; word-break: normal; }
.msg__body :deep(a) { color: var(--text-link); }
.msg__body :deep(a:hover) { color: var(--text-link-hover); }

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 2px var(--space-4);
  width: fit-content;
}
.chip--err { color: var(--text-warning); border-color: var(--text-warning); }
.chip code { font-family: ui-monospace, monospace; }
.chip__spin {
  width: 10px; height: 10px;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: chip-spin 0.6s linear infinite;
}
@keyframes chip-spin { to { transform: rotate(360deg); } }
</style>
