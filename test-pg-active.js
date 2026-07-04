import pg from 'pg';
const pool = new pg.Pool({ connectionString: "postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi" });
pool.query("SELECT is_active, COUNT(*) FROM core.students WHERE status_pool='AKTIF_CABANG' GROUP BY is_active;", (err, res) => {
  if (err) console.error(err);
  else console.log(res.rows);
  pool.end();
});
