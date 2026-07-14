// 10x Radar (auto screener) + Pro Radar (AI-boosted). Discovers trending Solana
// tokens, screens them, keeps the high-upside picks, and (de-duped) pushes new
// ones to Telegram. State lives in radarStore so it survives restarts and
// de-dupes across serverless instances.
import { Router } from "express";
import { runAutoScan } from "../screener/autoScreen.js";
import { runProRadar } from "../screener/proRadar.js";
import { sendAlert } from "../screener/telegram.js";
import { getState } from "../ai/settings.js";
import { getLatestScan, setLatestScan, markAlerted } from "../radarStore.js";
import { scanLimit } from "../middleware/limits.js";
import { solscanKey, telegram } from "../context.js";

// One radar pass: scan, then claim + alert up to 5 NEW picks. markAlerted is
// atomic (Redis SADD), so two instances scanning at once won't both alert the
// same mint. Exported so index.js can also run it on a background interval.
export async function runRadarOnce(preset) {
  const result = await runAutoScan({
    solscanKey: solscanKey(),
    nowMs: Date.now(),
    preset: preset || process.env.RADAR_PRESET || "balanced",
  });
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

const router = Router();

router.get("/auto-screen", scanLimit, async (req, res) => {
  try {
    res.json(await runRadarOnce(req.query.preset));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.get("/auto-screen/latest", async (_req, res) => {
  try {
    res.json(await getLatestScan());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Same discovery funnel as the 10x Radar, but enriches finalists with liquidity
// lock data and runs a Fable 5 ranking pass. Degrades to heuristic ordering
// (aiUsed:false) when the AI is unavailable.
router.get("/pro-radar", scanLimit, async (req, res) => {
  const st = getState();
  try {
    res.json(await runProRadar({
      solscanKey: solscanKey(),
      nowMs: Date.now(),
      preset: req.query.preset,
      ai: { aiMode: st.aiMode, aiKey: st.aiKey, model: st.model, claudePath: st.claudePath },
      smart: { birdeyeKey: st.birdeyeKey, heliusKey: st.heliusKey },
    }));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

export default router;
