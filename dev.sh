#!/bin/bash
set -e

COMMIT_MSG="${1:-Update backend-api code}"

echo "=== 1. Menambahkan Perubahan ke Git ==="
git add .

echo "=== 2. Membuat Commit ==="
# Cegah error jika tidak ada perubahan baru untuk di-commit
if git diff-index --quiet HEAD --; then
    echo "Tidak ada perubahan yang perlu di-commit."
else
    git commit -m "$COMMIT_MSG"
fi

echo "=== 3. Mem-push ke GitHub ==="
# Gunakan flag --verbose agar terlihat progress upload-nya
git push --verbose origin main

echo "=== 4. Menjalankan Backend API Lokal ==="
# Menghentikan proses di port 8080 jika ada
fuser -k 8080/tcp 2>/dev/null || kill -9 $(lsof -t -i:8080) 2>/dev/null || true

npm run dev