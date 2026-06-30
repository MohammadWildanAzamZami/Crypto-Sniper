# Deploy: GitHub Pages (frontend) + Render (backend)

Tujuan: publik bisa buka **`https://mohammadwildanazamzami.github.io/Memecoin-Screener/`**
dengan semua fitur live (🚀 10x Radar, Screener, Chat) jalan lewat backend hosted.

Arsitektur:

```
GitHub Pages (frontend statis)  --->  Render (backend Express /api/*)  --->  DexScreener/RugCheck
```

Repo sudah berisi semua yang otomatis:
- `.github/workflows/deploy-pages.yml` — build & publish frontend ke Pages.
- `render.yaml` — blueprint backend.
- Frontend memanggil API lewat `VITE_API_BASE` (lihat `web/frontend/src/lib/api.js`).

Yang di bawah ini perlu **kamu klik sekali** di dashboard.

---

## 1. Backend (pilih satu host — semua punya free tier)

Repo punya **dua** cara deploy: `render.yaml` (Render) **dan** `Dockerfile`
(host container apa pun). Tujuannya sama: dapat satu URL backend publik.

### Opsi A — Back4app Containers (TANPA kartu kredit) ⭐ untuk yang tak mau isi kartu
1. Daftar di <https://www.back4app.com/> (cukup email/GitHub, tidak minta kartu).
2. **Containers** → **Deploy your app** → connect repo `Memecoin-Screener`.
3. Build pakai **Dockerfile** di root (otomatis terdeteksi). Port: `8787`
   (atau biarkan Back4app set `PORT`).
4. Tambah Environment Variables (lihat tabel knob di bawah; minimal `ADMIN_TOKEN`).
5. Deploy → catat URL publiknya (mis. `https://<app>.back4app.io`).

### Opsi B — Koyeb (juga tanpa kartu untuk free tier)
1. Daftar di <https://www.koyeb.com/> dengan GitHub.
2. **Create Web Service** → repo `Memecoin-Screener` → builder **Dockerfile**.
3. Instance **Free**, set env vars, Deploy → catat URL (`https://<app>.koyeb.app`).

### Opsi C — Render (Blueprint) — catatan: free tier Render umumnya tak butuh
kartu, tapi kalau diminta, pakai Opsi A/B.
1. <https://dashboard.render.com> → **New** → **Blueprint** → repo `Memecoin-Screener`.
2. Render membaca `render.yaml` → service `memecoin-screener-api` (Free, root `web/server`).
3. **Apply** → catat URL (`https://memecoin-screener-api.onrender.com`).

**Apa pun hostnya, verifikasi:** buka `…/api/health` → harus `{"ok":true,...}`.

> **Keamanan (sudah ada proteksi):** backend kini aman dipublikasikan —
> - Endpoint tulis (`/api/settings`, `/api/screen-and-alert`, `/api/batch-screen`)
>   **digate `ADMIN_TOKEN`**; tanpa token, request dari luar (non-loopback) ditolak.
> - `/api/chat` & `/api/auto-screen` **dibatasi rate** per-IP, plus **budget harian**
>   chat (`CHAT_DAILY_MAX`, default 200) agar token AI tidak jebol.
> - Radar & Screener tetap jalan **tanpa key** (DexScreener gratis).
>
> Untuk mengaktifkan **Chat AI publik**: set env `ANTHROPIC_API_KEY` di Render.
> Untuk bisa mengelola settings dari jauh: set env `ADMIN_TOKEN` (string acak),
> lalu kirim header `Authorization: Bearer <token>`. (Catatan Render Free:
> service "tidur" setelah idle, request pertama bisa lambat ~30 dtk.)
>
> **Knob env opsional:** `RATE_LIMIT_MAX` (global/menit, default 120),
> `CHAT_RATE_MAX` (chat/menit/IP, default 8), `SCAN_RATE_MAX` (scan/menit/IP,
> default 6), `CHAT_DAILY_MAX` (chat/hari total, default 200).

---

## 2. Arahkan frontend ke backend itu

1. GitHub → repo → **Settings → Secrets and variables → Actions → Variables**.
2. **New repository variable**:
   - Name: `VITE_API_BASE`
   - Value: URL Render dari langkah 1 (tanpa slash akhir),
     mis. `https://memecoin-screener-api.onrender.com`

---

## 3. Nyalakan GitHub Pages

1. GitHub → repo → **Settings → Pages**.
2. **Build and deployment → Source → GitHub Actions**.
3. Jalankan workflow: **Actions → "Deploy frontend to GitHub Pages" → Run workflow**
   (atau cukup push apa pun ke `main` yang menyentuh `web/frontend/**`).
4. Setelah hijau, situs live di:
   **`https://mohammadwildanazamzami.github.io/Memecoin-Screener/`**

---

## Update berikutnya

- **Frontend**: push ke `main` → workflow rebuild & redeploy Pages otomatis.
- **Backend**: push ke `main` → Render auto-deploy (default ON).
- Ganti backend? cukup update variable `VITE_API_BASE` lalu re-run workflow Pages.

## Catatan
- Repo name = subpath Pages. Kalau repo di-rename, ubah `VITE_BASE` di
  `deploy-pages.yml` agar cocok (`/<nama-repo>/`).
- Lokal tetap seperti biasa: `web/server` + `web/frontend` (atau single-port
  `npm run build` lalu `npm start` di `web/server`). `VITE_API_BASE` kosong =
  same-origin, jadi tidak menyentuh Render saat dev.
