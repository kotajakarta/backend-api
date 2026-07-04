import pg from 'pg';
const pool = new pg.Pool({ connectionString: "postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi" });
pool.query("SELECT COUNT(*) FROM core.students s LEFT JOIN core.biodata b ON s.biodata_id = b.id WHERE s.status_pool = 'AKTIF_CABANG' AND b.id IS NULL;", (err, res) => {
  if (err) console.error(err);
  else console.log("Missing biodata:", res.rows);
  pool.end();
});
