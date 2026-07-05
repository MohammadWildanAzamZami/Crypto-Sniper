# 💎 Memecoin-Screener — Solana Token Screener (GEM Score™)

Screener token Solana dengan **GEM Score™ (0–100)** + alert Telegram, dibangun di
atas [SolScanMcp](https://github.com/wowinter13/solscan-mcp). Tujuannya: menilai
sebuah token memecoin secara cepat dari data publik (likuiditas, momentum,
kepercayaan) dan mengirim sinyal ke Telegram.

> ⚠️ **Bukan nasihat keuangan.** GEM Score hanya heuristik dari data publik.
> Memecoin bisa jatuh ke nol — **DYOR (Do Your Own Research)**.

---

## ✨ Fitur utama

- **GEM Score™ 0–100** — skor gabungan 3 pilar (Likuiditas 40 / Momentum 35 / Trust & Age 25).
- **Web app** — UI Vue 3 + proxy Express untuk screening lewat browser.
- **Alert Telegram** — kirim hasil screening ke chat Telegram.
- **MCP server** — bisa dipakai dari Claude Desktop sebagai tool.
- **Tanpa API key pun jalan** — backbone-nya [DexScreener](https://dexscreener.com) (publik, gratis). Solscan Pro hanya untuk *enrich* data holder (opsional).
- **Aman** — tidak pernah menyentuh wallet / seed phrase / private key. "Buy" hanya berupa deep-link ke Trojan bot.

---

## 🧱 Tech stack

| Bagian | Teknologi |
|--------|-----------|
| Frontend | Vue 3 + Vite |
| Backend / proxy | Node.js + Express |
| MCP server | Node.js (stdio, zero-dependency) |
| MCP asli (opsional) | Rust (Solscan Pro API, 37 tools) |
| Sumber data | DexScreener (utama), Solscan Pro (opsional) |

---

## 📂 Struktur folder

```
SolScanMcp/
├── src/                       # MCP server versi Rust (opsional, butuh Rust)
├── web/
│   ├── server/                # Backend Express (proxy + screener)
│   │   ├── screener/          # ⭐ INTI: sources.js, gemScore.js, telegram.js, screen.js
│   │   ├── ai/                # integrasi AI/chat
│   │   ├── index.js           # entry point server (port 8787)
│   │   └── .env.example       # contoh konfigurasi (copy jadi .env)
│   ├── frontend/              # UI Vue 3 (port 5173)
│   │   └── src/components/panels/ScreenerPanel.vue   # ⭐ panel GEM Score
│   └── mcp/server.js          # MCP server versi Node (untuk Claude Desktop)
├── docs/                      # semua dokumentasi terpusat
│   ├── SCREENER.md            # dokumentasi detail screener
│   ├── PRO-RADAR.md           # alur Pro Radar (Fable 5) + flowchart
│   ├── HANDOVER.md / LAPORAN.md / TOOLS.md / DEPLOY.md
├── CLAUDE.md                  # konteks auto-load untuk Claude Code
└── README.md                  # file ini
```

> 💡 **Kalau mau nambah/edit logika screener, mulai dari `web/server/screener/`.**
> Kalau mau ubah tampilan, ke `web/frontend/src/components/panels/ScreenerPanel.vue`.

---

## 🚀 Cara menjalankan (untuk kolaborator)

### 1. Prasyarat
- **Node.js** v18+ (disarankan v20/v24). Cek: `node -v`
- **Git**. Cek: `git --version`
- (Opsional) **Rust** — hanya kalau mau build MCP versi Rust di `src/`.

### 2. Clone repo
```bash
git clone https://github.com/MohammadWildanAzamZami/Memecoin-Screener.git
cd Memecoin-Screener
```

### 3. Install dependency
> `node_modules` sengaja **tidak** diupload ke GitHub, jadi harus install sendiri.
```bash
cd web/server
npm install

cd ../frontend
npm install
```

### 4. Konfigurasi environment
```bash
# dari folder web/server
# Windows PowerShell:
Copy-Item .env.example .env
# Linux/Mac:
cp .env.example .env
```
Lalu buka `web/server/.env` dan isi (semua opsional — screener tetap jalan tanpa ini):
```ini
SOLSCAN_API_KEY=        # opsional, untuk data holder
TELEGRAM_BOT_TOKEN=     # opsional, untuk alert Telegram
TELEGRAM_CHAT_ID=       # opsional
PORT=8787
```

### 5. Jalankan (butuh 2 terminal)
```bash
# Terminal 1 — backend
cd web/server
npm run dev          # http://localhost:8787

# Terminal 2 — frontend
cd web/frontend
npm run dev          # http://localhost:5173  ← buka ini di browser
```
Buka **http://localhost:5173** → panel **GEM Score™ Screener** ada di atas.
USDC sudah preload sebagai demo. Klik **Screen** untuk menilai, klik
**Alert Telegram** untuk kirim ke Telegram (butuh `TELEGRAM_*` di `.env`).

---

## 📊 Cara kerja GEM Score (0–100)

| Pilar | Bobot | Sinyal yang dinilai |
|-------|-------|---------------------|
| **Liquidity & Market** | 40 | kedalaman likuiditas, volume 24 jam, rasio volume/likuiditas |
| **Momentum** | 35 | pergerakan harga 1 jam / 6 jam, rasio buy/sell, jumlah transaksi |
| **Trust & Age** | 25 | umur pair, jumlah pair DEX, jumlah holder (via Solscan, opsional) |

**Gerbang verdict:**
- 🟢 **≥ 70 → STRONG**
- 🟡 **50–69 → WATCH**
- 🔴 **< 50 → SKIP**

---

## 🔌 HTTP API (proxy di port 8787)

| Method | Endpoint | Keterangan |
|--------|----------|------------|
| `GET`  | `/api/screen?token_address=<mint>` | laporan GEM Score lengkap |
| `POST` | `/api/screen-and-alert` `{ token_address }` | laporan + kirim Telegram |
| `POST` | `/api/batch-screen` `{ addresses: [...] }` | screening banyak token, terurut |
| `GET`  | `/api/health` | status `{ ok, hasKey, telegram }` |

---

## 🤖 Pakai dari Claude Desktop (MCP)

Tambahkan ke `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "solana-screener": {
      "command": "node",
      "args": ["PATH\\KE\\Memecoin-Screener\\web\\mcp\\server.js"],
      "env": {
        "SOLSCAN_API_KEY": "opsional",
        "TELEGRAM_BOT_TOKEN": "opsional",
        "TELEGRAM_CHAT_ID": "opsional"
      }
    }
  }
}
```
Tools yang tersedia: `screen_token`, `screen_and_alert`, `batch_screen`,
`get_holder_analysis`, `check_bonding_curve`.

---

## 🤝 Cara berkontribusi (untuk teman)

1. Minta diundang sebagai **collaborator** (Settings → Collaborators di GitHub), atau **fork** repo ini.
2. Buat branch baru untuk fiturmu:
   ```bash
   git checkout -b fitur-baru
   ```
3. Edit kode, lalu commit:
   ```bash
   git add .
   git commit -m "Tambah: deskripsi singkat perubahan"
   ```
4. Push branch:
   ```bash
   git push -u origin fitur-baru
   ```
5. Buka **Pull Request** di GitHub agar bisa direview sebelum di-merge ke `main`.

> 🔒 **JANGAN PERNAH commit file `.env` atau API key asli.** File `.env` sudah
> di-ignore. Gunakan `.env.example` sebagai template.

---

## 🛡️ Keamanan & disclaimer

- Screener **tidak pernah** menangani wallet, seed phrase, atau private key.
- Fitur "Buy via Trojan" hanya deep-link `t.me/solana_trojanbot?start=buy_<mint>` — manusia yang mengonfirmasi sendiri di dalam Trojan.
- GEM Score adalah heuristik atas data publik, **bukan nasihat keuangan**. Memecoin sangat berisiko — DYOR.

---

## 📄 Lisensi

MIT — lihat repo asal [wowinter13/solscan-mcp](https://github.com/wowinter13/solscan-mcp).
