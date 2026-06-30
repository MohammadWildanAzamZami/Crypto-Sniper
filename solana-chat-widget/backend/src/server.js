// Express proxy untuk widget chat. Menyimpan ANTHROPIC_API_KEY di server (tidak
// pernah sampai ke browser), meneruskan pesan ke Claude API, dan mengalirkan
// jawabannya kembali ke widget via SSE.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

dotenv.config();

const PORT = process.env.PORT || 8788;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const RATE_MAX = Number(process.env.RATE_MAX || 15);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[widget] ANTHROPIC_API_KEY belum diset di .env — /api/chat akan menolak sampai diisi.");
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: "256kb" }));

// Rate limit sederhana per-IP untuk melindungi saldo API.
const hits = new Map();
app.use("/api/chat", (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || "x";
  let e = hits.get(ip);
  if (!e || now > e.resetAt) { e = { c: 0, resetAt: now + 60_000 }; hits.set(ip, e); }
  if (++e.c > RATE_MAX) {
    res.set("Retry-After", String(Math.ceil((e.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." });
  }
  next();
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, model: MODEL, keyed: Boolean(process.env.ANTHROPIC_API_KEY) })
);

app.post("/api/chat", async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length === 0) return res.status(400).json({ error: "Field 'messages' kosong." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server belum punya ANTHROPIC_API_KEY (isi di backend/.env)." });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.slice(-20).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
    });
    stream.on("text", (t) => res.write(`data: ${JSON.stringify({ type: "delta", text: t })}\n\n`));
    await stream.finalMessage();
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", error: String(err?.message || err) })}\n\n`);
  }
  res.end();
});

app.listen(PORT, () => console.log(`[widget] backend di http://localhost:${PORT} (model ${MODEL})`));
