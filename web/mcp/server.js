#!/usr/bin/env node
/**
 * solana-screener MCP server (Node, stdio, zero-dependency).
 *
 * Exposes the GEM Score™ screener to Claude Desktop as MCP tools, mirroring the
 * setup guide: screen_token, screen_and_alert, batch_screen, get_holder_analysis,
 * check_bonding_curve. Reuses the same screening core as the web proxy.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio spec).
 * Secrets come from env (set them in claude_desktop_config.json):
 *   SOLSCAN_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
import { createInterface } from "node:readline";
import { screenToken, screenAndAlert, batchScreen } from "../server/screener/screen.js";

const SOLSCAN_KEY = process.env.SOLSCAN_API_KEY;
const TELEGRAM = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
};

// stderr is safe for logs; stdout is reserved for the JSON-RPC stream.
const log = (...a) => console.error("[solana-screener-mcp]", ...a);

const TOOLS = [
  {
    name: "screen_token",
    description:
      "Run the GEM Score (0-100) screener on a single Solana token mint. Returns " +
      "the score, verdict (STRONG/WATCH/SKIP), pillar breakdown and live market metrics.",
    inputSchema: {
      type: "object",
      properties: { token_address: { type: "string", description: "Solana token mint (base58)." } },
      required: ["token_address"],
    },
  },
  {
    name: "screen_and_alert",
    description:
      "Screen a token AND push a Telegram alert with the GEM Score and a Trojan buy " +
      "deep-link. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.",
    inputSchema: {
      type: "object",
      properties: { token_address: { type: "string" } },
      required: ["token_address"],
    },
  },
  {
    name: "batch_screen",
    description: "Screen up to 20 token mints at once and return them ranked by GEM Score.",
    inputSchema: {
      type: "object",
      properties: {
        addresses: { type: "array", items: { type: "string" }, description: "List of mints." },
      },
      required: ["addresses"],
    },
  },
  {
    name: "get_holder_analysis",
    description:
      "Holder-distribution slice of the screener for one token (needs Solscan Pro key " +
      "for holder data; otherwise returns market-only signals).",
    inputSchema: {
      type: "object",
      properties: { token_address: { type: "string" } },
      required: ["token_address"],
    },
  },
  {
    name: "check_bonding_curve",
    description:
      "Maturity / entry-timing read for a token: pair age, liquidity depth and momentum " +
      "summarised from the GEM Score pillars.",
    inputSchema: {
      type: "object",
      properties: { token_address: { type: "string" } },
      required: ["token_address"],
    },
  },
];

async function dispatch(name, args) {
  const nowMs = Date.now();
  const opts = { solscanKey: SOLSCAN_KEY, nowMs };

  switch (name) {
    case "screen_token":
      return await screenToken(args.token_address, opts);
    case "screen_and_alert":
      return await screenAndAlert(args.token_address, { ...opts, telegram: TELEGRAM });
    case "batch_screen":
      return { results: await batchScreen(args.addresses || [], opts) };
    case "get_holder_analysis": {
      const r = await screenToken(args.token_address, opts);
      return {
        token: r.token,
        holdersEnriched: r.holdersEnriched,
        trustPillar: r.pillars.find((p) => p.name === "Trust & Age"),
        note: r.holdersEnriched ? undefined : "Holder counts need a Solscan Pro key.",
      };
    }
    case "check_bonding_curve": {
      const r = await screenToken(args.token_address, opts);
      return {
        token: r.token,
        gemScore: r.gemScore,
        verdict: r.verdict,
        liquidityUsd: r.metrics.liquidityUsd,
        volume24h: r.metrics.volume.h24,
        priceChange: r.metrics.priceChange,
        entryHint:
          r.gemScore >= 70
            ? "Liquidity & momentum healthy — entry zone (DYOR)."
            : r.gemScore >= 50
              ? "Mixed — wait for confirmation."
              : "Weak signals — likely too early or too risky.",
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---- JSON-RPC plumbing ----------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "solana-screener", version: "1.0.0" },
      });
    case "notifications/initialized":
      return; // notification, no response
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args } = params || {};
      try {
        const data = await dispatch(name, args || {});
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        });
      } catch (err) {
        return reply(id, {
          content: [{ type: "text", text: `Error: ${err.message || err}` }],
          isError: true,
        });
      }
    }
    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return log("dropped non-JSON line");
  }
  handle(msg).catch((e) => log("handler error:", e));
});

log("ready on stdio. Solscan key:", SOLSCAN_KEY ? "set" : "absent",
  "| Telegram:", TELEGRAM.botToken && TELEGRAM.chatId ? "configured" : "off");
