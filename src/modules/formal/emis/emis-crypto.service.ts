import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

/**
 * Service untuk enkripsi ID siswa EMIS Kemenag di sisi backend.
 * Menggunakan algoritma AES-256-CBC dengan format output Double Base64,
 * sesuai dengan spesifikasi resmi yang dibutuhkan oleh endpoint:
 * GET https://api-emis.kemenag.go.id/v1/students/pontrens/students/{encryptedId}
 */
@Injectable()
export class EmisCryptoService {
  private readonly logger = new Logger(EmisCryptoService.name);
  private readonly cryptoKey: string;
  private readonly cryptoIv: string;

  constructor() {
    this.cryptoKey = process.env.EMIS_CRYPTO_KEY || 'a2c36eb2w1em50d6665dc5d61a68b400';
    this.cryptoIv = process.env.EMIS_CRYPTO_IV || 'emisBase64IVkeys';

    if (!process.env.EMIS_CRYPTO_KEY || !process.env.EMIS_CRYPTO_IV) {
      this.logger.warn('EMIS_CRYPTO_KEY atau EMIS_CRYPTO_IV belum diatur di .env. Menggunakan default fallback.');
    }
  }

  /**
   * Mengenkripsi satu ID siswa dengan AES-256-CBC dan double base64
   */
  encryptStudentId(studentId: string): string | null {
    if (!studentId || studentId.trim() === '') return null;

    try {
      const keyBuffer = Buffer.from(this.cryptoKey, 'utf8');
      const ivBuffer = Buffer.from(this.cryptoIv, 'utf8');

      const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, ivBuffer);
      let encrypted = cipher.update(studentId.trim(), 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      // Double base64 encoding (sesuai spesifikasi di vermis/encrypt.php)
      const firstBase64 = encrypted.toString('base64');
      const doubleBase64 = Buffer.from(firstBase64, 'utf8').toString('base64');

      return doubleBase64;
    } catch (err: any) {
      this.logger.error(`Gagal mengenkripsi ID santri ${studentId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Mengenkripsi batch array ID siswa menjadi Map/Record { [id]: encodedId }
   */
  encryptBatch(studentIds: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const id of studentIds) {
      if (!id) continue;
      const strId = String(id).trim();
      const enc = this.encryptStudentId(strId);
      if (enc) {
        map[strId] = enc;
      }
    }
    return map;
  }
}
