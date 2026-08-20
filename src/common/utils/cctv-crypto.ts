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

const TOKEN_TTL_MS = 90_000; // ephemeral proxy tokens (playlist/segment URLs handed to the browser) expire 90s after issuance; the HLS proxy mints a fresh token every time it rewrites a playlist, so this does not interrupt continuous playback — only a leaked/idle token stops working after 90s. Never use this for values that must survive longer, e.g. database storage — see encryptStoredStreamUrl below.

function aesGcmEncrypt(payload: string): string {
  const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(payload, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `cctv_enc_${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// Returns the decrypted payload string, or null if the input isn't valid GCM-format ciphertext
// (wrong shape, or the auth tag doesn't match — tampered/corrupted).
function aesGcmDecrypt(str: string): string | null {
  const rawCipher = str.replace('cctv_enc_', '');
  const parts = rawCipher.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivHex, tagHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

// Legacy AES-256-CBC format (2-part, no auth tag, no embedded expiry) — the scheme every
// pre-existing CctvChannel.streamUrl row was encrypted under before this change. Needed so
// decryptStoredStreamUrl can keep reading rows written before this migration.
function legacyCbcDecrypt(str: string): string | null {
  const rawCipher = str.replace('cctv_enc_', '');
  const colonIdx = rawCipher.indexOf(':');
  if (colonIdx === -1) return null;
  try {
    const ivHex = rawCipher.substring(0, colonIdx);
    const encryptedText = rawCipher.substring(colonIdx + 1);
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Ephemeral, short-lived stream tokens handed to the browser (HLS playlist/segment proxy URLs).
 * Embeds a 90s expiry. Use only for values that are consumed within seconds of being issued —
 * for anything persisted (e.g. the database), use encryptStoredStreamUrl/decryptStoredStreamUrl below.
 */
export function encryptStreamUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('cctv_enc_')) return url;
  try {
    const payload = JSON.stringify({ u: url, exp: Date.now() + TOKEN_TTL_MS });
    return aesGcmEncrypt(payload);
  } catch (err) {
    console.error('Error encrypting stream URL:', err);
    return '';
  }
}

export function decryptStreamUrl(encryptedUrl: string): string {
  if (!encryptedUrl) return '';
  let str = decodeURIComponent(encryptedUrl).trim();

  let attempts = 0;
  while (str.startsWith('cctv_enc_') && attempts < 5) {
    attempts++;
    const decrypted = aesGcmDecrypt(str);
    if (decrypted === null) break;
    try {
      const parsed = JSON.parse(decrypted);
      if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
        return '';
      }
      str = String(parsed.u).trim();
    } catch {
      break;
    }
  }

  return str.startsWith('cctv_enc_') ? '' : str;
}

/**
 * Non-expiring encryption for values persisted at rest — currently only CctvChannel.streamUrl.
 * decryptStoredStreamUrl also accepts the legacy AES-256-CBC format so rows written before this
 * change keep working without a data migration.
 */
export function encryptStoredStreamUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('cctv_enc_')) return url;
  try {
    const payload = JSON.stringify({ u: url });
    return aesGcmEncrypt(payload);
  } catch (err) {
    console.error('Error encrypting stored stream URL:', err);
    return '';
  }
}

export function decryptStoredStreamUrl(encryptedUrl: string): string {
  if (!encryptedUrl) return '';
  let str = decodeURIComponent(encryptedUrl).trim();

  let attempts = 0;
  while (str.startsWith('cctv_enc_') && attempts < 5) {
    attempts++;
    const gcmDecrypted = aesGcmDecrypt(str);
    if (gcmDecrypted !== null) {
      try {
        const parsed = JSON.parse(gcmDecrypted);
        str = String(parsed.u).trim();
        continue;
      } catch {
        break;
      }
    }
    const cbcDecrypted = legacyCbcDecrypt(str);
    if (cbcDecrypted === null) break;
    str = cbcDecrypted.trim();
  }

  return str.startsWith('cctv_enc_') ? '' : str;
}

