// Tool surface exposed to Claude. Each tool maps to an allowlisted Solscan
// resource (or the screener), so the AI can only reach data we already expose.
// The schemas are what Claude reads to decide when/how to call — descriptions
// are prescriptive about WHEN to call, which improves tool selection.

import { solscanFetch } from "../solscan.js";
import { screenToken } from "../screener/screen.js";

export const TOOLS = [
  {
    name: "chain_info",
    description:
      "Get current Solana network status: block height, current epoch, total transaction count. " +
      "Call this when the user asks about the chain/network state or as a connectivity check.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "token_meta",
    description:
      "Get metadata for one SPL token by mint address: name, symbol, price, market cap, holder count, supply. " +
      "Call this first whenever the user asks about a specific token.",
    input_schema: {
      type: "object",
      properties: { token_address: { type: "string", description: "Token mint (base58, 32-44 chars)." } },
      required: ["token_address"],
      additionalProperties: false,
    },
  },
  {
    name: "token_holders",
    description:
      "Get the top holders of a token (address + amount), with the total holder count. " +
      "Call this when judging whether supply is concentrated (whale/rug risk) or distribution looks healthy. " +
      "Requires a Solscan Pro key; on the free tier this returns a 401 you should explain.",
    input_schema: {
      type: "object",
      properties: {
        token_address: { type: "string" },
        page: { type: "integer", description: "Page number, default 1." },
        page_size: { type: "integer", description: "Holders per page (10/20/30/40), default 20." },
      },
      required: ["token_address"],
      additionalProperties: false,
    },
  },
  {
    name: "account_detail",
    description:
      "Get details for a wallet/account address: SOL balance, type, owner program, executable flag. " +
      "Call this to characterise a wallet before judging its behaviour.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string", description: "Solana account address (base58)." } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "account_transactions",
    description:
      "List recent transactions for a wallet (signatures, time, status, fee). " +
      "Call this when investigating wallet activity, bot-like patterns, or recent moves.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string" },
        limit: { type: "integer", description: "How many to return (10/20/30/40), default 10." },
        before: { type: "string", description: "Pagination cursor (a tx signature)." },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "screen_token",
    description:
      "Run the GEM Score (0-100) screener on a token mint: liquidity, momentum, and trust pillars plus a " +
      "STRONG/WATCH/SKIP verdict, computed from live DexScreener data (works without a Solscan key). " +
      "Call this when the user wants an overall quality/risk judgement or asks 'is this a good buy / a rug?'.",
    input_schema: {
      type: "object",
      properties: { token_address: { type: "string" } },
      required: ["token_address"],
      additionalProperties: false,
    },
  },
];

/**
 * Execute one tool call. Returns a string (Claude reads tool_result content as
 * text). Errors are returned as text with isError handled by the caller.
 * @returns {Promise<{text: string, isError: boolean}>}
 */
export async function runTool(name, input, { solscanKey, nowMs }) {
  try {
    switch (name) {
      case "chain_info":
        return wrap(await solscanFetch("chain-info", {}, solscanKey));
      case "token_meta":
        return wrap(await solscanFetch("token-meta", { token_address: input.token_address }, solscanKey));
      case "token_holders":
        return wrap(await solscanFetch("token-holders", {
          token_address: input.token_address,
          page: input.page ?? 1,
          page_size: input.page_size ?? 20,
        }, solscanKey));
      case "account_detail":
        return wrap(await solscanFetch("account-detail", { address: input.address }, solscanKey));
      case "account_transactions":
        return wrap(await solscanFetch("account-transactions", {
          address: input.address,
          limit: input.limit ?? 10,
          before: input.before,
        }, solscanKey));
      case "screen_token": {
        const report = await screenToken(input.token_address, { solscanKey, nowMs });
        return { text: JSON.stringify(report), isError: false };
      }
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { text: `Tool error: ${err.message || err}`, isError: true };
  }
}

// Forward Solscan's real status so the model can explain 401/429 etc.
function wrap({ ok, status, body }) {
  const text = JSON.stringify({ status, ok, data: body });
  return { text, isError: !ok };
}
