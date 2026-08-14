import path from "node:path";
import express from "express";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";

migrate().catch((err) => {
  console.error("DB migration failed:", err.message);
  process.exit(1);
});

const app = express();

app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

// Health check
app.get("/api/health", async (req, res) => {
  let db = "up";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "down";
  }
  res.json({ status: "ok", db });
});

// API routes are mounted here as they are built, e.g.:
// app.use('/api/donations', (await import('./routes/donations.js')).default);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SANAD running at http://localhost:${PORT}`);
});
