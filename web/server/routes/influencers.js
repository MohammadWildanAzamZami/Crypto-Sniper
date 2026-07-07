// Influencer watchlist (SNIPER ENGINE Modul B2) — manage the manually-tracked
// influencer wallets that the live monitor (Modul C) sweeps alongside the
// self-learning smart wallets.
//   GET    /api/influencers        — list tracked influencers
//   POST   /api/influencers        — add one { owner, label, handle }
//   DELETE /api/influencers/:owner  — stop tracking one
// No auth (local tool), consistent with the other routers.
import { Router } from "express";
import { addInfluencer, removeInfluencer, getInfluencers } from "../screener/influencers.js";

const router = Router();

router.get("/influencers", (_req, res) => {
  try {
    res.json(getInfluencers());
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.post("/influencers", (req, res) => {
  try {
    const { owner, label, handle } = req.body || {};
    const r = addInfluencer({ owner, label, handle });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.status(201).json(r.influencer);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

router.delete("/influencers/:owner", (req, res) => {
  try {
    res.json(removeInfluencer(req.params.owner));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

export default router;
