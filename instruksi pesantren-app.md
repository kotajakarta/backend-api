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

Tabel-tabel pesantren Anda diisolasi secara aman di dalam skema `pesantren` PostgreSQL. Karena `backend-api` merupakan repositori bersama, Anda **wajib** mengikuti alur kerja berikut untuk mencegah kerusakan skema atau konflik.

### A. Jika Anda INGIN Mengubah/Menambah Skema
1. **Perbarui Repositori Lokal Terlebih Dahulu**:
   Sebelum mengubah apapun, pastikan kode lokal Anda *up-to-date*.
   ```bash
   cd backend-api
   git pull origin main
   npm install
   npx prisma generate
   ```
2. **Ubah File Skema**:
   Edit **hanya** file skema milik Anda: `prisma/schema/pesantren.prisma`.
   Setiap tabel baru **wajib** menggunakan tag `@@schema("pesantren")`.
   ```prisma
   model DataHafalan {
     id       String @id @default(uuid())
     surah    String
     // ...
     @@schema("pesantren")
   }
   ```
3. **Buat Migrasi Lokal**:
   Jalankan perintah ini untuk membuat file migrasi dan memperbarui database lokal:
   ```bash
   npx prisma migrate dev --name deskripsi_singkat_perubahan
   ```
4. **Push ke GitHub**:
   Kirimkan hasil migrasi Anda agar tim lain (seperti tim Sekolah) bisa mendapatkan perubahannya.
   ```bash
   ./push.sh
   ```

### B. Jika Tim Lain (Sekolah) Telah Mengubah Skema
Saat tim lain menambahkan tabel/kolom, aplikasi Anda mungkin akan tertinggal. Lakukan langkah sinkronisasi ini:
1. **Tarik Perubahan Terbaru**:
   ```bash
   cd backend-api
   git pull origin main
   ```
2. **Sinkronkan Dependensi & Prisma**:
   Sangat penting menjalankan perintah berikut agar `Prisma Client` mengenali kolom/tabel baru dari tim lain.
   ```bash
   npm install
   npx prisma generate
   ```
3. **Terapkan Migrasi ke Database Lokal Anda**:
   ```bash
   npx prisma migrate dev
   ```
4. **Restart Backend**:
   Jalankan ulang `./runlocal.sh` untuk menerapkan perubahan skema.
