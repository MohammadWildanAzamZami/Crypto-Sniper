import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { screenToken, screenAndAlert, batchScreen, isValidMint } from "./screener/screen.js";
import { runAutoScan } from "./screener/autoScreen.js";
import { runProRadar } from "./screener/proRadar.js";
import { getTrackRecord } from "./screener/learn.js";
import { sendAlert } from "./screener/telegram.js";
import { ALLOWED, solscanFetch } from "./solscan.js";
import { publicStatus, getState, applySettings, testTarget } from "./ai/settings.js";
import { streamChat } from "./ai/anthropic.js";
import { localChat } from "./ai/local.js";
import { getLatestScan, setLatestScan, markAlerted, radarBackend } from "./radarStore.js";
import { rateLimit, chatBudget, requireAdmin } from "./middleware/guard.js";

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
// Behind Render/Heroku/nginx the client IP is in X-Forwarded-For; trust one hop
// so req.ip (used by the rate limiter) is the real caller, not the proxy.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

// Baseline per-IP limit on the whole API so nobody can hammer the free backend.
app.use("/api", rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_MAX || 120), name: "global" }));

// Stricter limits for the expensive endpoints.
const chatLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.CHAT_RATE_MAX || 8), name: "chat" });
const chatDaily = chatBudget({ max: Number(process.env.CHAT_DAILY_MAX || 200) });
const scanLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.SCAN_RATE_MAX || 6), name: "scan" });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...publicStatus() });
});

// ---- Settings (keys stay server-side; GET returns status only) -----------
app.get("/api/settings", (_req, res) => res.json(publicStatus()));

app.post("/api/settings", requireAdmin, (req, res) => {
  res.json(applySettings(req.body || {}));
});

app.post("/api/settings/test", requireAdmin, async (req, res) => {
  const target = String(req.body?.target || "");
  res.json(await testTarget(target));
});

// ---- AI analyst chat (SSE stream) ----------------------------------------
// Holds the AI key server-side, runs the tool-calling loop, streams the reply.
app.post("/api/chat", chatLimit, chatDaily, async (req, res) => {
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

app.post("/api/screen-and-alert", requireAdmin, async (req, res) => {
  const addr = String(req.body?.token_address || req.query.token_address || "");
  if (!isValidMint(addr)) return res.status(400).json({ error: "Invalid Solana mint address." });
  try {
    res.json(await screenAndAlert(addr, { solscanKey: solscanKey(), nowMs: Date.now(), telegram: telegram() }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.post("/api/batch-screen", requireAdmin, async (req, res) => {
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
// "high upside" profile, and (de-duped) pushes new picks to Telegram. State
// lives in radarStore (Upstash Redis when configured, else a file / memory) so
// it survives restarts and de-dupes correctly across serverless instances.

async function runRadarOnce(preset) {
  const result = await runAutoScan({
    solscanKey: solscanKey(),
    nowMs: Date.now(),
    preset: preset || process.env.RADAR_PRESET || "balanced",
  });
  // Claim + alert up to 5 NEW picks. markAlerted is atomic (Redis SADD), so two
  // instances scanning at once won't both alert the same mint. Only the tokens
  // we actually send get claimed — the rest stay eligible for the next run.
  const tg = telegram();
  let newlyAlerted = 0;
  for (const m of result.matches) {
    if (newlyAlerted >= 5) break;
    if (await markAlerted(m.address)) {
      await sendAlert(m.report, tg);
      newlyAlerted++;
    }
  }
  const latestScan = {
    scannedAt: result.scannedAt,
    preset: result.preset,
    discovered: result.discovered,
    candidatesScanned: result.candidatesScanned,
    newlyAlerted,
    matches: result.matches.map(({ report, ...m }) => m), // strip heavy report for the client
  };
  await setLatestScan(latestScan);
  return latestScan;
}

app.get("/api/auto-screen", scanLimit, async (req, res) => {
  try {
    res.json(await runRadarOnce(req.query.preset));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/auto-screen/latest", async (_req, res) => {
  try {
    res.json(await getLatestScan());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---- Pro Radar (AI-boosted, Fable 5) -------------------------------------
// Same discovery funnel as the 10x Radar, but enriches the finalists with the
// liquidity-lock data and runs a Fable 5 ranking pass (conviction + thesis +
// red flags). Uses whatever AI mode is configured (local CLI or API key); if
// the AI is unavailable it degrades to pure-heuristic ordering (aiUsed:false).
// Self-learning track record (win rate + current auto-tuned thresholds). Cheap:
// reads the learn store, no scan. Defined before /api/:resource so it isn't shadowed.
app.get("/api/pro-radar/track", (_req, res) => {
  res.json(getTrackRecord());
});

app.get("/api/pro-radar", scanLimit, async (req, res) => {
  const st = getState();
  try {
    res.json(await runProRadar({
      solscanKey: solscanKey(),
      nowMs: Date.now(),
      preset: req.query.preset,
      ai: { aiMode: st.aiMode, aiKey: st.aiKey, model: st.model, claudePath: st.claudePath },
    }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ---- Generic Solscan proxy (allowlisted) — keep LAST so it doesn't shadow ----
app.get("/api/:resource", async (req, res) => {
  if (!ALLOWED[req.params.resource]) {
    return res.status(404).json({ error: `Unknown resource '${req.params.resource}'` });
  }
  const { status, body } = await solscanFetch(req.params.resource, req.query, solscanKey());
  res.status(status).json(body);
});

// ---- Serve the built frontend (single-port mode) ----
// Run `npm run build` in web/frontend first. Static assets are served from the
// Vite dist/, and any non-/api route falls back to index.html (SPA). When dist/
// is absent (e.g. backend hosted separately as a pure API, with the frontend on
// GitHub Pages) this is skipped and the server is API-only.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../frontend/dist");
if (existsSync(path.join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  console.log("[web] serving frontend build from dist/");
} else {
  console.log("[web] no frontend build found — running API-only");
}

// Run a normal long-lived HTTP listener (single-port: serves API + frontend).
// Background auto-scan interval (0 disables it).
const radarMins = Number(process.env.RADAR_INTERVAL_MIN || 15);
if (radarMins > 0) {
  setInterval(() => runRadarOnce().catch(() => {}), radarMins * 60_000);
  console.log(`[radar] auto-scan tiap ${radarMins} menit`);
}
app.listen(PORT, () => {
  console.log(`[solscan-proxy] listening on http://localhost:${PORT}`);
  console.log(`[radar] state backend: ${radarBackend()}`);
});

export default app;
