import path from "node:path";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 3000;
const adminEmail = (process.env.ADMIN_EMAIL || "admin@sanad.com")
  .trim()
  .toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "Sanad@2026";
const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const SESSION_COOKIE = "sanad_session";

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function removeExpiredSessions() {
  await pool.query(
    `DELETE FROM user_sessions
     WHERE expires_at <= NOW()
        OR last_seen_at + ($1 * INTERVAL '1 millisecond') <= NOW()`,
    [SESSION_IDLE_TTL_MS],
  );
  removeExpiredResetTokens();
}

const sessionCleanup = setInterval(() => {
  removeExpiredSessions().catch(error => console.error("Session cleanup failed:", error));
}, 5 * 60 * 1000);
sessionCleanup.unref();

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const resetTokens = new Map();
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function removeExpiredResetTokens() {
  const now = Date.now();
  for (const [tokenHash, record] of resetTokens) {
    if (record.expiresAt <= now) resetTokens.delete(tokenHash);
  }
}

function loginAttemptKey(req, email) {
  return `${req.ip || "unknown"}:${email}`;
}

function isLoginRateLimited(key) {
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (record.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return record.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    record.count += 1;
  }
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [
          part.slice(0, index).trim(),
          decodeURIComponent(part.slice(index + 1).trim()),
        ];
      }),
  );
}

function cookieOptions(maxAge = SESSION_TTL_MS) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function resolveDisplayName(user) {
  const name = user.name || user.full_name || user.displayName;
  const parts = [user.firstName || user.first_name, user.lastName || user.last_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return String(name || parts.join(" ") || "").trim() || null;
}

async function createSession(user, rememberMe = false) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const csrfToken = randomBytes(32).toString("hex");
  const sessionTtlMs = rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
  await pool.query(
    `INSERT INTO user_sessions
      (token_hash, user_id, role, email, display_name, csrf_token, remember_me, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 * INTERVAL '1 millisecond'))`,
    [tokenHash, user.id || null, user.role, user.email, resolveDisplayName(user), csrfToken, rememberMe, sessionTtlMs],
  );
  return { token, maxAge: sessionTtlMs };
}

async function rotateSession(req, res, user, rememberMe = false) {
  const currentToken = parseCookies(req)[SESSION_COOKIE];
  if (currentToken) {
    await pool.query(
      "DELETE FROM user_sessions WHERE token_hash = $1",
      [hashSessionToken(currentToken)],
    );
  }
  setSessionCookie(res, await createSession(user, rememberMe));
}

async function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const tokenHash = token ? hashSessionToken(token) : null;
  if (!tokenHash) return null;
  const result = await pool.query(
    `SELECT s.token_hash, s.user_id AS id, s.role, s.email,
            COALESCE(NULLIF(s.display_name, ''), NULLIF(u.full_name, ''),
                     NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
                     NULLIF(u.name, '')) AS name,
            s.csrf_token AS "csrfToken", s.created_at AS "createdAt",
            s.last_seen_at AS "lastSeenAt", s.expires_at AS "expiresAt"
     FROM user_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const session = result.rows[0];
  if (!session) return null;
  const now = Date.now();
  if (new Date(session.expiresAt).getTime() <= now || new Date(session.lastSeenAt).getTime() + SESSION_IDLE_TTL_MS <= now) {
    await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [tokenHash]);
    return null;
  }
  await pool.query("UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = $1", [tokenHash]);
  return session;
}

function requireCsrf(req, res, next) {
  const expected = String(req.user?.csrfToken || "");
  const provided = String(req.get("X-CSRF-Token") || "");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    !expected ||
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(403).json({ message: "Invalid CSRF token." });
  }
  return next();
}

function setSessionCookie(res, session) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Max-Age=${Math.floor(session.maxAge / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

async function requireAuth(req, res, next) {
  try {
    const session = await getSession(req);
    if (session) {
      req.user = session;
      return next();
    }
    if (req.path.startsWith("/api/"))
      return res.status(401).json({ message: "Authentication required." });
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  } catch (error) {
    console.error("Session lookup failed:", error);
    if (req.path.startsWith("/api/"))
      return res.status(503).json({ message: "Authentication is temporarily unavailable." });
    return res.status(503).render("errors/server-error");
  }
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      if (req.path.startsWith("/api/"))
        return res
          .status(403)
          .json({ message: "Administrator access required." });
      return res
        .status(403)
        .render("errors/server-error", {
          message: "ليس لديك صلاحية الوصول إلى هذه الصفحة.",
        });
    }
    return next();
  });
}

const pageRoutes = Object.freeze({
  "/": "index",
  "/login": "login",
  "/signup": "signup",
  "/forgot-password": "forgot-password",
  "/reset-password": "reset-password",
  "/profile": "profile",
  "/dashboard": "profile",
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

  return (
    submitted.length === expected.length && timingSafeEqual(submitted, expected)
  );
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
  return (
    expected.length === derivedKey.length &&
    timingSafeEqual(expected, derivedKey)
  );
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
  const firstName = String(req.body?.firstName || "")
    .trim()
    .replace(/\s+/g, " ");
  const lastName = String(req.body?.lastName || "")
    .trim()
    .replace(/\s+/g, " ");
  const fullName = `${firstName} ${lastName}`.trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const phone = String(req.body?.phone || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "")
    .trim()
    .toLowerCase();
  const donorType = String(req.body?.donorType || "individual")
    .trim()
    .toLowerCase();
  const organizationName = String(req.body?.organizationName || "").trim();

  if (
    firstName.length < 2 ||
    firstName.length > 60 ||
    lastName.length < 2 ||
    lastName.length > 60 ||
    !isValidEmail(email) ||
    !/^[+\d][\d\s()-]{7,19}$/.test(phone) ||
    password.length < 8 ||
    !["donor", "beneficiary"].includes(role)
  ) {
    return res
      .status(400)
      .json({ message: "Please provide valid registration details." });
  }

  if (role === "donor" && !["individual", "organization"].includes(donorType)) {
    return res
      .status(400)
      .json({ message: "Please select a valid donor type." });
  }

  if (
    role === "donor" &&
    donorType === "organization" &&
    organizationName.length < 2
  ) {
    return res.status(400).json({ message: "Organization name is required." });
  }

  const client = await pool.connect();
  try {
    const passwordHash = await hashPassword(password);
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (name, first_name, last_name, full_name, email, password, password_hash, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, first_name, last_name, full_name, email, phone, role`,
      [
        fullName,
        firstName,
        lastName,
        fullName,
        email,
        passwordHash,
        passwordHash,
        phone,
        role,
      ],
    );
    const user = result.rows[0];

    if (role === "donor") {
      await client.query(
        `INSERT INTO donor_profiles (user_id, donor_type, organization_name)
         VALUES ($1, $2, NULLIF($3, ''))`,
        [
          user.id,
          donorType,
          donorType === "organization" ? organizationName : "",
        ],
      );
    } else {
      await client.query(
        "INSERT INTO beneficiary_profiles (user_id) VALUES ($1)",
        [user.id],
      );
    }

    await client.query("COMMIT");
    setSessionCookie(
      res,
      await createSession({ id: user.id, role: user.role, email: user.email, name: fullName }),
    );
    return res.status(201).json({ user });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ message: "This email is already registered." });
    }

    console.error("Signup failed:", error);
    return res
      .status(503)
      .json({ message: "Registration is temporarily unavailable." });
  } finally {
    client.release();
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({
    user: { id: req.user.id, role: req.user.role, email: req.user.email, name: req.user.name || req.user.email },
  });
});

app.get("/api/auth/csrf", requireAuth, (req, res) => {
  return res.json({ csrfToken: req.user.csrfToken });
});

app.get("/api/profile", requireAuth, async (req, res) => {
  if (!req.user.id) return res.status(404).json({ message: "Profile not found." });
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, full_name, email, phone, role
       FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: "Profile not found." });
    return res.json({ user });
  } catch (error) {
    console.error("Profile fetch failed:", error);
    return res.status(503).json({ message: "Profile is temporarily unavailable." });
  }
});

app.patch("/api/profile", requireAuth, requireCsrf, async (req, res) => {
  if (!req.user.id) return res.status(404).json({ message: "Profile not found." });
  const firstName = String(req.body?.firstName || "").trim();
  const lastName = String(req.body?.lastName || "").trim();
  const phone = String(req.body?.phone || "").trim();
  if (firstName.length < 2 || firstName.length > 50 || lastName.length < 2 || lastName.length > 50) {
    return res.status(400).json({ message: "Please enter a valid first and last name." });
  }
  if (phone && !/^[+0-9()\s-]{7,20}$/.test(phone)) {
    return res.status(400).json({ message: "Please enter a valid phone number." });
  }
  const fullName = `${firstName} ${lastName}`.trim();
  try {
    const result = await pool.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, full_name = $3, name = $3, phone = $4
       WHERE id = $5
       RETURNING id, first_name, last_name, full_name, email, phone, role`,
      [firstName, lastName, fullName, phone || null, req.user.id],
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: "Profile not found." });
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) {
      await pool.query(
        "UPDATE user_sessions SET display_name = $1 WHERE token_hash = $2",
        [fullName, hashSessionToken(token)],
      );
    }
    return res.json({ message: "Profile updated successfully.", user });
  } catch (error) {
    console.error("Profile update failed:", error);
    return res.status(503).json({ message: "Profile update is temporarily unavailable." });
  }
});

app.post("/api/profile/password", requireAuth, requireCsrf, async (req, res) => {
  if (!req.user.id) return res.status(404).json({ message: "Profile not found." });
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = String(req.body?.confirmPassword || "");
  if (newPassword.length < 8) return res.status(400).json({ message: "The new password must be at least 8 characters." });
  if (newPassword !== confirmPassword) return res.status(400).json({ message: "Password confirmation does not match." });
  try {
    const result = await pool.query("SELECT password_hash, password FROM users WHERE id = $1", [req.user.id]);
    const user = result.rows[0];
    const storedHash = user?.password_hash || user?.password;
    if (!user || !(await passwordMatches(currentPassword, storedHash))) {
      return res.status(401).json({ message: "The current password is incorrect." });
    }
    const passwordHash = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1, password = $1 WHERE id = $2", [passwordHash, req.user.id]);
    return res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Password update failed:", error);
    return res.status(503).json({ message: "Password update is temporarily unavailable." });
  }
});

app.post("/api/auth/logout", requireAuth, requireCsrf, async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
  res.setHeader("Set-Cookie", cookieOptions(0));
  return res.json({ success: true });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const genericMessage = "If an account exists for this email, a reset link has been created.";
  if (!isValidEmail(email)) return res.json({ message: genericMessage });

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) return res.json({ message: genericMessage });

    const token = randomBytes(32).toString("hex");
    resetTokens.set(hashSessionToken(token), {
      userId: user.id,
      expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
    });
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    if (process.env.NODE_ENV !== "production") {
      console.log(`Password reset link for ${email}: ${resetUrl}`);
      return res.json({ message: genericMessage, resetUrl });
    }
    return res.json({ message: genericMessage });
  } catch (error) {
    console.error("Forgot-password request failed:", error);
    return res.json({ message: genericMessage });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = String(req.body?.confirmPassword || "");
  if (newPassword.length < 8) return res.status(400).json({ message: "The new password must be at least 8 characters." });
  if (newPassword !== confirmPassword) return res.status(400).json({ message: "Password confirmation does not match." });

  const tokenHash = hashSessionToken(token);
  const record = resetTokens.get(tokenHash);
  if (!record || record.expiresAt <= Date.now()) {
    resetTokens.delete(tokenHash);
    return res.status(400).json({ message: "This reset link is invalid or has expired." });
  }

  try {
    const passwordHash = await hashPassword(newPassword);
    const result = await pool.query(
      "UPDATE users SET password_hash = $1, password = $1 WHERE id = $2 RETURNING id",
      [passwordHash, record.userId],
    );
    if (!result.rows[0]) return res.status(400).json({ message: "This reset link is invalid or has expired." });
    resetTokens.delete(tokenHash);
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [record.userId]);
    return res.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Password reset failed:", error);
    return res.status(503).json({ message: "Password reset is temporarily unavailable." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const rememberMe = req.body?.rememberMe === true;
  const attemptKey = loginAttemptKey(req, email);

  if (isLoginRateLimited(attemptKey)) {
    res.setHeader("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    return res
      .status(429)
      .json({ message: "Too many login attempts. Please try again later." });
  }

  if (credentialsMatch(email, password)) {
    clearLoginFailures(attemptKey);
    await rotateSession(req, res, { role: "admin", email }, rememberMe);
    return res.json({ role: "admin" });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, first_name, last_name, full_name, email, password_hash, role
       FROM users WHERE email = $1`,
      [email],
    );
    const user = result.rows[0];

    if (!user || !(await passwordMatches(password, user.password_hash))) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    clearLoginFailures(attemptKey);
    await rotateSession(
      req,
      res,
      {
        id: user.id,
        role: user.role,
        email: user.email,
        name: user.full_name,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      rememberMe,
    );
    return res.json({
      role: user.role,
      user: {
        id: user.id,
        name: resolveDisplayName(user),
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res
      .status(503)
      .json({ message: "Login is temporarily unavailable." });
  }
});

const protectedPages = new Set([
  "/profile",
  "/dashboard",
  "/donations",
  "/admin-requests",
  "/inventory",
  "/beneficiaries",
  "/distributions",
]);

for (const [route, page] of Object.entries(pageRoutes)) {
  const guard =
    route === "/admin-requests"
      ? requireAdmin
      : protectedPages.has(route)
        ? requireAuth
        : (_req, _res, next) => next();
  app.get(route, guard, (_req, res, next) => {
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

async function start() {
  try {
    await migrate();
    await removeExpiredSessions();
    console.log("Database migration completed.");
  } catch (error) {
    console.error("Database migration failed; server will not start:", error.message);
    process.exitCode = 1;
    return;
  }

  app.listen(port, () => {
    console.log(`SANAD running at http://localhost:${port}`);
  });
}

start();
