import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('=== MEMULAI SINKRONISASI DATA HEALING NISN & NIS ===');

    // 1. Ambil semua siswa formal yang memiliki NISN di biodata tapi kosong di siswa_formal
    const nullFormalRes = await client.query(`
      SELECT 
        sf.id as sf_id,
        s.id as student_id,
        b.full_name,
        TRIM(b.nisn) as bio_nisn,
        TRIM(b.nis_lokal) as bio_nis
      FROM formal.siswa_formal sf
      JOIN core.students s ON sf.student_id = s.id
      JOIN core.biodata b ON s.biodata_id = b.id
      WHERE sf.nisn IS NULL 
        AND b.nisn IS NOT NULL 
        AND TRIM(b.nisn) <> '' 
        AND TRIM(b.nisn) <> '-';
    `);

    console.log(`Ditemukan ${nullFormalRes.rowCount} record siswa_formal dengan NISN NULL yang memiliki NISN di biodata.`);

    let updatedNullCount = 0;
    let skippedNullConflict = 0;

    await client.query('BEGIN');

    // Ambil semua NISN yang sudah terpakai di formal.siswa_formal saat ini
    const takenNisnRes = await client.query(`
      SELECT nisn, id FROM formal.siswa_formal WHERE nisn IS NOT NULL;
    `);
    const takenNisnMap = new Map<string, string>();
    takenNisnRes.rows.forEach(r => takenNisnMap.set(r.nisn, r.id));

    for (const row of nullFormalRes.rows) {
      const bioNisn = row.bio_nisn;
      const sfId = row.sf_id;

      // Cek apakah NISN ini sudah terpakai oleh siswa formal lain
      const existingOwnerSfId = takenNisnMap.get(bioNisn);
      if (existingOwnerSfId && existingOwnerSfId !== sfId) {
        skippedNullConflict++;
        continue;
      }

      await client.query(`
        UPDATE formal.siswa_formal
        SET nisn = $1,
            nis = COALESCE(nis, $2)
        WHERE id = $3
      `, [bioNisn, row.bio_nis || null, sfId]);

      takenNisnMap.set(bioNisn, sfId);
      updatedNullCount++;
    }

    console.log(`✅ Berhasil menyinkronkan ${updatedNullCount} record NISN yang sebelumnya NULL ke siswa_formal.`);
    if (skippedNullConflict > 0) {
      console.warn(`⚠️ Dilewati ${skippedNullConflict} record karena konflik NISN duplikat pada siswa formal lain.`);
    }

    // 2. Cek dan tangani 44 record siswa yang nilai NISN-nya berbeda antara biodata dan siswa_formal
    const diffRes = await client.query(`
      SELECT 
        sf.id as sf_id,
        s.id as student_id,
        b.id as biodata_id,
        b.full_name,
        TRIM(b.nisn) as bio_nisn,
        TRIM(sf.nisn) as sf_nisn
      FROM formal.siswa_formal sf
      JOIN core.students s ON sf.student_id = s.id
      JOIN core.biodata b ON s.biodata_id = b.id
      WHERE b.nisn IS NOT NULL 
        AND sf.nisn IS NOT NULL 
        AND TRIM(b.nisn) <> TRIM(sf.nisn);
    `);

    console.log(`\nDitemukan ${diffRes.rowCount} record dengan nilai NISN berbeda antara biodata dan siswa_formal.`);

    let reconciledCount = 0;
    for (const row of diffRes.rows) {
      const isBio10 = /^\d{10}$/.test(row.bio_nisn);
      const isSf10 = /^\d{10}$/.test(row.sf_nisn);

      if (isBio10 && !isSf10) {
        // Biodata memiliki 10 digit resmi, sf tidak resmi
        const owner = takenNisnMap.get(row.bio_nisn);
        if (!owner || owner === row.sf_id) {
          await client.query(`UPDATE formal.siswa_formal SET nisn = $1 WHERE id = $2`, [row.bio_nisn, row.sf_id]);
          takenNisnMap.set(row.bio_nisn, row.sf_id);
          reconciledCount++;
        }
      } else if (!isBio10 && isSf10) {
        // SiswaFormal memiliki 10 digit resmi, biodata tidak
        await client.query(`UPDATE core.biodata SET nisn = $1 WHERE id = $2`, [row.sf_nisn, row.biodata_id]);
        reconciledCount++;
      } else if (isBio10 && isSf10) {
        // Keduanya 10 digit, samakan sf.nisn dengan bio.nisn (single source of truth) jika tidak konflik
        const owner = takenNisnMap.get(row.bio_nisn);
        if (!owner || owner === row.sf_id) {
          await client.query(`UPDATE formal.siswa_formal SET nisn = $1 WHERE id = $2`, [row.bio_nisn, row.sf_id]);
          takenNisnMap.set(row.bio_nisn, row.sf_id);
          reconciledCount++;
        }
      }
    }

    console.log(`✅ Berhasil merekonsiliasi ${reconciledCount} dari ${diffRes.rowCount} perbedaan NISN.`);

    await client.query('COMMIT');

    // 3. Verifikasi kondisi akhir setelah data healing
    const finalCheck = await client.query(`
      SELECT 
        COUNT(*) as total_siswa_formal,
        COUNT(CASE WHEN b.nisn IS DISTINCT FROM sf.nisn THEN 1 END) as total_beda,
        COUNT(CASE WHEN b.nisn IS NOT NULL AND sf.nisn IS NULL THEN 1 END) as biodata_ada_formal_null,
        COUNT(CASE WHEN b.nisn IS NULL AND sf.nisn IS NOT NULL THEN 1 END) as biodata_null_formal_ada,
        COUNT(CASE WHEN b.nisn IS NOT NULL AND sf.nisn IS NOT NULL AND b.nisn <> sf.nisn THEN 1 END) as beda_nilai
      FROM core.students s
      JOIN core.biodata b ON s.biodata_id = b.id
      JOIN formal.siswa_formal sf ON sf.student_id = s.id;
    `);

    console.log('\n=== STATUS DATA SETELAH DATA HEALING ===');
    console.table(finalCheck.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error saat sinkronisasi data healing:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
