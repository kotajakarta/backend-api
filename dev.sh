#!/bin/bash
# Script untuk menjalankan backend-api secara lokal untuk pengembangan
set -e

# Ambil parameter pesan commit dari argumen perintah, jika kosong pakai default
COMMIT_MSG="${1:-Update backend-api code}"

echo "=== 1. Menambahkan Perubahan ke Git ==="
git add .

echo "=== 2. Membuat Commit ==="
git commit -m "$COMMIT_MSG"

echo "=== 3. Mem-push ke GitHub ==="
git push origin main

echo "Push Berhasil! Kode terbaru sudah ada di GitHub."

echo "=== Menghentikan proses di port 8080 (jika ada) ==="
fuser -k 8080/tcp 2>/dev/null || kill -9 $(lsof -t -i:8080) 2>/dev/null || true
echo "=== Menjalankan Backend API Lokal ==="
npm run dev
