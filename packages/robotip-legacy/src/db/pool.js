'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.ROBOTIP_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
