import type { Pool } from 'pg';
import { ImageStorage, fieldSlug, parseDataUrl, extensionForMime, uploadDataUrl } from './image-field.js';

/**
 * One-off migration of the base64 data URLs stored in Postgres into MinIO
 * (see image-field.ts). Driven by src/scripts/migrate-base64-to-minio.ts.
 *
 * Safety properties:
 * - dry-run unless `apply` is set;
 * - each value is uploaded, verified by size, then swapped in with a
 *   compare-and-set on the original value — a row a user edited meanwhile is
 *   left alone and the orphan upload removed;
 * - every swapped value is journaled with its original, so it can be restored;
 * - rows that already hold a path are never selected, so reruns are no-ops.
 */

export interface MigrationTarget {
  table: string;
  /** MinIO key prefix; objects go under `<prefix>/<row id>/` like new uploads. */
  prefix: string;
  /** SQL column -> Prisma field (the field name is used in the object key). */
  columns: Record<string, string>;
}

export const MIGRATION_TARGETS: readonly MigrationTarget[] = [
  {
    table: 'core.staff',
    prefix: 'staff',
    columns: { ktp_url: 'ktpUrl', ijazah_url: 'ijazahUrl', ifadah_url: 'ifadahUrl' },
  },
  {
    table: 'core.cabang',
    prefix: 'cabang',
    columns: {
      foto_plang: 'fotoPlang',
      foto_gedung: 'fotoGedung',
      foto_halaman: 'fotoHalaman',
      foto_denah: 'fotoDenah',
      foto_mushala: 'fotoMushala',
      foto_kelas: 'fotoKelas',
      foto_ruang_tidur: 'fotoRuangTidur',
      foto_ruang_makan: 'fotoRuangMakan',
      foto_kamar_mandi: 'fotoKamarMandi',
    },
  },
];

export interface MigrationDb {
  listIdsWithBase64(table: string, column: string): Promise<string[]>;
  getValue(table: string, column: string, id: string): Promise<string | null>;
  /** Set `column` to `next` only if it still equals `expected`. */
  compareAndSet(table: string, column: string, id: string, expected: string, next: string): Promise<boolean>;
}

export interface MigrationStorage extends ImageStorage {
  statObject(key: string): Promise<{ size: number } | null>;
}

export interface JournalRecord {
  table: string;
  column: string;
  id: string;
  path: string;
  original: string;
}

export interface BackupRecord {
  table: string;
  column: string;
  id: string;
  value: string;
}

type Logger = { log: (msg: string) => void };

function assertTarget(table: string, column: string): MigrationTarget {
  const target = MIGRATION_TARGETS.find(t => t.table === table);
  if (!target || !(column in target.columns)) {
    throw new Error(`Unknown migration target ${table}.${column}`);
  }
  return target;
}

/** SQL implementation over a pg Pool; identifiers come only from MIGRATION_TARGETS. */
export function pgMigrationDb(pool: Pick<Pool, 'query'>): MigrationDb {
  const ident = (table: string, column: string) => {
    assertTarget(table, column);
    const [schema, name] = table.split('.');
    return { tbl: `"${schema}"."${name}"`, col: `"${column}"` };
  };
  return {
    listIdsWithBase64: async (table, column) => {
      const { tbl, col } = ident(table, column);
      const res = await pool.query(`SELECT id FROM ${tbl} WHERE ${col} LIKE 'data:%' ORDER BY id`);
      return res.rows.map((r: any) => String(r.id));
    },
    getValue: async (table, column, id) => {
      const { tbl, col } = ident(table, column);
      const res = await pool.query(`SELECT ${col} AS v FROM ${tbl} WHERE id = $1`, [id]);
      return res.rows[0]?.v ?? null;
    },
    compareAndSet: async (table, column, id, expected, next) => {
      const { tbl, col } = ident(table, column);
      const res = await pool.query(`UPDATE ${tbl} SET ${col} = $1 WHERE id = $2 AND ${col} = $3`, [next, id, expected]);
      return res.rowCount === 1;
    },
  };
}

/** Emit every base64 value (for an offline backup before migrating). */
export async function backupBase64(db: MigrationDb, emit: (r: BackupRecord) => void): Promise<number> {
  let count = 0;
  for (const t of MIGRATION_TARGETS) {
    for (const column of Object.keys(t.columns)) {
      for (const id of await db.listIdsWithBase64(t.table, column)) {
        const value = await db.getValue(t.table, column, id);
        if (value?.startsWith('data:')) {
          emit({ table: t.table, column, id, value });
          count++;
        }
      }
    }
  }
  return count;
}

export interface MigrationReport {
  candidates: number;
  bytes: number;
  migrated: number;
  conflicts: number;
  invalid: number;
  failed: number;
}

export async function migrateBase64ToStorage(
  db: MigrationDb,
  storage: MigrationStorage,
  opts: { apply: boolean; journal: (r: JournalRecord) => void } & Logger
): Promise<MigrationReport> {
  const report: MigrationReport = { candidates: 0, bytes: 0, migrated: 0, conflicts: 0, invalid: 0, failed: 0 };

  for (const t of MIGRATION_TARGETS) {
    for (const [column, field] of Object.entries(t.columns)) {
      for (const id of await db.listIdsWithBase64(t.table, column)) {
        const original = await db.getValue(t.table, column, id);
        if (!original?.startsWith('data:')) continue; // changed since listing
        report.candidates++;
        const where = `${t.table}.${column} id=${id}`;

        const parsed = parseDataUrl(original);
        if (!parsed || !extensionForMime(parsed.mime)) {
          report.invalid++;
          opts.log(`[INVALID] ${where}: not a supported image/PDF data URL — left in place`);
          continue;
        }
        report.bytes += parsed.buffer.length;
        if (!opts.apply) continue;

        let key: string | null = null;
        try {
          key = await uploadDataUrl(storage, original, `${t.prefix}/${id}`, field);
          const stat = await storage.statObject(key);
          if (!stat || stat.size !== parsed.buffer.length) {
            throw new Error(`verification failed (stored ${stat?.size ?? 'nothing'}, expected ${parsed.buffer.length} bytes)`);
          }
          const path = `/uploads/${key}`;
          if (await db.compareAndSet(t.table, column, id, original, path)) {
            opts.journal({ table: t.table, column, id, path, original });
            report.migrated++;
            opts.log(`[OK] ${where} -> ${path}`);
          } else {
            await storage.deleteObject(key).catch(() => {});
            report.conflicts++;
            opts.log(`[CONFLICT] ${where}: value changed during migration — left as is`);
          }
        } catch (err: any) {
          if (key) await storage.deleteObject(key).catch(() => {});
          report.failed++;
          opts.log(`[FAILED] ${where}: ${err?.message || err}`);
        }
      }
    }
  }
  return report;
}

/** Undo a migration from its journal, only where the migrated path is still stored. */
export async function restoreFromJournal(
  db: MigrationDb,
  journal: Iterable<JournalRecord> | AsyncIterable<JournalRecord>,
  opts: { apply: boolean } & Logger
): Promise<{ restored: number; skipped: number }> {
  const report = { restored: 0, skipped: 0 };
  for await (const r of journal as AsyncIterable<JournalRecord>) {
    assertTarget(r.table, r.column);
    if (!opts.apply) {
      const current = await db.getValue(r.table, r.column, r.id);
      if (current === r.path) report.restored++; else report.skipped++;
      continue;
    }
    if (await db.compareAndSet(r.table, r.column, r.id, r.path, r.original)) {
      report.restored++;
    } else {
      report.skipped++;
      opts.log(`[SKIP] ${r.table}.${r.column} id=${r.id}: value changed since migration`);
    }
  }
  return report;
}

export { fieldSlug };
