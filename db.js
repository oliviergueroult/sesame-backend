const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const init = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      email        VARCHAR(255) UNIQUE NOT NULL,
      password     VARCHAR(255) NOT NULL,
      created_at   TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_systems (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      system_type  VARCHAR(50) NOT NULL DEFAULT 'tahoma',
      credentials  JSONB NOT NULL DEFAULT '{}',
      devices      JSONB NOT NULL DEFAULT '{}',
      updated_at   TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id)
    );
  `);
  console.log('[DB] Tables prêtes');
};

module.exports = { pool, init };
