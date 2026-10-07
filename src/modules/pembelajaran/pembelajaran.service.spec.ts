/**
 * Unit tests for PembelajaranService.
 *
 * Run with:
 *   npx tsx --test src/modules/pembelajaran/pembelajaran.service.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PembelajaranService } from './pembelajaran.service.js';

function makeRekapServiceSpy() {
  const requested: string[] = [];
  const synced: string[] = [];
  return {
    requested,
    synced,
    service: {
      requestSync: (ta: string, sem: string, mode: string, key?: string) => {
        requested.push([ta, sem, mode, key ?? ''].join('|'));
      },
      syncPeriod: async (ta: string, sem: string, mode: string, key?: string) => {
        synced.push([ta, sem, mode, key ?? ''].join('|'));
      },
    },
  };
}

describe('PembelajaranService.triggerRekapSync', () => {
  it('queues coalesced syncs for each touched month and the semester instead of recomputing directly', async () => {
    const prisma: any = {
      pengaturanAkademik: { findFirst: async () => ({ tahunAjaran: '2026/2027', semesterAktif: 'Ganjil' }) },
    };
    const spy = makeRekapServiceSpy();
    const svc = new PembelajaranService(prisma, spy.service as any);

    (svc as any).triggerRekapSync(['2026-09-26', '2026-09-19', '2026-08-29', '']);
    await new Promise(r => setTimeout(r, 20));

    assert.deepEqual(spy.synced, [], 'must not call syncPeriod directly');
    assert.deepEqual(spy.requested.sort(), [
      '2026/2027|Ganjil|monthly|2026-08',
      '2026/2027|Ganjil|monthly|2026-09',
      '2026/2027|Ganjil|semester|',
    ]);
  });
});
