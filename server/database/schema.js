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
        email_verified_at TIMESTAMPTZ,
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
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
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
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_mfa (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret_ciphertext TEXT NOT NULL,
        recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}',
        enabled_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS mfa_challenges (
        challenge_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        remember_me BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
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
        reference_code TEXT UNIQUE,
        received_at TIMESTAMPTZ,
        expiration_date DATE,
        notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id BIGSERIAL PRIMARY KEY,
        source_donation_id BIGINT REFERENCES donation_requests(id) ON DELETE SET NULL,
        name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 160),
        category TEXT NOT NULL CHECK (char_length(trim(category)) BETWEEN 2 AND 80),
        description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
        unit TEXT NOT NULL CHECK (char_length(trim(unit)) BETWEEN 1 AND 40),
        quantity_total INTEGER NOT NULL CHECK (quantity_total >= 0),
        quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
        quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
        low_stock_threshold INTEGER NOT NULL DEFAULT 1 CHECK (low_stock_threshold >= 0),
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'low_stock', 'out_of_stock', 'in_distribution', 'surplus', 'archived')),
        warehouse TEXT NOT NULL DEFAULT 'المخزن العام' CHECK (char_length(trim(warehouse)) BETWEEN 2 AND 160),
        location TEXT NOT NULL CHECK (char_length(trim(location)) BETWEEN 2 AND 160),
        condition TEXT NOT NULL DEFAULT 'standard' CHECK (char_length(trim(condition)) BETWEEN 2 AND 80),
        expiration_date DATE,
        notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (quantity_available + quantity_reserved <= quantity_total)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS beneficiary_needs (
        id BIGSERIAL PRIMARY KEY,
        beneficiary_id INTEGER NOT NULL REFERENCES beneficiary_profiles(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 160),
        description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
        category TEXT NOT NULL CHECK (char_length(trim(category)) BETWEEN 2 AND 80),
        quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
        quantity_fulfilled INTEGER NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
        unit TEXT NOT NULL CHECK (char_length(trim(unit)) BETWEEN 1 AND 40),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_fulfilled', 'fulfilled', 'cancelled')),
        due_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (quantity_fulfilled <= quantity_requested)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS distributions (
        id BIGSERIAL PRIMARY KEY,
        beneficiary_id INTEGER NOT NULL REFERENCES beneficiary_profiles(id) ON DELETE RESTRICT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'cancelled')),
        scheduled_at TIMESTAMPTZ,
        distributed_at TIMESTAMPTZ,
        location TEXT CHECK (location IS NULL OR char_length(trim(location)) BETWEEN 2 AND 160),
        notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (distributed_at IS NULL OR status = 'completed')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS distribution_items (
        distribution_id BIGINT NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
        inventory_item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (distribution_id, inventory_item_id)
      );
    `);

    await client.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE user_mfa ALTER COLUMN enabled_at DROP NOT NULL`);

    // Migration for donation_requests
    await client.query(`ALTER TABLE donation_requests ADD COLUMN IF NOT EXISTS reference_code TEXT`);
    await client.query(`ALTER TABLE donation_requests ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE donation_requests ADD COLUMN IF NOT EXISTS expiration_date DATE`);
    await client.query(`ALTER TABLE donation_requests ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`);
    await client.query(`UPDATE donation_requests SET reference_code = 'DON-' || LPAD(id::text, 4, '0') WHERE reference_code IS NULL`);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_donation_reference_code()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.reference_code IS NULL OR trim(NEW.reference_code) = '' THEN
          NEW.reference_code := 'DON-' || LPAD(NEW.id::text, 4, '0');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_set_donation_reference_code'
        ) THEN
          CREATE TRIGGER trigger_set_donation_reference_code
          BEFORE INSERT ON donation_requests
          FOR EACH ROW
          EXECUTE FUNCTION set_donation_reference_code();
        END IF;
      END $$;
    `);

    // Migration for inventory_items
    await client.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expiration_date DATE`);
    await client.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS donation_requests_reference_code_idx ON donation_requests (reference_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS donation_requests_expiration_idx ON donation_requests (expiration_date) WHERE expiration_date IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS inventory_items_expiration_idx ON inventory_items (expiration_date) WHERE expiration_date IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS inventory_items_status_updated_at_idx ON inventory_items (status, updated_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS inventory_items_category_idx ON inventory_items (category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS inventory_items_source_donation_idx ON inventory_items (source_donation_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS beneficiary_needs_priority_status_idx ON beneficiary_needs (priority, status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS beneficiary_needs_beneficiary_idx ON beneficiary_needs (beneficiary_id, status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS beneficiary_needs_category_idx ON beneficiary_needs (category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS distributions_status_scheduled_idx ON distributions (status, scheduled_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS distributions_beneficiary_idx ON distributions (beneficiary_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS distribution_items_inventory_idx ON distribution_items (inventory_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_mfa_updated_at_idx ON user_mfa (updated_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS mfa_challenges_user_expires_idx ON mfa_challenges (user_id, expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id, expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_at_idx ON email_verification_tokens (expires_at)`);
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
