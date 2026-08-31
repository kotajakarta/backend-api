import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCctvEnabled, assertCctvEnabled } from './module-guard.js';

describe('module-guard — isCctvEnabled & assertCctvEnabled', () => {
  const originalEnv = { ...process.env };

  const restoreEnv = () => {
    delete process.env.CCTV;
    delete (process.env as any).cctv;
    delete process.env.ENABLE_CCTV;
    delete process.env.CCTV_ENABLED;
  };

  it('defaults to true when no env var is set', () => {
    restoreEnv();
    assert.equal(isCctvEnabled(), true);
    assert.doesNotThrow(() => assertCctvEnabled());
  });

  it('returns true when CCTV="true" or CCTV="1"', () => {
    restoreEnv();
    process.env.CCTV = 'true';
    assert.equal(isCctvEnabled(), true);

    process.env.CCTV = '1';
    assert.equal(isCctvEnabled(), true);
  });

  it('returns false when CCTV="false", "0", "off", "no"', () => {
    restoreEnv();
    process.env.CCTV = 'false';
    assert.equal(isCctvEnabled(), false);
    assert.throws(() => assertCctvEnabled(), /Fitur CCTV sedang dinonaktifkan/);

    process.env.CCTV = '0';
    assert.equal(isCctvEnabled(), false);

    process.env.CCTV = 'off';
    assert.equal(isCctvEnabled(), false);

    process.env.CCTV = 'no';
    assert.equal(isCctvEnabled(), false);
  });

  it('supports lowercase cctv, ENABLE_CCTV, and CCTV_ENABLED aliases', () => {
    restoreEnv();
    (process.env as any).cctv = 'false';
    assert.equal(isCctvEnabled(), false);

    restoreEnv();
    process.env.ENABLE_CCTV = 'false';
    assert.equal(isCctvEnabled(), false);

    restoreEnv();
    process.env.CCTV_ENABLED = 'false';
    assert.equal(isCctvEnabled(), false);

    restoreEnv();
    process.env.CCTV = originalEnv.CCTV;
  });
});
