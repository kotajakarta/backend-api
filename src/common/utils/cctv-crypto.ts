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
  if (!encryptedUrl.startsWith('cctv_enc_')) return encryptedUrl;

  try {
    const parts = encryptedUrl.replace('cctv_enc_', '').split(':');
    if (parts.length !== 2) return encryptedUrl;
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Error decrypting stream URL:', err);
    return encryptedUrl;
  }
}
