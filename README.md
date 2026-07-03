# Edaimi Backend API Gateway

Backend API Terpusat untuk seluruh ekosistem aplikasi Yayasan / Edaimi (Sekolah App, Pesantren App, Absensi, dll). Aplikasi ini dibangun dengan mengedepankan keamanan, performa, dan isolasi data antar aplikasi.

## 🚀 Teknologi Utama
- **Framework**: NestJS v11 (Express-based)
- **Database ORM**: Prisma v7
- **Database Engine**: PostgreSQL
- **Language**: TypeScript

## 🗄️ Arsitektur Database (Multi-Schema)
Database PostgreSQL (`edaimi`) dipisahkan ke dalam beberapa skema (schema) logis untuk isolasi data tiap tim/aplikasi:
1. `core` - Data utama (Siswa, Pengguna, Autentikasi, dll)
2. `formal` - Data akademik sekolah (Nilai, Kelas, Jadwal, dll)
3. `pesantren` - Data kepesantrenan (Hafalan, Asrama, dll)
4. `absensi` - Data kehadiran (Gateway mesin absensi, Tap ID)

## 🛡️ Fitur Keamanan Bawaan
- **Helmet**: Melindungi dari kerentanan web standar (XSS, Clickjacking, dll).
- **CORS**: Dibatasi hanya untuk domain frontend resmi (`CORS_ORIGINS`).
- **Rate Limiting**: Mencegah serangan *Brute Force* dan *DDoS* (Login: 5 req/min, Global: 100 req/min).
- **Request ID**: Pelacakan setiap *request* menggunakan UUID (mudah untuk *debugging*).
- **Audit Logging**: Mencatat semua operasi modifikasi data (POST, PUT, DELETE) beserta pengguna yang melakukannya.
- **Error Masking**: Mencegah detail *stack trace* atau *query* database bocor ke pengguna akhir.

## 💻 Panduan Pengembangan (Local)

1. **Instalasi**
   ```bash
   npm install
   ```
2. **Setup Konfigurasi**
   Salin `.env.example` ke `.env` lalu sesuaikan kredensialnya:
   ```bash
   cp .env.example .env
   ```
3. **Persiapan Prisma Client (wajib)**
   ```bash
   npx prisma generate
   ```
4. **Menjalankan Server (Mode Development)**
   ```bash
   ./runlocal.sh
   # atau
   npm run dev
   ```
5. **Dokumentasi API (Swagger)**
   Saat mode development (`NODE_ENV !== 'production'`), Swagger aktif di:
   `http://localhost:8080/api/v1/docs`

## 🔄 Panduan Sinkronisasi Skema & Git
Repositori ini dikerjakan oleh berbagai tim (Sekolah, Pesantren, dll). Agar tidak terjadi bentrok skema database, patuhi panduan berikut:

- Jika Anda bekerja di tim Pesantren, silakan baca: `instruksi pesantren-app.md`
- Jika Anda bekerja di tim Sekolah, silakan baca: `instruksi sekolah-app.md`

## 🚢 Panduan Deployment (Produksi)
Di server produksi, aplikasi berjalan secara terisolasi di dalam **Rootless Podman Container** yang dikendalikan oleh **Systemd Quadlet**.

Semua manajemen deployment telah diotomatisasi dengan *script* Bash:

1. **Setup Awal Server (Hanya Sekali)**:
   ```bash
   ./setup-awal.sh
   ```
   *(Script ini akan mem-build image Podman dan menyiapkan konfigurasi Systemd secara otomatis).*

2. **Update Kode Produksi**:
   Jika ada kode baru di GitHub, login ke server, masuk ke folder `backend-api`, lalu jalankan:
   ```bash
   ./update.sh
   ```
   *(Script ini akan menarik kode terbaru `git pull`, menjalankan migrasi Prisma, mem-build ulang image, dan merestart container).*
