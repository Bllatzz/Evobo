'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.ROBOTIP_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Sem listener, um erro numa conexão ociosa (Postgres reiniciou, rede caiu)
// vira 'error' não tratado no processo inteiro do evobo-api.
pool.on('error', (err) => {
  console.error(`[robotip-legacy] [${new Date().toISOString()}] erro no pool do Postgres:`, err.message);
});

module.exports = pool;
