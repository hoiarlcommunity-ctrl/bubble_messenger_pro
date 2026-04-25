const fs = require('fs');
const path = require('path');

async function runSqlMigrations(query, migrationsDir = path.join(__dirname, '..', 'db', 'migrations')) {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const exists = await query('SELECT id FROM schema_migrations WHERE id = $1', [id]);
    if (exists.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await query(sql);
    await query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
    console.log(`[migration] applied ${id}`);
  }
}

module.exports = { runSqlMigrations };
