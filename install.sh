#!/bin/bash
# Script untuk setup awal dan instalasi dependencies di RHEL (Rootless Podman Environment)
set -e

APP_DIR="/data/podman-hosting/apps/backend-api"

echo "=== 1. Menginstall Dependencies via Podman ==="
podman run --rm \
  -v "$APP_DIR":/app:Z \
  -w /app \
  docker.io/library/node:20-alpine \
  npm install --production --no-audit --no-fund

echo "=== 2. Generate Prisma Client ==="
podman run --rm \
  -v "$APP_DIR":/app:Z \
  -w /app \
  docker.io/library/node:20-alpine \
  npx prisma generate

echo "=== 3. Restart Service daimi-api ==="
systemctl --user restart daimi-api.service

echo "=== 4. Status Service ==="
systemctl --user status daimi-api.service

echo "Setup & Instalasi Selesai!"
