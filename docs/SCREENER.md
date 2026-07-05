# Solana Token Screener — GEM Score™ (combined build)

This layers the **GEM Score screener + Telegram alerts** from the setup guide on
top of the SolScanMcp repo, reusing one screening core in three places:

```
                         web/server/screener/   (the core: sources + gemScore + telegram)
                          /            |            \
        web/server/index.js     web/mcp/server.js    (reusable from any CLI)
        Express proxy (browser) MCP stdio (Claude Desktop)
```

## What GEM Score measures (0–100, weighted 40/35/25)

| Pillar | Weight | Signals |
|--------|--------|---------|
| Liquidity & Market | 40 | liquidity depth, 24h volume, volume/liquidity turnover |
| Momentum | 35 | 1h/6h price action, buy/sell balance, trade count |
| Trust & Age | 25 | pair maturity, # of DEX pairs, holder count (Solscan, optional) |

Verdict gates: **≥70 STRONG**, **50–69 WATCH**, **<50 SKIP**.

> Backbone is **DexScreener** (public, no key), so the score works without a
> Solscan Pro key. Solscan only *enriches* holder data when a key is present.

## Run the web app (check in browser)

```powershell
cd web/server
npm install
Copy-Item .env.example .env   # optional: fill SOLSCAN/TELEGRAM keys
npm run dev                    # http://localhost:8787

# second terminal
cd web/frontend
npm install
npm run dev                    # http://localhost:5173  ← open this
```

Open http://localhost:5173 → the **GEM Score™ Screener** panel is at the top.
USDC is preloaded as a demo. Click **Screen**; click **Alert Telegram** to push
a Telegram message (needs TELEGRAM_* in `web/server/.env`).

### HTTP endpoints (proxy)

- `GET  /api/screen?token_address=<mint>` → full GEM Score report
- `POST /api/screen-and-alert` `{ token_address }` → report + Telegram status
- `POST /api/batch-screen` `{ addresses: [...] }` → ranked results
- `GET  /api/health` → `{ ok, hasKey, telegram }`

## Use from Claude Desktop (MCP)

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "solana-screener": {
      "command": "node",
      "args": ["C:\\Users\\Daris Novita Sari\\SolScanMcp\\web\\mcp\\server.js"],
      "env": {
        "SOLSCAN_API_KEY": "optional_for_holder_data",
        "TELEGRAM_BOT_TOKEN": "optional",
        "TELEGRAM_CHAT_ID": "optional"
      }
    }
  }
}
```

Tools exposed: `screen_token`, `screen_and_alert`, `batch_screen`,
`get_holder_analysis`, `check_bonding_curve`.

## Safety boundary

The screener **never touches a wallet, seed phrase, or private key**. "Buy via
Trojan" is only a `t.me/solana_trojanbot?start=buy_<mint>` deep-link — the human
taps it and confirms inside Trojan. GEM Score is a heuristic on public data,
**not financial advice**. Memecoins can go to zero — DYOR.
