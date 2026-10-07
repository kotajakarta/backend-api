/**
 * Unit tests for the one-off base64 -> MinIO migration.
 *
 * Run with:
 *   npx tsx --test src/common/media/base64-migration.spec.ts
 * The SQL adapter test additionally needs a disposable Postgres:
 *   PG_TEST_URL=postgres://postgres:test@localhost:15432/postgres npx tsx --test src/common/media/base64-migration.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIGRATION_TARGETS,
  MigrationDb,
  MigrationStorage,
  migrateBase64ToStorage,
  restoreFromJournal,
  backupBase64,
  JournalRecord,
  pgMigrationDb,
} from './base64-migration.js';

const bytes = (s: string) => Buffer.from(s);
const dataUrl = (s: string, mime = 'image/jpeg') => `data:${mime};base64,${bytes(s).toString('base64')}`;

function makeDb(rows: Record<string, Record<string, Record<string, string | null>>>) {
  // rows[table][id][column] = value
  const db: MigrationDb & { rows: typeof rows; beforeCas?: (table: string) => void } = {
    rows,
    listIdsWithBase64: async (table, column) =>
      Object.entries(rows[table] || {})
        .filter(([, r]) => typeof r[column] === 'string' && r[column]!.startsWith('data:'))
        .map(([id]) => id)
        .sort(),
    getValue: async (table, column, id) => rows[table]?.[id]?.[column] ?? null,
    compareAndSet: async (table, column, id, expected, next) => {
      db.beforeCas?.(table);
      const r = rows[table]?.[id];
      if (!r || r[column] !== expected) return false;
      r[column] = next;
      return true;
    },
  };
  return db;
}

function makeStorage(opts: { corruptSize?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const storage: MigrationStorage = {
    uploadBuffer: async (key, buffer) => (objects.set(key, buffer), { key, url: `/uploads/${key}` }),
    deleteObject: async key => { objects.delete(key); },
    statObject: async key => {
      const b = objects.get(key);
      return b ? { size: opts.corruptSize ? b.length + 1 : b.length } : null;
    },
  };
  return { storage, objects };
}

const quiet = { log: () => {} };

function fixture() {
  return makeDb({
    'core.staff': {
      s1: { ktp_url: dataUrl('ktp-1'), ijazah_url: null, ifadah_url: '/uploads/staff/s1/ifadah-url-x.jpg' },
      s2: { ktp_url: dataUrl('ktp-2', 'image/png'), ijazah_url: dataUrl('ijz-2'), ifadah_url: null },
    },
    'core.cabang': {
      c1: { foto_gedung: dataUrl('gedung'), foto_plang: null },
    },
  });
}

describe('MIGRATION_TARGETS', () => {
  it('covers exactly the 12 base64 columns found in production', () => {
    const cols = MIGRATION_TARGETS.flatMap(t => Object.keys(t.columns).map(c => `${t.table}.${c}`)).sort();
    assert.deepEqual(cols, [
      'core.cabang.foto_denah', 'core.cabang.foto_gedung', 'core.cabang.foto_halaman', 'core.cabang.foto_kamar_mandi',
      'core.cabang.foto_kelas', 'core.cabang.foto_mushala', 'core.cabang.foto_plang', 'core.cabang.foto_ruang_makan',
      'core.cabang.foto_ruang_tidur', 'core.staff.ifadah_url', 'core.staff.ijazah_url', 'core.staff.ktp_url',
    ]);
  });
});

describe('backupBase64', () => {
  it('emits every base64 value with its location and nothing else', async () => {
    const db = fixture();
    const out: any[] = [];
    await backupBase64(db, r => out.push(r));
    assert.equal(out.length, 4);
    assert.ok(out.every(r => r.value.startsWith('data:')));
    assert.deepEqual(out.find(r => r.id === 's2' && r.column === 'ijazah_url')?.table, 'core.staff');
  });
});

describe('migrateBase64ToStorage', () => {
  it('dry-run reports what would move and changes nothing', async () => {
    const db = fixture();
    const { storage, objects } = makeStorage();
    const before = JSON.stringify(db.rows);
    const report = await migrateBase64ToStorage(db, storage, { apply: false, journal: () => {}, ...quiet });
    assert.equal(report.candidates, 4);
    assert.equal(report.migrated, 0);
    assert.equal(objects.size, 0);
    assert.equal(JSON.stringify(db.rows), before);
  });

  it('apply uploads each value, stores its /uploads path and journals the original', async () => {
    const db = fixture();
    const { storage, objects } = makeStorage();
    const journal: JournalRecord[] = [];
    const report = await migrateBase64ToStorage(db, storage, { apply: true, journal: r => journal.push(r), ...quiet });

    assert.equal(report.migrated, 4);
    assert.equal(report.failed, 0);
    const s2ktp = db.rows['core.staff'].s2.ktp_url!;
    assert.match(s2ktp, /^\/uploads\/staff\/s2\/ktp-url-[0-9a-f-]{36}\.png$/);
    assert.deepEqual(objects.get(s2ktp.slice('/uploads/'.length)), bytes('ktp-2'));
    assert.match(db.rows['core.cabang'].c1.foto_gedung!, /^\/uploads\/cabang\/c1\/foto-gedung-/);
    assert.equal(db.rows['core.staff'].s1.ifadah_url, '/uploads/staff/s1/ifadah-url-x.jpg', 'existing path untouched');
    assert.equal(journal.length, 4);
    assert.ok(journal.every(j => j.original.startsWith('data:') && j.path.startsWith('/uploads/')));
  });

  it('is idempotent: a second run finds nothing left to migrate', async () => {
    const db = fixture();
    const { storage, objects } = makeStorage();
    await migrateBase64ToStorage(db, storage, { apply: true, journal: () => {}, ...quiet });
    const size = objects.size;
    const report = await migrateBase64ToStorage(db, storage, { apply: true, journal: () => {}, ...quiet });
    assert.equal(report.candidates, 0);
    assert.equal(objects.size, size);
  });

  it('does not overwrite a value a user changed mid-migration, and removes the orphan upload', async () => {
    const db = fixture();
    const { storage, objects } = makeStorage();
    // The user saves a new photo between our read of the row and our compare-and-set.
    let first = true;
    db.beforeCas = table => {
      if (table === 'core.cabang' && first) { first = false; db.rows['core.cabang'].c1.foto_gedung = dataUrl('edited-by-user'); }
    };
    const journal: JournalRecord[] = [];
    const report = await migrateBase64ToStorage(db, storage, { apply: true, journal: r => journal.push(r), ...quiet });
    assert.equal(report.conflicts, 1);
    assert.equal(db.rows['core.cabang'].c1.foto_gedung, dataUrl('edited-by-user'));
    assert.equal(journal.some(j => j.table === 'core.cabang'), false);
    assert.equal([...objects.keys()].some(k => k.startsWith('cabang/')), false, 'orphan upload removed');
  });

  it('leaves the row untouched when the stored object does not verify', async () => {
    const db = fixture();
    const { storage, objects } = makeStorage({ corruptSize: true });
    const report = await migrateBase64ToStorage(db, storage, { apply: true, journal: () => {}, ...quiet });
    assert.equal(report.failed, 4);
    assert.equal(report.migrated, 0);
    assert.ok(db.rows['core.staff'].s1.ktp_url!.startsWith('data:'));
    assert.equal(objects.size, 0);
  });

  it('skips values it cannot decode and keeps them in place', async () => {
    const db = makeDb({ 'core.staff': { s9: { ktp_url: 'data:text/html;base64,PHNjcmlwdD4=', ijazah_url: null, ifadah_url: null } } });
    const { storage } = makeStorage();
    const report = await migrateBase64ToStorage(db, storage, { apply: true, journal: () => {}, ...quiet });
    assert.equal(report.invalid, 1);
    assert.equal(db.rows['core.staff'].s9.ktp_url, 'data:text/html;base64,PHNjcmlwdD4=');
  });
});

describe('restoreFromJournal', () => {
  it('puts the original base64 back only where the migrated path is still in place', async () => {
    const db = fixture();
    const { storage } = makeStorage();
    const journal: JournalRecord[] = [];
    await migrateBase64ToStorage(db, storage, { apply: true, journal: r => journal.push(r), ...quiet });
    // user replaced one document after the migration
    db.rows['core.staff'].s2.ijazah_url = '/uploads/staff/s2/ijazah-url-newer.jpg';

    const report = await restoreFromJournal(db, journal, { apply: true, ...quiet });
    assert.equal(report.restored, 3);
    assert.equal(report.skipped, 1);
    assert.equal(db.rows['core.staff'].s1.ktp_url, dataUrl('ktp-1'));
    assert.equal(db.rows['core.staff'].s2.ijazah_url, '/uploads/staff/s2/ijazah-url-newer.jpg');
  });
});

describe('pgMigrationDb (SQL adapter)', { skip: !process.env.PG_TEST_URL && 'PG_TEST_URL not set' }, () => {
  it('lists, reads and compare-and-sets against real Postgres', async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL });
    try {
      await pool.query('create schema if not exists core');
      await pool.query('drop table if exists core.staff');
      await pool.query('create table core.staff (id text primary key, ktp_url text, ijazah_url text, ifadah_url text)');
      await pool.query("insert into core.staff values ('a', 'data:image/jpeg;base64,QQ==', null, null), ('b', '/uploads/x', null, null)");
      const db = pgMigrationDb(pool);
      assert.deepEqual(await db.listIdsWithBase64('core.staff', 'ktp_url'), ['a']);
      assert.equal(await db.getValue('core.staff', 'ktp_url', 'a'), 'data:image/jpeg;base64,QQ==');
      assert.equal(await db.compareAndSet('core.staff', 'ktp_url', 'a', 'wrong', '/uploads/new'), false);
      assert.equal(await db.compareAndSet('core.staff', 'ktp_url', 'a', 'data:image/jpeg;base64,QQ==', '/uploads/new'), true);
      assert.equal(await db.getValue('core.staff', 'ktp_url', 'a'), '/uploads/new');
      await assert.rejects(db.listIdsWithBase64('core.staff; drop table core.staff', 'ktp_url'), /Unknown migration target/);
    } finally {
      await pool.query('drop table if exists core.staff').catch(() => {});
      await pool.end();
    }
  });
});
