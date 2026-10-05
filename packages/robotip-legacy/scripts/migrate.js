'use strict';

// Roda as migrations do robotip-legacy (packages/robotip-legacy/migrations)
// no banco do ROBOTIP_DATABASE_URL. Todas são idempotentes (IF NOT EXISTS).
// O deploy não roda isso sozinho — em produção:
//   fly ssh console -a evobo-api -C "node packages/robotip-legacy/scripts/migrate.js"

const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

async function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    console.log(`Running migration: ${file}`);
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`Migration done: ${file}`);
  }
}

migrate()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
