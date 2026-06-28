// Vercel serverless entry point.
// Re-exports the Express app from web/server so every /api/* request (rewritten
// by vercel.json) is handled by the same backend used in local dev.
import app from "../web/server/index.js";

export default app;
