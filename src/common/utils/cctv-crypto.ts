import * as crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;
const SECRET_KEY = process.env.CCTV_SECRET_KEY || (JWT_SECRET ? crypto.createHmac('sha256', JWT_SECRET).update('cctv-stream-cipher-key').digest('hex') : '');

if (!SECRET_KEY) {
  throw new Error('FATAL: Neither CCTV_SECRET_KEY nor JWT_SECRET environment variable is set. Refusing to start.');
}

/**
 * SSRF Protection Validator.
 * Rejects URLs that target loopback, private networks, link-local,
 * cloud metadata endpoints, or invalid protocols.
 */
export function isSafeStreamUrl(targetUrl: string): boolean {
  if (!targetUrl || typeof targetUrl !== 'string') return false;

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost / loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return false;
    }

    // Block Cloud metadata services (AWS, GCP, Azure, OpenStack, etc.)
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname.endsWith('.internal')) {
      return false;
    }

    // Block private IPv4 ranges (RFC 1918 & Carrier Grade NAT)
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
      const o1 = Number(ipMatch[1]);
      const o2 = Number(ipMatch[2]);
      if (o1 === 10) return false;
      if (o1 === 127) return false;
      if (o1 === 169 && o2 === 254) return false;
      if (o1 === 192 && o2 === 168) return false;
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
      if (o1 === 0 || o1 >= 224) return false; // Reserved / Multicast
    }

    // Check optional whitelist from environment if configured
    const allowedHosts = process.env.ALLOWED_CCTV_HOSTS?.split(',').map(h => h.trim().toLowerCase()) || [];
    if (allowedHosts.length > 0 && !allowedHosts.includes('*')) {
      return allowedHosts.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`));
    }

    return true;
  } catch {
    return false;
  }
}

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
    return '';
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

