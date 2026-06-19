const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const init = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      email        VARCHAR(255) UNIQUE NOT NULL,
      password     VARCHAR(255) NOT NULL,
      is_admin     BOOLEAN DEFAULT FALSE,
      is_active    BOOLEAN DEFAULT TRUE,
      max_devices  INTEGER DEFAULT 10,
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

  // Ajouter colonnes si migration nécessaire
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin    BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS max_devices INTEGER DEFAULT 10;
  `).catch(() => {});

  // Créer/mettre à jour le compte admin
  const adminEmail    = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const bcrypt = require('bcryptjs');
    const hash   = await bcrypt.hash(adminPassword, 10);
    await pool.query(`
      INSERT INTO users (email, password, is_admin, max_devices)
      VALUES ($1, $2, TRUE, -1)
      ON CONFLICT (email) DO UPDATE SET password=$2, is_admin=TRUE, max_devices=-1
    `, [adminEmail.toLowerCase(), hash]);
    console.log(`[DB] Admin configuré : ${adminEmail}`);
  }

  console.log('[DB] Tables prêtes');
};

module.exports = { pool, init };
