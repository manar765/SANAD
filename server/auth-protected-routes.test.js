import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { migrate } from "./database/schema.js";

const port = 3137;
const baseUrl = `http://127.0.0.1:${port}`;
const testSuffix = `${Date.now()}-${process.pid}`;
const users = {
    donor: {
        role: "donor",
        firstName: "اختبار",
        lastName: "متبرع",
        email: `test.donor.${testSuffix}@example.com`,
        phone: "01012345678",
        password: "TestPass123",
        donorType: "individual",
    },
    beneficiary: {
        role: "beneficiary",
        firstName: "اختبار",
        lastName: "مستفيد",
        email: `test.beneficiary.${testSuffix}@example.com`,
        phone: "01087654321",
        password: "TestPass123",
    },
};

let server;
let pool;
const cleanupProbeHash = `expired-session-probe-${testSuffix}`;

function cookieFrom(response) {
    const cookies = response.headers.getSetCookie?.() || [];
    const value = cookies.join(";").match(/sanad_session=([^;]+)/)?.[1];
    assert.ok(value, "Expected a sanad_session cookie");
    return `sanad_session=${value}`;
}

async function request(path, options = {}) {
    return fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        ...options,
        headers: { Accept: "application/json", ...(options.headers || {}) },
    });
}

async function signup(user) {
    const response = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
    });
    assert.equal(response.status, 201);
    return { response, cookie: cookieFrom(response) };
}

async function csrf(cookie) {
    const response = await request("/api/auth/csrf", {
        headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()).csrfToken;
}

async function logout(cookie) {
    const response = await request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, "X-CSRF-Token": await csrf(cookie) },
    });
    assert.equal(response.status, 200);
}

async function login(user) {
    const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, password: user.password }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.name, `${user.firstName} ${user.lastName}`);
    return { response, cookie: cookieFrom(response) };
}

before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(
        `INSERT INTO user_sessions
      (token_hash, role, email, csrf_token, expires_at, last_seen_at)
     VALUES ($1, 'donor', 'cleanup-probe@example.com', 'cleanup-probe-csrf', NOW() - INTERVAL '1 minute', NOW())
     ON CONFLICT (token_hash) DO UPDATE SET expires_at = NOW() - INTERVAL '1 minute'`,
        [cleanupProbeHash],
    );
    server = spawn(process.execPath, ["server/app.js"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`SANAD server did not start. Output: ${output}`)), 35000);
        const onData = (chunk) => {
            output += chunk.toString();
            if (output.includes(`SANAD running at http://localhost:${port}`)) {
                clearTimeout(timer);
                resolve();
            }
        };
        server.stdout.on("data", onData);
        server.stderr.on("data", onData);
        server.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`SANAD server exited with code ${code}. Output: ${output}`));
        });
    });
    await ready;
});

after(async () => {
    if (pool) {
        const emails = [
            users.donor.email,
            users.beneficiary.email,
            `donation.donor.${testSuffix}@example.com`,
            `donation.beneficiary.${testSuffix}@example.com`,
        ];
        await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
        await pool.end();
    }
    if (server && !server.killed) {
        server.kill("SIGTERM");
        await once(server, "exit").catch(() => { });
    }
});

test("reruns migrations safely and preserves the required schema", async () => {
    await migrate();
    await migrate();
    const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
        [["organizations", "users", "donor_profiles", "beneficiary_profiles", "user_sessions"]],
    );
    assert.equal(tables.rowCount, 5);

    const columns = await pool.query(
        `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_sessions'
       AND column_name = ANY($1::text[])`,
        [["token_hash", "csrf_token", "remember_me", "last_seen_at", "expires_at"]],
    );
    assert.equal(columns.rowCount, 5);
});

test("removes expired sessions during server startup cleanup", async () => {
    const result = await pool.query("SELECT 1 FROM user_sessions WHERE token_hash = $1", [cleanupProbeHash]);
    assert.equal(result.rowCount, 0);
});

test("protects pages and APIs from unauthenticated access", async () => {
    const page = await request("/donations");
    assert.equal(page.status, 302);
    assert.match(page.headers.get("location"), /\/login\?returnTo=/);

    const adminPage = await request("/admin-requests");
    assert.equal(adminPage.status, 302);

    const api = await request("/api/auth/me");
    assert.equal(api.status, 401);
});

test("allows authenticated users into protected pages but denies admin pages", async () => {
    const donor = await signup(users.donor);
    const donorPage = await request("/donations", { headers: { Cookie: donor.cookie } });
    assert.equal(donorPage.status, 200);

    const donorAdminPage = await request("/admin-requests", { headers: { Cookie: donor.cookie } });
    assert.equal(donorAdminPage.status, 403);

    const donorMe = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(donorMe.status, 200);
    assert.equal((await donorMe.json()).user.name, "اختبار متبرع");
    await logout(donor.cookie);

    const beneficiary = await signup(users.beneficiary);
    const beneficiaryPage = await request("/profile", { headers: { Cookie: beneficiary.cookie } });
    assert.equal(beneficiaryPage.status, 200);

    const beneficiaryAdminPage = await request("/admin-requests", { headers: { Cookie: beneficiary.cookie } });
    assert.equal(beneficiaryAdminPage.status, 403);
    await logout(beneficiary.cookie);
});

test("rotates the session token when an already-sessioned user logs in again", async () => {
    const firstLogin = await login(users.donor);
    const secondResponse = await request("/api/auth/login", {
        method: "POST",
        headers: {
            Cookie: firstLogin.cookie,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: users.donor.email, password: users.donor.password }),
    });
    assert.equal(secondResponse.status, 200);
    const secondCookie = cookieFrom(secondResponse);
    assert.notEqual(secondCookie, firstLogin.cookie);

    const oldSession = await request("/api/auth/me", { headers: { Cookie: firstLogin.cookie } });
    assert.equal(oldSession.status, 401);
    const newSession = await request("/api/auth/me", { headers: { Cookie: secondCookie } });
    assert.equal(newSession.status, 200);
    await logout(secondCookie);
});

test("allows the configured administrator to access the admin page", async () => {
    const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(response.status, 200);
    const cookie = cookieFrom(response);
    const adminPage = await request("/admin-requests", { headers: { Cookie: cookie } });
    assert.equal(adminPage.status, 200);
    await logout(cookie);
});

test("rejects state-changing requests without a valid CSRF token", async () => {
    const donor = await login(users.donor);
    const missingToken = await request("/api/profile", {
        method: "PATCH",
        headers: { Cookie: donor.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "اختبار", lastName: "متبرع", phone: users.donor.phone }),
    });
    assert.equal(missingToken.status, 403);

    const invalidToken = await request("/api/profile/password", {
        method: "POST",
        headers: {
            Cookie: donor.cookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": "invalid-token",
        },
        body: JSON.stringify({ currentPassword: users.donor.password, newPassword: "NewTestPass123", confirmPassword: "NewTestPass123" }),
    });
    assert.equal(invalidToken.status, 403);
    await logout(donor.cookie);
});

test("rate-limits repeated failed login attempts", async () => {
    const email = `rate-limit.${testSuffix}@example.com`;
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "wrong-password" }),
        });
        statuses.push(response.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test("returns the full Arabic name on login and invalidates the session on logout", async () => {
    const donor = await login(users.donor);
    const me = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.name, "اختبار متبرع");
    await logout(donor.cookie);

    const afterLogout = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(afterLogout.status, 401);
});

test("uses reset tokens once and revokes existing sessions after password reset", async () => {
    const beneficiary = await login(users.beneficiary);
    const forgot = await request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: users.beneficiary.email }),
    });
    assert.equal(forgot.status, 200);
    const forgotPayload = await forgot.json();
    assert.equal(forgotPayload.message, "If an account exists for this email, a reset link has been created.");
    assert.ok(forgotPayload.resetUrl, "Development mode should expose the local reset URL for testing");
    const token = new URL(forgotPayload.resetUrl).searchParams.get("token");
    assert.ok(token);

    const reset = await request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "ResetTestPass123", confirmPassword: "ResetTestPass123" }),
    });
    assert.equal(reset.status, 200);

    const revokedSession = await request("/api/auth/me", { headers: { Cookie: beneficiary.cookie } });
    assert.equal(revokedSession.status, 401);

    const reusedToken = await request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "AnotherTestPass123", confirmPassword: "AnotherTestPass123" }),
    });
    assert.equal(reusedToken.status, 400);

    const loginAfterReset = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: users.beneficiary.email, password: "ResetTestPass123" }),
    });
    assert.equal(loginAfterReset.status, 200);
    await logout(cookieFrom(loginAfterReset));
});

test("rejects malformed server-side input while accepting Arabic names", async () => {
    const invalidName = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...users.donor, email: `invalid-name.${testSuffix}@example.com`, firstName: "محمد123" }),
    });
    assert.equal(invalidName.status, 400);

    const invalidPhone = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...users.donor, email: `invalid-phone.${testSuffix}@example.com`, phone: "not-a-phone" }),
    });
    assert.equal(invalidPhone.status, 400);

    const invalidPassword = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...users.donor,
            email: `invalid-password.${testSuffix}@example.com`,
            password: "x".repeat(129),
        }),
    });
    assert.equal(invalidPassword.status, 400);

    const invalidRecovery = await request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
    });
    assert.equal(invalidRecovery.status, 200);
    assert.equal(
        (await invalidRecovery.json()).message,
        "If an account exists for this email, a reset link has been created.",
    );
});

test("lists sessions without tokens and revokes other sessions securely", async () => {
    const first = await login(users.donor);
    const second = await login(users.donor);

    const listed = await request("/api/auth/sessions", { headers: { Cookie: second.cookie } });
    assert.equal(listed.status, 200);
    const sessions = (await listed.json()).sessions;
    assert.ok(sessions.length >= 2);
    assert.equal(sessions.filter(session => session.current).length, 1);
    assert.ok(sessions.every(session => !session.sessionId && !session.tokenHash));

    const missingCsrf = await request("/api/auth/sessions/revoke-others", {
        method: "POST",
        headers: { Cookie: second.cookie },
    });
    assert.equal(missingCsrf.status, 403);

    const revoke = await request("/api/auth/sessions/revoke-others", {
        method: "POST",
        headers: {
            Cookie: second.cookie,
            "X-CSRF-Token": await csrf(second.cookie),
        },
    });
    assert.equal(revoke.status, 200);
    assert.ok((await revoke.json()).revoked >= 1);

    const oldSession = await request("/api/auth/me", { headers: { Cookie: first.cookie } });
    assert.equal(oldSession.status, 401);
    const remaining = await request("/api/auth/sessions", { headers: { Cookie: second.cookie } });
    assert.equal((await remaining.json()).sessions.length, 1);
    await logout(second.cookie);
});

test("records sensitive actions without exposing secrets and protects audit access", async () => {
    const donor = await login(users.donor);
    const token = await csrf(donor.cookie);
    const profileUpdate = await request("/api/profile", {
        method: "PATCH",
        headers: {
            Cookie: donor.cookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": token,
        },
        body: JSON.stringify({ firstName: "اختبار", lastName: "متبرع", phone: users.donor.phone }),
    });
    assert.equal(profileUpdate.status, 200);
    await logout(donor.cookie);

    const rows = await pool.query(
        `SELECT action, success, metadata::text AS metadata, user_agent
     FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [(await pool.query("SELECT id FROM users WHERE email = $1", [users.donor.email])).rows[0].id],
    );
    const actions = rows.rows.map(row => row.action);
    assert.ok(actions.includes("login_success"));
    assert.ok(actions.includes("profile_updated"));
    assert.ok(actions.includes("logout_success"));
    assert.ok(rows.rows.every(row => !/TestPass123|sanad_session|csrf|token/i.test(`${row.metadata} ${row.user_agent}`)));

    const deniedSession = await login(users.donor);
    const denied = await request("/api/admin/audit-logs", { headers: { Cookie: deniedSession.cookie } });
    assert.equal(denied.status, 403);
    await logout(deniedSession.cookie);

    const admin = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: process.env.ADMIN_EMAIL || "admin@sanad.com", password: process.env.ADMIN_PASSWORD || "Sanad@2026" }),
    });
    assert.equal(admin.status, 200);
    const adminLogs = await request("/api/admin/audit-logs?limit=1000", { headers: { Cookie: cookieFrom(admin) } });
    assert.equal(adminLogs.status, 200);
    const logPayload = await adminLogs.json();
    assert.ok(logPayload.logs.length <= 100);
    assert.ok(logPayload.logs.every(log => !("metadata" in log) && !("tokenHash" in log)));
    await logout(cookieFrom(admin));
});

test("stores donation requests securely and enforces donor/admin workflow", async () => {
    const donor = await signup({
        role: "donor",
        firstName: "متبرع",
        lastName: "التجربة",
        email: `donation.donor.${testSuffix}@example.com`,
        phone: "01011112222",
        password: "DonationPass123",
        donorType: "individual",
    });
    const csrfToken = await csrf(donor.cookie);
    const create = await request("/api/donations", {
        method: "POST",
        headers: { Cookie: donor.cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
            title: "بطاطين شتوية",
            description: "بطاطين نظيفة للأسر المحتاجة",
            category: "ملابس",
            quantity: 20,
            unit: "بطانية",
            condition: "جيدة",
            warehouse: "مخزن القاهرة",
            location: "القاهرة",
        }),
    });
    assert.equal(create.status, 201);
    const donation = (await create.json()).donation;
    assert.equal(donation.status, "قيد المراجعة");
    assert.ok(donation.id);
    assert.match(donation.referenceCode, /^DON-\d{4,}$/);

    const donorList = await request("/api/donations", { headers: { Cookie: donor.cookie } });
    const userDonations = (await donorList.json()).donations;
    assert.ok(userDonations.some(item => item.id === donation.id && /^DON-\d{4,}$/.test(item.referenceCode)));

    const beneficiary = await signup({
        role: "beneficiary",
        firstName: "مستفيد",
        lastName: "التجربة",
        email: `donation.beneficiary.${testSuffix}@example.com`,
        phone: "01033334444",
        password: "DonationPass123",
    });
    const beneficiaryList = await request("/api/donations", { headers: { Cookie: beneficiary.cookie } });
    assert.ok(!(await beneficiaryList.json()).donations.some(item => item.id === donation.id));

    const forbidden = await request(`/api/admin/donations/${donation.id}/status`, {
        method: "PATCH",
        headers: { Cookie: donor.cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(forbidden.status, 403);

    const adminLogin = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: process.env.ADMIN_EMAIL || "admin@sanad.com", password: process.env.ADMIN_PASSWORD || "Sanad@2026" }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookieFrom(adminLogin);
    const adminCsrf = await csrf(adminCookie);
    const approve = await request(`/api/admin/donations/${donation.id}/status`, {
        method: "PATCH",
        headers: { Cookie: adminCookie, "Content-Type": "application/json", "X-CSRF-Token": adminCsrf },
        body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(approve.status, 200);
    const approvePayload = await approve.json();
    assert.equal(approvePayload.donation.status, "متاح");
    assert.ok(approvePayload.donation.inventoryItemId);

    const inventoryRes = await request("/api/inventory", { headers: { Cookie: adminCookie } });
    assert.equal(inventoryRes.status, 200);
    const inventoryItems = (await inventoryRes.json()).items;
    const linkedInventory = inventoryItems.find(item => String(item.sourceDonationId) === String(donation.id));
    assert.ok(linkedInventory);
    assert.equal(linkedInventory.quantityTotal, 20);
    assert.equal(linkedInventory.quantityAvailable, 20);
    assert.equal(linkedInventory.status, "available");

    const visibleAfterApproval = await request("/api/donations", { headers: { Cookie: beneficiary.cookie } });
    assert.ok((await visibleAfterApproval.json()).donations.some(item => item.id === donation.id));
    await logout(donor.cookie);
    await logout(beneficiary.cookie);
    await logout(adminCookie);
});
