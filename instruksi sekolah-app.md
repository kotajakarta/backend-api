# Panduan Integrasi & Konfigurasi Sekolah-App

Dokumen ini berisi panduan teknis bagi pengembang **Sekolah-App** untuk terhubung ke **Backend-API Gateway Terpusat** (`daimi-api.yts.sch.id`).

---

## 1. Lingkungan Pengembangan (Local Development)

Pada mode lokal, frontend `sekolah-app` disajikan menggunakan Vite Dev Server, sedangkan backend-api berjalan di server Quadlet/lokal.

### Konfigurasi `.env` Sekolah-App
Buat berkas `.env` di root `sekolah-app/`:
```ini
# Kosongkan VITE_API_BASE_URL agar otomatis menggunakan Vite proxy lokal (/api/v1)
VITE_API_BASE_URL=""

# Host backend lokal untuk keperluan proxy
VITE_BACKEND_HOST="http://localhost:8080"
```

### Mekanisme Proxy (`vite.config.ts`)
Vite akan meneruskan request `/api/v1/*` ke host backend secara otomatis untuk menghindari kendala CORS:
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

## 2. Lingkungan Produksi (Production - daimi-api.yts.sch.id)

Dalam lingkungan produksi, frontend `sekolah-app` dideploy secara terpisah (misalnya menggunakan hosting static/Nginx) dan menembak domain API resmi.

### Konfigurasi `.env` Produksi
Ubah konfigurasi `.env` pada server sekolah-app Anda menjadi:
```ini
# Tembak langsung domain API Gateway resmi lewat Cloudflared Tunnel
VITE_API_BASE_URL="https://daimi-api.yts.sch.id/api/v1"
```

### Keamanan CORS (Sisi Backend)
Pastikan domain frontend sekolah-app Anda (misal `https://daimi-sekolah.yts.sch.id`) sudah terdaftar di `.env` milik `backend-api`:
```ini
CORS_ORIGINS="https://daimi-sekolah.yts.sch.id"
```

---

## 3. Alur Kerja Perubahan Skema Database (Sekolah)

Tabel-tabel Sekolah terisolasi di dalam skema `formal` PostgreSQL. Karena `backend-api` merupakan repositori bersama, Anda **wajib** mengikuti alur kerja berikut untuk mencegah kerusakan skema atau konflik.

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
   Edit **hanya** file skema milik Anda: `prisma/schema/formal.prisma`.
   Pastikan setiap model baru memiliki penanda skema `formal`:
   ```prisma
   model NilaiBaru {
     id    String @id @default(uuid())
     // ...
     @@schema("formal")
   }
   ```
3. **Buat Migrasi Lokal**:
   Jalankan perintah ini untuk membuat file migrasi dan memperbarui database lokal:
   ```bash
   npx prisma migrate dev --name deskripsi_singkat_perubahan
   ```
4. **Push ke GitHub**:
   Kirimkan hasil migrasi Anda agar tim lain (seperti tim Pesantren) bisa mendapatkan perubahannya.
   ```bash
   ./push.sh
   ```

### B. Jika Tim Lain (Pesantren) Telah Mengubah Skema
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
