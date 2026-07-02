# Panduan Integrasi & Konfigurasi Pesantren-App

Dokumen ini berisi panduan teknis bagi pengembang **Pesantren-App** untuk terhubung ke **Backend-API Gateway Terpusat** (`daimi-api.yts.sch.id`).

---

## 1. Lingkungan Pengembangan (Local Development)

Pada mode lokal, frontend `pesantren-app` disajikan menggunakan Vite Dev Server (atau framework frontend lainnya) dan terhubung ke backend-api secara local.

### Konfigurasi `.env` Pesantren-App
Buat berkas `.env` di root proyek `pesantren-app/`:
```ini
# Kosongkan VITE_API_BASE_URL agar otomatis menggunakan proxy lokal
VITE_API_BASE_URL=""

# Arahkan ke host backend (default port 8080)
VITE_BACKEND_HOST="http://localhost:8080"
```

### Konfigurasi Proxy (Contoh Vite `vite.config.ts`)
```typescript
server: {
  proxy: {
    '/api': {
      target: process.env.VITE_BACKEND_HOST || 'http://localhost:8080',
      changeOrigin: true,
    }
  }
}
```

---

## 2. Lingkungan Produksi (Production)

Di lingkungan produksi, `pesantren-app` akan menembak endpoint domain Cloudflared Tunnel secara langsung.

### Konfigurasi `.env` Produksi
```ini
# Gunakan alamat domain resmi backend-api
VITE_API_BASE_URL="https://daimi-api.yts.sch.id/api/v1"
```

### Keamanan CORS (Sisi Backend)
Pastikan domain frontend pesantren Anda (misal `https://daimi-pesantren.yts.sch.id`) sudah didaftarkan pada server `backend-api` di berkas `.env`:
```ini
CORS_ORIGINS="https://daimi-sekolah.yts.sch.id,https://daimi-pesantren.yts.sch.id"
```

---

## 3. Alur Kerja Perubahan Skema Database (Pesantren)

Tabel-tabel pesantren Anda diisolasi secara aman di dalam skema `pesantren` PostgreSQL.

1. **Menambah Tabel/Kolom**:
   Edit hanya file skema milik Anda di `backend-api`:
   `backend-api/prisma/schema/pesantren.prisma`
2. **Deklarasikan Skema**:
   Pastikan setiap model baru yang Anda buat memiliki anotasi skema `pesantren`:
   ```prisma
   model DataHafalan {
     id       String @id @default(uuid())
     surah    String
     // ...
     @@schema("pesantren")
   }
   ```
3. **Migrasi**:
   Jalankan migrasi di folder `backend-api` untuk memperbarui database:
   ```bash
   npx prisma migrate dev --name nama_migrasi
   ```
4. **Git Push**:
   Commit dan push perubahan skema Anda ke repositori bersama.
   *Tip: Jika tim sekolah melakukan perubahan skema, Anda cukup melakukan `git pull` lalu jalankan `npx prisma generate` dan `npx prisma migrate dev` untuk menyinkronkan database lokal Anda.*
