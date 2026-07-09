# Handover — Memecoin-Screener (Solana GEM Score + AI Analyst)

> **For the next engineer (and for Claude Code).** This document captures the
> current state, how to run everything, decisions already made, known issues, and
> a prioritized roadmap toward a production-grade, professional setup.
>
> For a readable, Indonesian-language overview of everything built (with
> flowcharts), see [LAPORAN.md](LAPORAN.md).
>
> A separate **product/design spec** is maintained by the team outside this repo.
> Where this document and that spec disagree, the spec wins — reconcile before
> building. Ask the owner to link the spec when you start.

---

## 1. TL;DR — current state

The repo grew from "Solscan MCP server + a sample explorer page" into a full
**memecoin screening platform** — Solana first, kini juga **Robinhood Chain (EVM)**.
Sistem yang live:

| Area | Status | Notes |
|------|--------|-------|
| **GEM Score™ screener** | ✅ Works | 0–100 score, 3 weighted pillars; DexScreener-only works key-less |
| **10x Radar** (auto-screener) | ✅ Works | discover → screen → filter → Telegram, runs on an interval/Cron |
| **Pro Radar** (AI-boosted radar) | ✅ Works | 10x funnel + RugCheck/Pump.fun enrich + hard quality gate + **Fable 5** rank + **win-rate self-tuning** + **smart money** (Birdeye+Helius) + inline chart; `GET /api/pro-radar`, degrades gracefully. See §3.4 |
| **Sniper Engine** (Bedah Coin + Watchlist + Live Monitor) | ✅ Works | Forensic autopsy of a pumped token → early-buyer smart wallets → self-learning watchlist → live monitor raises accumulation signals. **v2 (2026-07-07):** live-editable parameter registry (Settings, no restart), net-buy engine, dual signal streams (Awal/v1 + v2). **2026-07-08/10:** hold/exit tracking (signal auto-removed once smart money fully sold — `{mint}` balance check with public-RPC fallback when Helius RPC 429s), **$20k min-mcap floor** (both streams), and **real-time Helius webhook** (push replaces 5-min polling; auto-detects ngrok/`PUBLIC_URL`; polling stays as fallback). `GET /api/autopsy`, `/api/watchlist`, `/api/sniper/signals`, `POST /api/sniper/helius-webhook`. Needs Birdeye+Helius. Design in **[SNIPER-ENGINE.md](SNIPER-ENGINE.md)**, params in **[REKAP-PARAMETER.md](REKAP-PARAMETER.md)** |
| **AI Analyst chat** | ✅ Works | Claude tool-loop over SSE; API key or local Claude-CLI mode. **Model locked to `claude-fable-5`** (only option in Settings). **Local mode strips `ANTHROPIC_API_KEY` from the spawned CLI's env** (in `local.js`/`explainSignal.js`/`analyze.js`) so it always uses the subscription login — fixes "Invalid API key"/"credit balance too low" when the `.env` key is empty/low-balance |
| **Robinhood Chain (EVM)** ecosystem | ✅ Works | Pipeline kembar di **Robinhood Chain** (EVM L2, chain 4663): Discover → Screen/GEM → Bedah → Watchlist → Sniper + **auto-pilot** (menumbuhkan watchlist sendiri). Data on-chain nyata via **GeckoTerminal + Blockscout** (tanpa API key); gate keamanan heuristik (GoPlus/Honeypot.is belum dukung chain ini). Zona terpisah, toggle Solana ⇄ Robinhood di UI. `GET/POST /api/robinhood/*`. Detail: **[ROBINHOOD-CHAIN.md](ROBINHOOD-CHAIN.md)** |
| **Telegram alerts + Trojan link** | ✅ Works | HTML alert + 1-tap buy deep-link (no wallet held) |
| **Node MCP server** (`web/mcp`) | ✅ Works | 5 screener tools for Claude Desktop, shares the screening core |
| Rust MCP server (`solscan-mcp`) | ✅ Builds & runs | 37 Solscan tools over stdio (original server) |
| Solscan connectivity | ✅ Verified | `chain_info` public; Pro endpoints need a Pro key |
| Pro endpoints | ⚠️ Plan-gated | Free key → `401 upgrade your api key level` (handled gracefully) |
| Web UI (`web/frontend`) | ✅ Builds & runs | Vite + Vue 3, token-driven design system. **2026-07-10:** tema **hitam pekat** (semua latar abu-abu → `#000` via `tokens.css`); panel Solana dibungkus **kotak** (`.sol-box`) sejajar kotak Robinhood (`.rh`); **tombol melayang** kini pemindah view **Solana ⇄ Robinhood** (menggantikan tombol "Kalkulator manual" yang dihapus — `ManualScoringPanel` dihapus permanen) |
| API proxy (`web/server`) | ✅ Runs | Express, keeps all secrets server-side; serves the frontend build on one port |
| Tests / CI | ❌ None | See roadmap §6 |
| Docker | ❌ WIP | README says "available soon" |

The screener works **out of the box without any key** because DexScreener is the
backbone; Solscan (holders) and RugCheck (LP lock) only enrich the score.

---

## 2. Repository layout

```
Memecoin-Screener/
├── CLAUDE.md              # Auto-loaded context for Claude Code (stays at root)
├── README.md              # Original project README (install + usage)
├── docs/                  # All project documentation, centralised
│   ├── HANDOVER.md        # This file
│   ├── LAPORAN.md         # Indonesian overview + flowcharts of everything built
│   ├── PRO-RADAR.md       # Pro Radar (Fable 5) data-flow + Mermaid/ASCII flowcharts
│   ├── SCREENER.md        # Screener deep-dive
│   ├── DEPLOY.md          # Deployment notes
│   └── TOOLS.md           # Reference for all Rust MCP tools
├── Cargo.toml / .lock     # Rust crate manifest
├── src/                   # Rust MCP server (37 Solscan tools over stdio)
│   ├── main.rs            # Entry point: env key → serve over stdio
│   └── solscan_mcp/
│       ├── api.rs         # All 37 tools + request helpers + ServerHandler (~1480 lines)
│       └── requests/      # Request param structs, grouped by namespace
└── web/
    ├── server/            # Express proxy — ALL secrets live here (seeded from .env)
    │   ├── index.js       # Routes: /api/screen, /api/auto-screen, /api/pro-radar(/track), /api/chat, /api/:resource
    │   ├── solscan.js     # Allowlist + fetch to Solscan
    │   ├── ai/            # AI analyst: anthropic.js (SSE tool-loop), local.js,
    │   │                  #   analyze.js (Fable 5 Pro-Radar ranking),
    │   │                  #   tools.js (6 tools), settings.js (secret store + tests)
    │   └── screener/      # Framework-free screening core:
    │       ├── screen.js      #   orchestrator (single / batch)
    │       ├── gemScore.js    #   the 3-pillar 0–100 score
    │       ├── sources.js     #   DexScreener + Solscan holders + RugCheck lock
    │       ├── discover.js    #   trending-token feeds (Radar input)
    │       ├── autoScreen.js  #   10x Radar: discover → screen → filter
    │       ├── proRadar.js    #   Pro Radar: funnel → enrich → quality gate → Fable 5 → self-tune
    │       ├── quality.js     #   hard anti-junk gate (rug/thin-liq/honeypot/dump)
    │       ├── learn.js       #   self-tuning: win-rate controller + starvation guard
    │       ├── smartMoney.js  #   smart money: Birdeye top traders + Helius wallet verify
    │       └── telegram.js    #   alert formatting + Trojan deep-link
    ├── mcp/server.js      # Node MCP server (5 screener tools) for Claude Desktop
    └── frontend/          # Vite + Vue 3 app
        └── src/
            ├── styles/tokens.css   # Design tokens (primitive + semantic)
            ├── components/         # ScreenerPanel, RadarPanel, SettingsPanel,
            │                       #   Chat{Widget,Panel,Composer,Message}, plus
            │                       #   AppButton, AppInput, AppLink, DataTable, StatList
            ├── composables/useSolscan.js
            └── pages/ExplorerPage.vue
```

---

## 3. Architecture & key decisions

### 3.1 Why a proxy sits between the browser and the APIs
- The Rust MCP server communicates over **stdio**, so it is reachable by MCP
  clients (Claude Desktop, MCP Inspector) — **not** by a browser.
- The Solscan/Anthropic/Telegram keys are secrets. Embedding any in the Vue bundle
  would leak it to anyone who opens devtools. The Express proxy holds all keys (in
  the `ai/settings.js` store, seeded from `.env`) and exposes only allowlisted
  endpoints. GET endpoints return status booleans, never the secret values.

```
MCP client    ──stdio──▶  solscan-mcp (Rust)        ──▶  Solscan API
Claude Desktop──stdio──▶  web/mcp/server.js (Node)   ──▶  screening core
Browser (Vue) ─/api/*─▶   Express proxy (:8787)      ──▶  DexScreener / RugCheck /
                                                          Solscan / Anthropic / Telegram
```

### 3.2 GEM Score™ — three weighted pillars
The score (`screener/gemScore.js`) is a transparent 0–100 heuristic — **not** a
prediction or financial advice. Pillars: **Liquidity & Market (40)**,
**Momentum (35)**, **Trust & Age (25)**. Verdict: STRONG ≥70, WATCH ≥50, else SKIP.
DexScreener is required (backbone); Solscan holders and RugCheck lock only enrich,
and every enrichment **degrades to null on failure** so the score still computes.

### 3.3 10x Radar — automated funnel
`screener/autoScreen.js` discovers trending Solana mints (DexScreener boost/profile
feeds), screens them with bounded concurrency (`skipLock` keeps the bulk scan fast),
filters against a preset (aggressive / balanced / conservative), and de-dupes new
matches before pushing to Telegram. Runs on a `setInterval` (default 15 min); set
`RADAR_INTERVAL_MIN=0` to disable, or trigger `GET /api/auto-screen` from an
external scheduler/cron if you prefer to drive it on demand.

### 3.4 Pro Radar — AI-ranked variant of the funnel (+ quality gate + self-tuning)
`screener/proRadar.js` reuses the 10x Radar discovery funnel (wider net, ~40 mints),
fast-screens them for GEM Score, keeps the top-14 finalists, then **enriches** those
finalists with RugCheck LP-lock data and runs an AI ranking pass via
`ai/analyze.js` on **Fable 5** (`claude-fable-5`). The model returns, per token,
`conviction` (0–100), `tier` (S/A/B/C), a `thesis`, `catalysts[]`, `redFlags[]`, and
an `action` (APE/WATCH/AVOID). The AI runs through whatever mode is configured (local
Claude-CLI or Anthropic API); if it's unavailable it **degrades to pure-heuristic GEM
ordering** and returns `aiUsed:false` (the UI shows a ⚠️ badge). Exposed at
`GET /api/pro-radar`. Full data-flow + flowcharts live in `docs/PRO-RADAR.md`.

**Quality gate (`screener/quality.js`).** After enrichment, a hard gate runs
*before* the AI: it drops `rugged` tokens, zero-market-cap, thin liquidity/volume,
dead trade counts, one-sided books (near-all-buys ≈ honeypot, near-all-sells ≈ dump),
and known-but-low LP lock. This is what removed the junk that used to pad the list.

**AI-drop, not just sort.** Post-AI, tokens judged `AVOID` or below the (tuned)
conviction floor are **removed** from the results (a small top-3 floor keeps the panel
non-empty when the AI is harsh). Each surviving token also gets a blended
`quality = 0.5·gem + 0.5·conviction` (the **Q** badge), which is the primary sort key.

**Self-tuning loop (`screener/learn.js`) — win-rate-target controller.** Evidence-based,
not prediction. Every displayed pick is snapshotted with its entry price (`recordPicks`)
into a gitignored `web/server/screener/.radar-memory.json` (file-backed, in-memory
fallback). On a later scan, matured picks (default ≥3h, `RADAR_GRADE_AFTER_MIN`) are
graded live — current price vs entry → **win** (≥+50%) / **loss** (≤−25%) / **rug**
(≤10% of entry or delisted) / **flat** (`gradeAndRetune`). A closed-loop controller then
drives the gate thresholds toward a **target win rate** (`RADAR_TARGET_WINRATE`, default
**0.9**): when below target it tightens EVERY lever proportionally to the gap — `minGem`,
`minLiquidity`, `minVolume`, `minTx`, `minLockedPct`, `minConviction` up and
`maxDrawdownFromAth` down — and, on a big miss or ongoing rugs, escalates to
`requirePumpComplete` (graduated-pump-only); above target it relaxes slightly. All values
clamped to wide-but-sane bounds. Exposed at `GET /api/pro-radar/track` and shown in the
UI (🧬 Self-tuning strip: 🎯 target, win rate, ⚙️ auto-tightening status, live thresholds).
**Not a profit guarantee — 0.9 is a setpoint it *chases*, not a promise.** Chasing a high
target mostly means FEWER, safer picks (often 0–2, or empty in strict mode); memecoins
can't actually be won 90% of the time.

**Pump.fun signals (`fetchPumpfun` in `sources.js`).** For pump-origin mints, enrichment
also pulls the pump.fun v3 API (`frontend-api-v3.pump.fun/coins/<mint>`, key-less): bonding
-curve `complete` (graduated), drawdown from ATH market cap, and banned/nsfw/hidden flags.
The gate rejects banned/nsfw/hidden, big ATH drawdowns, and (strict mode) non-graduated
tokens; the AI payload and UI (🎓 grad badge) surface graduation too. Degrades to null for
non-pump tokens or API failure. **Note:** Solscan holder-concentration would add another
signal but needs a Pro key (absent on the free tier).

**Smart money tracking (`screener/smartMoney.js`) — Birdeye + Helius, interlocking.**
For each enriched finalist (when a Birdeye key is set): **Birdeye** `/defi/v2/tokens/top_traders`
gives the token's 24h top traders with USD buy/sell volume, wallet `tags` (whale/bundler),
and per-trader PnL; **Helius** `/v0/addresses/<owner>/transactions` verifies the top few are
established wallets (real history) rather than fresh sniper/bundle wallets. Combined into a
0–100 `smartScore` (net buy pressure + whales accumulating + profitable traders + breadth +
Helius verification) surfaced in the AI payload, the blended quality score (+up to 12), and a
UI badge (🧠 Smart N · 🐋). Both keys live server-side in the settings store (seeded from
`BIRDEYE_API_KEY` / `HELIUS_API_KEY`), editable in the Settings panel (🧠 Smart money section,
with a Test button → `testTarget("smart")`); `publicStatus()` exposes `smartMoneyEnabled`.
Birdeye is required; Helius optional; both degrade to null (feature off) with no key.
`smartMoney.js` retries on 429/5xx so a free-tier burst during the enrich fan-out doesn't
null everything. **Note:** the free Birdeye tier is CU/rate-limited — a public deployment
that scans often will consume the operator's quota.

**Starvation guard (`learn.js` `noteScanYield`).** The win-rate controller chasing 0.9 against
a real ~15% win rate will tighten the gate to the point of an empty radar — which then can
never gather outcomes to improve. If a scan surfaces 0 picks `STARVE_LIMIT` (2) times in a
row, the thresholds relax a step (and `requirePumpComplete` clears) so the funnel reopens.
Tuning bounds were also capped below "impossible" (e.g. `minLockedPct` max 92, not 100).

**.env load order fix (`loadenv.js`).** `ai/settings.js` reads `process.env` at import time to
seed secrets; ESM evaluates imports before the entrypoint body, so the old `dotenv.config()`
in `index.js` ran *after* settings had already read a still-empty env — `.env`-seeded keys
never took effect. `index.js` now imports `./loadenv.js` first (it calls `dotenv.config()`),
so `.env` is loaded before any module initialises.

**Inline chart.** Clicking a token in the Pro Radar list embeds its DexScreener chart
(inline on desktop, floating overlay on mobile with the attribution footer masked and the
token logo in the header); the backend sends a `chartUrl` per match.

### 3.4b Sniper Engine — Bedah Coin → Watchlist → Live Monitor

A three-module loop that turns "who bought the last winner early" into "who is
buying the next one now". Built in three stages; full design, decisions (D1–D7),
and the calibration log live in **[SNIPER-ENGINE.md](SNIPER-ENGINE.md)**.

- **Modul A — Bedah Coin (`screener/autopsy.js`, `GET /api/autopsy?mint=`).**
  Forensic autopsy of a token that already pumped. Pages Birdeye
  `txs/token?sort_type=asc` (oldest-first trades) until market cap crosses $100k,
  reconstructs `mcapAtTrade = price × supply`, and extracts the **early buyers**
  in two tiers (ultra-early <$50k, early <$100k). For each: entry→now multiple,
  held-vs-sold, Helius wallet age (mapan/fresh). Detects **bundle/bot** clusters
  (same-second buys with near-uniform amounts) and excludes them. Output: ranked
  **smart-wallet candidates**. Cost-bounded (≤8 pages; top candidates verified).
- **Modul B — Watchlist (`screener/watchlist.js`, `GET /api/watchlist`).**
  Self-learning store keyed by wallet. When an autopsy of a **real winner**
  (`launchToNowX ≥ SNIPER_WINNER_MIN_X`, default 10) runs, its clean candidates
  are auto-recorded as "catches" (idempotent per mint). Reputation 0–100 from
  distinct winners caught + entry quality + Helius-established. Top
  `SNIPER_WATCH_SIZE` (40) = the **active** set. Persists to
  `screener/.watchlist-state.json` (gitignored).
- **Modul C — Live Monitor (`screener/sniper.js`, `GET /api/sniper/signals` +
  `/sniper/sweep`).** A background sweep every `SNIPER_POLL_MIN` (5 min) reads each
  active wallet's recent buys (Helius parsed txs / `tokenTransfers`), groups by
  token, and raises a **signal** when ≥ `SNIPER_SIGNAL_MIN` (2) distinct proven
  wallets are buying the same still-small token (mcap < `SNIPER_SIGNAL_MAX_MCAP`,
  2M). Signals dedupe + expire (TTL); Birdeye enrichment is bounded/parallel
  (cap 20 candidates → ~11 s/sweep). Persists to `screener/.sniper-state.json`.

All degrade safely (no key → feature off; failures → null, never throw). Signal
quality rises as the watchlist accumulates more diverse winners — early on it can
be noisy with wallets from a single token. UI: three panels (`AutopsyPanel`,
`WatchlistPanel`, `SniperPanel`) in `ExplorerPage`, after Pro Radar. NOT financial
advice — the whole engine is heuristic.

### 3.5 AI analyst — server-side tool-loop
`ai/anthropic.js` runs Claude's agentic tool-use loop server-side and streams the
reply over SSE. The 6 tools (`ai/tools.js`) map to the same allowlisted Solscan
resources and the screener, so the model can only reach data we already expose.
A **local mode** (`ai/local.js`) drives the Claude CLI instead of the API.

### 3.6 Design system is token-driven
- All raw values (color/space/type/radius/motion) live once in
  `web/frontend/src/styles/tokens.css` as **primitive** tokens, aliased to
  intent-based **semantic** tokens. Components reference semantic tokens only.
- Rationale: single source of truth, theme-ability, and consistency — changing a
  brand color is a one-line edit.

### 3.7 Errors are surfaced, never swallowed or crashed
- Rust: failed requests return `McpError`; the server never panics on a bad call.
- Web: the proxy forwards Solscan's real HTTP status and message; the UI renders a
  visible error state (e.g. the 401 upgrade message) instead of failing silently.

---

## 4. How to run everything

### 4.1 Prerequisites
- Rust toolchain (installed via rustup, but **not on PATH** by default here):
  ```bash
  export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
  ```
  Consider adding that line to `~/.zshrc`, or reinstall via the official
  `rustup-init` so the `~/.cargo/bin` shims are created.
- Node.js 20+ (verified on v24).
- **No key is required** for the screener/Radar — DexScreener is key-less. Optional:
  a Solscan **Pro** key (holder enrichment + the Rust tools), an **Anthropic** key
  (AI analyst API mode), and a **Telegram** bot token + chat id (alerts). All are
  set in `.env` and/or live-editable from the Settings panel.

### 4.2 Rust MCP server
```bash
SOLSCAN_API_KEY=… cargo run            # or: cargo build && ./target/debug/solscan-mcp
```
Quick protocol smoke test (no MCP client needed):
```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| SOLSCAN_API_KEY=… ./target/debug/solscan-mcp
```
Interactive: `npx @modelcontextprotocol/inspector ./target/debug/solscan-mcp`.

Wire into Claude Desktop — `claude_desktop_config.json`:
```json
{ "mcpServers": { "solscan-mcp": {
  "command": "/abs/path/target/debug/solscan-mcp",
  "args": [], "env": { "SOLSCAN_API_KEY": "…" } } } }
```

### 4.3 Web app (two terminals)
```bash
cd web/server   && npm install && cp .env.example .env  # keys optional (see 4.1)
npm run dev                                              # http://localhost:8787
cd web/frontend && npm install && npm run dev            # http://localhost:5173
```
Relevant `.env` vars (all optional): `SOLSCAN_API_KEY`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL` (default `claude-fable-5`; used by the chat analyst and Pro Radar),
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RADAR_INTERVAL_MIN`
(0 disables the local auto-scan), `RADAR_PRESET`.
Stop background servers: `lsof -ti:5173,8787 | xargs kill`.

### 4.4 Node screener MCP server (Claude Desktop)
```bash
SOLSCAN_API_KEY=… node web/mcp/server.js   # stdio; Telegram env optional
```
Wire into `claude_desktop_config.json` like the Rust server, pointing `command` at
`node` with `args: ["/abs/path/web/mcp/server.js"]`. Exposes 5 tools: `screen_token`,
`screen_and_alert`, `batch_screen`, `get_holder_analysis`, `check_bonding_curve`.

---

## 5. Known issues / tech debt

1. **Free-tier key blocks Pro endpoints.** Upgrade at https://solscan.io/apis to
   exercise token/account/tx tools. Not a code bug.
2. **`cargo` not on PATH** (rustup installed via Homebrew without shims).
3. **Dead code**: `TokenAccountsRequest`, `DefiActivitiesRequest` in
   `src/solscan_mcp/requests/account.rs` are unused (compiler warnings).
4. **`requests/` file naming is misleading** — `account.rs` actually holds token
   structs; modules don't match Solscan namespaces.
5. **`api.rs` is monolithic** (~1480 lines) — deliberate, but a barrier to scale.
6. **`api_key` is `Arc<Mutex<String>>`** though it never mutates — `Arc<String>`
   suffices.
7. **No tests, no CI, no Docker image** (Docker marked WIP in README).
8. **Web app has no routing** — everything lives on `ExplorerPage` (Screener, Radar,
   Settings panels + chat widget); fine for now, but a Vue Router split would help as
   surfaces grow. Note the panels are real now (the old "one example page" is gone).
9. ~~**Radar state is in-memory**~~ — FIXED: `radarStore.js` now abstracts three
   backends and picks one automatically: **Upstash Redis** (when
   `UPSTASH_REDIS_REST_URL` + `_TOKEN` are set) for correct dedupe across serverless
   instances (atomic `SADD`), else a gitignored `web/server/.radar-state.json` file,
   else in-memory. Set `UPSTASH_*` only if you run multiple instances behind a load
   balancer; for single-instance/local use the file/memory fallback is correct.
10. ~~**Settings store is in-memory**~~ — FIXED: settings now persist to a gitignored
    `web/server/.settings.json` and reload on boot (overlaid on `.env` defaults). On
    read-only/ephemeral filesystems the save no-ops and it falls back to the old
    in-memory behaviour. A shared store is still needed for true multi-instance.

---

## 6. Enhancement roadmap (toward professional / production)

Ordered by leverage. Each item is independently shippable.

### Phase 1 — Hardening & hygiene (low risk, high signal)
- [ ] Add `rustfmt` + `clippy` and a GitHub Actions CI (`fmt --check`, `clippy -D warnings`, `cargo build`).
- [ ] Remove dead structs (#3) or wire them to tools.
- [ ] Switch `Arc<Mutex<String>>` → `Arc<String>` for the key (#6).
- [ ] Add `.gitignore` coverage for `web/**/node_modules`, `.env`, `target/` (verify).
- [ ] Document required Solscan plan tier per tool in `docs/TOOLS.md`.

### Phase 2 — Reliability of the MCP server
- [ ] Centralize request building (one helper) to kill the copy-paste in `api.rs`.
- [ ] Split `api.rs` into modules per Solscan namespace (token/account/nft/market/tx/block).
- [ ] Add typed error mapping: distinguish 401 (plan), 429 (rate limit), 5xx
      (upstream) into structured MCP errors with retry hints.
- [ ] Add client-side timeout + retry-with-backoff on the `reqwest` client.
- [ ] Unit tests with a mocked HTTP layer (e.g. `wiremock`) for happy/error paths.

### Phase 3 — Web app to a real product surface
- [ ] Add routing (Vue Router): Home, Token detail, Account, Transaction.
- [ ] Build a component showcase / Storybook (Histoire) covering every state for QA.
- [ ] Add the remaining proxy endpoints behind the allowlist as pages are built.
- [ ] Add request caching + loading skeletons already supported by components.
- [ ] Add automated a11y checks (axe-core / Playwright + @axe-core/playwright) in CI.
- [ ] Add unit/component tests (Vitest + @vue/test-utils) and E2E (Playwright).

### Phase 4 — Delivery & ops
- [ ] Finish the Docker image for the MCP server (multi-stage Rust build).
- [ ] Containerize the web app + proxy (compose file) for one-command local run.
- [ ] Secrets management: load keys from a vault/secret store, not plaintext `.env`.
- [ ] Add rate-limit handling + caching in the proxy to respect Solscan quotas.
- [ ] Publish: `cargo publish` for the MCP crate; versioned releases + changelog.

---

## 7. Working with Claude Code in this repo

- `CLAUDE.md` is loaded automatically and gives Claude the architecture, gotchas,
  and conventions. Keep it short and current.
- Point Claude at **your team's spec document** at the start of a session; it is
  the source of truth for product/design decisions and is not stored in this repo.
- Good first asks for Claude: "implement Phase 1 of the HANDOVER roadmap", or
  "add the Token detail page following the design tokens and existing components".
- Guardrails: do not commit/push or print the API key without explicit say-so;
  prefer extending the design tokens over introducing one-off styles.

---

## 8. Verification log (what was actually exercised)

- `cargo build` → success (2 dead-code warnings only).
- MCP `initialize` / `tools/list` (37 tools) / `tools/call` → all respond.
- `chain_info` via Rust server and via the Express proxy → live chain data.
- Pro endpoints (`token_meta`, `token_price`, `token_top`, `account_detail`) →
  `401 upgrade your api key level`, surfaced cleanly.
- `web/frontend` production build → success (`vite build`).
- Web app rendered (Playwright) in 4 states: live data, 401 error, input
  validation error, mobile (390px) — all correct.
- Pro Radar v2 (quality gate + AI-drop + self-tuning), `GET /api/pro-radar` live:
  40 discovered/scanned → **3 shown** (down from 10 of mixed junk); survivors all
  LP-locked 99–100%, liquidity $26k–50k, no rugs. `recordPicks` persisted 3 picks
  with entry prices; `gradeAndRetune` (tested with `RADAR_GRADE_AFTER_MIN=0`) graded
  them, computed returns, and aggregated the track record without error.
  `GET /api/pro-radar/track` returns tuned thresholds. Inline DexScreener chart
  toggles per token in the UI (Vite HMR clean).
- Smart money (Birdeye + Helius) calibrated LIVE with real keys: Birdeye
  `top_traders` → 200 with USD volume + whale tags + PnL; Helius
  `/addresses/../transactions` → parsed swap array. `fetchSmartMoney(BONK)` →
  score 97 (3 whales, net +$203k, 4 Helius-verified). Full `/api/pro-radar`
  scan surfaced picks with `smart` populated (e.g. trumplet score 46, 5
  profitable traders, 3 established wallets); `/api/health` → `smartMoneyEnabled:true`.
  429-retry added after observing burst rate-limits null the enrich fan-out.
- Pro Radar v3 (win-rate controller + pump.fun), verified live: `/api/pro-radar/track`
  reports `targetWinRate: 0.9`, `belowTarget: true`. Controller test (isolated,
  `RADAR_GRADE_AFTER_MIN=0`): at winRate 0.12 it tightened every lever in one cycle
  (liq 12k→19.2k, vol 15k→24k, tx 60→132, lock 20→62, conv 45→75, gem→75,
  maxDrawdownFromAth→53, requirePumpComplete→true). `fetchPumpfun` on a pump mint
  returned `complete:true`, drawdown 32% from ATH, no ban/nsfw. Frontend rebuilt and
  served via ngrok (single-port :8787).
