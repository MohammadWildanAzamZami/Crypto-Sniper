// Server-side settings store. Secrets (Solscan key, AI key) live ONLY here in
// memory, seeded from .env at boot, then OVERLAID with anything the user saved
// via the Settings panel (persisted to a gitignored .settings.json on disk so
// keys survive a restart). The browser can read STATUS (booleans) and write new
// values, but GET never returns a secret. This matches the brief's
// non-negotiable: keys are the proxy's secrets, exactly like before.

import { solscanFetch } from "../solscan.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Sits next to .env in web/server/. Holds the same secrets, so it MUST stay
// gitignored (see .gitignore). On read-only/ephemeral filesystems the load/save
// below no-op gracefully — env-seeded values still work.
const STORE_PATH = fileURLToPath(new URL("../.settings.json", import.meta.url));

// Fields we persist. solscanTier is a runtime probe result, deliberately not saved.
const PERSISTED = ["solscanKey", "aiMode", "aiProvider", "aiKey", "model", "claudePath", "telegram", "birdeyeKey", "heliusKey"];

const state = {
  solscanKey: process.env.SOLSCAN_API_KEY || "",
  // Smart-money tracking keys. Birdeye = who's trading (top traders); Helius =
  // are those wallets real/established. Both server-side; both optional (the
  // radar degrades to no-smart-money when absent).
  birdeyeKey: process.env.BIRDEYE_API_KEY || "",
  heliusKey: process.env.HELIUS_API_KEY || "",
  // Default ke mode lokal: pakai CLI `claude` (tanpa API key, tanpa biaya).
  // Catatan: mode lokal butuh CLI `claude` di mesin yang menjalankan server.
  // Di host publik (mis. Render) yang tak punya CLI itu, chat belum berfungsi
  // sampai di-switch ke "api" + isi ANTHROPIC_API_KEY lewat Settings.
  aiMode: process.env.AI_MODE || "local", // "api" | "local"
  aiProvider: "claude", // "claude" | "openai" | "gemini"
  aiKey: process.env.ANTHROPIC_API_KEY || "",
  model: process.env.ANTHROPIC_MODEL || "claude-fable-5",
  claudePath: process.env.CLAUDE_CLI_PATH || "claude",
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },
};

// Overlay persisted settings on top of the .env-seeded defaults. A saved value
// reflects the user's most recent intent, so it wins over .env.
function loadPersisted() {
  try {
    const saved = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    for (const key of PERSISTED) {
      if (saved[key] == null) continue;
      if (key === "telegram" && typeof saved.telegram === "object") {
        state.telegram = { ...state.telegram, ...saved.telegram };
      } else {
        state[key] = saved[key];
      }
    }
  } catch {
    /* no file yet, or unreadable FS — keep .env defaults */
  }
}

// Write the current persisted fields to disk. Swallows errors so a read-only FS
// never breaks the request that triggered the save.
function savePersisted() {
  try {
    const out = {};
    for (const key of PERSISTED) out[key] = state[key];
    writeFileSync(STORE_PATH, JSON.stringify(out, null, 2), "utf8");
  } catch {
    /* read-only/ephemeral FS — settings stay in-memory for this process */
  }
}

loadPersisted();

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
    birdeyeConfigured: Boolean(state.birdeyeKey),
    heliusConfigured: Boolean(state.heliusKey),
    // Smart money needs Birdeye at minimum; Helius only enriches it.
    smartMoneyEnabled: Boolean(state.birdeyeKey),
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
  if (typeof patch.birdeyeKey === "string" && patch.birdeyeKey !== "") state.birdeyeKey = patch.birdeyeKey;
  if (typeof patch.heliusKey === "string" && patch.heliusKey !== "") state.heliusKey = patch.heliusKey;
  if (patch.telegram && typeof patch.telegram === "object") {
    if (typeof patch.telegram.botToken === "string" && patch.telegram.botToken !== "")
      state.telegram.botToken = patch.telegram.botToken;
    if (typeof patch.telegram.chatId === "string" && patch.telegram.chatId !== "")
      state.telegram.chatId = patch.telegram.chatId;
  }
  savePersisted(); // persist so the keys survive a restart
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

  if (target === "smart") {
    if (!state.birdeyeKey) return { ok: false, detail: "Belum ada Birdeye key (wajib untuk smart money)." };
    try {
      // Ping a stable mint (USDC) — just checks the key is accepted.
      const res = await fetch(
        "https://public-api.birdeye.so/defi/price?address=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        { headers: { "X-API-KEY": state.birdeyeKey, "x-chain": "solana", accept: "application/json" } }
      );
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "Birdeye key ditolak (401/403)." };
      if (!res.ok) return { ok: false, detail: `Birdeye merespons ${res.status}.` };
      const helius = state.heliusKey ? " + Helius aktif (verifikasi wallet)." : " (Helius belum diisi — verifikasi wallet nonaktif).";
      return { ok: true, detail: `Birdeye key valid.${helius}` };
    } catch (err) {
      return { ok: false, detail: `Uji Birdeye gagal: ${err?.message || err}` };
    }
  }

  return { ok: false, detail: `Unknown test target '${target}'.` };
}
