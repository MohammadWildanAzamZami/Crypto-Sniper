// Pro Radar AI analyst — a ONE-SHOT (non-streaming) Fable 5 call that ranks
// pre-screened memecoin candidates by conviction and explains WHY. Works in both
// API mode (Anthropic SDK) and Local mode (Claude CLI), matching the app's
// local-first default. Degrades gracefully: any failure returns null so the
// caller falls back to the pure-heuristic ordering.

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

const DEFAULT_MODEL = "claude-fable-5";
const LOCAL_TIMEOUT_MS = 90_000;

const SYSTEM = `You are a senior Solana memecoin analyst powering an automated "Pro Radar".
You receive a JSON array of pre-screened token candidates with live market data (already filtered by a heuristic screener).
Rank them by 10x–100x upside potential balanced against rug/dump risk, and explain each briefly.

Return ONLY a JSON array (no prose, no markdown fences). One object per input token, reusing the same "address" values:
[{
  "address": "<mint>",
  "conviction": <integer 0-100>,      // overall upside-vs-risk conviction
  "tier": "S" | "A" | "B" | "C",       // S = rare high-conviction, C = pass
  "thesis": "<=140 chars: why it could run, OR why to avoid",
  "catalysts": ["short phrase", ...],  // 0-3 bullish signals visible in the data
  "redFlags": ["short phrase", ...],   // 0-3 risks visible in the data
  "action": "APE" | "WATCH" | "AVOID"
}]

Rules:
- Ground every judgement in the numbers provided. Never invent data you were not given.
- Reward: small marketCap with real liquidity, healthy buy pressure, two-sided volume, locked LP, sane age, pumpGraduated=true (survived the bonding curve), low pumpDrawdownFromAthPct.
- Punish: unlocked LP, one-sided selling, dead volume, brand-new unproven pairs, marketCap too large for 10x, high pumpDrawdownFromAthPct (already pumped & dumped).
- Be decisive but honest. Most memecoins are AVOID/WATCH; reserve APE and tier S/A for genuinely strong setups.
- This is a heuristic, not financial advice.`;

function buildUserPrompt(candidates) {
  return "Analyze and rank these candidates. Return the JSON array only:\n\n" + JSON.stringify(candidates);
}

// Pull the first JSON array out of a possibly-noisy model reply.
function parseJsonArray(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Option A: hosted Anthropic API (server-side key). One-shot, non-streaming.
async function analyzeViaApi(candidates, { aiKey, model }) {
  const client = new Anthropic({ apiKey: aiKey });
  const msg = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserPrompt(candidates) }],
  });
  const text = (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseJsonArray(text);
}

// Option B: local Claude CLI (no API key, uses the user's subscription).
// One-shot headless call; the model just reasons over the JSON we hand it, so no
// MCP tools are needed here. Timed out so a stuck CLI can't hang the radar.
function analyzeViaLocal(candidates, { claudePath, model }) {
  const bin = claudePath || "claude";
  const args = [
    "-p", buildUserPrompt(candidates),
    "--append-system-prompt", SYSTEM,
    "--model", model || DEFAULT_MODEL,
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
  ];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    let out = "";
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(null); }, LOCAL_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", () => {
      clearTimeout(timer);
      let text = out;
      try {
        const p = JSON.parse(out);
        text = p.result ?? p.text ?? out;
      } catch {
        /* fall back to raw stdout */
      }
      finish(parseJsonArray(text));
    });
  });
}

/**
 * Rank candidates with Fable 5. Returns a Map(address -> analysis) or null when
 * the AI is unavailable/failed. Never throws — the caller falls back cleanly.
 * @param {Array} candidates  condensed candidate payloads (see proRadar.js)
 * @param {object} opts { aiMode, aiKey, model, claudePath }
 */
export async function analyzeCandidates(candidates, { aiMode, aiKey, model, claudePath } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  try {
    let arr;
    if (aiMode === "local") arr = await analyzeViaLocal(candidates, { claudePath, model });
    else if (aiKey) arr = await analyzeViaApi(candidates, { aiKey, model });
    else return null; // API mode without a key — nothing to call
    if (!Array.isArray(arr)) return null;

    const byAddr = new Map();
    for (const a of arr) {
      if (a && typeof a.address === "string") byAddr.set(a.address, a);
    }
    return byAddr.size ? byAddr : null;
  } catch {
    return null;
  }
}
