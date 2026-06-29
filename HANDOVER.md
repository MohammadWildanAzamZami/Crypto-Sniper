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
**Solana memecoin screening platform**. Five systems now live here:

| Area | Status | Notes |
|------|--------|-------|
| **GEM Score™ screener** | ✅ Works | 0–100 score, 3 weighted pillars; DexScreener-only works key-less |
| **10x Radar** (auto-screener) | ✅ Works | discover → screen → filter → Telegram, runs on an interval/Cron |
| **AI Analyst chat** | ✅ Works | Claude tool-loop over SSE; API key or local Claude-CLI mode |
| **Telegram alerts + Trojan link** | ✅ Works | HTML alert + 1-tap buy deep-link (no wallet held) |
| **Node MCP server** (`web/mcp`) | ✅ Works | 5 screener tools for Claude Desktop, shares the screening core |
| Rust MCP server (`solscan-mcp`) | ✅ Builds & runs | 37 Solscan tools over stdio (original server) |
| Solscan connectivity | ✅ Verified | `chain_info` public; Pro endpoints need a Pro key |
| Pro endpoints | ⚠️ Plan-gated | Free key → `401 upgrade your api key level` (handled gracefully) |
| Web UI (`web/frontend`) | ✅ Builds & runs | Vite + Vue 3, token-driven design system |
| API proxy (`web/server`) | ✅ Runs | Express, keeps all secrets server-side; deployable on Vercel |
| Tests / CI | ❌ None | See roadmap §6 |
| Docker | ❌ WIP | README says "available soon" |

The screener works **out of the box without any key** because DexScreener is the
backbone; Solscan (holders) and RugCheck (LP lock) only enrich the score.

---

## 2. Repository layout

```
Memecoin-Screener/
├── CLAUDE.md              # Auto-loaded context for Claude Code
├── HANDOVER.md            # This file
├── LAPORAN.md             # Indonesian overview + flowcharts of everything built
├── README.md              # Original project README (install + usage)
├── TOOLS.md               # Reference for all Rust MCP tools
├── Cargo.toml / .lock     # Rust crate manifest
├── src/                   # Rust MCP server (37 Solscan tools over stdio)
│   ├── main.rs            # Entry point: env key → serve over stdio
│   └── solscan_mcp/
│       ├── api.rs         # All 37 tools + request helpers + ServerHandler (~1480 lines)
│       └── requests/      # Request param structs, grouped by namespace
└── web/
    ├── server/            # Express proxy — ALL secrets live here (seeded from .env)
    │   ├── index.js       # Routes: /api/screen, /api/auto-screen, /api/chat, /api/:resource
    │   ├── solscan.js     # Allowlist + fetch to Solscan
    │   ├── ai/            # AI analyst: anthropic.js (SSE tool-loop), local.js,
    │   │                  #   tools.js (6 tools), settings.js (secret store + tests)
    │   └── screener/      # Framework-free screening core:
    │       ├── screen.js      #   orchestrator (single / batch)
    │       ├── gemScore.js    #   the 3-pillar 0–100 score
    │       ├── sources.js     #   DexScreener + Solscan holders + RugCheck lock
    │       ├── discover.js    #   trending-token feeds (Radar input)
    │       ├── autoScreen.js  #   10x Radar: discover → screen → filter
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
matches before pushing to Telegram. Runs on a local `setInterval` (default 15 min)
or a Vercel Cron in production.

### 3.4 AI analyst — server-side tool-loop
`ai/anthropic.js` runs Claude's agentic tool-use loop server-side and streams the
reply over SSE. The 6 tools (`ai/tools.js`) map to the same allowlisted Solscan
resources and the screener, so the model can only reach data we already expose.
A **local mode** (`ai/local.js`) drives the Claude CLI instead of the API.

### 3.5 Design system is token-driven
- All raw values (color/space/type/radius/motion) live once in
  `web/frontend/src/styles/tokens.css` as **primitive** tokens, aliased to
  intent-based **semantic** tokens. Components reference semantic tokens only.
- Rationale: single source of truth, theme-ability, and consistency — changing a
  brand color is a one-line edit.

### 3.6 Errors are surfaced, never swallowed or crashed
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
`ANTHROPIC_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RADAR_INTERVAL_MIN`
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
   else in-memory. Set `UPSTASH_*` in Vercel env to make multi-instance dedupe correct;
   without it, single-instance/local use still works via the file/memory fallback.
10. ~~**Settings store is in-memory**~~ — FIXED: settings now persist to a gitignored
    `web/server/.settings.json` and reload on boot (overlaid on `.env` defaults). On
    read-only/ephemeral filesystems (Vercel) the save no-ops and it falls back to the
    old in-memory behaviour. A shared store is still needed for true multi-instance.

---

## 6. Enhancement roadmap (toward professional / production)

Ordered by leverage. Each item is independently shippable.

### Phase 1 — Hardening & hygiene (low risk, high signal)
- [ ] Add `rustfmt` + `clippy` and a GitHub Actions CI (`fmt --check`, `clippy -D warnings`, `cargo build`).
- [ ] Remove dead structs (#3) or wire them to tools.
- [ ] Switch `Arc<Mutex<String>>` → `Arc<String>` for the key (#6).
- [ ] Add `.gitignore` coverage for `web/**/node_modules`, `.env`, `target/` (verify).
- [ ] Document required Solscan plan tier per tool in `TOOLS.md`.

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
