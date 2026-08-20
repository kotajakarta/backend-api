import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-cctv-crypto-spec';

const { encryptStreamUrl, decryptStreamUrl, encryptStoredStreamUrl, decryptStoredStreamUrl } = await import('./cctv-crypto.js');

const SAMPLE_URL = 'https://example.com/stream.m3u8';

describe('cctv-crypto — ephemeral proxy tokens (encryptStreamUrl/decryptStreamUrl)', () => {
  it('round-trips', () => {
    const token = encryptStreamUrl(SAMPLE_URL);
    assert.equal(decryptStreamUrl(token), SAMPLE_URL);
  });

  it('expires after the TTL window', () => {
    const realNow = Date.now;
    try {
      const token = encryptStreamUrl(SAMPLE_URL);
      Date.now = () => realNow() + 200_000;
      assert.equal(decryptStreamUrl(token), '');
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects a tampered ciphertext', () => {
    const token = encryptStreamUrl(SAMPLE_URL);
    const parts = token.replace('cctv_enc_', '').split(':');
    const tamperedHex = (parseInt(parts[2][0], 16) ^ 0xf).toString(16) + parts[2].slice(1);
    const tampered = `cctv_enc_${parts[0]}:${parts[1]}:${tamperedHex}`;
    assert.equal(decryptStreamUrl(tampered), '');
  });
});

describe('cctv-crypto — at-rest storage (encryptStoredStreamUrl/decryptStoredStreamUrl)', () => {
  it('round-trips', () => {
    const stored = encryptStoredStreamUrl(SAMPLE_URL);
    assert.equal(decryptStoredStreamUrl(stored), SAMPLE_URL);
  });

  it('does NOT expire — this is the regression test for the final-review Critical finding: a value encrypted for storage must still decrypt correctly long after the ephemeral 90s TTL window', () => {
    const realNow = Date.now;
    try {
      const stored = encryptStoredStreamUrl(SAMPLE_URL);
      Date.now = () => realNow() + 10 * 24 * 60 * 60 * 1000; // +10 days
      assert.equal(decryptStoredStreamUrl(stored), SAMPLE_URL);
    } finally {
      Date.now = realNow;
    }
  });

  it('reads a legacy AES-256-CBC-encrypted value (pre-existing database rows)', async () => {
    const crypto = await import('node:crypto');
    const SECRET_KEY = process.env.CCTV_SECRET_KEY || crypto.createHmac('sha256', process.env.JWT_SECRET as string).update('cctv-stream-cipher-key').digest('hex');
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(SAMPLE_URL, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const legacyToken = `cctv_enc_${iv.toString('hex')}:${encrypted}`;

    assert.equal(decryptStoredStreamUrl(legacyToken), SAMPLE_URL);
  });

  it('rejects a tampered stored ciphertext', () => {
    const stored = encryptStoredStreamUrl(SAMPLE_URL);
    const parts = stored.replace('cctv_enc_', '').split(':');
    const tamperedHex = (parseInt(parts[2][0], 16) ^ 0xf).toString(16) + parts[2].slice(1);
    const tampered = `cctv_enc_${parts[0]}:${parts[1]}:${tamperedHex}`;
    assert.equal(decryptStoredStreamUrl(tampered), '');
  });
});
