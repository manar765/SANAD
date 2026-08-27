import pool from "./index.js";

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
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
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
    await client.query(`UPDATE users SET full_name = trim(concat_ws(' ', first_name, last_name)) WHERE full_name IS NULL`);
    await client.query(`UPDATE users SET name = COALESCE(NULLIF(trim(name), ''), full_name) WHERE name IS NULL OR NULLIF(trim(name), '') IS NULL`);
    await client.query(`UPDATE users SET full_name = 'User ' || id WHERE NULLIF(trim(full_name), '') IS NULL`);
    await client.query(`UPDATE users SET first_name = split_part(full_name, ' ', 1) WHERE first_name IS NULL`);
    await client.query(`UPDATE users SET last_name = NULLIF(trim(regexp_replace(full_name, '^\\S+\\s*', '')), '') WHERE last_name IS NULL`);
    await client.query(`UPDATE users SET role = 'donor' WHERE role = 'user'`);
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('donor', 'beneficiary', 'admin'))`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS donor_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        donor_type TEXT NOT NULL DEFAULT 'individual' CHECK (donor_type IN ('individual', 'organization')),
        organization_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (donor_type = 'individual' OR NULLIF(trim(organization_name), '') IS NOT NULL)
      );
    `);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT,
        csrf_token TEXT NOT NULL,
        remember_me BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (char_length(action) BETWEEN 3 AND 80),
        success BOOLEAN NOT NULL DEFAULT TRUE,
        ip_address TEXT,
        user_agent TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS donation_requests (
        id BIGSERIAL PRIMARY KEY,
        donor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
        description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
        category TEXT NOT NULL CHECK (char_length(category) BETWEEN 2 AND 60),
        quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
        unit TEXT NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 40),
        item_condition TEXT NOT NULL DEFAULT 'حالة قياسية' CHECK (char_length(item_condition) BETWEEN 2 AND 80),
        warehouse TEXT NOT NULL DEFAULT 'المخزن العام' CHECK (char_length(warehouse) BETWEEN 2 AND 160),
        location TEXT NOT NULL CHECK (char_length(location) BETWEEN 2 AND 80),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'in_progress', 'distributed')),
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_sessions_last_seen_at_idx ON user_sessions (last_seen_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_user_created_at_idx ON audit_logs (user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS donation_requests_status_created_at_idx ON donation_requests (status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS donation_requests_donor_created_at_idx ON donation_requests (donor_id, created_at DESC)`);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => { });
    throw error;
  } finally {
    client.release();
  }
}
