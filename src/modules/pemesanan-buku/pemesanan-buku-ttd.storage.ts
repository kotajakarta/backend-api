import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { MinioService } from '../../common/minio/minio.service.js';

/**
 * Penyimpanan scan TTD wilayah: MinIO dengan fallback disk lokal `uploads/<key>`
 * (pola yang sama dengan indisipliner.service.ts). Key selalu dibuat oleh server.
 */
@Injectable()
export class PemesananBukuTtdStorage {
  private readonly logger = new Logger(PemesananBukuTtdStorage.name);

  constructor(@Inject(MinioService) private readonly minio: MinioService) {}

  private lokal(key: string): string {
    return path.resolve(process.cwd(), 'uploads', key);
  }

  async simpan(key: string, buffer: Buffer, mime: string): Promise<void> {
    try {
      await this.minio.uploadBuffer(key, buffer, mime);
    } catch (err: any) {
      this.logger.warn(`Upload MinIO gagal, simpan ke disk lokal: ${err?.message || err}`);
      const file = this.lokal(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
    }
  }

  async ambil(key: string): Promise<Buffer | null> {
    const dariMinio = await this.minio.getObjectBuffer(key);
    if (dariMinio) return dariMinio;
    const file = this.lokal(key);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }

  /** Tidak pernah melempar: dipanggil setelah perubahan DB tersimpan, berkas yatim lebih baik daripada 500. */
  async hapus(key: string): Promise<void> {
    try {
      await this.minio.deleteObject(key);
      const file = this.lokal(key);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err: any) {
      this.logger.warn(`Gagal menghapus berkas scan '${key}': ${err?.message || err}`);
    }
  }
}
