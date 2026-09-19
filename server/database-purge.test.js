import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const port = 3148;
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
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Server did not start.\n${logs}`);
}

await waitForServer();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

after(async () => {
    try {
        await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${testSuffix}%`]);
    } catch { }
    await pool.end();
    server.kill("SIGTERM");
});

test("database purge permissions and selective/full wipe feature", async (t) => {
    // 1. Unauthenticated access to /api/admin/database/stats returns 401
    const unauthStats = await fetch(`${baseUrl}/api/admin/database/stats`);
    assert.equal(unauthStats.status, 401);

    // 2. Signup a donor user
    const donorEmail = `donor.purge.${testSuffix}@example.com`;
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            role: "donor",
            firstName: "متبرع",
            lastName: "تجريبي",
            email: donorEmail,
            phone: "01011112222",
            password: "DonorPurgePass123",
            donorType: "individual",
        }),
    });
    assert.equal(signupRes.status, 201);
    const donorCookie = signupRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(donorCookie);

    // 3. Donor accessing /api/admin/database/stats returns 403
    const donorForbidden = await fetch(`${baseUrl}/api/admin/database/stats`, {
        headers: { Cookie: donorCookie },
    });
    assert.equal(donorForbidden.status, 403);

    // 4. Super Admin Login
    const superAdminRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(superAdminRes.status, 200);
    const superAdminCookie = superAdminRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(superAdminCookie);

    const superAdminCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: superAdminCookie } });
    const superAdminCsrf = (await superAdminCsrfRes.json()).csrfToken;
    assert.ok(superAdminCsrf);

    // 5. Super Admin accesses /api/admin/database/stats
    const superStatsRes = await fetch(`${baseUrl}/api/admin/database/stats`, {
        headers: { Cookie: superAdminCookie },
    });
    assert.equal(superStatsRes.status, 200);
    const statsPayload = await superStatsRes.json();
    assert.equal(statsPayload.isSuperAdmin, true);
    assert.equal(statsPayload.canClearDatabase, true);
    assert.ok(typeof statsPayload.stats.donations === "number");

    // 6. Create secondary admin
    const secondaryEmail = `admin2.purge.${testSuffix}@example.com`;
    const secSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            role: "donor",
            firstName: "مشرف",
            lastName: "ثانٍ",
            email: secondaryEmail,
            phone: "01033334444",
            password: "SecAdminPass123",
            donorType: "individual",
        }),
    });
    assert.equal(secSignupRes.status, 201);
    const secUserRow = await pool.query("SELECT id FROM users WHERE email = $1", [secondaryEmail]);
    const secondaryAdminId = secUserRow.rows[0].id;

    // Super admin promotes secondary user to admin role
    const promoteRes = await fetch(`${baseUrl}/api/admin/users/${secondaryAdminId}/role`, {
        method: "PATCH",
        headers: {
            Cookie: superAdminCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": superAdminCsrf,
        },
        body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(promoteRes.status, 200);

    // Login as secondary admin
    const secLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: secondaryEmail,
            password: "SecAdminPass123",
        }),
    });
    assert.equal(secLoginRes.status, 200);
    const secCookie = secLoginRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(secCookie);

    const secCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: secCookie } });
    const secCsrf = (await secCsrfRes.json()).csrfToken;

    // 7. Secondary admin checks /api/admin/database/stats - canClearDatabase should be false
    const secStatsRes = await fetch(`${baseUrl}/api/admin/database/stats`, {
        headers: { Cookie: secCookie },
    });
    assert.equal(secStatsRes.status, 200);
    const secStatsPayload = await secStatsRes.json();
    assert.equal(secStatsPayload.isSuperAdmin, false);
    assert.equal(secStatsPayload.canClearDatabase, false);

    // 8. Secondary admin attempts purge -> returns 403
    const secPurgeForbidden = await fetch(`${baseUrl}/api/admin/database/purge`, {
        method: "POST",
        headers: {
            Cookie: secCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": secCsrf,
        },
        body: JSON.stringify({
            mode: "selective",
            targets: ["donations"],
            confirmationText: "مسح البيانات",
        }),
    });
    assert.equal(secPurgeForbidden.status, 403);

    // 9. Secondary admin attempts to grant himself permissions -> returns 403
    const secGrantSelfForbidden = await fetch(`${baseUrl}/api/admin/users/${secondaryAdminId}/permissions`, {
        method: "PATCH",
        headers: {
            Cookie: secCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": secCsrf,
        },
        body: JSON.stringify({ canClearDatabase: true }),
    });
    assert.equal(secGrantSelfForbidden.status, 403);

    // 10. Super Admin grants canClearDatabase = true to secondary admin
    const grantRes = await fetch(`${baseUrl}/api/admin/users/${secondaryAdminId}/permissions`, {
        method: "PATCH",
        headers: {
            Cookie: superAdminCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": superAdminCsrf,
        },
        body: JSON.stringify({ canClearDatabase: true }),
    });
    assert.equal(grantRes.status, 200);
    const grantPayload = await grantRes.json();
    assert.equal(grantPayload.user.canClearDatabase, true);

    // 11. Secondary admin re-checks stats -> now canClearDatabase is true
    const secStatsUpdated = await fetch(`${baseUrl}/api/admin/database/stats`, {
        headers: { Cookie: secCookie },
    });
    assert.equal(secStatsUpdated.status, 200);
    assert.equal((await secStatsUpdated.json()).canClearDatabase, true);

    // 12. Purge without valid confirmation text returns 400
    const invalidConfirmationRes = await fetch(`${baseUrl}/api/admin/database/purge`, {
        method: "POST",
        headers: {
            Cookie: secCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": secCsrf,
        },
        body: JSON.stringify({
            mode: "selective",
            targets: ["donations"],
            confirmationText: "غلط",
        }),
    });
    assert.equal(invalidConfirmationRes.status, 400);

    // 13. Secondary admin executes selective purge on donations
    const validPurgeRes = await fetch(`${baseUrl}/api/admin/database/purge`, {
        method: "POST",
        headers: {
            Cookie: secCookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": secCsrf,
        },
        body: JSON.stringify({
            mode: "selective",
            targets: ["donations"],
            confirmationText: "مسح البيانات",
        }),
    });
    assert.equal(validPurgeRes.status, 200);
    const purgeResult = await validPurgeRes.json();
    assert.ok(purgeResult.result);
    assert.equal(purgeResult.result.mode, "selective");

    // 14. Super Admin account permissions cannot be modified
    const superAdminUserRow = await pool.query("SELECT id FROM users WHERE email = $1", [process.env.ADMIN_EMAIL || "admin@sanad.com"]);
    if (superAdminUserRow.rows[0]) {
        const modifySuperForbidden = await fetch(`${baseUrl}/api/admin/users/${superAdminUserRow.rows[0].id}/permissions`, {
            method: "PATCH",
            headers: {
                Cookie: superAdminCookie,
                "Content-Type": "application/json",
                "X-CSRF-Token": superAdminCsrf,
            },
            body: JSON.stringify({ canClearDatabase: false }),
        });
        assert.equal(modifySuperForbidden.status, 400);
    }
});
