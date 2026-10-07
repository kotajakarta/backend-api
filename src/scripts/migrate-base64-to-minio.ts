/**
 * Pindahkan dokumen staf & foto cabang yang tersimpan sebagai base64 di Postgres ke MinIO.
 * Logika & pengamanannya ada di src/common/media/base64-migration.ts (teruji).
 *
 * stdout hanya berisi data JSON Lines (backup / jurnal); semua log ke stderr.
 * Jalankan di dalam container API (env DATABASE_URL & MINIO_* sudah tersedia):
 *
 *   # 1. Backup semua nilai base64 (simpan di host, JANGAN di folder uploads/)
 *   podman exec -w /app esantri-api npx tsx src/scripts/migrate-base64-to-minio.ts backup > ~/esantri-backups/base64-backup.jsonl
 *
 *   # 2. Dry-run: hanya laporan, tidak mengubah apa pun
 *   podman exec -w /app esantri-api npx tsx src/scripts/migrate-base64-to-minio.ts migrate
 *
 *   # 3. Eksekusi; jurnal (path baru + nilai asli) untuk rollback
 *   podman exec -w /app esantri-api npx tsx src/scripts/migrate-base64-to-minio.ts migrate --apply > ~/esantri-backups/base64-journal.jsonl
 *
 *   # Rollback (dry-run tanpa --apply)
 *   podman exec -i -w /app esantri-api npx tsx src/scripts/migrate-base64-to-minio.ts restore --apply < ~/esantri-backups/base64-journal.jsonl
 */
import 'dotenv/config';
import 'reflect-metadata';
import readline from 'node:readline';
import pg from 'pg';
import { Logger } from '@nestjs/common';
import { MinioService } from '../common/minio/minio.service.js';
import {
  pgMigrationDb,
  backupBase64,
  migrateBase64ToStorage,
  restoreFromJournal,
  JournalRecord,
} from '../common/media/base64-migration.js';
import { writeJsonLineSync } from '../common/media/jsonl-writer.js';

// Nest's logger writes to stdout, which is reserved for JSON Lines output here.
Logger.overrideLogger(false);

const log = (msg: string) => process.stderr.write(msg + '\n');
// Complete, synchronous line writes even when stdout is a full non-blocking pipe (podman exec).
const emit = (record: unknown) => writeJsonLineSync(1, record);

async function* readJournal(): AsyncGenerator<JournalRecord> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line) as JournalRecord;
  }
}

async function main() {
  const [mode, ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  if (!['backup', 'migrate', 'restore'].includes(mode)) {
    log('Pemakaian: migrate-base64-to-minio.ts <backup|migrate|restore> [--apply]');
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = pgMigrationDb(pool);
  try {
    if (mode === 'backup') {
      const count = await backupBase64(db, emit);
      log(`Backup selesai: ${count} nilai base64 ditulis ke stdout.`);
      return;
    }

    if (mode === 'restore') {
      const report = await restoreFromJournal(db, readJournal(), { apply, log });
      log(`${apply ? 'Restore' : 'Dry-run restore'}: ${report.restored} ${apply ? 'dikembalikan' : 'akan dikembalikan'}, ${report.skipped} dilewati (sudah berubah).`);
      return;
    }

    const minio = new MinioService();
    const storage = {
      uploadBuffer: (key: string, buffer: Buffer, mime?: string) => minio.uploadBuffer(key, buffer, mime),
      deleteObject: (key: string) => minio.deleteObject(key),
      statObject: (key: string) => minio.statObject(key),
    };
    log(apply ? 'MODE APPLY — data akan dipindahkan ke MinIO.' : 'DRY-RUN — tidak ada yang diubah (tambahkan --apply untuk eksekusi).');
    const report = await migrateBase64ToStorage(db, storage, { apply, journal: emit, log });
    log(
      `Selesai. kandidat=${report.candidates} (${(report.bytes / 1048576).toFixed(1)} MB), ` +
        `dipindahkan=${report.migrated}, konflik=${report.conflicts}, tidak-valid=${report.invalid}, gagal=${report.failed}`
    );
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  log(`ERROR: ${err?.stack || err}`);
  process.exit(1);
});
