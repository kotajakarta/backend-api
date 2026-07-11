const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const res = await pool.query(`
    UPDATE core.audit_logs al
    SET actor_name = u.username || ' - ' || COALESCE(c.name, w.name, '')
    FROM core.users u
    LEFT JOIN core.cabang c ON u.cabang_id = c.id
    LEFT JOIN core.wilayah w ON u.wilayah_id = w.id
    WHERE al.actor_id = u.id AND al.actor_name = 'System' AND u.id != 'system';
  `);
  console.log(`Updated ${res.rowCount} rows.`);
}

main().catch(console.error).finally(() => pool.end());
