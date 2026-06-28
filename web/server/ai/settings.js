// Server-side settings store. Secrets (Solscan key, AI key) live ONLY here in
// memory, seeded from .env at boot. The browser can read STATUS (booleans) and
// write new values, but GET never returns a secret. This matches the brief's
// non-negotiable: keys are the proxy's secrets, exactly like before.

import { solscanFetch } from "../solscan.js";

const state = {
  solscanKey: process.env.SOLSCAN_API_KEY || "",
  aiMode: "api", // "api" | "local"
  aiProvider: "claude", // "claude" | "openai" | "gemini"
  aiKey: process.env.ANTHROPIC_API_KEY || "",
  model: "claude-opus-4-8",
  claudePath: process.env.CLAUDE_CLI_PATH || "claude",
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },
};

// What the browser is allowed to see — status only, never the secret values.
export function publicStatus() {
  return {
    solscanConfigured: Boolean(state.solscanKey),
    solscanTier: state.solscanTier || "unknown", // filled by a /test
    aiMode: state.aiMode,
    aiProvider: state.aiProvider,
    aiConfigured: state.aiMode === "local" ? true : Boolean(state.aiKey),
    model: state.model,
    telegramConfigured: Boolean(state.telegram.botToken && state.telegram.chatId),
  };
}

// Internal accessor for the proxy/AI layer (full secrets).
export function getState() {
  return state;
}

// Apply a settings update. Empty strings are ignored for secret fields so the
// UI can submit "unchanged" without wiping a key. Returns publicStatus().
export function applySettings(patch = {}) {
  if (typeof patch.solscanKey === "string" && patch.solscanKey !== "") state.solscanKey = patch.solscanKey;
  if (patch.aiMode === "api" || patch.aiMode === "local") state.aiMode = patch.aiMode;
  if (["claude", "openai", "gemini"].includes(patch.aiProvider)) state.aiProvider = patch.aiProvider;
  if (typeof patch.aiKey === "string" && patch.aiKey !== "") state.aiKey = patch.aiKey;
  if (typeof patch.model === "string" && patch.model !== "") state.model = patch.model;
  if (typeof patch.claudePath === "string" && patch.claudePath !== "") state.claudePath = patch.claudePath;
  if (patch.telegram && typeof patch.telegram === "object") {
    if (typeof patch.telegram.botToken === "string" && patch.telegram.botToken !== "")
      state.telegram.botToken = patch.telegram.botToken;
    if (typeof patch.telegram.chatId === "string" && patch.telegram.chatId !== "")
      state.telegram.chatId = patch.telegram.chatId;
  }
  return publicStatus();
}

/**
 * Cheap probe for the "Test" buttons. target: "solscan" | "ai".
 * Returns { ok, detail, tier? } — never leaks the key.
 */
export async function testTarget(target) {
  if (target === "solscan") {
    // chain-info is public; token-meta needs Pro. Probe token-meta to learn tier.
    const probe = await solscanFetch("token-meta", { token_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, state.solscanKey);
    if (probe.ok) {
      state.solscanTier = "pro";
      return { ok: true, tier: "pro", detail: "Solscan Pro key valid." };
    }
    if (probe.status === 401) {
      state.solscanTier = "free";
      return { ok: false, tier: "free", detail: "Free tier (Pro endpoints return 401). Screener still works." };
    }
    return { ok: false, detail: `Solscan probe failed (status ${probe.status}).` };
  }

  if (target === "ai") {
    if (state.aiMode === "local") return { ok: true, detail: "Local mode uses the Claude CLI — no key needed." };
    if (state.aiProvider !== "claude") return { ok: false, detail: `${state.aiProvider} backend not implemented yet (v1 supports Claude).` };
    if (!state.aiKey) return { ok: false, detail: "No Anthropic API key set." };
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: state.aiKey });
      await client.messages.create({ model: state.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
      return { ok: true, detail: `Anthropic key valid (${state.model}).` };
    } catch (err) {
      return { ok: false, detail: `Anthropic key test failed: ${err?.message || err}` };
    }
  }

  return { ok: false, detail: `Unknown test target '${target}'.` };
}
