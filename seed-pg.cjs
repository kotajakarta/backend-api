const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi',
});
async function main() {
  await client.connect();
  console.log('Connected to DB');
  const res = await client.query('SELECT * FROM pesantren.grup_daimi');
  if (res.rows.length === 0) {
    console.log('Inserting data...');
    await client.query(`
      INSERT INTO pesantren.grup_daimi (id, name) VALUES 
      (gen_random_uuid(), 'Endonezya'),
      (gen_random_uuid(), 'Isler'),
      (gen_random_uuid(), 'Muadalah')
    `);
    console.log('Data inserted.');
  } else {
    console.log('Data already exists:', res.rows);
  }
  await client.end();
}
main().catch(console.error);
