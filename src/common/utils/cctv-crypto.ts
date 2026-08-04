import * as crypto from 'crypto';

const SECRET_KEY = process.env.CCTV_SECRET_KEY || 'esantri-cctv-secure-cipher-2026-key!';

export function encryptStreamUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('cctv_enc_')) return url; // Already encrypted

  try {
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(url, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `cctv_enc_${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('Error encrypting stream URL:', err);
    return url;
  }
}

export function decryptStreamUrl(encryptedUrl: string): string {
  if (!encryptedUrl) return '';
  let str = decodeURIComponent(encryptedUrl).trim();

  // Unwrap up to 5 times if double-encrypted or nested
  let attempts = 0;
  while (str.startsWith('cctv_enc_') && attempts < 5) {
    attempts++;
    try {
      const rawCipher = str.replace('cctv_enc_', '');
      const colonIdx = rawCipher.indexOf(':');
      if (colonIdx === -1) break;

      const ivHex = rawCipher.substring(0, colonIdx);
      const encryptedText = rawCipher.substring(colonIdx + 1);

      const iv = Buffer.from(ivHex, 'hex');
      const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      str = decrypted.trim();
    } catch (err) {
      break;
    }
  }

  return str;
}
