#!/bin/bash
# Script lokal untuk menarik kode terbaru dan regenerasi skema database
set -e

echo "=== 1. Menarik Kode Terbaru dari GitHub ==="
git pull origin main

echo "=== 2. Regenerasi Prisma Client Lokal ==="
npx prisma generate --schema=prisma/schema

echo "=== 3. Menjalankan Migrasi Database Lokal ==="
npx prisma migrate dev --schema=prisma/schema

echo "Sinkronisasi Selesai! Aplikasi Anda siap digunakan."
