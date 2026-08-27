import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 3000;
const adminEmail = (process.env.ADMIN_EMAIL || "admin@sanad.com").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "Sanad@2026";
const scryptAsync = promisify(scrypt);

const pageRoutes = Object.freeze({
  "/": "index",
  "/login": "login",
  "/signup": "signup",
  "/dashboard": "dashboard",
  "/donations": "donations",
  "/admin-requests": "AdminRequests",
  "/inventory": "inventory",
  "/beneficiaries": "beneficiaries",
  "/distributions": "distributions",
});

const app = express();

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(projectRoot, "public", "views"));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(projectRoot, "public"), { index: false }));
app.use("/assets", express.static(path.join(projectRoot, "assets")));

function credentialsMatch(email, password) {
  const submitted = Buffer.from(`${email}\0${password}`);
  const expected = Buffer.from(`${adminEmail}\0${adminPassword}`);

  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function passwordMatches(password, storedHash) {
  const [salt, hash] = String(storedHash).split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  if (expected.length !== 64) return false;
  const derivedKey = await scryptAsync(password, salt, expected.length);
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const firstName = String(req.body?.firstName || "").trim().replace(/\s+/g, " ");
  const lastName = String(req.body?.lastName || "").trim().replace(/\s+/g, " ");
  const fullName = `${firstName} ${lastName}`.trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const phone = String(req.body?.phone || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "").trim().toLowerCase();
  const donorType = String(req.body?.donorType || "individual").trim().toLowerCase();
  const organizationName = String(req.body?.organizationName || "").trim();

  if (
    firstName.length < 2 || firstName.length > 60 || lastName.length < 2 || lastName.length > 60 ||
    !isValidEmail(email) || !/^[+\d][\d\s()-]{7,19}$/.test(phone) || password.length < 8 ||
    !["donor", "beneficiary"].includes(role)
  ) {
    return res.status(400).json({ message: "Please provide valid registration details." });
  }

  if (role === "donor" && !["individual", "organization"].includes(donorType)) {
    return res.status(400).json({ message: "Please select a valid donor type." });
  }

  if (role === "donor" && donorType === "organization" && organizationName.length < 2) {
    return res.status(400).json({ message: "Organization name is required." });
  }

  const client = await pool.connect();
  try {
    const passwordHash = await hashPassword(password);
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (name, first_name, last_name, full_name, email, password, password_hash, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, first_name, last_name, email, phone, role`,
      [fullName, firstName, lastName, fullName, email, passwordHash, passwordHash, phone, role],
    );
    const user = result.rows[0];

    if (role === "donor") {
      await client.query(
        `INSERT INTO donor_profiles (user_id, donor_type, organization_name)
         VALUES ($1, $2, NULLIF($3, ''))`,
        [user.id, donorType, donorType === "organization" ? organizationName : ""],
      );
    } else {
      await client.query("INSERT INTO beneficiary_profiles (user_id) VALUES ($1)", [user.id]);
    }

    await client.query("COMMIT");
    return res.status(201).json({ user });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ message: "This email is already registered." });
    }

    console.error("Signup failed:", error);
    return res.status(503).json({ message: "Registration is temporarily unavailable." });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (credentialsMatch(email, password)) {
    return res.json({ role: "admin" });
  }

  try {
    const result = await pool.query(
      "SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];

    if (!user || !(await passwordMatches(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    return res.json({ role: user.role, user: { id: user.id, name: user.full_name, email: user.email } });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(503).json({ message: "Login is temporarily unavailable." });
  }
});

for (const [route, page] of Object.entries(pageRoutes)) {
  app.get(route, (_req, res, next) => {
    res.render(`pages/${page}`, { currentPath: route }, (error, html) => {
      if (error) return next(error);
      return res.send(html);
    });
  });
}

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found." });
});

app.use((_req, res) => {
  res.status(404).render("errors/not-found");
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error);
  res.status(500).render("errors/server-error");
});

function start() {
  const server = app.listen(port, () => {
    console.log(`SANAD running at http://localhost:${port}`);
  });

  migrate()
    .then(() => console.log("Database migration completed."))
    .catch((error) => {
      console.error("Database migration failed; database features are unavailable:", error.message);
    });

  return server;
}

start();
