import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 3000;
const adminEmail = (process.env.ADMIN_EMAIL || "admin@sanad.com").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "Sanad@2026";

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
app.set("views", path.join(projectRoot, "views"));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(projectRoot, "public"), { index: false }));
app.use("/assets", express.static(path.join(projectRoot, "assets")));

function credentialsMatch(email, password) {
  const submitted = Buffer.from(`${email}\0${password}`);
  const expected = Buffer.from(`${adminEmail}\0${adminPassword}`);

  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!credentialsMatch(email, password)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  return res.json({ role: "admin" });
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
