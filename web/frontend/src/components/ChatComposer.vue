<script setup>
/**
 * ChatComposer — the question input. Enter sends, Shift+Enter inserts a newline,
 * disabled while the analyst is streaming. Auto-grows up to a few lines.
 */
import { ref } from "vue";
import AppButton from "./AppButton.vue";

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
    <label class="sr-only" for="chat-input">Ask the analyst a question</label>
    <textarea
      id="chat-input"
      v-model="text"
      class="composer__input"
      rows="2"
      placeholder="Ask: is this token a rug? who are the top holders of…?"
      :disabled="disabled"
      @keydown="onKeydown"
    />
    <AppButton type="submit" :disabled="disabled || !text.trim()">Send</AppButton>
  </form>
</template>

<style scoped>
.composer { display: flex; align-items: flex-end; gap: var(--space-4); }
.composer__input {
  flex: 1;
  resize: none;
  min-height: var(--control-height);
  max-height: 140px;
  padding: var(--space-3) var(--control-padding-x);
  background: var(--bg-card);
  color: var(--text-body);
  border: 1px solid var(--border-default);
  border-radius: var(--control-radius);
  font-family: var(--font-family-stack);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}
.composer__input::placeholder { color: var(--text-muted); }
.composer__input:focus-visible { border-color: var(--border-focus); outline: none; }
.composer__input:disabled { opacity: 0.5; cursor: not-allowed; }

.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
</style>
