// AI analyst chat (SSE stream). Holds the AI key server-side, runs the
// tool-calling loop, and streams the reply back token-by-token.
import { Router } from "express";
import { getState } from "../ai/settings.js";
import { streamChat } from "../ai/anthropic.js";
import { localChat } from "../ai/local.js";
import { chatLimit, chatDaily } from "../middleware/limits.js";
import { solscanKey } from "../context.js";

const router = Router();

router.post("/chat", chatLimit, chatDaily, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: "Provide a non-empty 'messages' array." });
  }

  // SSE headers.
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy/CDN buffering (e.g. nginx) so SSE chunks stream live.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const st = getState();
  try {
    if (st.aiMode === "local") {
      await localChat({ messages, claudePath: st.claudePath, solscanKey: solscanKey() }, res);
    } else if (st.aiProvider === "claude") {
      if (!st.aiKey) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "No Anthropic API key. Add one in Settings, or switch to Local mode." })}\n\n`);
      } else {
        await streamChat({ messages, apiKey: st.aiKey, model: st.model, solscanKey: solscanKey() }, res);
      }
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: `Provider '${st.aiProvider}' is not implemented in v1 (Claude only). Switch provider in Settings.` })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", error: String(err?.message || err) })}\n\n`);
  }
  res.end();
});

export default router;
