// Generic Solscan proxy (allowlisted). Mounted LAST in index.js so its
// single-segment /:resource match doesn't shadow the specific routes above.
import { Router } from "express";
import { ALLOWED, solscanFetch } from "../solscan.js";
import { solscanKey } from "../context.js";

const router = Router();

router.get("/:resource", async (req, res) => {
  if (!ALLOWED[req.params.resource]) {
    return res.status(404).json({ error: `Unknown resource '${req.params.resource}'` });
  }
  const { status, body } = await solscanFetch(req.params.resource, req.query, solscanKey());
  res.status(status).json(body);
});

export default router;
