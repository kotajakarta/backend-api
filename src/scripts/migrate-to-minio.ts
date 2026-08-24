import 'dotenv/config';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';

const cleanEnv = (val?: string, defaultVal: string = ''): string => {
  if (!val) return defaultVal;
  return val.trim().replace(/^["']|["']$/g, '').trim();
};

async function migrate() {
  console.log('🚀 Memulai migrasi folder uploads/ ke MinIO Object Storage...');

  let rawEndpoint = cleanEnv(process.env.MINIO_ENDPOINT, 'minio');
  let port = parseInt(cleanEnv(process.env.MINIO_PORT, '9000'), 10);
  let useSSL = cleanEnv(process.env.MINIO_USE_SSL) === 'true';

  if (rawEndpoint.startsWith('http://') || rawEndpoint.startsWith('https://')) {
    try {
      const u = new URL(rawEndpoint);
      rawEndpoint = u.hostname;
      if (u.port) port = parseInt(u.port, 10);
      if (u.protocol === 'https:') useSSL = true;
    } catch {
      rawEndpoint = rawEndpoint.replace(/^https?:\/\//, '').split(':')[0];
    }
  } else if (rawEndpoint.includes(':')) {
    const parts = rawEndpoint.split(':');
    rawEndpoint = parts[0];
    if (parts[1]) port = parseInt(parts[1], 10);
  }

  const endpoint = rawEndpoint.trim();
  const accessKey = cleanEnv(process.env.MINIO_ACCESS_KEY) || cleanEnv(process.env.MINIO_ROOT_USER, 'minio-aithendi');
  const secretKey = cleanEnv(process.env.MINIO_SECRET_KEY) || cleanEnv(process.env.MINIO_ROOT_PASSWORD, 'Hendi_2026!1');
  const bucketName = cleanEnv(process.env.MINIO_BUCKET, 'edaimi-uploads');

  console.log(`📡 Menghubungkan ke MinIO -> Endpoint: ${endpoint}:${port} (SSL: ${useSSL}), Bucket: ${bucketName}`);

  const client = new Minio.Client({
    endPoint: endpoint,
    port: port,
    useSSL: useSSL,
    accessKey: accessKey,
    secretKey: secretKey,
  });


  // Pastikan bucket ada
  try {
    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      console.log(`Membuat bucket '${bucketName}' baru di MinIO...`);
      await client.makeBucket(bucketName, 'us-east-1');
    }
    console.log(`✅ Terhubung ke MinIO (Bucket '${bucketName}' siap)`);
  } catch (err: any) {
    console.error('❌ Gagal terhubung ke MinIO:', err?.message || err?.code || err);
    console.error('Detail Error:', err);
    process.exit(1);
  }


  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    console.log('ℹ️ Folder uploads/ tidak ditemukan di lokal. Tidak ada berkas untuk dimigrasi.');
    return;
  }

  function getAllFiles(dir: string, baseDir: string = dir): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getAllFiles(fullPath, baseDir));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allFiles = getAllFiles(uploadDir);
  console.log(`📦 Ditemukan ${allFiles.length} berkas di folder uploads/`);

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (const filePath of allFiles) {
    const relativePath = path.relative(uploadDir, filePath).replace(/\\/g, '/');
    try {
      // Cek apakah sudah ada di MinIO
      try {
        await client.statObject(bucketName, relativePath);
        skippedCount++;
        continue;
      } catch (_) {
        // File belum ada, upload
      }

      await client.fPutObject(bucketName, relativePath, filePath);
      successCount++;
      console.log(` [UPLOADED] -> ${relativePath}`);
    } catch (err: any) {
      failCount++;
      console.error(` [FAILED] -> ${relativePath}: ${err.message}`);
    }
  }

  console.log('\n=============================================');
  console.log(`🎉 Migrasi Selesai!`);
  console.log(` - Berhasil diunggah : ${successCount}`);
  console.log(` - Sudah ada (skip)  : ${skippedCount}`);
  console.log(` - Gagal             : ${failCount}`);
  console.log('=============================================\n');
}

migrate().catch(console.error);
