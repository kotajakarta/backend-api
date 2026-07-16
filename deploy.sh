#!/bin/bash
# Script untuk deploy Backend API menggunakan Podman Quadlet
set -e

APP_DIR="/data/podman-hosting/apps/backend-api"

# Pastikan berada di direktori aplikasi
cd "$APP_DIR" || exit 1

echo "=== 1. Menarik Update Terbaru (git pull) ==="
git fetch origin main
git reset --hard origin/main
git clean -fd

echo "=== 2. Hapus versi Compose (jika sebelumnya dipakai) ==="
podman-compose down 2>/dev/null || true
podman rm -f edaimi-api 2>/dev/null || true
podman rm -f daimi-api 2>/dev/null || true

echo "=== 3. Build Aplikasi ==="
# Build menggunakan container sementara (ephemeral) untuk memastikan kompatibilitas
podman run --rm -v "$APP_DIR":/app:Z -w /app docker.io/library/node:20-alpine sh -c "npm install && npx prisma generate && npm run build"

echo "=== 4. Setup Quadlet Container ==="
mkdir -p ~/.config/containers/systemd
cp daimi-api.container ~/.config/containers/systemd/

echo "=== 5. Reload & Restart Systemd ==="
systemctl --user daemon-reload
systemctl --user restart daimi-api.service


echo "=== 6. Prisma Migrate Deploy ==="
# Menjalankan migrasi database di dalam container yang sudah berjalan
podman exec daimi-api npx prisma migrate deploy

echo "=== Deployment Selesai! ==="
systemctl --user status daimi-api.service --no-pager
