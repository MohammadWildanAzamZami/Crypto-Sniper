import "./loadenv.js"; // MUST be first — loads .env before settings.js reads process.env
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { radarBackend } from "./radarStore.js";
import { solscanKey } from "./context.js";
import { rateLimit } from "./middleware/guard.js";
import settingsRoutes from "./routes/settings.js";
import chatRoutes from "./routes/chat.js";
import screenRoutes from "./routes/screen.js";
import radarRoutes, { runRadarOnce } from "./routes/radar.js";
import autopsyRoutes, { sniperSweepOnce, discoverWalletsOnce } from "./routes/autopsy.js";
import { startWebhookAutoSync } from "./screener/heliusWebhook.js";
import { startEvmAuto } from "./screener/evmAuto.js";
import influencerRoutes from "./routes/influencers.js";
import robinhoodRoutes from "./routes/robinhood.js";
import proxyRoutes from "./routes/proxy.js";

const PORT = process.env.PORT || 8787;

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

// Feature routers. Order matters: the generic Solscan proxy (/:resource) matches
// any single-segment path, so it MUST be mounted LAST or it would shadow the
// specific routes (settings, chat, screen, radar).
app.use("/api", settingsRoutes);
app.use("/api", chatRoutes);
app.use("/api", screenRoutes);
app.use("/api", radarRoutes);
app.use("/api", autopsyRoutes);
app.use("/api", influencerRoutes);
app.use("/api", robinhoodRoutes);
app.use("/api", proxyRoutes);

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

// Sniper live monitor (Modul C). Primary path is now a HELIUS WEBHOOK: Helius pushes
// the instant a watched wallet swaps and we sweep immediately (near real-time). The
// interval below stays on as a SAFETY-NET fallback (covers a missed/unreachable
// webhook, e.g. no public URL). 0 disables the fallback; webhook needs a public URL.
startWebhookAutoSync();
const sniperMins = Number(process.env.SNIPER_POLL_MIN || 5);
if (sniperMins > 0) {
  setInterval(() => sniperSweepOnce().catch(() => {}), sniperMins * 60_000);
  console.log(`[sniper] live monitor: webhook real-time + fallback polling tiap ${sniperMins} menit`);
}

// Auto-discovery (Solana): populate the smart-wallet watchlist live from on-chain
// data — auto-Bedah trending winners + Birdeye top-trader harvest — so Modul B fills
// itself without manual "Bedah Coin". 0 disables it; needs a Birdeye key.
const discoveryMins = Number(process.env.SNIPER_DISCOVERY_MIN || 20);
if (discoveryMins > 0) {
  setInterval(() => discoverWalletsOnce().catch(() => {}), discoveryMins * 60_000);
  console.log(`[discovery] auto-isi watchlist tiap ${discoveryMins} menit`);
}

// Robinhood Chain (EVM) auto-loop: auto-seed watchlist dari winner trending → sniper sweep.
// 0 (RH_TICK_MIN=0) menonaktifkan. Butuh GeckoTerminal + Blockscout (publik, tanpa key).
if (Number(process.env.RH_TICK_MIN ?? 10) > 0) {
  const info = startEvmAuto();
  console.log(`[robinhood] auto-seed + sniper sweep tiap ${info?.tickMin} menit`);
}
app.listen(PORT, () => {
  console.log(`[solscan-proxy] listening on http://localhost:${PORT}`);
  console.log(`[radar] state backend: ${radarBackend()}`);
});

export default app;
