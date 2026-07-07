// Option B: local mode. Shells out to the Claude Code CLI in headless mode so
// the analyst runs on the user's existing Claude subscription — no API key.
// It's wired to the screener MCP server (web/mcp/server.js) so the local model
// can still call Solana tools (screen_token, get_holder_analysis, ...).
//
// This is the cost-free personal-use path. For a deployable product use Option A
// (ai/anthropic.js). v1 local mode is non-streaming ("thinking…" then full
// answer), which the brief accepts.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is web/server/ai → the MCP server lives at web/mcp/server.js
const MCP_SERVER = path.resolve(__dirname, "../../mcp/server.js");
const DEFAULT_MODEL = "claude-fable-5";
// Use the SAME node binary running this server so the CLI can launch the MCP
// even though node is a portable install that may not be on the CLI's PATH.
const NODE_BIN = process.execPath;

const SYSTEM =
  "You are a Solana on-chain analyst. Use the solana-screener MCP tools " +
  "(screen_token, get_holder_analysis, check_bonding_curve, batch_screen) to fetch live data, " +
  "then answer concisely. Ground claims in tool results. Not financial advice.";

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * Run the local Claude CLI and stream the result to SSE.
 * @param {object} opts { messages, claudePath, solscanKey, telegram }
 * @param {object} res  Express response with SSE headers set
 */
export async function localChat({ messages, claudePath, model, solscanKey }, res) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) {
    sse(res, { type: "error", error: "No user message to answer." });
    return;
  }

  // Write the MCP config to a temp file (more universally supported than an
  // inline JSON arg) pointing at the bundled screener server. Use the absolute
  // node binary so the CLI can launch it regardless of its own PATH.
  const mcpConfig = {
    mcpServers: {
      "solana-screener": {
        command: NODE_BIN,
        args: [MCP_SERVER],
        env: { SOLSCAN_API_KEY: solscanKey || "" },
      },
    },
  };
  const cfgPath = path.join(os.tmpdir(), "solscan-mcp-config.json");
  try {
    writeFileSync(cfgPath, JSON.stringify(mcpConfig), "utf8");
  } catch {
    /* fall through; CLI will just run without tools */
  }

  const bin = claudePath || "claude";
  const args = [
    "-p", last.content,
    "--model", model || DEFAULT_MODEL,
    "--append-system-prompt", SYSTEM,
    "--output-format", "json",
    "--mcp-config", cfgPath,
    "--allowedTools", "mcp__solana-screener__screen_token,mcp__solana-screener__get_holder_analysis,mcp__solana-screener__check_bonding_curve,mcp__solana-screener__batch_screen",
    "--permission-mode", "bypassPermissions",
  ];

  sse(res, { type: "tool", name: "claude-code (local)", status: "start" });

  // Local mode = the CLI's own subscription login. If the server was booted with
  // an ANTHROPIC_API_KEY in its env (seeded from .env for API mode), the spawned
  // CLI would inherit it, flip into "external API key" mode, and fail with
  // "Invalid API key" whenever that key is unset/low-balance. Strip the API-key
  // env vars from the child so it always falls back to the logged-in account.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;

  // Return a promise that resolves only when the child process exits, so the
  // caller keeps the SSE stream open until the answer is ready.
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, env: childEnv });
    } catch (err) {
      sse(res, { type: "error", error: `Could not launch claude CLI: ${err.message}` });
      return resolve();
    }

    let out = "";
    let errOut = "";
    let failed = false;
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (errOut += d.toString()));

    child.on("error", (err) => {
      failed = true;
      sse(res, { type: "tool", name: "claude-code (local)", status: "done", isError: true });
      sse(res, { type: "error", error: `claude CLI not found or failed: ${err.message}` });
      resolve();
    });

    child.on("close", (code) => {
      if (failed) return; // already handled by 'error'
      sse(res, { type: "tool", name: "claude-code (local)", status: "done", isError: code !== 0 });
      if (code !== 0 && !out) {
        sse(res, { type: "error", error: `Local mode failed (exit ${code}). ${errOut.slice(0, 300) || "no output"}` });
        return resolve();
      }
      // --output-format json returns one JSON object with a `result` string.
      let text = out;
      try {
        const parsed = JSON.parse(out);
        text = parsed.result ?? parsed.text ?? out;
      } catch {
        /* fall back to raw stdout */
      }
      sse(res, { type: "text", text: String(text).trim() || "(no output from local model)" });
      sse(res, { type: "done" });
      resolve();
    });
  });
}
