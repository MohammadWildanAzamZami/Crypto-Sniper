# Laporan: Memecoin-Screener — Apa Saja yang Sudah Dibangun

> Laporan ini menjelaskan seluruh sistem yang sudah dibangun di repo ini beserta
> flowchart alurnya, supaya gampang dibaca dan dipahami arah arsitekturnya.
> Untuk state teknis, cara menjalankan, dan roadmap, lihat [HANDOVER.md](HANDOVER.md).

---

## 1. Ringkasan

Repo ini berkembang dari "MCP server Solscan + UI explorer sederhana" menjadi
**platform screening memecoin Solana** yang lengkap. Ada 5 sistem besar:

| # | Sistem | Status | Fungsi inti |
|---|--------|--------|-------------|
| 1 | **GEM Score™ Screener** | ✅ Jalan | Skor 0–100 kualitas/risiko token dari data live |
| 2 | **10x Radar (Auto-Screener)** | ✅ Jalan | Otomatis cari token "potensi 10x" tiap interval |
| 3 | **AI Analyst Chat** | ✅ Jalan | Chat AI (Claude) yang bisa panggil tool on-chain |
| 4 | **Telegram Alert + Trojan link** | ✅ Jalan | Push notif token bagus + link beli 1-tap |
| 5 | **MCP Servers (Rust + Node)** | ✅ Jalan | Sambungkan screener ke Claude Desktop |

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

### 2.3 AI Analyst Chat
**File:** `web/server/ai/anthropic.js`, `local.js`, `tools.js`, `settings.js`
+ komponen frontend `ChatWidget/ChatPanel/ChatComposer/ChatMessage.vue`

- Chat mengambang gaya WhatsApp, bisa di-resize (`ChatWidget.vue`).
- Streaming jawaban via **SSE** (Server-Sent Events).
- **Agentic tool-loop**: Claude bisa memanggil 6 tool sampai 6 ronde
  (`chain_info`, `token_meta`, `token_holders`, `account_detail`,
  `account_transactions`, `screen_token`), lalu menalar hasilnya.
- Dua mode: **API** (pakai Anthropic key) atau **Local** (pakai Claude CLI).
- Key AI tidak pernah sampai ke browser; loop berjalan server-side.

### 2.4 Telegram + Trojan
**File:** `web/server/screener/telegram.js`
- Format alert HTML rapi (skor, breakdown pilar, verdict, link DexScreener).
- **Trojan deep-link** (`t.me/solana_trojanbot?start=<mint>`): tap = panel beli
  langsung terbuka. Server tidak pernah memegang wallet/seed/private key — beli
  tetap aksi manual user. Batas ini disengaja: screener memberi info, manusia memutuskan.

### 2.5 MCP Servers
- **Rust** (`src/`) — 37 tool Solscan Pro via stdio JSON-RPC (server asli repo).
- **Node** (`web/mcp/server.js`) — 5 tool screener untuk Claude Desktop
  (`screen_token`, `screen_and_alert`, `batch_screen`, `get_holder_analysis`,
  `check_bonding_curve`), memakai core screening yang sama dengan web proxy.

### 2.6 Kalkulator Screening Manual + Checklist
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

### 2.7 Settings & keamanan key
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
        ChatAPI["/api/chat (SSE)"]
        SolscanProxy["/api/:resource (allowlist Solscan)"]
    end

    subgraph Core["CORE SCREENING (framework-free)"]
        Screen["screen.js (orchestrator)"]
        Gem["gemScore.js (skor 3 pilar)"]
        Auto["autoScreen.js (discover->filter)"]
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
│   │   ├── anthropic.js         # Tool-loop + streaming SSE (Claude API)
│   │   ├── local.js             # Mode lokal via Claude CLI
│   │   ├── tools.js             # 6 tool yang boleh dipanggil AI
│   │   └── settings.js          # Store secret + status publik + test key
│   └── screener/
│       ├── screen.js            # Orchestrator screening 1 token / batch
│       ├── gemScore.js          # Logika skor 3 pilar
│       ├── sources.js           # DexScreener + Solscan + RugCheck
│       ├── discover.js          # Feed token trending (untuk Radar)
│       ├── autoScreen.js        # 10x Radar: discover->screen->filter
│       └── telegram.js          # Alert Telegram + Trojan deep-link
├── mcp/server.js                # MCP Node (5 tool screener) untuk Claude Desktop
└── frontend/src/
    ├── App.vue                  # Layout + ChatWidget mengambang
    ├── styles/tokens.css        # Design token (tema dark blue-grey + aksen mint)
    ├── pages/ExplorerPage.vue   # Halaman utama (Radar di atas, kalkulator manual di bawah)
    └── components/
        ├── ManualScoringPanel.vue # Kalkulator skor risiko manual (input tangan)
        ├── ChecklistPanel.vue   # Checklist kriteria screening cepat
        ├── ScreenerPanel.vue    # UI screening 1 token
        ├── RadarPanel.vue       # UI 10x Radar
        ├── SettingsPanel.vue    # UI kelola API key
        └── Chat*.vue            # Widget chat AI
```
