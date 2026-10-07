/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-ttd.storage.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PemesananBukuTtdStorage } from './pemesanan-buku-ttd.storage.js';

describe('PemesananBukuTtdStorage', () => {
  it('hapus tidak melempar error setelah perubahan DB tersimpan', async () => {
    const minio: any = { deleteObject: async () => { throw new Error('MinIO mati'); } };
    const storage = new PemesananBukuTtdStorage(minio);
    await storage.hapus('pemesanan-buku/ttd/tidak-ada.png');
  });
});
