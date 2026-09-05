import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3144;
const baseUrl = `http://127.0.0.1:${port}`;
const testSuffix = `${Date.now()}-${process.pid}`;

const server = spawn(process.execPath, ["server/app.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", chunk => { logs += chunk.toString(); });
server.stderr.on("data", chunk => { logs += chunk.toString(); });

async function waitForServer() {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.status === 200 || response.status === 503) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Server did not start.\n${logs}`);
}

await waitForServer();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let adminCookie = "";
let adminCsrf = "";
let donorCookie = "";
let testUserEmail = `role.test.${testSuffix}@example.com`;
let testUserId = null;

test("admin user roles management and permissions verification", async (t) => {
    // 1. Unauthenticated access to /api/admin/users should return 401
    const unauthUsers = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(unauthUsers.status, 401);

    // 2. Signup a donor user
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            role: "donor",
            firstName: "مستخدم",
            lastName: "الأدوار",
            email: testUserEmail,
            phone: "01099998888",
            password: "RoleTestPass123",
            donorType: "individual",
        }),
    });
    assert.equal(signupRes.status, 201);
    donorCookie = signupRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(donorCookie);

    // Fetch user ID
    const userRow = await pool.query("SELECT id FROM users WHERE email = $1", [testUserEmail]);
    testUserId = userRow.rows[0].id;
    assert.ok(testUserId);

    // 3. Authenticated donor accessing /api/admin/users should return 403
    const donorForbidden = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Cookie: donorCookie },
    });
    assert.equal(donorForbidden.status, 403);

    // 4. Authenticated donor attempting to change role should return 403
    const donorPatchForbidden = await fetch(`${baseUrl}/api/admin/users/${testUserId}/role`, {
        method: "PATCH",
        headers: {
            Cookie: donorCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": "invalid",
        },
        body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(donorPatchForbidden.status, 403);

    // 5. Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(adminLoginRes.status, 200);
    adminCookie = adminLoginRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(adminCookie);

    // 6. Admin CSRF token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: adminCookie } });
    assert.equal(csrfRes.status, 200);
    adminCsrf = (await csrfRes.json()).csrfToken;
    assert.ok(adminCsrf);

    // 7. Admin lists users successfully
    const listRes = await fetch(`${baseUrl}/api/admin/users?search=${encodeURIComponent(testUserEmail)}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.ok(Array.isArray(listPayload.users));
    const targetUser = listPayload.users.find(u => u.id === testUserId);
    assert.ok(targetUser);
    assert.equal(targetUser.role, "donor");

    // 8. Reject invalid role values
    const invalidRoleRes = await fetch(`${baseUrl}/api/admin/users/${testUserId}/role`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "superhero" }),
    });
    assert.equal(invalidRoleRes.status, 400);

    // 9. Admin updates user role from 'donor' to 'beneficiary'
    const changeToBeneficiary = await fetch(`${baseUrl}/api/admin/users/${testUserId}/role`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "beneficiary" }),
    });
    assert.equal(changeToBeneficiary.status, 200);
    const updatedPayload = await changeToBeneficiary.json();
    assert.equal(updatedPayload.user.role, "beneficiary");

    // Check database state
    const dbCheck = await pool.query("SELECT role FROM users WHERE id = $1", [testUserId]);
    assert.equal(dbCheck.rows[0].role, "beneficiary");

    // Check active session updated
    const sessionCheck = await pool.query("SELECT role FROM user_sessions WHERE user_id = $1", [testUserId]);
    if (sessionCheck.rowCount > 0) {
        assert.equal(sessionCheck.rows[0].role, "beneficiary");
    }

    // 10. Prevent admin from demoting their own admin account
    const adminUser = await pool.query("SELECT id FROM users WHERE email = $1", [process.env.ADMIN_EMAIL || "admin@sanad.com"]);
    if (adminUser.rowCount > 0) {
        const selfDemoteRes = await fetch(`${baseUrl}/api/admin/users/${adminUser.rows[0].id}/role`, {
            method: "PATCH",
            headers: {
                Cookie: adminCookie,
                "X-CSRF-Token": adminCsrf,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ role: "donor" }),
        });
        assert.equal(selfDemoteRes.status, 400);
    }
});

after(async () => {
    if (pool) {
        await pool.query("DELETE FROM users WHERE email = $1", [testUserEmail]).catch(() => {});
        await pool.end().catch(() => {});
    }
    if (server && !server.killed) {
        server.kill("SIGTERM");
        await once(server, "exit").catch(() => {});
    }
});
