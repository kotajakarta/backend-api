#!/bin/bash
# Script untuk menjalankan backend-api secara lokal untuk pengembangan

echo "=== Menghentikan proses di port 8080 (jika ada) ==="
fuser -k 8080/tcp 2>/dev/null || kill -9 $(lsof -t -i:8080) 2>/dev/null || true
echo "=== Menjalankan Backend API Lokal ==="
npm run dev
