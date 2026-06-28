// Option A: the Anthropic-powered analyst. Runs the agentic tool-use loop
// server-side (the API key never reaches the browser) and streams the assistant
// reply to the client as Server-Sent Events. Uses the official SDK.
//
// Loop: stream a turn → if Claude asked for tools, execute them against Solscan,
// feed results back, stream the next turn → repeat until it stops asking.

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool } from "./tools.js";

const SYSTEM = `You are a Solana on-chain analyst embedded in a blockchain explorer.
You answer questions about Solana tokens, wallets, transactions, and market quality by calling the provided tools to fetch LIVE data, then reasoning over it.

Rules:
- Always ground claims in tool results. If you haven't fetched the data, fetch it before asserting.
- For a "is this token good / safe / a rug?" question, prefer screen_token (GEM Score) and back it with token_meta / token_holders.
- For wallet questions, use account_detail and account_transactions.
- A Solana mint/address is base58, 32-44 chars. If the user gives something else, ask for a valid address.
- If a tool returns status 401 with "upgrade your api key level", explain that this needs a Solscan Pro key and fall back to what you CAN say (screen_token works without one).
- Be concise and lead with the answer. Render addresses in backticks. Not financial advice — note risk for memecoins.
- Stay on Solana on-chain topics; politely decline unrelated requests.`;

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;

// Write one SSE event. Each event is a JSON line under the default "message".
function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * Stream an analyst answer over SSE.
 * @param {object} opts
 * @param {Array} opts.messages  prior chat turns: [{role:'user'|'assistant', content:string}]
 * @param {string} opts.apiKey   Anthropic API key (server-side)
 * @param {string} opts.model    model id override (optional)
 * @param {string} opts.solscanKey
 * @param {object} res           Express response (SSE headers already set)
 */
export async function streamChat({ messages, apiKey, model, solscanKey }, res) {
  const client = new Anthropic({ apiKey });
  // Convert the simple chat history into Anthropic message params.
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: model || MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: TOOLS,
      messages: convo,
    });

    stream.on("text", (delta) => sse(res, { type: "text", text: delta }));

    let message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      sse(res, { type: "error", error: classify(err) });
      return;
    }

    if (message.stop_reason !== "tool_use") {
      // Done — natural end or refusal.
      if (message.stop_reason === "refusal") {
        sse(res, { type: "text", text: "\n\n_(The model declined to answer this request.)_" });
      }
      sse(res, { type: "done" });
      return;
    }

    // Append the assistant turn (with its tool_use blocks) verbatim.
    convo.push({ role: "assistant", content: message.content });

    // Execute every requested tool, announce each as a chip, collect results.
    const toolUses = message.content.filter((b) => b.type === "tool_use");
    const toolResults = [];
    for (const tu of toolUses) {
      sse(res, { type: "tool", name: tu.name, status: "start", input: tu.input });
      const { text, isError } = await runTool(tu.name, tu.input || {}, { solscanKey, nowMs: Date.now() });
      sse(res, { type: "tool", name: tu.name, status: "done", isError });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: text, is_error: isError });
    }
    // All results go back in ONE user message, then loop for the next turn.
    convo.push({ role: "user", content: toolResults });
  }

  sse(res, { type: "text", text: "\n\n_(Reached the tool-call limit for this turn.)_" });
  sse(res, { type: "done" });
}

function classify(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key. Set a valid key in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key lacks access to the model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Please retry shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Network error reaching Anthropic.";
  return `AI error: ${err?.message || err}`;
}
