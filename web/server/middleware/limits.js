// Stricter per-IP limits for the expensive endpoints, plus a daily chat budget.
// Instances are built once at module load (they read env then). The baseline
// whole-API limiter lives in index.js.
import { rateLimit, chatBudget } from "./guard.js";

export const chatLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.CHAT_RATE_MAX || 8), name: "chat" });
export const chatDaily = chatBudget({ max: Number(process.env.CHAT_DAILY_MAX || 200) });
export const scanLimit = rateLimit({ windowMs: 60_000, max: Number(process.env.SCAN_RATE_MAX || 6), name: "scan" });
