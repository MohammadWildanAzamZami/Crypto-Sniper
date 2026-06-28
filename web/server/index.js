import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { screenToken, screenAndAlert, batchScreen, isValidMint } from "./screener/screen.js";
import { runAutoScan } from "./screener/autoScreen.js";
import { sendAlert } from "./screener/telegram.js";
import { ALLOWED, solscanFetch } from "./solscan.js";
import { publicStatus, getState, applySettings, testTarget } from "./ai/settings.js";
import { streamChat } from "./ai/anthropic.js";
import { localChat } from "./ai/local.js";

dotenv.config();

const PORT = process.env.PORT || 8787;

// Keys live in the settings store (seeded from .env). Read them at call time so
// values entered in the Settings panel apply immediately, without a restart.
const solscanKey = () => getState().solscanKey;
const telegram = () => getState().telegram;

if (!solscanKey()) {
  console.error("[solscan-proxy] SOLSCAN_API_KEY is not set. Pro endpoints 401; screener still works via DexScreener.");
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...publicStatus() });
});

// ---- Settings (keys stay server-side; GET returns status only) -----------
app.get("/api/settings", (_req, res) => res.json(publicStatus()));

app.post("/api/settings", (req, res) => {
  res.json(applySettings(req.body || {}));
});

app.post("/api/settings/test", async (req, res) => {
  const target = String(req.body?.target || "");
  res.json(await testTarget(target));
});

// ---- AI analyst chat (SSE stream) ----------------------------------------
// Holds the AI key server-side, runs the tool-calling loop, streams the reply.
app.post("/api/chat", async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: "Provide a non-empty 'messages' array." });
  }

  // SSE headers.
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy/CDN buffering (Vercel/nginx) so SSE chunks stream live.
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

// ---- Screener (GEM Score™) endpoints -------------------------------------
app.get("/api/screen", async (req, res) => {
  const addr = String(req.query.token_address || "");
  if (!isValidMint(addr)) return res.status(400).json({ error: "Invalid Solana mint address (base58, 32–44 chars)." });
  try {
    res.json(await screenToken(addr, { solscanKey: solscanKey(), nowMs: Date.now() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post("/api/screen-and-alert", async (req, res) => {
  const addr = String(req.body?.token_address || req.query.token_address || "");
  if (!isValidMint(addr)) return res.status(400).json({ error: "Invalid Solana mint address." });
  try {
    res.json(await screenAndAlert(addr, { solscanKey: solscanKey(), nowMs: Date.now(), telegram: telegram() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post("/api/batch-screen", async (req, res) => {
  const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
  if (addresses.length === 0) return res.status(400).json({ error: "Provide a non-empty 'addresses' array." });
  try {
    res.json({ results: await batchScreen(addresses.slice(0, 20), { solscanKey: solscanKey(), nowMs: Date.now() }) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---- 10x Radar (auto screener) -------------------------------------------
// Discovers trending Solana tokens, screens them, keeps the ones that fit the
// "high upside" profile, and (de-duped) pushes new picks to Telegram.
let latestScan = { scannedAt: 0, preset: "balanced", discovered: 0, candidatesScanned: 0, matches: [], newlyAlerted: 0 };
const alertedMints = new Set();

async function runRadarOnce(preset) {
  const result = await runAutoScan({
    solscanKey: solscanKey(),
    nowMs: Date.now(),
    preset: preset || process.env.RADAR_PRESET || "balanced",
  });
  // Alert only tokens we haven't alerted before (cap per run to avoid spam).
  const tg = telegram();
  const fresh = result.matches.filter((m) => !alertedMints.has(m.address));
  for (const m of fresh.slice(0, 5)) {
    alertedMints.add(m.address);
    await sendAlert(m.report, tg);
  }
  latestScan = {
    scannedAt: result.scannedAt,
    preset: result.preset,
    discovered: result.discovered,
    candidatesScanned: result.candidatesScanned,
    newlyAlerted: fresh.length,
    matches: result.matches.map(({ report, ...m }) => m), // strip heavy report for the client
  };
  return latestScan;
}

app.get("/api/auto-screen", async (req, res) => {
  try {
    res.json(await runRadarOnce(req.query.preset));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/auto-screen/latest", (_req, res) => res.json(latestScan));

// ---- Generic Solscan proxy (allowlisted) — keep LAST so it doesn't shadow ----
app.get("/api/:resource", async (req, res) => {
  if (!ALLOWED[req.params.resource]) {
    return res.status(404).json({ error: `Unknown resource '${req.params.resource}'` });
  }
  const { status, body } = await solscanFetch(req.params.resource, req.query, solscanKey());
  res.status(status).json(body);
});

// Local dev / self-hosting: run a normal HTTP listener. On Vercel the app is
// imported and invoked as a serverless function instead (see /api/index.js), so
// we must NOT call listen() there.
if (!process.env.VERCEL) {
  // Local auto-scan interval (0 disables). Vercel uses a Cron job instead.
  const radarMins = Number(process.env.RADAR_INTERVAL_MIN || 15);
  if (radarMins > 0) {
    setInterval(() => runRadarOnce().catch(() => {}), radarMins * 60_000);
    console.log(`[radar] auto-scan tiap ${radarMins} menit`);
  }
  app.listen(PORT, () => {
    console.log(`[solscan-proxy] listening on http://localhost:${PORT}`);
  });
}

export default app;
