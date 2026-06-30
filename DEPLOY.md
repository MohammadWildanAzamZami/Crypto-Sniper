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

## 1. Backend di Render (dulu — karena URL-nya dibutuhkan frontend)

1. Buka <https://dashboard.render.com> → **New** → **Blueprint**.
2. Pilih repo `Memecoin-Screener`. Render membaca `render.yaml` → service
   `memecoin-screener-api` (plan **Free**, root `web/server`).
3. Klik **Apply**. Tunggu deploy selesai.
4. Catat URL-nya, mis. `https://memecoin-screener-api.onrender.com`.
5. Tes: buka `…onrender.com/api/health` → harus `{"ok":true,...}`.

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
