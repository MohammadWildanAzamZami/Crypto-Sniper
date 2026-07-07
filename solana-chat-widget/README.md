# Solana Chat Widget

Bubble chat AI yang bisa di-embed ke web mana pun. Backend menyimpan
`ANTHROPIC_API_KEY` server-side (tidak pernah ke browser); frontend cuma satu
file JS yang dipasang lewat satu `<script>`.

```
solana-chat-widget/
├── backend/                 ← simpan API key di sini, AMAN
│   ├── src/server.js            (proxy Express ke Claude API, SSE streaming)
│   ├── src/systemPrompt.js      (instruksi AI — bisa kamu edit)
│   ├── .env.example
│   └── package.json
├── frontend/                ← upload ke web kamu
│   ├── solana-chat-widget.js    (widget chat bubble, vanilla JS)
│   └── demo.html                (contoh pemakaian)
└── README.md
```

## 1. Setup backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env, isi ANTHROPIC_API_KEY dari https://console.anthropic.com/settings/keys
npm start
```

Backend jalan di `http://localhost:8788`. Cek `http://localhost:8788/api/health`
→ `{"ok":true,"model":"…","keyed":true}` (`keyed:false` artinya key belum diisi).

## 2. Coba widget

Buka `frontend/demo.html` di browser (atau serve foldernya). Bubble chat muncul
di pojok kanan bawah, sudah menunjuk ke `http://localhost:8788`.

> Catatan: kalau dibuka via `file://` dan backend di `localhost`, CORS sudah
> diizinkan (`ALLOWED_ORIGIN=*` default). Untuk produksi, set origin spesifik.

## 3. Pasang di web aslimu

Upload `solana-chat-widget.js` ke web-mu, lalu tambahkan satu baris sebelum
`</body>`:

```html
<script src="/path/solana-chat-widget.js" data-backend="https://backend-kamu.com"></script>
```

Atau konfigurasi lebih lengkap:

```html
<script>
  window.SOLANA_CHAT_WIDGET = {
    backend: "https://backend-kamu.com",
    title: "Asisten Memecoin",
    greeting: "Halo! Ada yang bisa dibantu?"
  };
</script>
<script src="/path/solana-chat-widget.js"></script>
```

## Deploy backend (tanpa kartu)

Backend ini Express biasa — bisa di-host di Back4app / Koyeb / Render dll.
Set env `ANTHROPIC_API_KEY` (dan `ALLOWED_ORIGIN` ke domain web-mu) di dashboard host.

## Konfigurasi (env backend)

| Env | Default | Fungsi |
|-----|---------|--------|
| `ANTHROPIC_API_KEY` | — | **Wajib.** Key dari console.anthropic.com |
| `ANTHROPIC_MODEL` | `claude-fable-5` | Ganti ke `claude-haiku-4-5` untuk lebih murah |
| `PORT` | `8788` | Port backend |
| `ALLOWED_ORIGIN` | `*` | Origin yang boleh memanggil (set domainmu di produksi) |
| `RATE_MAX` | `15` | Maks request `/api/chat` per menit per IP |

## Keamanan & biaya

- API key **hanya** di backend `.env` — tidak pernah dikirim ke browser.
- Tiap pesan memakai **saldo API berbayar**-mu. Ada rate-limit per IP; untuk web
  publik pertimbangkan menambah autentikasi atau batas harian.
- Ini bukan saran finansial — system prompt sudah menegaskan itu.
