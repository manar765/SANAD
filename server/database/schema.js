import pool from "./index.js";

// Schema matches entities in CONTEXT.md §12. Tables are added as modules are built.
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
