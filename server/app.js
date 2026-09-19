import path from "node:path";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";
import { sendVerificationEmail } from "./email-service.js";
import {
  createChallenge,
  createOtpAuthUri,
  createRecoveryCodes,
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  MFA_MAX_ATTEMPTS,
  verifyTotpCode,
} from "./mfa-service.js";
import {
  addBeneficiary,
  addDistribution,
  addInventoryItem,
  addNeed,
  approveOrRejectDonation,
  changeDistributionStatus,
  createAssistanceRequestService,
  deleteAllBeneficiaries,
  deleteBeneficiariesByIds,
  deleteSingleBeneficiary,
  editBeneficiary,
  editInventoryItem,
  editNeed,
  evaluateAndSaveRecommendation,
  getAssistanceRequestsService,
  getBeneficiaries,
  getBeneficiary,
  getBeneficiaryProfileId,
  getBeneficiaryRecommendation,
  getBeneficiaryVerification,
  getDistribution,
  getDistributions,
  getDistributionStatsService,
  getInventory,
  getMyAssistanceRequestsService,
  getNeeds,
  reviewAssistanceRequestService,
  searchVerification,
  getDashboardSummary,
  getOperationalReports,
  getOperationalNotifications,
} from "./operations-service.js";
import { extractCaseNotes } from "./ai-service.js";
import {
  authenticateUser,
  authenticateUserById,
  countChallengeAttempt,
  changeUserPassword,
  editUserProfile,
  getUserIdByEmail,
  getUserPasswordRecord,
  getUserProfile,
  finishMfaChallenge,
  getChallenge,
  getMfaSettings,
  registerUser,
  issueEmailVerificationToken,
  removeMfaSettings,
  saveMfaSettings,
  startMfaChallenge,
  useRecoveryCode,
  verifyEmailToken,
  changeUserRole,
  getAllUsers,
} from "./user-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
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
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === "true";

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

function verificationUrl(req, token) {
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
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
            s.last_seen_at AS "lastSeenAt", s.expires_at AS "expiresAt",
            u.email_verified_at IS NOT NULL AS "emailVerified"
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
  "/verify-email": "verify-email",
  "/profile": "profile",
  "/dashboard": "dashboard",
  "/donations": "donations",
  "/admin-requests": "AdminRequests",
  "/inventory": "inventory",
  "/beneficiaries": "beneficiaries",
  "/distributions": "distributions",
  "/verification": "verification",
  "/request-assistance": "request-assistance",
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

function isValidNationalId(value) {
  return /^\d{14}$/.test(String(value || "").trim());
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

// Donor-facing labels for the "My Donations" view. These mirror the actual
// database status (pending/approved/rejected/...) so the donor always sees the
// real review outcome from the admin.
const MY_DONATION_STATUS_LABELS = Object.freeze({
  pending: "قيد المراجعة",
  approved: "مقبول",
  rejected: "مرفوض",
  in_progress: "قيد التوزيع",
  distributed: "تم التوزيع",
});

const ASSISTANCE_STATUS_LABELS = Object.freeze({
  pending: "قيد المراجعة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  fulfilled: "تم التنفيذ",
});
const ASSISTANCE_STATUSES = new Set(Object.keys(ASSISTANCE_STATUS_LABELS));

function normalizeDonationText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function donationInput(body) {
  const quantity = Number.parseInt(body?.quantity, 10);
  const receivedAt = body?.receivedAt || body?.received_at;
  const expirationDate = body?.expirationDate || body?.expiration_date;
  return {
    title: normalizeDonationText(body?.title, 120),
    description: normalizeDonationText(body?.description, 2000),
    category: normalizeDonationText(body?.category, 60),
    quantity,
    unit: normalizeDonationText(body?.unit, 40),
    condition: normalizeDonationText(body?.condition || body?.itemCondition || "حالة قياسية", 80),
    warehouse: normalizeDonationText(body?.warehouse || "المخزن العام", 160),
    location: normalizeDonationText(body?.location, 80),
    notes: normalizeDonationText(body?.notes, 2000),
    receivedAt: receivedAt && isValidIsoDateTime(receivedAt) ? new Date(receivedAt).toISOString() : null,
    expirationDate: expirationDate && isValidIsoDate(expirationDate) ? expirationDate : null,
  };
}

function isValidDonationInput(input) {
  return input.title.length >= 2 && input.description.length <= 2000 &&
    input.category.length >= 2 && Number.isInteger(input.quantity) && input.quantity > 0 && input.quantity <= 100000 &&
    input.unit.length >= 1 && input.condition.length >= 2 && input.warehouse.length >= 2 && input.location.length >= 2;
}

const operationError = (error, res) => {
  const messages = {
    INVALID_INVENTORY: "يرجى تقديم تفاصيل صحيحة للمخزون.",
    INVALID_INVENTORY_STATUS: "يرجى تقديم حالة مخزون صحيحة.",
    INVALID_NEED: "يرجى تقديم تفاصيل صحيحة لاحتياجات المستفيد.",
    INVALID_NEED_PRIORITY: "يرجى تقديم أولوية احتياجات صحيحة.",
    INVALID_NEED_STATUS: "يرجى تقديم حالة احتياجات صحيحة.",
    INVALID_DISTRIBUTION: "يرجى تقديم تفاصيل توزيع صحيحة.",
    DUPLICATE_DISTRIBUTION_ITEM: "يجب أن يظهر كل عنصر من عناصر المخزون مرة واحدة فقط في التوزيع.",
    INVALID_DISTRIBUTION_STATUS: "يرجى تقديم حالة توزيع صحيحة.",
    INVALID_DISTRIBUTION_TRANSITION: "لا يمكن تغيير حالة هذا التوزيع بعد الآن.",
    INSUFFICIENT_INVENTORY: "الكمية المطلوبة غير متوفرة في المخزون.",
    CANNOT_REVERT_DISTRIBUTED_DONATION: "لا يمكن إلغاء أو تعديل تبرع تم توزيع أجزاء منه في المخزون بالفعل.",
    INVALID_BENEFICIARY_NAME: "يرجى تقديم اسم مستفيد صحيح.",
    INVALID_VERIFICATION_STATUS: "يرجى تقديم حالة تحقق صحيحة.",
    INVALID_NATIONAL_ID: "الرقم القومي يجب أن يتكون من 14 رقماً ولا يقبل الحروف أو الرموز.",
    BENEFICIARY_NOT_FOUND: "لم يتم العثور على ملف المستفيد.",
  };
  if (error.code === "INSUFFICIENT_STOCK") {
    return res.status(409).json({ message: error.message, details: error.details });
  }
  if (error.statusCode) {
    return res.status(error.statusCode).json({ message: error.message, details: error.details });
  }
  if (error.message === "BENEFICIARY_NOT_FOUND") return res.status(404).json({ message: messages.BENEFICIARY_NOT_FOUND });
  const message = messages[error.message];
  if (message) return res.status(["INSUFFICIENT_INVENTORY", "CANNOT_REVERT_DISTRIBUTED_DONATION"].includes(error.message) ? 409 : 400).json({ message });
  console.error("Operations API failed:", error);
  return res.status(503).json({ message: "العملية المطلوبة غير متاحة مؤقتاً." });
};

app.get("/api/inventory", requireAuth, async (req, res) => {
  try { return res.json({ items: await getInventory(req.query) }); } catch (error) { return operationError(error, res); }
});

app.post("/api/admin/inventory", requireAdmin, requireCsrf, async (req, res) => {
  try {
    const item = await addInventoryItem(req.body, req.user.id);
    await recordAuditEvent(req, { userId: req.user.id, action: "inventory_item_created", metadata: { inventoryItemId: item.id } });
    return res.status(201).json({ item });
  } catch (error) { return operationError(error, res); }
});

app.patch("/api/admin/inventory/:id", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم عنصر مخزون صحيح." });
  try {
    const item = await editInventoryItem(id, req.body);
    if (!item) return res.status(404).json({ message: "لم يتم العثور على عنصر المخزون." });
    await recordAuditEvent(req, { userId: req.user.id, action: "inventory_item_updated", metadata: { inventoryItemId: id } });
    return res.json({ item });
  } catch (error) { return operationError(error, res); }
});

app.get("/api/beneficiaries", requireAdmin, async (req, res) => {
  try {
    const beneficiaries = await getBeneficiaries(req.query);
    return res.json({ beneficiaries });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/beneficiaries/:id", requireAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const beneficiary = await getBeneficiary(targetId);
    if (!beneficiary) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    if (req.user.role !== "admin" && req.user.id !== beneficiary.userId) {
      return res.status(403).json({ message: "غير مصرح لك بعرض هذا الملف الشخصي للمستفيد." });
    }
    return res.json({ beneficiary });
  } catch (error) {
    return operationError(error, res);
  }
});

app.post("/api/beneficiaries", requireAdmin, requireCsrf, async (req, res) => {
  try {
    const beneficiary = await addBeneficiary(req.body, req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiary_created",
      metadata: { beneficiaryId: beneficiary.id, referenceCode: beneficiary.referenceCode },
    });
    return res.status(201).json({ beneficiary });
  } catch (error) {
    return operationError(error, res);
  }
});

app.patch("/api/beneficiaries/:id", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  try {
    const updated = await editBeneficiary(id, req.body, req.user.id);
    if (!updated) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiary_updated",
      metadata: { beneficiaryId: id },
    });
    return res.json({ beneficiary: updated });
  } catch (error) {
    return operationError(error, res);
  }
});

app.patch("/api/beneficiaries/:id/verification", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  const status = String(req.body?.status || "").trim();
  if (!["pending", "verified", "rejected", "needs_review"].includes(status)) {
    return res.status(400).json({ message: "يرجى تقديم حالة تحقق صحيحة." });
  }
  try {
    const updated = await editBeneficiary(id, { verificationStatus: status, notes: req.body?.notes }, req.user.id);
    if (!updated) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiary_verification_changed",
      metadata: { beneficiaryId: id, status },
    });
    return res.json({ beneficiary: updated });
  } catch (error) {
    return operationError(error, res);
  }
});

app.delete("/api/beneficiaries/bulk", requireAdmin, requireCsrf, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ message: "يرجى اختيار مستفيد واحد على الأقل." });
    const result = await deleteBeneficiariesByIds(ids, req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiaries_deleted",
      metadata: {
        count: result.deleted,
        deletedIds: result.deletedIds,
        blocked: result.blocked.map(({ id, distributionsCount, referenceCode }) => ({ id, distributionsCount, referenceCode })),
      },
    });
    return res.json(result);
  } catch (error) {
    return operationError(error, res);
  }
});

app.delete("/api/beneficiaries/all", requireAdmin, requireCsrf, async (req, res) => {
  try {
    const result = await deleteAllBeneficiaries(req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiaries_all_deleted",
      metadata: { count: result.deleted, deletedIds: result.deletedIds, blocked: result.blocked.length },
    });
    return res.json(result);
  } catch (error) {
    return operationError(error, res);
  }
});

app.delete("/api/beneficiaries/:id", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  try {
    const result = await deleteSingleBeneficiary(id, req.user.id);
    if (!result.deleted && (result.blocked?.length || 0) > 0) {
      const blocked = result.blocked[0];
      return res.status(409).json({
        message: `لا يمكن حذف المستفيد لأن لديه ${blocked.distributionsCount} سجل توزيع مرتبط.`,
        ...result,
      });
    }
    if (!result.deleted) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد.", ...result });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiary_deleted",
      metadata: { count: result.deleted, deletedIds: result.deletedIds },
    });
    return res.json(result);
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/beneficiaries/:id/recommendation", requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  try {
    const recommendation = await getBeneficiaryRecommendation(id, req.user.id, false);
    if (!recommendation) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    return res.json({ recommendation });
  } catch (error) {
    return operationError(error, res);
  }
});

app.post("/api/beneficiaries/:id/recommendation/refresh", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  try {
    const recommendation = await evaluateAndSaveRecommendation(id, req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "beneficiary_recommendation_refreshed",
      metadata: { beneficiaryId: id, priorityLevel: recommendation.priority_level },
    });
    return res.json({ recommendation });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/verification/search", requireAdmin, async (req, res) => {
  try {
    const query = String(req.query?.q || "").trim();
    const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 20, 1), 50);
    const results = await searchVerification(query, limit);
    return res.json({ results });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/verification/:id", requireAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم مستفيد صحيح." });
  try {
    const verification = await getBeneficiaryVerification(id, req.user.id);
    if (!verification) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    return res.json({ verification });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/beneficiary/needs", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "admin") return res.json({ needs: await getNeeds(req.query) });
    if (req.user.role !== "beneficiary") return res.status(403).json({ message: "المستفيدين فقط هم من يمكنهم الوصول إلى احتياجات المستفيدين." });
    const beneficiaryId = await getBeneficiaryProfileId(req.user.id);
    if (!beneficiaryId) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    return res.json({ needs: await getNeeds({ ...req.query, beneficiaryId }) });
  } catch (error) { return operationError(error, res); }
});

app.post("/api/beneficiary/needs", requireAuth, requireCsrf, async (req, res) => {
  if (req.user.role !== "beneficiary" && req.user.role !== "admin") {
    return res.status(403).json({ message: "المستفيدين فقط هم من يمكنهم إنشاء احتياجات." });
  }
  try {
    const beneficiaryId = req.user.role === "admin"
      ? (Number(req.body?.beneficiaryId) || null)
      : await getBeneficiaryProfileId(req.user.id);
    if (!beneficiaryId) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    const need = await addNeed(req.body, beneficiaryId);
    await recordAuditEvent(req, { userId: req.user.id, action: "beneficiary_need_created", metadata: { needId: need.id } });
    return res.status(201).json({ need });
  } catch (error) { return operationError(error, res); }
});

app.patch("/api/beneficiary/needs/:id", requireAuth, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم حاجة مستفيد صحيحة." });
  try {
    const beneficiaryId = req.user.role === "admin" ? null : await getBeneficiaryProfileId(req.user.id);
    if (req.user.role !== "admin" && (!beneficiaryId || req.user.role !== "beneficiary")) return res.status(403).json({ message: "غير مصرح لك بتحديث هذا الاحتياج." });
    const need = await editNeed(id, req.body, beneficiaryId);
    if (!need) return res.status(404).json({ message: "لم يتم العثور على حاجة المستفيد." });
    await recordAuditEvent(req, { userId: req.user.id, action: "beneficiary_need_updated", metadata: { needId: id } });
    return res.json({ need });
  } catch (error) { return operationError(error, res); }
});

app.get("/api/distributions/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await getDistributionStatsService();
    return res.json({ stats });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/distributions", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const result = await getDistributions(req.query);
      return res.json(result);
    }
    if (req.user.role !== "beneficiary") return res.status(403).json({ message: "المستفيدين فقط هم من يمكنهم الوصول إلى التوزيعات." });
    const beneficiaryId = await getBeneficiaryProfileId(req.user.id);
    if (!beneficiaryId) return res.status(404).json({ message: "لم يتم العثور على ملف المستفيد." });
    const result = await getDistributions({ ...req.query, beneficiaryId });
    return res.json(result);
  } catch (error) { return operationError(error, res); }
});

app.get("/api/distributions/:id", requireAuth, async (req, res) => {
  try {
    const distribution = await getDistribution(req.params.id);
    if (!distribution) return res.status(404).json({ message: "لم يتم العثور على التوزيع." });
    if (req.user.role !== "admin") {
      const beneficiaryId = await getBeneficiaryProfileId(req.user.id);
      if (!beneficiaryId || beneficiaryId !== distribution.beneficiaryId) {
        return res.status(403).json({ message: "غير مصرح لك بعرض هذا التوزيع." });
      }
    }
    return res.json({ distribution });
  } catch (error) { return operationError(error, res); }
});

app.post(["/api/distributions", "/api/admin/distributions"], requireAdmin, requireCsrf, async (req, res) => {
  try {
    const distribution = await addDistribution(req.body, req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "distribution_created",
      metadata: { distributionId: distribution.id, referenceCode: distribution.referenceCode },
    });
    return res.status(201).json({ distribution });
  } catch (error) { return operationError(error, res); }
});

app.post("/api/distributions/:id/cancel", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم توزيع صحيح." });
  try {
    const distribution = await changeDistributionStatus(id, req.user.id, req.body?.reason || "");
    return res.json({ distribution, message: "تم إلغاء التوزيع بنجاح." });
  } catch (error) { return operationError(error, res); }
});

app.patch("/api/admin/distributions/:id/status", requireAdmin, requireCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "يرجى تقديم رقم توزيع صحيح." });
  try {
    const updated = await changeDistributionStatus(id, req.user.id, String(req.body?.status || ""));
    if (updated === null) return res.status(404).json({ message: "لم يتم العثور على التوزيع." });
    await recordAuditEvent(req, { userId: req.user.id, action: "distribution_status_changed", metadata: { distributionId: id, status: req.body?.status } });
    return res.json({ message: "تم تحديث حالة التوزيع." });
  } catch (error) { return operationError(error, res); }
});

// ============================================================================
// Phase 7: AI-Assisted Case Note Extraction
// ============================================================================
app.post("/api/ai/analyze", requireAdmin, requireCsrf, async (req, res) => {
  try {
    const rawNotes = req.body?.notes ?? req.body?.text;
    const forceHeuristic = req.body?.forceHeuristic === true;
    const result = await extractCaseNotes(rawNotes, { forceHeuristic });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "ai_case_note_extracted",
      metadata: {
        provider: result.provider,
        hasName: Boolean(result.data?.name),
        familySize: result.data?.familySize,
        needsCount: result.data?.needs?.length || 0,
      },
    });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return operationError(error, res);
  }
});

app.get("/api/donations", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.reference_code AS "referenceCode", d.title, d.description AS "desc", d.category, d.quantity AS qty,
              d.unit, d.item_condition AS condition, d.warehouse, d.location,
              d.status, d.notes, d.received_at AS "receivedAt", d.expiration_date AS "expirationDate",
              d.created_at AS "createdAt", d.donor_id AS "donorId",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS donor
       FROM donation_requests d
       JOIN users u ON u.id = d.donor_id
       WHERE d.status IN ('approved', 'in_progress', 'distributed')
       ORDER BY d.created_at DESC`,
    );
    return res.json({
      donations: result.rows.map(donation => ({
        ...donation,
        referenceCode: donation.referenceCode || `DON-${String(donation.id).padStart(4, "0")}`,
        status: DONATION_STATUS_LABELS[donation.status] || donation.status,
        qty: `${donation.qty} ${donation.unit}`,
        date: new Date(donation.createdAt).toLocaleDateString("ar-EG"),
        receivedDate: donation.receivedAt ? new Date(donation.receivedAt).toLocaleDateString("ar-EG") : null,
        expirationDate: donation.expirationDate || null,
      })),
    });
  } catch {
    return res.status(503).json({ message: "Donations are temporarily unavailable." });
  }
});

app.get("/api/donations/my", requireAuth, async (req, res) => {
  if (req.user.role !== "donor") {
    return res.status(403).json({ message: "المتبرعين فقط هم من يمكنهم عرض تبرعاتهم." });
  }
  try {
    const result = await pool.query(
      `SELECT d.id, d.reference_code AS "referenceCode", d.title, d.description AS "desc", d.category,
              d.quantity AS qty, d.unit, d.item_condition AS condition, d.warehouse, d.location,
              d.status, d.notes, d.received_at AS "receivedAt", d.expiration_date AS "expirationDate",
              d.created_at AS "createdAt"
       FROM donation_requests d
       WHERE d.donor_id = $1
       ORDER BY d.created_at DESC`,
      [req.user.id],
    );
    return res.json({
      donations: result.rows.map(donation => ({
        ...donation,
        referenceCode: donation.referenceCode || `DON-${String(donation.id).padStart(4, "0")}`,
        statusKey: donation.status,
        status: MY_DONATION_STATUS_LABELS[donation.status] || donation.status,
        qtyLabel: `${donation.qty} ${donation.unit}`,
        date: new Date(donation.createdAt).toLocaleDateString("ar-EG"),
        receivedDate: donation.receivedAt ? new Date(donation.receivedAt).toLocaleDateString("ar-EG") : null,
        expirationDate: donation.expirationDate || null,
      })),
    });
  } catch {
    return res.status(503).json({ message: "Donations are temporarily unavailable." });
  }
});

app.post("/api/donations", requireAuth, requireCsrf, async (req, res) => {
  if (req.user.role !== "donor" || !req.user.id) {
    return res.status(403).json({
      message: "لا يمكنك تسجيل تبرع لأن حسابك مسجل كمستفيد، وليس كمتبرع.",
      code: "BENEFICIARY_DONATION_FORBIDDEN",
    });
  }
  const input = donationInput(req.body);
  if (!isValidDonationInput(input)) {
    return res.status(400).json({ message: "Please provide valid donation details." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO donation_requests
        (donor_id, title, description, category, quantity, unit, item_condition, warehouse, location, notes, received_at, expiration_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, reference_code AS "referenceCode", title, description AS "desc", category, quantity AS qty, unit,
                 item_condition AS condition, warehouse, location, notes, received_at AS "receivedAt",
                 expiration_date AS "expirationDate", status, created_at AS "createdAt"`,
      [req.user.id, input.title, input.description, input.category, input.quantity, input.unit, input.condition, input.warehouse, input.location, input.notes, input.receivedAt, input.expirationDate],
    );
    const row = result.rows[0];
    const referenceCode = row.referenceCode || `DON-${String(row.id).padStart(4, "0")}`;
    await recordAuditEvent(req, { userId: req.user.id, action: "donation_submitted", metadata: { donationId: row.id, referenceCode } });
    return res.status(201).json({
      donation: {
        ...row,
        referenceCode,
        status: DONATION_STATUS_LABELS.pending,
      },
    });
  } catch {
    return res.status(503).json({ message: "Donation submission is temporarily unavailable." });
  }
});

app.get("/api/admin/donations", requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.reference_code AS "referenceCode", d.title, d.description AS desc, d.category, d.quantity AS qty,
              d.unit, d.item_condition AS condition, d.warehouse, d.location,
              d.status AS "approvalStatus", d.notes, d.received_at AS "receivedAt", d.expiration_date AS "expirationDate",
              d.created_at AS "createdAt",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS donor
       FROM donation_requests d
       JOIN users u ON u.id = d.donor_id
       ORDER BY d.created_at DESC`,
    );
    return res.json({
      donations: result.rows.map(donation => ({
        ...donation,
        referenceCode: donation.referenceCode || `DON-${String(donation.id).padStart(4, "0")}`,
      })),
    });
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
    const outcome = await approveOrRejectDonation(donationId, status, req.user.id);
    if (!outcome || !outcome.donation) return res.status(404).json({ message: "Donation request not found." });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "donation_status_changed",
      metadata: { donationId, status, inventoryItemId: outcome.inventoryItemId },
    });
    return res.json({
      donation: {
        id: donationId,
        referenceCode: outcome.donation.referenceCode || `DON-${String(donationId).padStart(4, "0")}`,
        status: DONATION_STATUS_LABELS[status],
        inventoryItemId: outcome.inventoryItemId || null,
      },
    });
  } catch (error) {
    return operationError(error, res);
  }
});

// ============================================================================
// Assistance Requests (طلب مساعدة) — beneficiary self-service requests
// ============================================================================

function mapAssistanceRequest(row) {
  if (!row) return row;
  return {
    ...row,
    referenceCode: row.referenceCode || `REQ-${String(row.id).padStart(4, "0")}`,
    statusLabel: ASSISTANCE_STATUS_LABELS[row.status] || row.status,
    date: row.createdAt ? new Date(row.createdAt).toLocaleDateString("ar-EG") : "—",
    reviewedDate: row.reviewedAt ? new Date(row.reviewedAt).toLocaleDateString("ar-EG") : null,
  };
}

app.get("/api/assistance-requests", requireAdmin, async (req, res) => {
  try {
    const requests = await getAssistanceRequestsService({
      status: req.query?.status,
      search: req.query?.q,
    });
    return res.json({ requests: requests.map(mapAssistanceRequest) });
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/assistance-requests/my", requireAuth, async (req, res) => {
  if (req.user.role !== "beneficiary") {
    return res.status(403).json({ message: "المستفيدين فقط هم من يمكنهم إرسال طلبات المساعدة." });
  }
  try {
    const requests = await getMyAssistanceRequestsService(req.user.id);
    return res.json({ requests: requests.map(mapAssistanceRequest) });
  } catch (error) {
    return operationError(error, res);
  }
});

app.post("/api/assistance-requests", requireAuth, requireCsrf, async (req, res) => {
  if (req.user.role !== "beneficiary") {
    return res.status(403).json({ message: "المستفيدين فقط هم من يمكنهم إرسال طلبات المساعدة." });
  }
  try {
    const request = await createAssistanceRequestService(req.body, req.user.id);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "assistance_request_submitted",
      metadata: { requestId: request.id, referenceCode: request.referenceCode },
    });
    return res.status(201).json({ request: mapAssistanceRequest(request) });
  } catch (error) {
    if (error.code === "DUPLICATE_ASSISTANCE_REQUEST") {
      return res.status(error.statusCode || 409).json({
        message: error.message,
        code: error.code,
        details: error.details,
      });
    }
    if (error.code === "BENEFICIARY_PROFILE_NOT_FOUND" || error.code === "ASSISTANCE_USER_NOT_FOUND") {
      return res.status(error.statusCode || 404).json({ message: error.message });
    }
    if (error.code === "INVALID_ASSISTANCE_REQUEST") {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    return operationError(error, res);
  }
});

app.patch("/api/admin/assistance-requests/:id/status", requireAdmin, requireCsrf, async (req, res) => {
  const requestId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(requestId)) return res.status(400).json({ message: "يرجى تقديم رقم طلب مساعدة صحيح." });
  const status = String(req.body?.status || "").trim();
  if (!ASSISTANCE_STATUSES.has(status) || status === "pending") {
    return res.status(400).json({ message: "يرجى تقديم حالة صحيحة لطلب المساعدة." });
  }
  try {
    const updated = await reviewAssistanceRequestService(requestId, status, req.user.id);
    if (!updated) return res.status(404).json({ message: "لم يتم العثور على طلب المساعدة." });
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "assistance_request_status_changed",
      metadata: { requestId, status },
    });
    return res.json({ request: mapAssistanceRequest(updated), message: status === "approved" ? "تمت الموافقة على طلب المساعدة." : "تم تحديث حالة طلب المساعدة." });
  } catch (error) {
    if (error.code === "INVALID_ASSISTANCE_STATUS" || error.code === "INVALID_ASSISTANCE_TRANSITION") {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    return operationError(error, res);
  }
});

app.get("/api/dashboard/summary", requireAdmin, async (req, res) => {
  try {
    const summary = await getDashboardSummary();
    return res.json(summary);
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/reports/analytics", requireAdmin, async (req, res) => {
  try {
    const { from, to, category } = req.query;
    const reports = await getOperationalReports({
      from: from ? String(from).slice(0, 30) : null,
      to: to ? String(to).slice(0, 30) : null,
      category: category ? String(category).slice(0, 80) : null,
    });
    return res.json(reports);
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const notifications = await getOperationalNotifications();
    return res.json(notifications);
  } catch (error) {
    return operationError(error, res);
  }
});

app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const action = req.query.action ? String(req.query.action).trim().slice(0, 80) : null;
  try {
    const where = action ? "WHERE a.action = $2" : "";
    const params = action ? [limit, action] : [limit];
    const result = await pool.query(
      `SELECT a.id, a.action, a.success, a.ip_address AS "ipAddress",
              a.created_at AS "createdAt", a.user_id AS "userId",
              COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "userName"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $1`,
      params,
    );
    return res.json({ logs: result.rows });
  } catch {
    return res.status(503).json({ message: "Audit logs are temporarily unavailable." });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await getAllUsers({
      search: req.query.search,
      role: req.query.role,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ users });
  } catch (error) {
    console.error("Fetch admin users failed:", error);
    return res.status(503).json({ message: "Failed to load users." });
  }
});

app.patch("/api/admin/users/:id/role", requireAdmin, requireCsrf, async (req, res) => {
  const targetUserId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(targetUserId)) {
    return res.status(400).json({ message: "Invalid user ID." });
  }
  const role = String(req.body?.role || "").trim().toLowerCase();
  if (!["donor", "beneficiary", "admin"].includes(role)) {
    return res.status(400).json({ message: "Please select a valid role (donor, beneficiary, admin)." });
  }
  try {
    const updated = await changeUserRole(targetUserId, role, req.user.id, req.user.email);
    await recordAuditEvent(req, {
      userId: req.user.id,
      action: "user_role_changed",
      metadata: { targetUserId, newRole: role },
    });
    return res.json({ message: "User role updated successfully.", user: updated });
  } catch (error) {
    if (error.code === "CANNOT_DEMOTE_SELF") {
      return res.status(400).json({ message: "You cannot change the role of your own admin account." });
    }
    if (error.code === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found." });
    }
    console.error("Change user role failed:", error);
    return res.status(503).json({ message: "Failed to update user role." });
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
  const nationalId = String(req.body?.nationalId || "").trim();
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

  if (role === "beneficiary") {
    if (!isValidNationalId(nationalId)) {
      return res
        .status(400)
        .json({ message: "الرقم القومي يجب أن يتكون من 14 رقماً." });
    }
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

  try {
    const passwordHash = await hashPassword(password);
    const user = await registerUser({
      firstName,
      lastName,
      fullName,
      email,
      passwordHash,
      phone,
      role,
      nationalId,
      donorType,
      organizationName,
    });
    const verificationToken = randomBytes(32).toString("hex");
    await issueEmailVerificationToken(
      user.id,
      hashSessionToken(verificationToken),
      new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    );
    const verificationLink = verificationUrl(req, verificationToken);
    await sendVerificationEmail({ to: user.email, name: fullName, verificationUrl: verificationLink });
    if (!REQUIRE_EMAIL_VERIFICATION) {
      setSessionCookie(
        res,
        await createSession({ id: user.id, role: user.role, email: user.email, name: fullName }),
      );
    }
    await recordAuditEvent(req, { userId: user.id, action: "signup_success", metadata: { role: user.role } });
    return res.status(201).json({
      user: { ...user, emailVerified: false },
      verificationRequired: REQUIRE_EMAIL_VERIFICATION,
      ...(process.env.NODE_ENV !== "production" ? { verificationUrl: verificationLink } : {}),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ message: "This email is already registered." });
    }

    console.error("Signup failed:", error);
    return res
      .status(503)
      .json({ message: "Registration is temporarily unavailable." });
  }
});

app.get("/api/auth/verify-email", async (req, res) => {
  const token = String(req.query?.token || "");
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ message: "This verification link is invalid or has expired." });
  }
  try {
    const user = await verifyEmailToken(hashSessionToken(token));
    if (!user) return res.status(400).json({ message: "This verification link is invalid or has expired." });
    await recordAuditEvent(req, { userId: user.id, action: "email_verified" });
    return res.json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    console.error("Email verification failed:", error);
    return res.status(503).json({ message: "Email verification is temporarily unavailable." });
  }
});

app.post("/api/auth/resend-verification", requireAuth, requireCsrf, async (req, res) => {
  if (!req.user.id) return res.status(404).json({ message: "Profile not found." });
  try {
    const user = await getUserProfile(req.user.id);
    if (!user) return res.status(404).json({ message: "Profile not found." });
    const verificationToken = randomBytes(32).toString("hex");
    await issueEmailVerificationToken(
      user.id,
      hashSessionToken(verificationToken),
      new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    );
    const link = verificationUrl(req, verificationToken);
    await sendVerificationEmail({ to: user.email, name: resolveDisplayName(user), verificationUrl: link });
    return res.json({
      message: "A new verification link has been sent.",
      ...(process.env.NODE_ENV !== "production" ? { verificationUrl: link } : {}),
    });
  } catch (error) {
    console.error("Verification email resend failed:", error);
    return res.status(503).json({ message: "Verification email could not be sent." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
      name: req.user.name || req.user.email,
      emailVerified: Boolean(req.user.emailVerified),
    },

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

app.get("/api/profile/mfa", requireAuth, async (req, res) => {
  const settings = await getMfaSettings(req.user.id);
  return res.json({ enabled: Boolean(settings), enabledAt: settings?.enabled_at || null });
});

app.post("/api/profile/mfa/setup", requireAuth, requireCsrf, async (req, res) => {
  try {
    const existing = await getMfaSettings(req.user.id);
    if (existing?.enabled_at) return res.status(409).json({ message: "MFA is already enabled." });
    const secret = createTotpSecret();
    const recoveryCodes = createRecoveryCodes();
    const pendingToken = randomBytes(32).toString("hex");
    await startMfaChallenge(hashSessionToken(pendingToken), req.user.id, false, new Date(Date.now() + 10 * 60 * 1000));
    await saveMfaSettings(req.user.id, encryptSecret(`${pendingToken}:${secret}`), recoveryCodes.map(hashRecoveryCode));
    return res.json({ secret, otpauthUri: createOtpAuthUri(secret, req.user.email), recoveryCodes, setupToken: pendingToken });
  } catch (error) {
    console.error("MFA setup failed:", error);
    return res.status(503).json({ message: "MFA setup is temporarily unavailable." });
  }
});

app.post("/api/profile/mfa/enable", requireAuth, requireCsrf, async (req, res) => {
  const code = String(req.body?.code || "");
  const setupToken = String(req.body?.setupToken || "");
  try {
    const settings = await getMfaSettings(req.user.id);
    if (!settings || settings.enabled_at) return res.status(400).json({ message: "Start MFA setup first." });
    const setupChallenge = await getChallenge(hashSessionToken(setupToken));
    const combined = decryptSecret(settings.secret_ciphertext);
    const separator = combined.indexOf(":");
    const secret = combined.slice(separator + 1);
    if (!setupChallenge || new Date(setupChallenge.expires_at).getTime() <= Date.now() || combined.slice(0, separator) !== setupToken || !verifyTotpCode(secret, code)) {
      return res.status(400).json({ message: "The authenticator code is incorrect." });
    }
    await saveMfaSettings(req.user.id, encryptSecret(secret), settings.recovery_code_hashes, new Date());
    await finishMfaChallenge(setupChallenge.challenge_hash);
    await recordAuditEvent(req, { userId: req.user.id, action: "mfa_enabled" });
    return res.json({ message: "MFA enabled successfully." });
  } catch (error) {
    console.error("MFA enable failed:", error);
    return res.status(503).json({ message: "MFA could not be enabled." });
  }
});

app.post("/api/profile/mfa/disable", requireAuth, requireCsrf, async (req, res) => {
  const password = String(req.body?.password || "");
  try {
    const user = await getUserPasswordRecord(req.user.id);
    if (!user || !(await passwordMatches(password, user.password_hash || user.password))) {
      return res.status(401).json({ message: "The password is incorrect." });
    }
    await removeMfaSettings(req.user.id);
    await recordAuditEvent(req, { userId: req.user.id, action: "mfa_disabled" });
    return res.json({ message: "MFA disabled successfully." });
  } catch (error) {
    console.error("MFA disable failed:", error);
    return res.status(503).json({ message: "MFA could not be disabled." });
  }
});

app.get("/api/profile", requireAuth, async (req, res) => {
  if (!req.user.id) return res.status(404).json({ message: "Profile not found." });
  try {
    const user = await getUserProfile(req.user.id);
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
    const user = await editUserProfile({
      userId: req.user.id,
      firstName,
      lastName,
      fullName,
      phone,
    });
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
    const user = await getUserPasswordRecord(req.user.id);
    const storedHash = user?.password_hash || user?.password;
    if (!user || !(await passwordMatches(currentPassword, storedHash))) {
      return res.status(401).json({ message: "The current password is incorrect." });
    }
    const passwordHash = await hashPassword(newPassword);
    await changeUserPassword(req.user.id, passwordHash);
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
    const userId = await getUserIdByEmail(email);
    if (!userId) return res.json({ message: genericMessage });

    for (const [tokenHash, record] of resetTokens) {
      if (record.userId === userId) resetTokens.delete(tokenHash);
    }

    const token = randomBytes(32).toString("hex");
    resetTokens.set(hashSessionToken(token), {
      userId,
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
    const user = await changeUserPassword(record.userId, passwordHash);
    if (!user) return res.status(400).json({ message: "This reset link is invalid or has expired." });
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [record.userId]);
    await recordAuditEvent(req, { userId: record.userId, action: "password_reset_success" });
    return res.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Password reset failed:", error);
    return res.status(503).json({ message: "Password reset is temporarily unavailable." });
  }
});

app.post("/api/auth/mfa/verify", async (req, res) => {
  const challengeToken = String(req.body?.challengeToken || "");
  const code = String(req.body?.code || "");
  if (!/^[a-f0-9]{64}$/i.test(challengeToken)) return res.status(401).json({ message: "Invalid MFA challenge." });
  try {
    const challenge = await getChallenge(hashSessionToken(challengeToken));
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= MFA_MAX_ATTEMPTS) {
      return res.status(401).json({ message: "This MFA challenge is invalid or expired." });
    }
    const mfa = await getMfaSettings(challenge.user_id);
    const validTotp = mfa && verifyTotpCode(decryptSecret(mfa.secret_ciphertext), code);
    const validRecovery = mfa && !validTotp && await useRecoveryCode(challenge.user_id, hashRecoveryCode(code));
    if (!validTotp && !validRecovery) {
      const attempts = await countChallengeAttempt(challenge.challenge_hash);
      if (attempts >= MFA_MAX_ATTEMPTS) await finishMfaChallenge(challenge.challenge_hash);
      return res.status(401).json({ message: "The MFA code is incorrect." });
    }
    const user = await authenticateUserById(challenge.user_id);
    await finishMfaChallenge(challenge.challenge_hash);
    await rotateSession(req, res, {
      id: user.id, role: user.role, email: user.email, emailVerified: Boolean(user.email_verified_at),
      name: user.full_name, firstName: user.first_name, lastName: user.last_name,
    }, challenge.remember_me);
    await recordAuditEvent(req, { userId: user.id, action: "mfa_login_success", metadata: { recoveryCode: Boolean(validRecovery) } });
    return res.json({ role: user.role, user: { id: user.id, name: resolveDisplayName(user), email: user.email } });
  } catch (error) {
    console.error("MFA verification failed:", error);
    return res.status(503).json({ message: "MFA verification is temporarily unavailable." });
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
    const adminRecord = await pool.query("SELECT id FROM users WHERE email = $1", [email]).catch(() => null);
    const adminId = adminRecord?.rows?.[0]?.id || null;
    await rotateSession(req, res, { id: adminId, role: "admin", email, name: "المشرف" }, rememberMe);
    await recordAuditEvent(req, { userId: adminId, action: "login_success", metadata: { role: "admin" } });
    return res.json({ role: "admin" });
  }

  try {
    const user = await authenticateUser(email);

    if (!user || !(await passwordMatches(password, user.password_hash))) {
      recordLoginFailure(attemptKey);
      await recordAuditEvent(req, { action: "login_failed", success: false });
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (REQUIRE_EMAIL_VERIFICATION && !user.email_verified_at) {
      await recordAuditEvent(req, { action: "login_unverified_email", success: false });
      return res.status(403).json({ message: "Please verify your email before logging in." });
    }

    const mfa = await getMfaSettings(user.id);
    if (mfa?.enabled_at) {
      clearLoginFailures(attemptKey);
      const challenge = createChallenge();
      await startMfaChallenge(challenge.tokenHash, user.id, rememberMe, challenge.expiresAt);
      await recordAuditEvent(req, { userId: user.id, action: "mfa_challenge_created" });
      return res.status(202).json({ mfaRequired: true, challengeToken: challenge.token });
    }

    clearLoginFailures(attemptKey);
    await rotateSession(
      req,
      res,
      {
        id: user.id,
        role: user.role,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
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
  "/verification",
  "/request-assistance",
]);

function requireBeneficiary(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== "beneficiary") {
      if (req.path.startsWith("/api/"))
        return res.status(403).json({ message: "صفحة طلب المساعدة متاحة للمستفيدين فقط." });
      return res.status(403).render("errors/server-error", {
        message: "صفحة طلب المساعدة متاحة للمستفيدين فقط.",
      });
    }
    return next();
  });
}

for (const [route, page] of Object.entries(pageRoutes)) {
  const guard =
    route === "/admin-requests" || route === "/verification"
      ? requireAdmin
      : route === "/request-assistance"
        ? requireBeneficiary
        : protectedPages.has(route)
          ? requireAuth
          : (_req, _res, next) => next();
  app.get(route, guard, (req, res, next) => {
    res.render(`pages/${page}`, { currentPath: route, role: req.user?.role || null }, (error, html) => {
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

  httpServer = app.listen(port, host, () => {
    console.log(`SANAD running at http://localhost:${port}`);
  });
}

start();
