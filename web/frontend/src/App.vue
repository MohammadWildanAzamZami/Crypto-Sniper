<script setup>
import ExplorerPage from "./pages/ExplorerPage.vue";
import ChatWidget from "./components/ChatWidget.vue";
</script>

<template>
  <a class="skip" href="#main">Skip to content</a>
  <div class="layout">
    <div id="main" class="layout__main">
      <ExplorerPage />
    </div>
  </div>

  <!-- WhatsApp-style floating, resizable chat assistant -->
  <ChatWidget />
</template>

<style scoped>
.layout {
  min-height: 100vh;
}
/* Explorer now spans the full width; the analyst lives in a floating widget.
   Leave room at the bottom-right so content isn't hidden behind the FAB. */
.layout__main {
  min-width: 0;
  overflow-y: auto;
  padding-bottom: 96px;
}

/* Skip link: hidden until focused, a WCAG 2.4.1 bypass-blocks requirement. */
.skip {
  position: absolute;
  left: var(--space-6);
  top: -48px;
  background: var(--bg-accent);
  color: var(--text-on-accent);
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-sm);
  transition: top var(--motion-duration-instant) var(--motion-ease);
  z-index: 10;
}
.skip:focus-visible { top: var(--space-6); }
</style>
