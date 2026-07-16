#!/bin/bash
# Script untuk deploy Backend API menggunakan podman-compose
set -e

APP_DIR="/data/podman-hosting/apps/backend-api"

# Pastikan berada di direktori aplikasi
cd "$APP_DIR" || exit 1

echo "=== 1. Menarik Update Terbaru (git pull) ==="
git fetch origin main
git reset --hard origin/main
git clean -fd

echo "=== 2. Mematikan Service Lama (Jika Ada) ==="
# Mematikan service lama yang dibuat via systemd/quadlet agar port 8087 tidak bentrok
systemctl --user stop edaimi-api.service 2>/dev/null || true
systemctl --user stop daimi-api.service 2>/dev/null || true

# Hapus container lama secara paksa jika masih ada
podman rm -f edaimi-api 2>/dev/null || true

# Turunkan service compose jika sebelumnya sudah jalan
podman-compose down 2>/dev/null || true

echo "=== 3. Build Image & Jalankan Container ==="
# Menjalankan build dari Dockerfile dan me-restart container di background
podman-compose up -d --build

echo "=== 4. Prisma Migrate Deploy ==="
# Menjalankan migrasi database di dalam container yang sudah berjalan
# (Catatan: flag -it dihilangkan karena script ini biasanya dijalankan otomatis non-interaktif)
podman exec edaimi-api npx prisma migrate deploy

echo "=== Deployment Selesai! ==="
podman ps | grep edaimi-api
