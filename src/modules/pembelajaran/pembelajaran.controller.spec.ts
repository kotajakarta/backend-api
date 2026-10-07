/**
 * Unit tests for PembelajaranController query parsing.
 *
 * Run with:
 *   JWT_SECRET=x npx tsx --test src/modules/pembelajaran/pembelajaran.controller.spec.ts
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { PembelajaranController } = await import('./pembelajaran.controller.js');

function makeController() {
  const calls: any[] = [];
  const service: any = {
    getRingkasan: async (...args: any[]) => (calls.push(['getRingkasan', ...args]), {}),
    getRingkasanWeekDetails: async (...args: any[]) => (calls.push(['getRingkasanWeekDetails', ...args]), { details: [] }),
  };
  return { controller: new PembelajaranController(service), calls };
}

describe('PembelajaranController ringkasan', () => {
  it('passes withDetails=false through only when the client asks for it', async () => {
    const { controller, calls } = makeController();
    const req = { user: { scope: 'GLOBAL' } };
    await (controller as any).getRingkasan('semester', undefined, undefined, '2026/2027', 'GANJIL', undefined, undefined, undefined, 'false', req);
    await (controller as any).getRingkasan('monthly', undefined, '2026-09', undefined, undefined, undefined, undefined, undefined, undefined, req);
    assert.equal(calls[0][2].withDetails, false);
    assert.equal(calls[1][2].withDetails, undefined, 'old clients keep getting details');
  });

  it('ringkasan/detail parses unitIds and weekNumber', async () => {
    const { controller, calls } = makeController();
    const req = { user: { scope: 'GLOBAL' } };
    await (controller as any).getRingkasanDetail('semester', undefined, undefined, '2026/2027', 'GANJIL', undefined, undefined, undefined, 'w1,w2', '3', req);
    const [, user, query, unitIds, weekNumber] = calls[0];
    assert.deepEqual(user, req.user);
    assert.equal(query.mode, 'semester');
    assert.equal(query.semester, 'GANJIL');
    assert.deepEqual(unitIds, ['w1', 'w2']);
    assert.equal(weekNumber, 3);
  });
});
