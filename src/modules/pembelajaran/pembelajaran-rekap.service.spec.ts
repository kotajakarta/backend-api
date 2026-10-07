/**
 * Unit tests for PembelajaranRekapService.
 *
 * Same test-infra approach as src/modules/portal/portal.service.spec.ts:
 * Node's built-in test runner (`node:test`) executed through `tsx`, no live
 * database — PrismaService is the hand-mocked object from
 * pembelajaran-rekap.fixture.ts.
 *
 * Run with:
 *   TZ=UTC npx tsx --test src/modules/pembelajaran/pembelajaran-rekap.service.spec.ts
 *
 * The golden file pins the exact rows syncPeriod() writes so performance
 * refactors can prove they didn't change the rekap. Regenerate it only for an
 * intentional output change: UPDATE_GOLDEN=1 TZ=UTC npx tsx --test <this file>
 */
process.env.TZ = 'UTC';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PembelajaranRekapService, expandWeeksJson, normalizeSemester } from './pembelajaran-rekap.service.js';
import { makeRekapPrisma, makeLargeDataset } from './pembelajaran-rekap.fixture.js';

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '__golden__', 'pembelajaran-rekap.sync.json');

async function runAllModes() {
  const { prisma, upserts, findManyArgs } = makeRekapPrisma();
  const service = new PembelajaranRekapService(prisma);
  await service.syncPeriod('2025/2026', 'Ganjil', 'monthly', '2025-08');
  await service.syncPeriod('2025/2026', 'Ganjil', 'weekly', '2025-08-10');
  await service.syncPeriod('2025/2026', 'Ganjil', 'semester');
  const rows = upserts.map(u => u.create);
  return { rows, findManyArgs };
}

describe('PembelajaranRekapService.syncPeriod', () => {
  it('writes exactly the golden rekap rows for monthly, weekly and semester periods', async () => {
    const { rows } = await runAllModes();
    // The golden file holds the expanded form (week.details inline), which is
    // what readers get after expandWeeksJson().
    const expanded = rows.map(r => ({ ...r, weeksJson: expandWeeksJson(r.weeksJson) }));
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(expanded, null, 2) + '\n');
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    assert.deepEqual(expanded, golden);
  });

  it('stores each detail once (weeks reference them by date range instead of copying them)', async () => {
    const { rows } = await runAllModes();
    for (const r of rows) {
      assert.ok(Array.isArray(r.weeksJson.details));
      for (const w of r.weeksJson.weeks) {
        assert.equal(w.details, undefined, `${r.unitLevel} ${r.periodeKey} week ${w.weekNumber} still stores a details copy`);
      }
    }
  });

  it('loads only the columns it aggregates (absensi rows are ~190k per semester in production)', async () => {
    const { findManyArgs } = await runAllModes();
    for (const args of findManyArgs.absensiMapel) {
      assert.equal(args.include, undefined, 'absensiMapel must not include relations per row');
      assert.deepEqual(Object.keys(args.select).sort(), ['kelasId', 'mataPelajaranId', 'status', 'tanggal']);
    }
    for (const args of findManyArgs.pelaksanaanSilabus) {
      assert.equal(args.include, undefined, 'pelaksanaanSilabus must use select, not include');
      assert.ok(args.select, 'pelaksanaanSilabus must use select');
    }
    for (const args of findManyArgs.kelas) {
      assert.equal(args.include, undefined, 'kelas must not load siswaFormal rows just to count them');
      assert.ok(args.select?._count?.select?.siswaFormal, 'kelas must count siswaFormal via _count');
    }
  });

  it('shares one computation between concurrent calls for the same period', async () => {
    const { prisma, findManyArgs } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma);
    await Promise.all([
      service.syncPeriod('2025/2026', 'Ganjil', 'semester'),
      service.syncPeriod('2025/2026', 'Ganjil', 'semester'),
      service.syncPeriod('2025/2026', 'Ganjil', 'semester'),
    ]);
    assert.equal(findManyArgs.absensiMapel.length, 1);
  });
});

describe('PembelajaranRekapService.requestSync', () => {
  const syncOptions = { debounceMs: 20, maxWaitMs: 500, retryMs: 10, lockTtlMs: 5000 };

  it('collapses a burst of save-triggered requests into one sync per period', async () => {
    const { prisma } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma, undefined, syncOptions);
    const calls: string[] = [];
    service.syncPeriod = (async (ta: string, sem: string, mode: string, key?: string) => {
      calls.push([ta, sem, mode, key ?? ''].join('|'));
      return { count: 0, periodeKey: key ?? '' };
    }) as any;

    for (let i = 0; i < 25; i++) {
      service.requestSync('2025/2026', 'Ganjil', 'monthly', '2025-08');
      service.requestSync('2025/2026', 'Ganjil', 'semester');
    }
    assert.equal(calls.length, 0, 'must not recompute synchronously on save');
    await new Promise(r => setTimeout(r, 150));
    assert.deepEqual(calls.sort(), ['2025/2026|Ganjil|monthly|2025-08', '2025/2026|Ganjil|semester|']);
  });
});

describe('PembelajaranRekapService.syncPeriod performance', () => {
  it('computes a production-sized semester without blocking the event loop for long', async () => {
    // ~60 cabang / 180 kelas / ~80k absensi rows — the shape that used to hang workers.
    const data = makeLargeDataset({ wilayah: 6, cabangPerWilayah: 10, kelasPerCabang: 3, siswaPerKelas: 10 });
    const { prisma } = makeRekapPrisma(data, { recordUpserts: false });
    const service = new PembelajaranRekapService(prisma);
    const started = Date.now();
    await service.syncPeriod('2025/2026', 'Ganjil', 'semester');
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `semester sync took ${elapsed}ms for ${data.absensi.length} absensi rows`);
  });
});

describe('PembelajaranRekapService.getRingkasanFromRekap', () => {
  const golden = () => JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const query = { mode: 'semester' as const, tahunAjaran: '2025/2026', semester: 'Ganjil' };

  it('serves the same per-week details from compact rows as before', async () => {
    const { prisma } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma);
    await service.syncPeriod('2025/2026', 'Ganjil', 'semester');

    const res = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, query);
    // Ringkasan only lists active wilayah (drops the 'unknown' bucket for kelas without cabang).
    const expected = golden().filter((r: any) => r.periodeTipe === 'SEMESTER' && r.unitLevel === 'WILAYAH' && r.unitId !== 'unknown');
    assert.equal(res.unitBreakdown.length, expected.length);
    for (const u of res.unitBreakdown) {
      const g = expected.find((r: any) => r.unitId === u.id);
      assert.deepEqual(u.weeks, g.weeksJson.weeks);
      assert.deepEqual(u.details, g.weeksJson.details);
    }
  });

  it('still reads rows written in the old format (details copied into each week)', async () => {
    const { prisma, upserts } = makeRekapPrisma();
    const legacyRows = golden().filter((r: any) => r.periodeTipe === 'SEMESTER');
    for (const row of legacyRows) upserts.push({ create: row });
    const service = new PembelajaranRekapService(prisma);

    const res = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, query);
    const expected = legacyRows.filter((r: any) => r.unitLevel === 'WILAYAH' && r.unitId !== 'unknown');
    assert.equal(res.unitBreakdown.length, expected.length);
    for (const u of res.unitBreakdown) {
      assert.deepEqual(u.weeks, expected.find((r: any) => r.unitId === u.id).weeksJson.weeks);
    }
  });
});

describe('semester spelling', () => {
  it('normalizes the accepted spellings to the pengaturan form', () => {
    for (const s of ['GANJIL', 'ganjil', 'Ganjil', ' Ganjil ', '1']) assert.equal(normalizeSemester(s), 'Ganjil', s);
    for (const s of ['GENAP', 'genap', 'Genap', '2']) assert.equal(normalizeSemester(s), 'Genap', s);
    assert.equal(normalizeSemester(''), '');
  });

  it('writes rekap rows under the canonical semester whatever spelling the caller used', async () => {
    const { prisma, upserts } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma);
    await service.syncPeriod('2025/2026', 'GANJIL', 'semester');
    assert.ok(upserts.length > 0);
    assert.deepEqual([...new Set(upserts.map(u => u.create.semester))], ['Ganjil']);
    assert.deepEqual([...new Set(upserts.map(u => u.where.tahunAjaran_semester_periodeTipe_periodeKey_unitLevel_unitId_mataPelajaranId.semester))], ['Ganjil']);
  });

  it('serves Ringkasan requested as GANJIL from the rows kept fresh under Ganjil (no stale duplicate set)', async () => {
    const { prisma, upserts } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma);
    await service.syncPeriod('2025/2026', 'Ganjil', 'semester');
    const written = upserts.length;

    const res = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, { mode: 'semester', tahunAjaran: '2025/2026', semester: 'GANJIL' as any });
    assert.equal(upserts.length, written, 'must not compute a second, separately-keyed rekap');
    assert.equal(res.semester, 'Ganjil');
    assert.ok(res.unitBreakdown.length > 0);
  });
});

describe('Ringkasan without inline details (details are fetched per week on demand)', () => {
  const query = { mode: 'semester' as const, tahunAjaran: '2025/2026', semester: 'Ganjil' };
  const stripDetails = (u: any) => {
    const { details, ...rest } = u;
    return { ...rest, weeks: rest.weeks.map(({ details: _d, ...w }: any) => w) };
  };

  async function setup() {
    const { prisma } = makeRekapPrisma();
    const service = new PembelajaranRekapService(prisma);
    await service.syncPeriod('2025/2026', 'Ganjil', 'semester');
    return service;
  }

  it('withDetails=false returns the same numbers but no detail rows', async () => {
    const service = await setup();
    const full = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, query);
    const slim = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, { ...query, withDetails: false });
    for (const u of slim.unitBreakdown) {
      assert.equal((u as any).details, undefined);
      for (const w of u.weeks) assert.equal(w.details, undefined);
    }
    assert.deepEqual(slim.unitBreakdown, full.unitBreakdown.map(stripDetails));
    assert.deepEqual({ ...slim, unitBreakdown: [] }, { ...full, unitBreakdown: [] });
  });

  it('getRingkasanWeekDetails returns exactly the week details the full response carried', async () => {
    const service = await setup();
    const full = await service.getRingkasanFromRekap({ scope: 'GLOBAL' }, query);
    const weekNumber = full.unitBreakdown[0].weeks.findIndex((w: any) => w.details.length > 0) + 1;
    assert.ok(weekNumber > 0, 'fixture must have a week with details');
    const ids = full.unitBreakdown.map((u: any) => u.id);
    const expected = full.unitBreakdown.flatMap((u: any) => u.weeks[weekNumber - 1].details);

    const res = await service.getRingkasanWeekDetails({ scope: 'GLOBAL' }, query, ids, weekNumber);
    assert.deepEqual(res.details, expected);

    const one = await service.getRingkasanWeekDetails({ scope: 'GLOBAL' }, query, [ids[0]], weekNumber);
    assert.deepEqual(one.details, full.unitBreakdown[0].weeks[weekNumber - 1].details);
  });

  it('getRingkasanWeekDetails never returns units outside the caller scope', async () => {
    const service = await setup();
    // A WILAYAH user of w1 asking for a cabang that belongs to w2.
    const res = await service.getRingkasanWeekDetails({ scope: 'WILAYAH', wilayahId: 'w1' }, query, ['c3'], 1);
    assert.deepEqual(res.details, []);
  });
});
