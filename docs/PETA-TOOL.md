# Peta & Flowchart Semua Tool — Memecoin Screener

> Gambaran menyeluruh semua tool yang sudah dibuat, alur datanya, dan bagaimana
> mereka saling terhubung. Diagram pakai **Mermaid** (otomatis ter-render di
> GitHub). Bahan baca — bukan spec final. Detail parameter: [REKAP-PARAMETER.md](REKAP-PARAMETER.md).

---

## 1. Peta besar — semua tool dalam satu layar

```mermaid
flowchart TB
  subgraph UI["🖥️ Frontend (Vue) — panel yang dilihat user"]
    P1["💎 GEM Score Screener"]
    P2["🚀 10x Radar"]
    P3["🧠 Pro Radar (AI)"]
    P4["🔬 Bedah Coin (Autopsy)"]
    P5["🎯 Watchlist Wallet"]
    P6["🎯 Sinyal Sniper Live"]
    P7["🧮 Kalkulator Manual"]
    P8["⚙️ Settings"]
    P9["💬 Chat AI"]
  end

  subgraph API["⚙️ Express :8787 (/api/*) — proxy, key server-side"]
    R1["/screen, /batch-screen"]
    R2["/auto-screen"]
    R3["/pro-radar, /pro-radar/track"]
    R4["/autopsy"]
    R5["/watchlist · /influencers"]
    R6["/sniper/sweep · /signals · /params · /explain · /awal/*"]
    R7["/settings · /settings/test"]
    R8["/chat"]
  end

  subgraph ENGINE["🧮 Screener engine (web/server/screener)"]
    E1["gemScore.js"]
    E2["autoScreen.js"]
    E3["proRadar.js"]
    E4["autopsy.js — Modul A"]
    E5["watchlist.js — Modul B / influencers.js — B2"]
    E6["sniper.js — Modul C + sniperParams.js"]
    E7["smartMoney.js · quality.js · discover.js · sources.js · learn.js"]
  end

  subgraph EXT["🌐 Sumber data eksternal"]
    D1["DexScreener"]
    D2["RugCheck"]
    D3["Pump.fun"]
    D4["Birdeye"]
    D5["Helius"]
    D6["Claude / Anthropic"]
    D7["Telegram"]
  end

  P1 --> R1 --> E1
  P2 --> R2 --> E2
  P3 --> R3 --> E3
  P4 --> R4 --> E4
  P5 --> R5 --> E5
  P6 --> R6 --> E6
  P8 --> R7
  P9 --> R8 --> D6

  E1 --> E7
  E2 --> E1
  E3 --> E1
  E2 & E3 --> D7
  E4 --> D4 & D5
  E5 --> E6
  E6 --> E7
  E7 --> D1 & D2 & D3 & D4 & D5
```

---

## 2. Daftar tool + fungsinya

### A. Tool screening token
| Tool (panel) | Endpoint | Engine | Fungsi singkat |
|---|---|---|---|
| 💎 **GEM Score Screener** | `/screen` | `gemScore.js` | Skor 0–100 satu token: likuiditas, momentum, trust → verdict STRONG/WATCH/SKIP. |
| 🚀 **10x Radar** | `/auto-screen` | `autoScreen.js` | Auto-screen token trending, tampilkan yang potensi tinggi. Scan interval + alert Telegram. |
| 🧠 **Pro Radar (AI)** | `/pro-radar` | `proRadar.js` | Sama seperti 10x Radar + **AI** menilai conviction, tesis, katalis, red flag. Self-learning track record. |
| 🧮 **Kalkulator Manual** | — (client) | — | Input data DexScreener/RugCheck manual → skor. Untuk eyeballing pair by hand. |

### B. SNIPER ENGINE (3 modul berantai)
| Modul | Tool (panel) | Endpoint | Engine | Fungsi |
|---|---|---|---|---|
| **A** | 🔬 **Bedah Coin** | `/autopsy` | `autopsy.js` | Bedah 1 token yang sudah pump → temukan smart wallet yang beli lebih awal (Birdeye + Helius). |
| **B** | 🎯 **Watchlist Smart Wallet** | `/watchlist` | `watchlist.js` | Peringkat wallet dari hasil Bedah (self-learning). Top-40 jadi **aktif dipantau**. |
| **B2** | ⭐ **Watchlist Influencer** | `/influencers` | `influencers.js` | Wallet influencer yang kamu input sendiri. **1 beli** sudah cukup jadi sinyal. |
| **C** | 🎯 **Sinyal Sniper Live** | `/sniper/*` | `sniper.js` | Pantau wallet aktif tiap 5 mnt → sinyal saat ≥N wallet borong token kecil yang sama. |

### C. Infrastruktur / pendukung
| Tool | Endpoint | Fungsi |
|---|---|---|
| ⚙️ **Settings** | `/settings`, `/sniper/params` | Atur key, mode AI, dan **semua parameter Sniper** (runtime, tanpa restart). |
| 💬 **Chat AI** | `/chat` | Tanya-jawab AI dengan akses tool screener (function calling). |
| 📤 **Telegram alert** | (internal) | Push pick radar baru ke Telegram. |
| 🧠 **Self-learning** | `learn.js`, `/pro-radar/track` | Rekam win-rate pick radar, auto-tune ambang. |

---

## 3. Alur SNIPER ENGINE (A → B → C) — inti aplikasi

```mermaid
flowchart LR
  W["Token sudah pump<br/>(≥10x)"] --> A["🔬 Modul A: Bedah Coin<br/>autopsy.js"]
  A -->|"smart wallet<br/>yang beli awal"| B["🎯 Modul B: Watchlist<br/>watchlist.js"]
  B -->|"top-40 by reputasi<br/>= aktif dipantau"| C["🎯 Modul C: Live Monitor<br/>sniper.js (tiap 5 mnt)"]
  INF["⭐ Modul B2:<br/>Influencer manual"] --> C
  C -->|"≥N wallet borong<br/>token kecil sama"| SIG["🔔 SINYAL LIVE"]

  A -.->|Birdeye + Helius| A
  C -.->|Helius: baca beli| C
  C -.->|Birdeye: harga/mcap| C
  C -.->|Gate: DexScreener + RugCheck + Pump.fun| SIG
```

**Intinya:** makin banyak winner yang kamu **Bedah** → makin pintar **Watchlist** →
makin tajam **Sinyal Live**. Sistem belajar sendiri dari data.

---

## 4. Alur satu sweep Sniper Live (Modul C) — detail

```mermaid
flowchart TB
  S0["Sweep dipicu<br/>(tombol / auto 5 mnt)"] --> S1["Ambil wallet aktif<br/>Watchlist B + Influencer B2"]
  S1 --> S2["Per wallet: baca tx terbaru<br/>(Helius, recentTx)"]
  S2 --> S3{"Beli asli?<br/>bayar SOL/stable +<br/>swap + net-buy +<br/>≥ minBuyUsd"}
  S3 -->|tidak| X1["buang"]
  S3 -->|ya| S4["Kelompokkan per token<br/>+ entry price/size"]
  S4 --> S5{"≥ signalMin wallet<br/>di token sama?"}
  S5 -->|tidak| X2["bukan kandidat"]
  S5 -->|ya| S6["Enrich: Birdeye identitas/harga<br/>(maks maxEnrich token)"]
  S6 --> S7{"Gate keamanan<br/>mcap/likuiditas/rug/<br/>honeypot/LP-lock"}
  S7 -->|gagal| X3["ditahan"]
  S7 -->|lolos| S8{"skor komposit<br/>≥ scoreMin?"}
  S8 -->|tidak| X4["ditahan"]
  S8 -->|ya| S9["🔔 Naikkan / segarkan sinyal<br/>(TTL signalTtlMin)"]
```

Semua ambang (`signalMin`, `minBuyUsd`, `scoreMin`, gate, TTL, dst.) diatur di
registry `sniperParams.js` — lihat [REKAP-PARAMETER.md](REKAP-PARAMETER.md).

---

## 5. Alur Radar (10x & Pro Radar)

```mermaid
flowchart LR
  T["discover.js<br/>token trending<br/>(DexScreener boosts)"] --> G["gemScore.js<br/>skor 0–100"]
  G --> Q["quality.js<br/>gate kualitas"]
  Q --> R10["🚀 10x Radar<br/>autoScreen.js"]
  Q --> RP["🧠 Pro Radar<br/>proRadar.js"]
  RP --> AI["AI (Claude):<br/>conviction, tesis,<br/>katalis, red flag"]
  R10 --> TG["📤 Telegram alert"]
  RP --> TG
  RP --> LR["learn.js<br/>track record<br/>+ auto-tune"]
```

---

## 6. Arsitektur data (kenapa ada server)

```mermaid
flowchart LR
  B["🌐 Browser (Vue)"] -->|"/api/*"| V["Vite proxy :5173<br/>(dev)"]
  B -->|"dist/"| EX["Express :8787<br/>(prod / ngrok)"]
  V --> EX
  EX -->|"key server-side"| SOL["Solscan / DexScreener /<br/>Birdeye / Helius / RugCheck /<br/>Pump.fun / Anthropic"]
```

**Kunci:** semua API key **tinggal di server** (`web/server/.env`), tidak pernah
ke browser. Browser hanya bicara ke `/api/*`; Express yang memegang rahasia dan
memanggil sumber data eksternal.

---

## 7. Peta file (rujukan cepat)

```
web/
├─ frontend/src/components/panels/
│  ├─ ScreenerPanel.vue      💎 GEM Score
│  ├─ RadarPanel.vue         🚀 10x Radar
│  ├─ ProRadarPanel.vue      🧠 Pro Radar (AI)
│  ├─ AutopsyPanel.vue       🔬 Bedah Coin (A)
│  ├─ WatchlistPanel.vue     🎯 Watchlist (B + B2)
│  ├─ SniperPanel.vue        🎯 Sinyal Sniper Live (C)
│  ├─ ManualScoringPanel.vue 🧮 Kalkulator manual
│  └─ SettingsPanel.vue      ⚙️ Settings
└─ server/
   ├─ index.js               mount semua route
   ├─ routes/                screen · radar · autopsy · influencers · settings · chat · proxy
   ├─ screener/
   │  ├─ gemScore.js · autoScreen.js · proRadar.js
   │  ├─ autopsy.js (A) · watchlist.js (B) · influencers.js (B2)
   │  ├─ sniper.js (C) · sniperParams.js (registry param)
   │  ├─ smartMoney.js · quality.js · discover.js · sources.js · learn.js · telegram.js
   │  └─ .sniper-params.json  ← OVERRIDE parameter (menang atas .env)
   ├─ ai/                     analyze · anthropic · tools · settings · explainSignal
   └─ .env                    semua key + seed SNIPER_*
```

---

## 8. Ringkas alur nilai (mental model)

1. **Bedah** token winner → dapat smart wallet.
2. Smart wallet naik peringkat di **Watchlist** → dipantau live.
3. **Sniper Live** memantau wallet aktif → sinyal saat mereka borong barengan.
4. Paralel, **Radar** memindai pasar & **AI** menilai; alert ke **Telegram**.
5. **Settings** menyetel ketajaman semua ini secara real-time.
6. Semuanya heuristik — **bukan nasihat keuangan. DYOR.**

---

## 9. ⛓️ Ekosistem Robinhood Chain (EVM) — pipeline kembar

Zona terpisah (tombol melayang **Solana ⇄ Robinhood Chain** di UI) yang mem-port
pipeline yang sama ke **Robinhood Chain** (EVM L2). Detail penuh:
[ROBINHOOD-CHAIN.md](ROBINHOOD-CHAIN.md).

```mermaid
flowchart LR
  GT["GeckoTerminal"] --> D["🚀 Discover"]
  D --> S["💎 Screen/GEM\nevmScreen.js"]
  S --> B["🩻 Bedah\nevmAutopsy.js"]
  B --> W["👛 Watchlist\nevmWatchlist.js"]
  W --> SN["🎯 Sniper\nevmSniper.js"]
  BS["Blockscout"] --> S & B & SN
  AUTO["🤖 Auto-pilot\nevmAuto.js"] -.-> B & W & SN
```

| Tool | File | Endpoint |
|---|---|---|
| 🚀 Discover | `routes/robinhood.js` | `/api/robinhood/discover` |
| 💎 Screen / GEM | `screener/evmScreen.js` | `/api/robinhood/screen` |
| 🩻 Bedah Coin | `screener/evmAutopsy.js` | `/api/robinhood/bedah` |
| 👛 Watchlist | `screener/evmWatchlist.js` | `/api/robinhood/watchlist` |
| 🎯 Sniper Live | `screener/evmSniper.js` | `/api/robinhood/sniper/*` |
| 🤖 Auto-pilot | `screener/evmAuto.js` | `/api/robinhood/auto/*` |

**Beda dari Solana:** sumber data = **GeckoTerminal + Blockscout** (tanpa API key,
ganti Helius/Birdeye/DexScreener/RugCheck); gate keamanan **heuristik on-chain**
(GoPlus/Honeypot.is belum dukung chain 4663); watchlist **memantau semua wallet**
(cap pertumbuhan `RH_WATCHLIST_MAX`). Parameter: [REKAP-PARAMETER.md](REKAP-PARAMETER.md#-parameter-robinhood-chain-evm).
