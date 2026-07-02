# Laporan: Memecoin-Screener — Apa Saja yang Sudah Dibangun

> Laporan ini menjelaskan seluruh sistem yang sudah dibangun di repo ini beserta
> flowchart alurnya, supaya gampang dibaca dan dipahami arah arsitekturnya.
> Untuk state teknis, cara menjalankan, dan roadmap, lihat [HANDOVER.md](HANDOVER.md).

---

## 1. Ringkasan

Repo ini berkembang dari "MCP server Solscan + UI explorer sederhana" menjadi
**platform screening memecoin Solana** yang lengkap. Ada 6 sistem besar:

| # | Sistem | Status | Fungsi inti |
|---|--------|--------|-------------|
| 1 | **GEM Score™ Screener** | ✅ Jalan | Skor 0–100 kualitas/risiko token dari data live |
| 2 | **10x Radar (Auto-Screener)** | ✅ Jalan | Otomatis cari token "potensi 10x" tiap interval |
| 3 | **🧠 Pro Radar (Fable 5)** | ✅ Jalan | 10x Radar + peringkat AI: conviction, tesis, red flag |
| 4 | **AI Analyst Chat** | ✅ Jalan | Chat AI (Claude) yang bisa panggil tool on-chain |
| 5 | **Telegram Alert + Trojan link** | ✅ Jalan | Push notif token bagus + link beli 1-tap |
| 6 | **MCP Servers (Rust + Node)** | ✅ Jalan | Sambungkan screener ke Claude Desktop |

Plus: **Kalkulator Screening Manual + Checklist** (hitung skor risiko dari angka
yang kamu baca sendiri di DexScreener/RugCheck), **Settings panel** (kelola API key
dari UI, key tetap di server), dan **proxy Express** sebagai jembatan aman
browser ↔ API yang sekaligus **menyajikan frontend build** (mode satu port :8787).

---

## 2. Komponen yang sudah dibangun (detail)

### 2.1 GEM Score™ — Mesin penilaian token
**File:** `web/server/screener/gemScore.js`, `screen.js`, `sources.js`

Skor 0–100 dihitung dari **3 pilar** berbobot:

| Pilar | Bobot | Yang dinilai |
|-------|-------|--------------|
| 🏦 Liquidity & Market | 40 | Kedalaman likuiditas, volume 24j, turnover (vol/likuiditas), LP lock |
| 📈 Momentum | 35 | Tren harga 1h/6h, rasio buy/sell, jumlah transaksi 24j |
| 🛡️ Trust & Age | 25 | Umur pair, jumlah pool/DEX, distribusi holder |

**Verdict:** 🟢 STRONG (≥70) · 🟡 WATCH (≥50) · 🔴 SKIP (<50)

Sumber data (semua **degrade gracefully** kalau gagal):
- **DexScreener** (gratis, tanpa key) → tulang punggung, selalu jalan.
- **Solscan Pro** (opsional, perlu key) → enrich data holder.
- **RugCheck** (gratis) → cek LP locked % (sinyal anti-rug terpenting).

Skor ini **heuristik, bukan prediksi dan bukan saran finansial** — selalu DYOR.

### 2.2 10x Radar — Pemburu otomatis
**File:** `web/server/screener/autoScreen.js`, `discover.js`

Alur: **Discover → Screen → Filter → Alert**
- Ambil token trending dari feed publik DexScreener (token-boosts + token-profiles).
- Screen semua paralel (default 18 token, konkurensi 9, `skipLock` agar cepat ~8 detik).
- Saring pakai preset kriteria:

| Preset | Max Market Cap | Min Likuiditas | Min GEM | Umur | Min LP Lock |
|--------|----------------|----------------|---------|------|-------------|
| aggressive | $500K | $5K | 55 | 0.5j–14h | 0% |
| balanced (default) | $2M | $10K | 60 | 1j–30h | 30% |
| conservative | $5M | $50K | 72 | 6j–60h | 80% |

- Hitung estimasi upside sebagai kelipatan ke $10M (mis. "~14x").
- Token baru yang lolos → push ke Telegram (dedup via `alertedMints`, maks 5/scan).
- Auto-jalan tiap `RADAR_INTERVAL_MIN` menit (default 15); set `=0` untuk mematikan,
  atau panggil `GET /api/auto-screen` dari scheduler eksternal bila ingin on-demand.

### 2.3 🧠 Pro Radar — 10x Radar bertenaga AI (Fable 5)
**File:** `web/server/screener/proRadar.js`, `web/server/ai/analyze.js`,
komponen frontend `web/frontend/src/components/ProRadarPanel.vue`
**Endpoint:** `GET /api/pro-radar` · **Dokumen alur lengkap:** [web/PRO-RADAR.md](web/PRO-RADAR.md)

Funnel penemuannya sama seperti 10x Radar, tapi finalisnya di-*enrich* dengan data
liquidity-lock lalu diperingkat oleh model **Fable 5** (`claude-fable-5`) yang menilai
*conviction*, tesis, katalis, dan red flag tiap token.

#### 📥 Sumber data — data apa diambil dari mana

Semua data pasar berasal dari **API publik gratis** (DexScreener + RugCheck).
Solscan Pro & AI bersifat **opsional** — kalau tak ada, Pro Radar tetap jalan.

| Tahap | Fungsi (file) | Sumber & endpoint | Perlu key? | Data yang diambil |
|-------|---------------|-------------------|:----------:|-------------------|
| 1. Discover | `discoverSolanaTokens` (`discover.js`) | **DexScreener** `token-boosts/latest`, `token-boosts/top`, `token-profiles/latest` | ❌ | Daftar sampai **28 mint** Solana yang lagi trending (dedup, buang USDC/USDT/wSOL) |
| 2. Fast screen | `fetchDexScreener` (`sources.js`) | **DexScreener** `latest/dex/tokens/<mint>` | ❌ | Harga USD, likuiditas USD, marketCap/FDV, volume 1h/6h/24h, priceChange 1h/6h/24h, txns buy/sell 24j, umur pair (`pairCreatedAt`), jumlah pair, logo/URL |
| 2b. (opsional) | `fetchSolscanHolders` (`sources.js`) | **Solscan Pro** `pro-api.solscan.io/v2.0/token/holders` | ✅ Pro | Jumlah holder + konsentrasi top holder — **dilewati kalau tanpa key Pro** |
| 2c. Skor | `computeGemScore` (`gemScore.js`) | (hitung lokal, tanpa jaringan) | ❌ | **GEM Score 0–100** (Likuiditas 40 + Momentum 35 + Trust/Age 25) |
| 4. Enrich | `fetchRugcheckLock` (`sources.js`) | **RugCheck** `api.rugcheck.xyz/v1/tokens/<mint>/report` | ❌ | **LP locked %**, locked USD, total LP USD, status (Locked/Partially/Unlocked), flag `rugged` |
| 5. AI rank | `analyzeCandidates` (`ai/analyze.js`) | **Fable 5** — CLI `claude -p` (Local) atau Anthropic SDK (API) | Local ❌ · API ✅ | conviction 0–100, tier S/A/B/C, thesis, catalysts[], redFlags[], action APE/WATCH/AVOID |

> ⚠️ LP-lock (RugCheck) **sengaja dilewati saat fast-screen** (`skipLock:true`) biar
> pemindaian massal cepat, lalu **hanya di-ambil untuk 10 finalis** di tahap enrich.

#### 🔄 Alur screening — langkah demi langkah

**Discover → Fast Screen (semua) → Pre-filter → Enrich (finalis) → AI Rank → Merge & Sort**

1. **Discover** (`discoverSolanaTokens`, limit 28) — tarik mint trending dari 3 feed
   DexScreener publik, gabung, buang duplikat + stablecoin/wSOL.
2. **Fast screen semua mint** — `screenToken(..., skipLock:true)` paralel **konkurensi
   ×10**. Tiap token: ambil data DexScreener (+ Solscan holders bila ada key) →
   hitung **GEM Score** → jalankan `evaluateMoonshot` (lolos/tidak + alasan).
3. **Pre-filter → finalis** — ambil yang **lolos preset `aggressive`**
   (MC ≤ $500k, Liq ≥ $5k, GEM ≥ 55, umur 0.5j–14h, buy ratio ≥ 50%), urut
   **GEM tertinggi**, ambil **TOP 10** (`maxAi`) sebagai finalis. Hitung estimasi
   `upsideX` = kelipatan ke target $10M market cap.
4. **Enrich finalis** — untuk 10 finalis saja, panggil ulang `screenToken(...,
   skipLock:false)` supaya **data LP-lock RugCheck ikut terisi** (locked %, status,
   rugged). Kalau enrich gagal, laporan cepat sebelumnya tetap dipakai.
5. **AI Rank (Fable 5)** — susun payload **ringkas per finalis** (address, symbol,
   gemScore, marketCap, liquidityUsd, volume24h, priceChange 1h/6h/24h, buys/sells,
   buyRatio%, ageHours, pairCount, lockedPct, lockStatus, rugged) → kirim ke Fable 5.
   Model **hanya menalar angka yang diberikan** (dilarang mengarang data), lalu balas
   JSON: `conviction`, `tier`, `thesis`, `catalysts[]`, `redFlags[]`, `action`.
   - **Mode Local** (default, tanpa biaya): CLI `claude -p --model claude-fable-5`
     (headless, timeout 90 detik). **Mode API**: Anthropic SDK (butuh Anthropic key).
6. **Merge & Sort** — gabungkan verdict AI ke tiap finalis, lalu:
   - **AI aktif** → urut **conviction ↓**, lalu action (APE > WATCH > AVOID), lalu GEM.
   - **AI mati/gagal** → fallback urut **GEM Score ↓**, tandai `aiUsed:false`
     (UI menampilkan badge **⚠️ AI tak aktif**). AI tidak pernah bikin request gagal —
     kegagalan apa pun degrade mulus ke urutan heuristik.

Respons akhir ke UI: `{ scannedAt, preset, discovered, candidatesScanned, aiUsed,
aiMode, model, matches[] }`. Tiap `match` berisi data token + `ai` (conviction, tier,
tesis, katalis, red flag, action) untuk digambar sebagai kartu + meter conviction.

Perbandingan singkat vs 10x Radar: Pro Radar menjaring lebih lebar (28 vs 18),
menambah **LP-lock enrichment** untuk finalis + **peringkat AI** (conviction/tesis/
red flag); trade-off-nya lebih lambat (ada langkah enrich + panggilan AI). Alur &
flowchart Mermaid/ASCII lengkap ada di [web/PRO-RADAR.md](web/PRO-RADAR.md).

### 2.4 AI Analyst Chat
**File:** `web/server/ai/anthropic.js`, `local.js`, `tools.js`, `settings.js`
+ komponen frontend `ChatWidget/ChatPanel/ChatComposer/ChatMessage.vue`

- Chat mengambang gaya WhatsApp, bisa di-resize (`ChatWidget.vue`).
- Streaming jawaban via **SSE** (Server-Sent Events).
- **Agentic tool-loop**: Claude bisa memanggil 6 tool sampai 6 ronde
  (`chain_info`, `token_meta`, `token_holders`, `account_detail`,
  `account_transactions`, `screen_token`), lalu menalar hasilnya.
- Dua mode: **API** (pakai Anthropic key) atau **Local** (pakai Claude CLI).
- **Model default kini `claude-fable-5`** (bisa diganti ke Opus 4.8 / Sonnet 5 /
  Haiku 4.5 dari Settings). Sebelumnya default `claude-opus-4-8`.
- Key AI tidak pernah sampai ke browser; loop berjalan server-side.

### 2.5 Telegram + Trojan
**File:** `web/server/screener/telegram.js`
- Format alert HTML rapi (skor, breakdown pilar, verdict, link DexScreener).
- **Trojan deep-link** (`t.me/solana_trojanbot?start=<mint>`): tap = panel beli
  langsung terbuka. Server tidak pernah memegang wallet/seed/private key — beli
  tetap aksi manual user. Batas ini disengaja: screener memberi info, manusia memutuskan.

### 2.6 MCP Servers
- **Rust** (`src/`) — 37 tool Solscan Pro via stdio JSON-RPC (server asli repo).
- **Node** (`web/mcp/server.js`) — 5 tool screener untuk Claude Desktop
  (`screen_token`, `screen_and_alert`, `batch_screen`, `get_holder_analysis`,
  `check_bonding_curve`), memakai core screening yang sama dengan web proxy.

### 2.7 Kalkulator Screening Manual + Checklist
**File:** `web/frontend/src/components/ManualScoringPanel.vue`, `ChecklistPanel.vue`

- **Kalkulator manual**: kamu ketik angka yang kamu lihat langsung di
  DexScreener/RugCheck (likuiditas, market cap, volume, umur, buy/sell, makers,
  konsentrasi top-10, status mint/freeze/LP, red flag) → skor risiko **0–100**
  dihitung otomatis dengan breakdown +/- yang transparan. Heuristik, bukan
  prediksi harga. Pelengkap GEM Score otomatis untuk saat menilai pair dengan mata.
- **Checklist**: daftar cek cepat kriteria screening dasar.
- **Layout halaman**: 🚀 10x Radar & Screener (data live) di **atas**, lalu
  Kalkulator manual & Checklist di **bawah**.
- **Tema**: palet dark blue-grey + aksen mint dengan angka monospace, seragam di
  seluruh app lewat design token (`styles/tokens.css`) — tanpa hex mentah di komponen.

### 2.8 Settings & keamanan key
**File:** `web/server/ai/settings.js`
- Semua secret (Solscan / Anthropic / Telegram) hidup di store memori server,
  di-seed dari `.env` saat boot.
- Browser hanya bisa baca **status** (boolean) dan menulis nilai baru; GET tidak
  pernah mengembalikan nilai secret. Tombol "Test" memprobe key tanpa membocorkannya.

---

## 3. Flowchart Arsitektur Keseluruhan

```mermaid
flowchart TD
    subgraph Clients["PENGGUNA"]
        Browser["Browser (Vue Frontend)"]
        ClaudeDesktop["Claude Desktop (MCP client)"]
        TG["Telegram"]
    end

    subgraph Proxy["EXPRESS :8787 — pegang semua secret + serve frontend"]
        Static["express.static (frontend build) + SPA fallback"]
        Settings["Settings Store (API keys di memori)"]
        ScreenAPI["/api/screen, /api/batch-screen"]
        RadarAPI["/api/auto-screen (10x Radar)"]
        ProRadarAPI["/api/pro-radar (Pro Radar + AI Fable 5)"]
        ChatAPI["/api/chat (SSE)"]
        SolscanProxy["/api/:resource (allowlist Solscan)"]
    end

    subgraph Core["CORE SCREENING (framework-free)"]
        Screen["screen.js (orchestrator)"]
        Gem["gemScore.js (skor 3 pilar)"]
        Auto["autoScreen.js (discover->filter)"]
        Pro["proRadar.js (funnel + AI rank)"]
        Analyze["ai/analyze.js (Fable 5 ranking)"]
        AI["ai/anthropic.js (tool-loop)"]
    end

    subgraph External["SUMBER DATA EKSTERNAL"]
        Dex["DexScreener (gratis)"]
        Rug["RugCheck (gratis)"]
        Sol["Solscan Pro (perlu key)"]
        Anthropic["Anthropic API (Claude)"]
    end

    Browser -->|HTML/JS/CSS| Static
    Browser -->|/api/*| ScreenAPI
    Browser --> RadarAPI
    Browser --> ChatAPI
    Browser --> SolscanProxy
    ClaudeDesktop -->|stdio JSON-RPC| MCPNode["web/mcp/server.js (5 tool)"]
    MCPNode --> Screen

    ScreenAPI --> Screen
    RadarAPI --> Auto --> Screen
    ProRadarAPI --> Pro --> Screen
    Pro --> Analyze --> Anthropic
    ChatAPI --> AI
    Screen --> Gem
    AI -->|tool: screen_token| Screen
    AI --> Anthropic

    Screen --> Dex
    Screen --> Rug
    Screen --> Sol
    SolscanProxy --> Sol

    Auto -->|token lolos| TGsend["telegram.js"]
    TGsend --> TG
    Settings -.seed dari .env.-> ScreenAPI
```

---

## 4. Flowchart Alur: Screening Satu Token

```
User masukin alamat token
        |
        v
+-----------------------------+
| Valid mint? (base58, 32-44) |--X--> Error 400
+-----------------------------+
        | OK
        v
+-------------------------------------------+
| fetchDexScreener (WAJIB - tulang punggung)|--X--> "Token tidak terdaftar di DEX"
+-------------------------------------------+
        | OK
        v  (paralel, keduanya boleh gagal -> null)
+------------------+   +-------------------+
| Solscan: holders |   | RugCheck: LP lock |
|   (opsional)     |   |    (opsional)     |
+------------------+   +-------------------+
        |                      |
        +----------+-----------+
                   v
        +------------------------+
        |   computeGemScore()    |
        |  Pilar 1 (40) Liquidity|
        |  Pilar 2 (35) Momentum |
        |  Pilar 3 (25) Trust    |
        +------------------------+
                   v
        +------------------------+
        | Skor 0-100 + Verdict   |
        | STRONG / WATCH / SKIP  |
        | + Trojan buy link      |
        +------------------------+
```

---

## 5. Flowchart Alur: 10x Radar (otomatis)

```
Timer tiap 15 menit  (atau tombol "Scan Sekarang")
        |
        v
discoverSolanaTokens()  -- ambil ~18 token trending dari DexScreener feeds
        |
        v
mapPool (konkurensi 9)  -- screen tiap token paralel (skipLock = cepat)
        |
        v
evaluateMoonshot(preset) -- filter: market cap kecil? likuiditas cukup?
        |                     GEM >= min? umur masuk? buy ratio sehat?
        v
   +---------+---------+
 LOLOS               GAGAL (dibuang)
   |
   v
Token baru (belum pernah di-alert)?
   | ya
   v
Telegram alert + Trojan link  (maks 5/scan, anti-spam)
   |
   v
Tampil di RadarPanel (diurutkan skor tertinggi)
```

---

## 6. Prinsip arsitektur yang dipegang

1. **Key = secret server-side.** Solscan/Anthropic/Telegram key cuma ada di Express
   proxy (`settings.js`); browser hanya lihat status boolean.
2. **Degrade gracefully.** Solscan free-tier (401) atau RugCheck mati → screener
   tetap jalan pakai DexScreener saja.
3. **Core bebas framework.** `screener/*` dipakai ulang oleh Express **dan** MCP
   server tanpa menyeret Express.
4. **Screener informs, human decides.** Sistem memberi sinyal + link; eksekusi beli
   tetap manual oleh user (tidak menyentuh wallet).

---

## 7. Peta file penting

```
web/
├── server/
│   ├── index.js                 # Express proxy: route /api/* + serve frontend build (1 port)
│   ├── solscan.js               # Allowlist + fetch ke Solscan
│   ├── ai/
│   │   ├── anthropic.js         # Tool-loop + streaming SSE (Claude API, default Fable 5)
│   │   ├── local.js             # Mode lokal via Claude CLI
│   │   ├── analyze.js           # Peringkat AI Pro Radar (Fable 5): conviction/tesis/red flag
│   │   ├── tools.js             # 6 tool yang boleh dipanggil AI
│   │   └── settings.js          # Store secret + status publik + test key (default model Fable 5)
│   └── screener/
│       ├── screen.js            # Orchestrator screening 1 token / batch
│       ├── gemScore.js          # Logika skor 3 pilar
│       ├── sources.js           # DexScreener + Solscan + RugCheck
│       ├── discover.js          # Feed token trending (untuk Radar)
│       ├── autoScreen.js        # 10x Radar: discover->screen->filter
│       ├── proRadar.js          # Pro Radar: funnel + enrich + AI rank (Fable 5)
│       └── telegram.js          # Alert Telegram + Trojan deep-link
├── mcp/server.js                # MCP Node (5 tool screener) untuk Claude Desktop
└── frontend/src/
    ├── App.vue                  # Layout + ChatWidget mengambang
    ├── styles/tokens.css        # Design token (tema dark blue-grey + aksen mint)
    ├── pages/ExplorerPage.vue   # Halaman utama (Radar & Pro Radar di atas, kalkulator manual di bawah)
    └── components/
        ├── ManualScoringPanel.vue # Kalkulator skor risiko manual (input tangan)
        ├── ChecklistPanel.vue   # Checklist kriteria screening cepat
        ├── ScreenerPanel.vue    # UI screening 1 token
        ├── RadarPanel.vue       # UI 10x Radar
        ├── ProRadarPanel.vue    # UI Pro Radar (kartu + meter conviction, tesis, red flag)
        ├── SettingsPanel.vue    # UI kelola API key (pilih model, default Fable 5)
        └── Chat*.vue            # Widget chat AI
```
