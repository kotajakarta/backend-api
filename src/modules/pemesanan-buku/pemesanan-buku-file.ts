import * as path from 'path';

export type JenisBerkas = 'pdf' | 'png' | 'jpg';

export const MAX_TTD_BYTES = 10 * 1024 * 1024;
export const MIME_BERKAS: Record<JenisBerkas, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };
export const EXT_BERKAS: Record<JenisBerkas, string> = { pdf: '.pdf', png: '.png', jpg: '.jpg' };

const EKSTENSI: Record<string, JenisBerkas> = { '.pdf': 'pdf', '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg' };
const MAGIC: Record<JenisBerkas, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
};

/** Jenis berkas hanya diterima bila ekstensi DAN isi (magic bytes) cocok. */
export function deteksiJenisBerkas(buf: Buffer, originalName: string): JenisBerkas | null {
  const jenis = EKSTENSI[path.extname(originalName || '').toLowerCase()];
  if (!jenis) return null;
  const magic = MAGIC[jenis];
  const cocok = buf.length >= magic.length && magic.every((b, i) => buf[i] === b);
  return cocok ? jenis : null;
}

// multer 1.x membaca nama berkas sebagai latin1; kembalikan ke UTF-8 bila valid.
export function decodeNamaBerkas(originalName: string): string {
  const decoded = Buffer.from(originalName || '', 'latin1').toString('utf8');
  return decoded.includes('�') ? originalName : decoded;
}
