import pool from "./index.js";

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'donor' CHECK (role IN ('donor', 'beneficiary', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Keep the migration compatible with earlier versions that used a different user shape.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`UPDATE users SET full_name = trim(concat_ws(' ', first_name, last_name)) WHERE full_name IS NULL`);
  await pool.query(`UPDATE users SET name = COALESCE(NULLIF(trim(name), ''), full_name) WHERE name IS NULL OR NULLIF(trim(name), '') IS NULL`);
  await pool.query(`UPDATE users SET full_name = 'User ' || id WHERE NULLIF(trim(full_name), '') IS NULL`);
  await pool.query(`UPDATE users SET first_name = split_part(full_name, ' ', 1) WHERE first_name IS NULL`);
  await pool.query(`UPDATE users SET last_name = NULLIF(trim(regexp_replace(full_name, '^\\S+\\s*', '')), '') WHERE last_name IS NULL`);
  await pool.query(`UPDATE users SET role = 'donor' WHERE role = 'user'`);
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('donor', 'beneficiary', 'admin'))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS donor_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      donor_type TEXT NOT NULL DEFAULT 'individual' CHECK (donor_type IN ('individual', 'organization')),
      organization_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (donor_type = 'individual' OR NULLIF(trim(organization_name), '') IS NOT NULL)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS beneficiary_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      family_size INTEGER CHECK (family_size IS NULL OR family_size > 0),
      children_count INTEGER CHECK (children_count IS NULL OR children_count >= 0),
      employment_status TEXT,
      location TEXT,
      current_needs TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      csrf_token TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id)`);
}
