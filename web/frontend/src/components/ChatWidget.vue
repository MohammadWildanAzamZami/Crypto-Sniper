<script setup>
/**
 * ChatWidget — wraps ChatPanel in a WhatsApp-style floating widget:
 *  - a round FAB (bottom-right) that toggles the chat open/closed,
 *  - a floating window the user can freely resize (drag the top-left grip),
 *  - a maximize toggle and a close button.
 * Size is clamped to the viewport via CSS max-width/height, so it never
 * overflows the screen even on small displays. ChatPanel keeps all its
 * logic; this component only owns presentation/placement.
 */
import { ref } from "vue";
import ChatPanel from "./ChatPanel.vue";

const open = ref(false);
const maximized = ref(false);

// Ref to the inner ChatPanel so the header buttons can drive it.
const panel = ref(null);
function openSettings() { panel.value?.openSettings(); }
function clearChat() { panel.value?.clearChat(); }

// Window size (px). CSS caps these to the viewport, so large values are safe.
const W = ref(400);
const H = ref(560);
const MIN_W = 300;
const MIN_H = 380;
// Remember the pre-maximize size so we can restore it.
let prevW = 400;
let prevH = 560;

function toggleOpen() {
  open.value = !open.value;
}
function close() {
  open.value = false;
}
function toggleMax() {
  if (maximized.value) {
    W.value = prevW;
    H.value = prevH;
    maximized.value = false;
  } else {
    prevW = W.value;
    prevH = H.value;
    W.value = Math.min(window.innerWidth - 32, 1100);
    H.value = Math.min(window.innerHeight - 110, 1000);
    maximized.value = true;
  }
}

// --- Custom resize from the top-left corner (window is anchored bottom-right,
// so dragging up-left enlarges and down-right shrinks). Works with mouse + touch.
let startX = 0;
let startY = 0;
let startW = 0;
let startH = 0;

function point(e) {
  return e.touches && e.touches[0] ? e.touches[0] : e;
}
function onResizeStart(e) {
  const p = point(e);
  startX = p.clientX;
  startY = p.clientY;
  startW = W.value;
  startH = H.value;
  maximized.value = false;
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeEnd);
  window.addEventListener("touchmove", onResizeMove, { passive: false });
  window.addEventListener("touchend", onResizeEnd);
  e.preventDefault();
}
function onResizeMove(e) {
  const p = point(e);
  const dw = startX - p.clientX; // drag left → wider
  const dh = startY - p.clientY; // drag up   → taller
  const maxW = Math.min(window.innerWidth - 32, 1100);
  const maxH = Math.min(window.innerHeight - 110, 1000);
  W.value = Math.max(MIN_W, Math.min(maxW, startW + dw));
  H.value = Math.max(MIN_H, Math.min(maxH, startH + dh));
  if (e.cancelable) e.preventDefault();
}
function onResizeEnd() {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeEnd);
  window.removeEventListener("touchmove", onResizeMove);
  window.removeEventListener("touchend", onResizeEnd);
}

// Keyboard resize for accessibility (focus the grip, use arrow keys).
function onResizeKey(e) {
  const step = e.shiftKey ? 60 : 20;
  const maxW = Math.min(window.innerWidth - 32, 1100);
  const maxH = Math.min(window.innerHeight - 110, 1000);
  if (e.key === "ArrowLeft") W.value = Math.min(maxW, W.value + step);
  else if (e.key === "ArrowRight") W.value = Math.max(MIN_W, W.value - step);
  else if (e.key === "ArrowUp") H.value = Math.min(maxH, H.value + step);
  else if (e.key === "ArrowDown") H.value = Math.max(MIN_H, H.value - step);
  else return;
  maximized.value = false;
  e.preventDefault();
}
</script>

<template>
  <!-- Floating chat window -->
  <transition name="cw-pop">
    <div
      v-if="open"
      class="cw__window"
      :style="{ width: W + 'px', height: H + 'px' }"
      role="dialog"
      aria-label="AI analyst chat"
    >
      <!-- Resize grip (top-left corner) -->
      <button
        class="cw__resize"
        type="button"
        title="Drag to resize (arrow keys when focused)"
        aria-label="Resize chat window"
        @mousedown="onResizeStart"
        @touchstart="onResizeStart"
        @keydown="onResizeKey"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M2 8 L8 2 M2 13 L13 2 M7 13 L13 7"
            stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" />
        </svg>
      </button>

      <!-- WhatsApp-style contact header -->
      <div class="cw__bar">
        <div class="cw__contact">
          <span class="cw__avatar" aria-hidden="true">🤖</span>
          <span class="cw__contact-text">
            <span class="cw__contact-name">Analyst</span>
            <span class="cw__contact-status">online</span>
          </span>
        </div>
        <div class="cw__bar-actions">
          <button class="cw__btn" type="button" title="Pengaturan" aria-label="Pengaturan" @click="openSettings">⚙</button>
          <button class="cw__btn" type="button" title="Hapus chat" aria-label="Hapus chat" @click="clearChat">🗑</button>
          <button class="cw__btn" type="button" :title="maximized ? 'Kecilkan' : 'Perbesar'"
            :aria-label="maximized ? 'Kecilkan' : 'Perbesar'" @click="toggleMax">
            {{ maximized ? "🗗" : "🗖" }}
          </button>
          <button class="cw__btn" type="button" title="Tutup chat" aria-label="Tutup chat" @click="close">✕</button>
        </div>
      </div>

      <!-- The actual chat -->
      <div class="cw__body">
        <ChatPanel ref="panel" />
      </div>
    </div>
  </transition>

  <!-- WhatsApp-style floating action button -->
  <button
    class="cw__fab"
    type="button"
    :class="{ 'cw__fab--open': open }"
    :aria-expanded="open"
    :aria-label="open ? 'Close chat assistant' : 'Open chat assistant'"
    @click="toggleOpen"
  >
    <svg v-if="!open" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path fill="currentColor"
        d="M12 2C6.5 2 2 6.03 2 11c0 2.7 1.34 5.13 3.47 6.78L4.5 22l4.6-2.1c.92.23 1.9.35 2.9.35 5.5 0 10-4.03 10-9S17.5 2 12 2zm-3.2 7.2h6.4a.8.8 0 0 1 0 1.6H8.8a.8.8 0 0 1 0-1.6zm0 3.2h4.8a.8.8 0 0 1 0 1.6H8.8a.8.8 0 0 1 0-1.6z" />
    </svg>
    <span v-else class="cw__fab-x" aria-hidden="true">✕</span>
  </button>
</template>

<style scoped>
/* ---- Floating action button (WhatsApp-style) ---- */
.cw__fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1000;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: #fff;
  background: #2563eb; /* blue */
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3);
  transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  animation: cw-pulse 2.4s ease-out infinite;
}
.cw__fab:hover { transform: scale(1.08); background: #1d4ed8; }
.cw__fab:active { transform: scale(0.96); }
.cw__fab:focus-visible { outline: 3px solid var(--border-focus, #6ea8fe); outline-offset: 3px; }
.cw__fab--open { background: var(--bg-raised, #2a2a2a); color: var(--text-body, #eee); animation: none; }
.cw__fab-x { font-size: 22px; line-height: 1; }

@keyframes cw-pulse {
  0% { box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45), 0 0 0 0 rgba(37, 99, 235, 0.5); }
  70% { box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45), 0 0 0 16px rgba(37, 99, 235, 0); }
  100% { box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45), 0 0 0 0 rgba(37, 99, 235, 0); }
}

/* ---- Floating chat window ---- */
.cw__window {
  position: fixed;
  right: 24px;
  bottom: 96px;
  z-index: 1000;
  /* Never overflow the viewport, regardless of the user's chosen size. */
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 110px);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg-subtle, #1a1a1a);
  border: 1px solid var(--border-default, #333);
  border-radius: var(--radius-lg, 14px);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.cw__resize {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: nwse-resize;
  border-top-left-radius: var(--radius-lg, 14px);
}
.cw__resize:hover { color: #fff; }
.cw__resize:focus-visible { outline: 2px solid var(--border-focus, #6ea8fe); outline-offset: -2px; }

.cw__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 28px;
  background: #1e3a8a; /* dark blue header */
}
.cw__contact { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cw__avatar {
  width: 34px; height: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  display: grid; place-items: center;
  font-size: 18px; line-height: 1;
  flex: none;
}
.cw__contact-text { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.cw__contact-name { font-size: 15px; font-weight: 600; color: #fff; }
.cw__contact-status { font-size: 12px; color: rgba(255, 255, 255, 0.85); }

.cw__bar-actions { display: flex; gap: 2px; flex: none; }
.cw__btn {
  width: 30px; height: 30px;
  border: none; background: transparent; cursor: pointer;
  color: #fff; border-radius: 50%;
  font-size: 14px; line-height: 1;
}
.cw__btn:hover { background: rgba(255, 255, 255, 0.18); }
.cw__btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }

.cw__body {
  min-height: 0;
  overflow: hidden;
  background: #0b1220;
}

/* Open/close animation */
.cw-pop-enter-active, .cw-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.cw-pop-enter-from, .cw-pop-leave-to { opacity: 0; transform: translateY(12px) scale(0.97); }

@media (max-width: 560px) {
  .cw__window { right: 12px; bottom: 84px; }
  .cw__fab { right: 16px; bottom: 16px; }
}
</style>
