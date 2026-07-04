import pg from 'pg';
const pool = new pg.Pool({ connectionString: "postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi" });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='core' AND table_name='students' AND column_name='jenis_siswa';", (err, res) => {
  if (err) console.error(err);
  else console.log(res.rows);
  pool.end();
});
