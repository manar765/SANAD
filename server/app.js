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
  pruneRateLimitRecords(loginAttempts);
  pruneRateLimitRecords(signupAttempts);
  pruneRateLimitRecords(forgotPasswordAttempts);
  pruneRateLimitRecords(resetPasswordAttempts);
}

const sessionCleanup = setInterval(() => {
  removeExpiredSessions().catch(() => console.error("Session cleanup failed."));
}, 5 * 60 * 1000);
sessionCleanup.unref();

const loginAttempts = new Map();
const signupAttempts = new Map();
const forgotPasswordAttempts = new Map();
const resetPasswordAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 10;
const FORGOT_PASSWORD_MAX_ATTEMPTS = 5;
const RESET_PASSWORD_MAX_ATTEMPTS = 10;
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

function isRateLimited(records, key, maxAttempts, windowMs = LOGIN_WINDOW_MS) {
  const record = records.get(key);
  if (!record) return false;
  if (record.resetAt <= Date.now()) {
    records.delete(key);
    return false;
  }
  return record.count >= maxAttempts;
}

function recordRateLimitAttempt(records, key, windowMs = LOGIN_WINDOW_MS) {
  const now = Date.now();
  const record = records.get(key);
  if (!record || record.resetAt <= now) {
    records.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    record.count += 1;
  }
}

function pruneRateLimitRecords(records) {
  const now = Date.now();
  for (const [key, record] of records) {
    if (record.resetAt <= now) records.delete(key);
  }
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

async function recordAuditEvent(req, { userId = null, action, success = true, metadata = {} }) {
  const safeAction = String(action || "").trim().slice(0, 80);
  if (!safeAction) return;
  const safeMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, success, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        userId || null,
        safeAction,
        Boolean(success),
        String(req.ip || "").slice(0, 100),
        String(req.get("user-agent") || "").slice(0, 500),
        JSON.stringify(safeMetadata),
      ],
    );
  } catch {
    console.error("Audit log write failed.");
  }
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
  "/inventory": "coming-soon",
  "/beneficiaries": "coming-soon",
  "/distributions": "coming-soon",
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

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeNamePart(value) {
  return normalizeWhitespace(value);
}

function isValidNamePart(value, maxLength = 60) {
  const name = normalizeNamePart(value);
  return (
    Array.from(name).length >= 2 &&
    Array.from(name).length <= maxLength &&
    /^[\p{L}\p{M}]+(?:[\s'’\u2010-\u2015-][\p{L}\p{M}]+)*$/u.test(name)
  );
}

function isValidEmail(email) {
  return String(email).length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidPhone(value, { optional = false } = {}) {
  const phone = normalizePhone(value);
  if (optional && !phone) return true;
  const digits = phone.replace(/\D/g, "");
  return /^[+\d][\d\s()\-]{7,19}$/.test(phone) && digits.length >= 8 && digits.length <= 15;
}

function isValidPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128 && !/[\u0000-\u001F\u007F]/.test(password);
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

const DONATION_STATUS_LABELS = Object.freeze({
  pending: "قيد المراجعة",
  approved: "متاح",
  rejected: "مرفوض",
  in_progress: "قيد التوزيع",
  distributed: "تم التوزيع",
});
const DONATION_STATUSES = new Set(Object.keys(DONATION_STATUS_LABELS));

function normalizeDonationText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function donationInput(body) {
  const quantity = Number.parseInt(body?.quantity, 10);
  return {
    title: normalizeDonationText(body?.title, 120),
    description: normalizeDonationText(body?.description, 2000),
    category: normalizeDonationText(body?.category, 60),
    quantity,
    unit: normalizeDonationText(body?.unit, 40),
    condition: normalizeDonationText(body?.condition || body?.itemCondition || "حالة قياسية", 80),
    warehouse: normalizeDonationText(body?.warehouse || "المخزن العام", 160),
    location: normalizeDonationText(body?.location, 80),
  };
}

function isValidDonationInput(input) {
  return input.title.length >= 2 && input.description.length <= 2000 &&
    input.category.length >= 2 && Number.isInteger(input.quantity) && input.quantity > 0 && input.quantity <= 100000 &&
    input.unit.length >= 1 && input.condition.length >= 2 && input.warehouse.length >= 2 && input.location.length >= 2;
}

app.get("/api/donations", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.title, d.description AS "desc", d.category, d.quantity AS qty,
              d.unit, d.item_condition AS condition, d.warehouse, d.location,
              d.status, d.created_at AS "createdAt", d.donor_id AS "donorId",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS donor
       FROM donation_requests d
       JOIN users u ON u.id = d.donor_id
       WHERE d.status IN ('approved', 'in_progress', 'distributed') OR d.donor_id = $1
       ORDER BY d.created_at DESC`,
      [req.user.id || 0],
    );
    return res.json({
      donations: result.rows.map(donation => ({
        ...donation,
        status: DONATION_STATUS_LABELS[donation.status] || donation.status,
        qty: `${donation.qty} ${donation.unit}`,
        date: new Date(donation.createdAt).toLocaleDateString("ar-EG"),
      })),
    });
  } catch {
    return res.status(503).json({ message: "Donations are temporarily unavailable." });
  }
});

app.post("/api/donations", requireAuth, requireCsrf, async (req, res) => {
  if (req.user.role !== "donor" || !req.user.id) {
    return res.status(403).json({ message: "Only donors can submit donations." });
  }
  const input = donationInput(req.body);
  if (!isValidDonationInput(input)) {
    return res.status(400).json({ message: "Please provide valid donation details." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO donation_requests
        (donor_id, title, description, category, quantity, unit, item_condition, warehouse, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, description AS "desc", category, quantity AS qty, unit,
                 item_condition AS condition, warehouse, location, status, created_at AS "createdAt"`,
      [req.user.id, input.title, input.description, input.category, input.quantity, input.unit, input.condition, input.warehouse, input.location],
    );
    await recordAuditEvent(req, { userId: req.user.id, action: "donation_submitted", metadata: { donationId: result.rows[0].id } });
    return res.status(201).json({ donation: { ...result.rows[0], status: DONATION_STATUS_LABELS.pending } });
  } catch {
    return res.status(503).json({ message: "Donation submission is temporarily unavailable." });
  }
});

app.get("/api/admin/donations", requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.title, d.description AS desc, d.category, d.quantity AS qty,
              d.unit, d.item_condition AS condition, d.warehouse, d.location,
              d.status AS "approvalStatus", d.created_at AS "createdAt",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS donor
       FROM donation_requests d
       JOIN users u ON u.id = d.donor_id
       ORDER BY d.created_at DESC`,
    );
    return res.json({ donations: result.rows });
  } catch {
    return res.status(503).json({ message: "Donation requests are temporarily unavailable." });
  }
});

app.patch("/api/admin/donations/:id/status", requireAdmin, requireCsrf, async (req, res) => {
  const donationId = Number.parseInt(req.params.id, 10);
  const status = String(req.body?.status || "").trim();
  if (!Number.isInteger(donationId) || !DONATION_STATUSES.has(status) || status === "pending") {
    return res.status(400).json({ message: "Please provide a valid donation status." });
  }
  try {
    const result = await pool.query(
      `UPDATE donation_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id, status`,
      [status, req.user.id || null, donationId],
    );
    if (!result.rows[0]) return res.status(404).json({ message: "Donation request not found." });
    await recordAuditEvent(req, { userId: req.user.id, action: "donation_status_changed", metadata: { donationId, status } });
    return res.json({ donation: { id: donationId, status: DONATION_STATUS_LABELS[status] } });
  } catch {
    return res.status(503).json({ message: "Donation status could not be updated." });
  }
});

app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  try {
    const result = await pool.query(
      `SELECT a.id, a.action, a.success, a.ip_address AS "ipAddress",
              a.created_at AS "createdAt", a.user_id AS "userId",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "userName"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return res.json({ logs: result.rows });
  } catch {
    return res.status(503).json({ message: "Audit logs are temporarily unavailable." });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const signupKey = `signup:${req.ip || "unknown"}`;
  if (isRateLimited(signupAttempts, signupKey, SIGNUP_MAX_ATTEMPTS)) {
    res.setHeader("Retry-After", String(Math.ceil(SIGNUP_WINDOW_MS / 1000)));
    return res.status(429).json({ message: "Too many signup attempts. Please try again later." });
  }
  recordRateLimitAttempt(signupAttempts, signupKey, SIGNUP_WINDOW_MS);

  const firstName = normalizeNamePart(req.body?.firstName);
  const lastName = normalizeNamePart(req.body?.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "")
    .trim()
    .toLowerCase();
  const donorType = String(req.body?.donorType || "individual")
    .trim()
    .toLowerCase();
  const organizationName = String(req.body?.organizationName || "").trim();

  if (
    !isValidNamePart(firstName) ||
    !isValidNamePart(lastName) ||
    !isValidEmail(email) ||
    !isValidPhone(phone) ||
    !isValidPassword(password) ||
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
    await recordAuditEvent(req, { userId: user.id, action: "signup_success", metadata: { role: user.role } });
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

app.get("/api/auth/sessions", requireAuth, async (req, res) => {
  const currentToken = parseCookies(req)[SESSION_COOKIE];
  const currentTokenHash = currentToken ? hashSessionToken(currentToken) : "";
  try {
    const result = await pool.query(
      `SELECT token_hash AS "sessionId", created_at AS "createdAt",
              last_seen_at AS "lastSeenAt", expires_at AS "expiresAt",
              remember_me AS "rememberMe",
              token_hash = $1 AS "current"
       FROM user_sessions
       WHERE (user_id = $2)
          OR (user_id IS NULL AND role = $3 AND email = $4)
       ORDER BY last_seen_at DESC`,
      [currentTokenHash, req.user.id || null, req.user.role, req.user.email],
    );
    return res.json({
      sessions: result.rows.map(({ sessionId: _sessionId, ...session }) => session),
    });
  } catch (error) {
    console.error("Session listing failed:", error);
    return res.status(503).json({ message: "Sessions are temporarily unavailable." });
  }
});

app.post("/api/auth/sessions/revoke-others", requireAuth, requireCsrf, async (req, res) => {
  const currentToken = parseCookies(req)[SESSION_COOKIE];
  const currentTokenHash = currentToken ? hashSessionToken(currentToken) : "";
  try {
    const result = await pool.query(
      `DELETE FROM user_sessions
       WHERE token_hash <> $1
         AND ((user_id = $2) OR (user_id IS NULL AND role = $3 AND email = $4))`,
      [currentTokenHash, req.user.id || null, req.user.role, req.user.email],
    );
    await recordAuditEvent(req, { userId: req.user.id, action: "sessions_revoke_others", metadata: { revoked: result.rowCount } });
    return res.json({ revoked: result.rowCount });
  } catch (error) {
    console.error("Other-session revocation failed:", error);
    return res.status(503).json({ message: "Other sessions could not be revoked." });
  }
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
  const firstName = normalizeNamePart(req.body?.firstName);
  const lastName = normalizeNamePart(req.body?.lastName);
  const phone = normalizePhone(req.body?.phone);
  if (!isValidNamePart(firstName) || !isValidNamePart(lastName)) {
    return res.status(400).json({ message: "Please enter a valid first and last name." });
  }
  if (!isValidPhone(phone, { optional: true })) {
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
    await recordAuditEvent(req, { userId: req.user.id, action: "profile_updated" });
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
  if (!isValidPassword(newPassword)) return res.status(400).json({ message: "The new password must be between 8 and 128 characters." });
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
    await recordAuditEvent(req, { userId: req.user.id, action: "password_changed" });
    return res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Password update failed:", error);
    return res.status(503).json({ message: "Password update is temporarily unavailable." });
  }
});

app.post("/api/auth/logout", requireAuth, requireCsrf, async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
  await recordAuditEvent(req, { userId: req.user.id, action: "logout_success" });
  res.setHeader("Set-Cookie", cookieOptions(0));
  return res.json({ success: true });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const genericMessage = "If an account exists for this email, a reset link has been created.";
  const forgotKey = `${req.ip || "unknown"}:${email}`;
  if (isRateLimited(forgotPasswordAttempts, forgotKey, FORGOT_PASSWORD_MAX_ATTEMPTS)) {
    res.setHeader("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    return res.json({ message: genericMessage });
  }
  recordRateLimitAttempt(forgotPasswordAttempts, forgotKey);
  if (!isValidEmail(email)) return res.json({ message: genericMessage });

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) return res.json({ message: genericMessage });

    for (const [tokenHash, record] of resetTokens) {
      if (record.userId === user.id) resetTokens.delete(tokenHash);
    }

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
  const resetKey = `reset:${req.ip || "unknown"}`;
  if (isRateLimited(resetPasswordAttempts, resetKey, RESET_PASSWORD_MAX_ATTEMPTS)) {
    res.setHeader("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    return res.status(429).json({ message: "Too many password reset attempts. Please try again later." });
  }
  recordRateLimitAttempt(resetPasswordAttempts, resetKey);

  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = String(req.body?.confirmPassword || "");
  if (!isValidPassword(newPassword)) return res.status(400).json({ message: "The new password must be between 8 and 128 characters." });
  if (newPassword !== confirmPassword) return res.status(400).json({ message: "Password confirmation does not match." });

  const tokenHash = hashSessionToken(token);
  const record = resetTokens.get(tokenHash);
  if (!record || record.expiresAt <= Date.now()) {
    resetTokens.delete(tokenHash);
    return res.status(400).json({ message: "This reset link is invalid or has expired." });
  }
  // Consume the token before asynchronous work to prevent concurrent reuse.
  resetTokens.delete(tokenHash);

  try {
    const passwordHash = await hashPassword(newPassword);
    const result = await pool.query(
      "UPDATE users SET password_hash = $1, password = $1 WHERE id = $2 RETURNING id",
      [passwordHash, record.userId],
    );
    if (!result.rows[0]) return res.status(400).json({ message: "This reset link is invalid or has expired." });
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [record.userId]);
    await recordAuditEvent(req, { userId: record.userId, action: "password_reset_success" });
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
    await recordAuditEvent(req, { action: "login_success", metadata: { role: "admin" } });
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
      await recordAuditEvent(req, { action: "login_failed", success: false });
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
    await recordAuditEvent(req, { userId: user.id, action: "login_success", metadata: { role: user.role } });
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

let httpServer;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(sessionCleanup);
  console.log(`SANAD shutting down after ${signal}.`);
  await new Promise(resolve => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
  });
  await pool.end();
}

process.once("SIGINT", () => shutdown("SIGINT").catch(() => process.exitCode = 1));
process.once("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exitCode = 1));

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

  httpServer = app.listen(port, () => {
    console.log(`SANAD running at http://localhost:${port}`);
  });
}

start();
