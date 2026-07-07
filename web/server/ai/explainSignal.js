// "Jelaskan sinyal ini" — a ONE-SHOT Claude call that turns a live sniper signal
// (Modul C) into a short, plain-Indonesian explanation of WHY smart money is
// accumulating this token and what the risks are. Mirrors ai/analyze.js: works in
// both API mode (Anthropic SDK) and Local mode (Claude CLI), and degrades to null
// on any failure so the route can report a clean error instead of throwing.
//
// Prefers the hosted API whenever an aiKey is present (the user's intent when they
// set ANTHROPIC_API_KEY), else falls back to the local Claude CLI.

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

const DEFAULT_MODEL = "claude-fable-5";
const LOCAL_TIMEOUT_MS = 90_000;

const SYSTEM = `Kamu analis memecoin Solana untuk fitur "Jelaskan Sinyal" di sebuah sniper live.
Kamu diberi SATU sinyal dalam JSON: token yang sedang diborong beberapa smart wallet (wallet Watchlist yang punya rekam jejak menangkap winner lebih awal) selagi market cap-nya masih kecil.

Tugasmu: jelaskan dalam Bahasa Indonesia yang ringkas dan jujur KENAPA ini jadi sinyal dan APA risikonya.

Aturan:
- 2-4 kalimat pendek. Langsung ke inti. Bahasa santai tapi tidak lebay.
- Dasarkan HANYA pada angka di JSON (jumlah wallet, reputasi, mcap, entry, PnL, unverified). Jangan mengarang data.
- Sebut sisi positif (berapa smart wallet sepakat, reputasi, entry vs harga sekarang) DAN sisi risiko (mcap kecil = volatil, kalau unverified=true berarti data pasar belum terverifikasi/kemungkinan token baru → ekstra hati-hati).
- Kalau smart money sudah profit besar (pnlX tinggi), ingatkan bahwa kamu mungkin sudah telat masuk.
- Tutup dengan pengingat singkat: heuristik, bukan nasihat keuangan, DYOR.
- JANGAN pakai markdown heading atau bullet. Teks paragraf biasa saja.`;

// Trim the signal to just what the model needs (and nothing that could leak).
function condense(signal) {
  const positions = Array.isArray(signal.positions) ? signal.positions.slice(0, 8).map((p) => ({
    reputation: p.reputation,
    established: p.established,
    entryMcap: p.entryMcap,
    sizeUsd: p.sizeUsd,
    pnlX: p.pnlX ? Math.round(p.pnlX * 100) / 100 : null,
    minutesAgo: p.at ? Math.round((Date.now() - p.at) / 60000) : null,
  })) : [];
  return {
    symbol: signal.symbol || null,
    mcap: signal.mcap || 0,
    unverified: !!signal.unverified,
    walletCount: signal.walletCount,
    isNew: !!signal.isNew,
    lastBuyMinutesAgo: signal.lastBuyAt ? Math.round((Date.now() - signal.lastBuyAt) / 60000) : null,
    positions,
  };
}

function buildUserPrompt(signal) {
  return "Jelaskan sinyal ini:\n\n" + JSON.stringify(condense(signal));
}

// Option A: hosted Anthropic API (server-side key). One-shot, non-streaming.
async function viaApi(signal, { aiKey, model }) {
  const client = new Anthropic({ apiKey: aiKey });
  const msg = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(signal) }],
  });
  return (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim() || null;
}

// Option B: local Claude CLI (no API key, uses the user's subscription).
function viaLocal(signal, { claudePath, model }) {
  const bin = claudePath || "claude";
  const args = [
    "-p", buildUserPrompt(signal),
    "--append-system-prompt", SYSTEM,
    "--model", model || DEFAULT_MODEL,
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
  ];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { windowsHide: true }); }
    catch { return resolve(null); }
    let out = "";
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(null); }, LOCAL_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", () => {
      clearTimeout(timer);
      let text = out;
      try { const p = JSON.parse(out); text = p.result ?? p.text ?? out; } catch { /* raw stdout */ }
      finish(typeof text === "string" ? text.trim() || null : null);
    });
  });
}

/**
 * Explain one signal. Returns { text } on success, or { error } describing why the
 * AI was unavailable. Never throws.
 * @param {object} signal  a live signal (from getSignals().signals)
 * @param {object} opts { aiMode, aiKey, model, claudePath }
 */
export async function explainSignal(signal, { aiMode, aiKey, model, claudePath } = {}) {
  try {
    let text;
    // Prefer the hosted API when a key is present (user set it on purpose);
    // otherwise use the local CLI when the app is in local mode.
    if (aiKey) text = await viaApi(signal, { aiKey, model });
    else if (aiMode === "local") text = await viaLocal(signal, { claudePath, model });
    else return { error: "AI belum siap — set ANTHROPIC_API_KEY (mode API) atau pakai mode lokal (CLI claude)." };

    if (!text) return { error: "AI tidak mengembalikan jawaban. Cek API key / CLI, lalu coba lagi." };
    return { text };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { error: "Anthropic API key tidak valid (401). Perbarui key di .env / Settings." };
    if (err instanceof Anthropic.RateLimitError) return { error: "Kena rate limit Anthropic. Coba lagi sebentar." };
    if (err instanceof Anthropic.PermissionDeniedError) return { error: "API key tidak punya akses ke model ini." };
    return { error: `AI error: ${err?.message || err}` };
  }
}
