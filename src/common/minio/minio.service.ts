import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

const cleanEnv = (val?: string, defaultVal: string = ''): string => {
  if (!val) return defaultVal;
  return val.trim().replace(/^["']|["']$/g, '').trim();
};

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client!: Minio.Client;
  private readonly bucketName: string;

  constructor() {
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

    this.bucketName = cleanEnv(process.env.MINIO_BUCKET, 'edaimi-uploads');

    this.client = new Minio.Client({
      endPoint: endpoint,
      port: port,
      useSSL: useSSL,
      accessKey: accessKey,
      secretKey: secretKey,
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        this.logger.log(`Bucket '${this.bucketName}' belum ada, membuat bucket baru...`);
        await this.client.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`✅ Bucket '${this.bucketName}' berhasil dibuat di MinIO.`);
      } else {
        this.logger.log(`✅ Terhubung ke MinIO. Bucket '${this.bucketName}' siap digunakan.`);
      }

      // Jalankan pembersihan berkas temp lama saat aplikasi start
      this.cleanupOldTempFiles(24).catch(() => {});
    } catch (error: any) {
      this.logger.warn(`⚠️ Gagal inisialisasi bucket MinIO '${this.bucketName}': ${error?.message || error?.code || error}`);
    }
  }

  /**
   * Cron Job Otomatis: Dijalankan setiap tengah malam (00:00)
   * Menghapus semua file di folder 'temp/' yang berumur lebih dari 24 jam (file pendaftaran yang ditinggalkan).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldTempFiles(maxAgeHours: number = 24): Promise<{ deletedMinio: number; deletedLocal: number }> {
    return new Promise((resolve) => {
      let deletedMinio = 0;
      let deletedLocal = 0;
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

      try {
        const stream = this.client.listObjectsV2(this.bucketName, 'temp/', true);
        const deletePromises: Promise<any>[] = [];

        stream.on('data', (obj) => {
          if (obj && obj.name && obj.lastModified) {
            const fileAge = now - new Date(obj.lastModified).getTime();
            if (fileAge > maxAgeMs) {
              deletePromises.push(
                this.client.removeObject(this.bucketName, obj.name).then(() => {
                  deletedMinio++;
                }).catch(() => {})
              );
            }
          }
        });

        stream.on('end', async () => {
          await Promise.allSettled(deletePromises);

          // Bersihkan juga sisa berkas di folder lokal uploads/temp jika ada
          const localTempDir = path.join(process.cwd(), 'uploads/temp');
          if (fs.existsSync(localTempDir)) {
            try {
              const files = fs.readdirSync(localTempDir);
              for (const file of files) {
                const filePath = path.join(localTempDir, file);
                try {
                  const stat = fs.statSync(filePath);
                  if (stat.isFile() && (now - stat.mtimeMs > maxAgeMs)) {
                    fs.unlinkSync(filePath);
                    deletedLocal++;
                  }
                } catch {}
              }
            } catch {}
          }

          if (deletedMinio > 0 || deletedLocal > 0) {
            this.logger.log(`🧹 Auto-cleanup: Berhasil menghapus ${deletedMinio} file temp MinIO dan ${deletedLocal} file temp lokal (> ${maxAgeHours} jam).`);
          }
          resolve({ deletedMinio, deletedLocal });
        });

        stream.on('error', (err) => {
          this.logger.warn(`⚠️ Error saat list temp objects di MinIO: ${err?.message || err}`);
          resolve({ deletedMinio, deletedLocal });
        });
      } catch (err: any) {
        this.logger.warn(`⚠️ Gagal menjalankan auto-cleanup temp: ${err?.message || err}`);
        resolve({ deletedMinio, deletedLocal });
      }
    });
  }



  /**
   * Menormalisasi key object agar bersih dari prefix '/uploads/' atau '/' di awal
   */
  sanitizeKey(key: string): string {
    if (!key) return '';
    let cleaned = key.trim().replace(/\\/g, '/');
    if (cleaned.startsWith('/')) cleaned = cleaned.slice(1);
    if (cleaned.startsWith('uploads/')) cleaned = cleaned.slice(8);
    if (cleaned.startsWith('pengaturan/uploads/')) cleaned = cleaned.slice(19);
    if (cleaned.startsWith('kegiatan/uploads/')) cleaned = `kegiatan/${cleaned.slice(17)}`;
    if (cleaned.startsWith('formal/muadalah/uploads/')) cleaned = `muadalah/${cleaned.slice(24)}`;
    return cleaned;
  }

  getClient(): Minio.Client {
    return this.client;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * Upload buffer file ke MinIO
   */
  async uploadBuffer(
    objectKey: string,
    buffer: Buffer,
    mimetype?: string,
    metaData?: Record<string, string>
  ): Promise<{ bucket: string; key: string; url: string }> {
    const key = this.sanitizeKey(objectKey);
    const meta: Record<string, any> = {
      'Content-Type': mimetype || this.getMimeType(key),
      ...(metaData || {}),
    };

    await this.client.putObject(this.bucketName, key, buffer, buffer.length, meta);
    return {
      bucket: this.bucketName,
      key: key,
      url: `/uploads/${key}`,
    };
  }

  /**
   * Upload file dari filesystem lokal ke MinIO
   */
  async uploadFileFromPath(
    objectKey: string,
    localFilePath: string,
    mimetype?: string
  ): Promise<{ bucket: string; key: string; url: string }> {
    const key = this.sanitizeKey(objectKey);
    const meta = {
      'Content-Type': mimetype || this.getMimeType(key),
    };

    await this.client.fPutObject(this.bucketName, key, localFilePath, meta);
    return {
      bucket: this.bucketName,
      key: key,
      url: `/uploads/${key}`,
    };
  }

  /**
   * Mengambil Stream Object dari MinIO untuk streaming response
   */
  async getObjectStream(objectKey: string): Promise<Readable> {
    const key = this.sanitizeKey(objectKey);
    return await this.client.getObject(this.bucketName, key);
  }

  /**
   * Mengambil Buffer Object dari MinIO
   */
  async getObjectBuffer(objectKey: string): Promise<Buffer | null> {
    try {
      const stream = await this.getObjectStream(objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      return null;
    }
  }

  /**
   * Mendapatkan metadata/info objek (stat)
   */
  async statObject(objectKey: string): Promise<Minio.BucketItemStat | null> {
    try {
      const key = this.sanitizeKey(objectKey);
      return await this.client.statObject(this.bucketName, key);
    } catch (err: any) {
      if (err.code === 'NotFound' || err.message?.includes('Not Found') || err.message?.includes('does not exist')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Menghapus objek dari MinIO
   */
  async deleteObject(objectKey: string): Promise<void> {
    try {
      const key = this.sanitizeKey(objectKey);
      await this.client.removeObject(this.bucketName, key);
    } catch (err: any) {
      this.logger.warn(`Gagal menghapus objek MinIO '${objectKey}': ${err.message}`);
    }
  }

  /**
   * Menyalin objek di dalam MinIO
   */
  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    const src = this.sanitizeKey(sourceKey);
    const dst = this.sanitizeKey(destKey);
    const sourceObj = `/${this.bucketName}/${src}`;
    const conds = new Minio.CopyConditions();
    await this.client.copyObject(this.bucketName, dst, sourceObj, conds);
  }

  /**
   * Memindahkan objek di dalam MinIO (Copy + Delete source)
   */
  async moveObject(sourceKey: string, destKey: string): Promise<void> {
    await this.copyObject(sourceKey, destKey);
    await this.deleteObject(sourceKey);
  }

  /**
   * Generate presigned download URL (opsional jika dibutuhkan download langsung)
   */
  async getPresignedUrl(objectKey: string, expirySeconds: number = 3600): Promise<string> {
    const key = this.sanitizeKey(objectKey);
    return await this.client.presignedGetObject(this.bucketName, key, expirySeconds);
  }

  /**
   * Helper penentuan MIME Type berdasarkan ekstensi file
   */
  getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }
}
