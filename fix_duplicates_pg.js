import pkg from 'pg';
const { Client } = pkg;

async function main() {
  const client = new Client({
    connectionString: "postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi"
  });

  await client.connect();
  console.log('Connected to database.');

  const res = await client.query(`
    DELETE FROM formal.absensi_mapel
    WHERE id NOT IN (
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER(
                       PARTITION BY mata_pelajaran_id, kelas_id, student_id, tanggal
                       ORDER BY created_at DESC
                   ) as row_num
            FROM formal.absensi_mapel
        ) t
        WHERE t.row_num = 1
    );
  `);

  console.log(`Deleted ${res.rowCount} duplicate records.`);
  await client.end();
}

main().catch(console.error);
