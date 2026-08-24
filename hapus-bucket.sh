#!/usr/bin/env bash
# ==============================================================================
# Script untuk Menghapus Bucket di MinIO
# Menggunakan kredensial dari berkas .env
# Penggunaan: ./hapus-bucket.sh [nama-bucket]
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "❌ Berkas .env tidak ditemukan di $SCRIPT_DIR!"
  exit 1
fi

# Baca variabel MinIO dari .env (membersihkan tanda petik dan spasi)
get_env_val() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" .env | cut -d '=' -f2- | tr -d '\r')
  # Hapus tanda petik di awal dan akhir
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"
  echo "$val"
}

MINIO_ENDPOINT=$(get_env_val "MINIO_ENDPOINT")
MINIO_PORT=$(get_env_val "MINIO_PORT")
MINIO_ACCESS_KEY=$(get_env_val "MINIO_ACCESS_KEY")
MINIO_SECRET_KEY=$(get_env_val "MINIO_SECRET_KEY")

MINIO_ENDPOINT=${MINIO_ENDPOINT:-minio}
MINIO_PORT=${MINIO_PORT:-9000}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-minio-aithendi}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-Hendi_2026!1}

TARGET_BUCKET="$1"

# Jika nama bucket tidak diberikan sebagai argumen, minta input interaktif
if [ -z "$TARGET_BUCKET" ]; then
  echo "=========================================="
  echo "🗑️  MinIO Bucket Removal Tool"
  echo "=========================================="
  echo "Menghubungkan ke MinIO ($MINIO_ENDPOINT:$MINIO_PORT)..."
  
  # Coba tampilkan daftar bucket yang ada
  podman run --rm --network global_net -v "$SCRIPT_DIR":/app:Z -w /app docker.io/library/node:22-alpine node --input-type=module -e '
  import { Client } from "minio";
  const c = new Client({
    endPoint: process.env.MINIO_ENDPOINT || "minio",
    port: parseInt(process.env.MINIO_PORT || "9000", 10),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY || "minio-aithendi",
    secretKey: process.env.MINIO_SECRET_KEY || "Hendi_2026!1"
  });
  const buckets = await c.listBuckets();
  console.log("\nDaftar bucket saat ini:");
  buckets.forEach((b, i) => console.log(` [${i+1}] ${b.name}`));
  ' 2>/dev/null || true

  echo ""
  read -r -p "Masukkan nama bucket yang ingin dihapus: " TARGET_BUCKET
fi

if [ -z "$TARGET_BUCKET" ]; then
  echo "❌ Nama bucket tidak boleh kosong."
  exit 1
fi

# Konfirmasi keamanan jika menghapus bucket default
if [ "$TARGET_BUCKET" = "edaimi-uploads" ]; then
  echo "⚠️  PERINGATAN: '$TARGET_BUCKET' adalah bucket utama aplikasi!"
  read -r -p "Ketik 'YA-HAPUS' untuk melanjutkan: " CONFIRM
  if [ "$CONFIRM" != "YA-HAPUS" ]; then
    echo "Dibatalkan."
    exit 0
  fi
fi

echo "🚀 Menghapus bucket '$TARGET_BUCKET' di MinIO..."

# Jalankan penghapusan via node script di container
podman run --rm --network global_net -v "$SCRIPT_DIR":/app:Z -w /app docker.io/library/node:22-alpine node --input-type=module -e "
import { Client } from 'minio';

const c = new Client({
  endPoint: '${MINIO_ENDPOINT}',
  port: parseInt('${MINIO_PORT}', 10),
  useSSL: false,
  accessKey: '${MINIO_ACCESS_KEY}',
  secretKey: '${MINIO_SECRET_KEY}'
});

async function run() {
  const bucket = '${TARGET_BUCKET}';
  try {
    const exists = await c.bucketExists(bucket);
    if (!exists) {
      console.log(\`ℹ️ Bucket '\${bucket}' tidak ditemukan.\`);
      return;
    }

    // Hapus semua isi objek di dalam bucket terlebih dahulu (force remove)
    const objectsStream = c.listObjectsV2(bucket, '', true);
    const objectsToDelete = [];

    for await (const obj of objectsStream) {
      if (obj.name) objectsToDelete.push(obj.name);
    }

    if (objectsToDelete.length > 0) {
      console.log(\`🧹 Menghapus \${objectsToDelete.length} berkas di dalam bucket '\${bucket}'...\`);
      await c.removeObjects(bucket, objectsToDelete);
    }

    await c.removeBucket(bucket);
    console.log(\`✅ Bucket '\${bucket}' berhasil dihapus sepenuhnya dari MinIO!\`);
  } catch (err) {
    console.error('❌ Gagal menghapus bucket:', err.message || err);
    process.exit(1);
  }
}

run();
"
