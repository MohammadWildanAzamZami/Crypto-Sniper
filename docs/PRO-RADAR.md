# 🧠 Pro Radar (Fable 5) — alur data & flowchart

Pro Radar adalah versi **bertenaga AI** dari 10x Radar, dengan fokus **token yang
sedang trending**: trafik transaksinya masih ramai SEKARANG di jendela
**5 mnt / 1 jam / 6 jam / 24 jam** (momentum multi-timeframe) dan smart money /
whale sedang **akumulasi terus-menerus**. Funnel penemuan token-nya sama, tapi
finalisnya di-*enrich* dengan data liquidity-lock, disaring gate kualitas +
trending (token yang pump-nya sudah lewat dibuang), lalu diperingkat oleh model
**Fable 5** (`claude-fable-5`) yang menilai *conviction*, tesis, katalis, dan
red flag tiap token.

> ⚠️ Heuristik + opini AI dari data pasar publik. **Bukan nasihat keuangan.**
> Memecoin sangat berisiko — DYOR.

Endpoint: `GET /api/pro-radar` · UI: panel **🧠 Pro Radar** (di bawah 10x Radar).

---

## Flowchart (Mermaid)

```mermaid
flowchart TD
    A[User klik 'Scan AI'<br/>GET /api/pro-radar] --> B[1. DISCOVER<br/>discoverSolanaTokens]
    B -->|DexScreener boosts &<br/>profiles feeds - publik, tanpa key| B1[Sampai 28 mint Solana<br/>trending, dedup, buang stablecoin]

    B1 --> C[2. FAST SCREEN semua mint<br/>screenToken skipLock, konkuren x10]
    C -->|DexScreener token API| C1[Harga, likuiditas, FDV/MC,<br/>volume, priceChange, txns buy/sell,<br/>umur pair, jumlah pair]
    C -->|Solscan Pro - opsional| C2[Jumlah holder + konsentrasi<br/>hanya jika ada Pro key]
    C1 --> D
    C2 --> D[computeGemScore 0-100<br/>3 pilar: Likuiditas 40 / Momentum 35 / Trust 25]

    D --> E[3. PRE-FILTER heuristik<br/>evaluateMoonshot preset 'aggressive']
    E --> E1[Ambil yang lolos,<br/>urут GEM tertinggi, ambil TOP 10 finalis]

    E1 --> F[4. ENRICH finalis<br/>screenToken skipLock=false]
    F -->|RugCheck report - publik, tanpa key| F1[LP locked %, locked USD,<br/>total LP, status, flag rugged]

    F1 --> F2[4b. GATE kualitas + trending<br/>qualityGate - ambang tetap]
    F2 -->|Buang: rug, likuiditas tipis,<br/>trafik 1 jam sepi = pump sudah lewat| F3[4c. MOMENTUM 5m/1j/6j/24j<br/>computeMomentum 0-100]

    F3 --> G[5. AI RANK<br/>analyzeCandidates - Fable 5]
    G -->|Mode LOCAL: CLI 'claude -p'<br/>Mode API: Anthropic SDK| G1[Kirim payload ringkas tiap finalis<br/>→ Fable 5 balas JSON:<br/>conviction, tier, thesis, catalysts, redFlags, action]

    G1 --> H{AI berhasil?}
    H -->|Ya| I[6. MERGE + urut by quality<br/>GEM+conviction+momentum+smart money,<br/>lalu momentum, smart, action, GEM]
    H -->|Tidak / AI mati| J[Fallback: urut heuristik<br/>aiUsed=false]

    I --> K[Kirim ke UI: kartu token +<br/>meter conviction, tesis, katalis, red flag]
    J --> K
```

Kalau Mermaid tak render (mis. di editor biasa), lihat versi ASCII di bawah.

---

## Flowchart (ASCII)

```
          ┌───────────────────────────────────────────────┐
          │  User klik "Scan AI"  →  GET /api/pro-radar     │
          └───────────────────────┬───────────────────────┘
                                   ▼
   1. DISCOVER  ── discover.js ─────────────────────────────────────────────
      Sumber : DexScreener  token-boosts/latest, token-boosts/top,
               token-profiles/latest   (PUBLIK, tanpa API key)
      Ambil  : sampai 28 mint Solana yang lagi "trending", dedup,
               buang USDC/USDT/wSOL
                                   │
                                   ▼
   2. FAST SCREEN (semua mint, paralel x10)  ── screen.js + sources.js ──────
      Sumber : DexScreener  /latest/dex/tokens/<mint>   (PUBLIK)
      Data   : harga, likuiditas USD, marketCap/FDV, volume 1h/6h/24h,
               priceChange 1h/6h/24h, txns buy/sell 24h, umur pair, jumlah pair
      (opsional) Solscan Pro /token/holders → jumlah holder & konsentrasi
                 → hanya jika SOLSCAN_API_KEY Pro terpasang; else dilewati
      Skor   : computeGemScore() → GEM Score 0–100
               (Likuiditas 40 + Momentum 35 + Trust/Age 25)
      Catatan: LP-lock DILEWATI di tahap ini (skipLock) biar cepat
                                   │
                                   ▼
   3. PRE-FILTER heuristik  ── autoScreen.js: evaluateMoonshot() ────────────
      Preset : "aggressive" (jaring lebar): MC ≤ $500k, Liq ≥ $5k,
               GEM ≥ 55, umur 0.5j–14h, buy ratio ≥ 50%
      Hasil  : yang LOLOS → urut GEM tertinggi → ambil TOP 10 (finalis)
                                   │
                                   ▼
   4. ENRICH finalis  ── screen.js (skipLock=false) + sources.js ────────────
      Sumber : RugCheck  /v1/tokens/<mint>/report   (PUBLIK, tanpa key)
      Data   : LP locked %, locked USD, total LP USD, status
               (Locked / Partially / Unlocked), flag "rugged"
                                   │
                                   ▼
   4b. GATE kualitas + TRENDING  ── quality.js: qualityGate() ───────────────
      Ambang TETAP (GATE, self-tuning dihapus): rug, GEM < 60, likuiditas
      < $12k, volume 24j < $15k, tx 24j < 60, honeypot-shaped, LP lock < 20%,
      dump dari ATH ≥ 80% → BUANG.
      TRENDING: tx 1 jam < 20, volume 1 jam < $2k, atau laju 1 jam < 35% dari
      rata-rata harian → BUANG (ramai kemarin ≠ trending sekarang).
                                   │
                                   ▼
   4c. MOMENTUM multi-timeframe  ── momentum.js: computeMomentum() ──────────
      Dari volume + txns DexScreener per jendela 5m/1j/6j/24j:
      skor 0–100 (trafik hidup sekarang + akselerasi vs rata-rata harian +
      tekanan beli 1 jam), pace per jendela, buy ratio, hotWindows.
                                   │
                                   ▼
   5. AI RANK  ── ai/analyze.js: analyzeCandidates() → FABLE 5 ──────────────
      Input ke model (payload RINGKAS per finalis):
        address, symbol, name, gemScore, marketCap, liquidityUsd,
        volume24h, priceChange 5m/1h/6h/24h, buys/sells 24h, buyRatio%,
        momentumScore, txns5m, txnsH1, volumeH1, volPaceH1/5m,
        buyRatioH1Pct, hotWindows, ageHours, pairCount, lockedPct,
        lockStatus, rugged, sinyal pump.fun + smart money
      Jalur :
        • Mode LOCAL  → CLI `claude -p ... --model claude-fable-5` (tanpa biaya)
        • Mode API    → Anthropic SDK messages.create (butuh ANTHROPIC_API_KEY)
      Output model (JSON array per token):
        conviction 0–100, tier S/A/B/C, thesis, catalysts[], redFlags[], action
        (APE / WATCH / AVOID)
                                   │
                                   ▼
   6. MERGE + SORT  ── proRadar.js ─────────────────────────────────────────
      Quality 0–100 = 60% (GEM+conviction) + 40% momentum,
                      + boost smart money s/d +20 (whale akumulasi terus)
      Urut: quality ↓, lalu momentum, smart money, action, GEM Score
      AI mati → fallback heuristik (aiUsed=false, badge ⚠️ di UI)
                                   │
                                   ▼
              UI: kartu token + meter conviction, tesis,
                  katalis (▲) & red flag (▼), tombol Chart / Buy
```

---

## Tabel sumber data

| Tahap | Fungsi | Sumber data | Perlu key? | Data yang diambil |
|-------|--------|-------------|:---------:|-------------------|
| 1. Discover | `discoverSolanaTokens` | DexScreener boosts/profiles | ❌ | Daftar mint trending |
| 2. Fast screen | `fetchDexScreener` | DexScreener tokens API | ❌ | Harga, likuiditas, MC, volume, priceChange, txns, umur pair |
| 2. (opsional) | `fetchSolscanHolders` | Solscan Pro | ✅ Pro | Jumlah holder, konsentrasi top holder |
| 2. Skor | `computeGemScore` | (lokal) | ❌ | GEM Score 0–100 |
| 3. Pre-filter | `evaluateMoonshot` | (lokal) | ❌ | Lolos/tidak + alasan |
| 4. Enrich | `fetchRugcheckLock` | RugCheck | ❌ | LP locked %, USD, status, rugged |
| 4b. Gate | `qualityGate` | (lokal, ambang tetap) | ❌ | Buang rug/junk + trafik yang sudah mati |
| 4c. Momentum | `computeMomentum` | (lokal, dari data DexScreener) | ❌ | Skor trending 0–100 per jendela 5m/1j/6j/24j |
| 5. AI rank | `analyzeCandidates` | **Fable 5** (CLI lokal / Anthropic API) | Lokal: ❌ · API: ✅ | conviction, tier, thesis, katalis, red flag, action |

---

## 10x Radar vs Pro Radar

| | 🚀 10x Radar | 🧠 Pro Radar (Fable 5) |
|--|--------------|------------------------|
| Discovery | DexScreener trending | DexScreener trending (jaring lebih lebar, 28) |
| GEM Score | ✅ | ✅ |
| Liquidity lock (RugCheck) | ❌ (dilewati, biar cepat) | ✅ (di-enrich untuk finalis) |
| Peringkat AI (Fable 5) | ❌ | ✅ conviction + tesis + red flag |
| Momentum trending 5m/1j/6j/24j | ❌ | ✅ skor + gate "trafik masih ramai" |
| Bobot smart money / whale | ❌ | ✅ boost quality s/d +20 |
| Urutan | GEM Score | Quality (GEM+conviction+momentum+smart) |
| Kecepatan | Cepat | Lebih lambat (ada langkah enrich + AI) |
| Endpoint | `/api/auto-screen` | `/api/pro-radar` |

## Cara pakai AI-nya

- **Mode Local** (default, tanpa biaya): butuh CLI `claude` di mesin yang menjalankan
  server. Model diatur ke `claude-fable-5`.
- **Mode API** (untuk hosting publik): set provider Claude + isi Anthropic API key di
  **Settings**, pilih model `claude-fable-5`.
- Kalau AI tak tersedia, Pro Radar tetap jalan memakai urutan heuristik dan menandai
  `⚠️ AI tak aktif` di UI.
