import { Pool } from 'pg';

async function main() {
  console.log('Fixing statusPool for existing students...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const result = await pool.query(`
      UPDATE core."students" 
      SET status_pool = 'AKTIF_CABANG' 
      WHERE cabang_id IS NOT NULL AND status_pool = 'TERSEDIA'
    `);
    console.log(`Updated ${result.rowCount} students to AKTIF_CABANG.`);
  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    await pool.end();
  }
}

main();
