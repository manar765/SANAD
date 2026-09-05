import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const port = 3147;
const baseUrl = `http://127.0.0.1:${port}`;
const testId = Date.now().toString().slice(-6);

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let adminCookie = "";
let adminCsrf = "";
let donorCookie = "";
let donorCsrf = "";
let testDonorUserId = null;

test("Phase 8: Operational Dashboard, Reports, Notifications & Audit History Suite", async (t) => {
    // 1. Admin login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(adminLoginRes.status, 200);
    adminCookie = (adminLoginRes.headers.get("set-cookie") || "").split(";")[0];
    const adminPayload = await adminLoginRes.json();
    adminCsrf = adminPayload.csrfToken;

    // 2. Register & login donor user
    const donorEmail = `dash.donor.${testId}@example.com`;
    const donorPass = "DonorPass123!@";
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            role: "donor",
            firstName: "متبرع",
            lastName: "لوحة",
            email: donorEmail,
            phone: "01099998888",
            password: donorPass,
            donorType: "individual",
        }),
    });
    assert.equal(signupRes.status, 201);
    const signupPayload = await signupRes.json();
    testDonorUserId = signupPayload.user.id;

    // Verify email
    await pool.query("UPDATE users SET email_verified_at = NOW() WHERE id = $1", [testDonorUserId]);

    const donorLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: donorEmail, password: donorPass }),
    });
    assert.equal(donorLoginRes.status, 200);
    donorCookie = (donorLoginRes.headers.get("set-cookie") || "").split(";")[0];
    const donorPayload = await donorLoginRes.json();
    donorCsrf = donorPayload.csrfToken;

    // ------------------------------------------------------------------------
    // API Route Security & RBAC Checks
    // ------------------------------------------------------------------------
    await t.test("security: rejects unauthenticated requests with 401", async () => {
        const resSum = await fetch(`${baseUrl}/api/dashboard/summary`);
        assert.equal(resSum.status, 401);

        const resRep = await fetch(`${baseUrl}/api/reports/analytics`);
        assert.equal(resRep.status, 401);

        const resNotif = await fetch(`${baseUrl}/api/notifications`);
        assert.equal(resNotif.status, 401);

        const resAudit = await fetch(`${baseUrl}/api/admin/audit-logs`);
        assert.equal(resAudit.status, 401);
    });

    await t.test("security: rejects non-admin users with 403 on admin-only endpoints", async () => {
        const resSum = await fetch(`${baseUrl}/api/dashboard/summary`, {
            headers: { Cookie: donorCookie },
        });
        assert.equal(resSum.status, 403);

        const resRep = await fetch(`${baseUrl}/api/reports/analytics`, {
            headers: { Cookie: donorCookie },
        });
        assert.equal(resRep.status, 403);

        const resAudit = await fetch(`${baseUrl}/api/admin/audit-logs`, {
            headers: { Cookie: donorCookie },
        });
        assert.equal(resAudit.status, 403);
    });

    // ------------------------------------------------------------------------
    // Dashboard Summary Endpoint Functionality
    // ------------------------------------------------------------------------
    await t.test("api: GET /api/dashboard/summary returns full operational KPIs", async () => {
        const res = await fetch(`${baseUrl}/api/dashboard/summary`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.ok(data.kpis, "Should include kpis object");
        assert.equal(typeof data.kpis.totalDonations, "number");
        assert.equal(typeof data.kpis.inventoryTotal, "number");
        assert.equal(typeof data.kpis.inventoryAvailable, "number");
        assert.equal(typeof data.kpis.beneficiariesTotal, "number");
        assert.equal(typeof data.kpis.distributionsTotal, "number");
        assert.equal(typeof data.kpis.distributionRate, "number");
        assert.equal(typeof data.kpis.openNeedsTotal, "number");

        assert.ok(Array.isArray(data.recentDonations), "recentDonations should be array");
        assert.ok(Array.isArray(data.recentDistributions), "recentDistributions should be array");
        assert.ok(Array.isArray(data.lowStockItems), "lowStockItems should be array");
        assert.ok(Array.isArray(data.surplusItems), "surplusItems should be array");
        assert.ok(Array.isArray(data.urgentNeeds), "urgentNeeds should be array");
        assert.ok(data.inventoryStatusCounts, "inventoryStatusCounts should be present");
        assert.ok(Array.isArray(data.recentActivity), "recentActivity should be array");

        // Verify Arabic labels in recentActivity
        if (data.recentActivity.length > 0) {
            const first = data.recentActivity[0];
            assert.ok(first.actionLabel, "Action should have human-readable Arabic label");
            assert.ok(first.userName, "Action should identify user name");
        }
    });

    // ------------------------------------------------------------------------
    // Operational Reports & PII Compliance
    // ------------------------------------------------------------------------
    await t.test("api: GET /api/reports/analytics aggregates data without exposing PII", async () => {
        const res = await fetch(`${baseUrl}/api/reports/analytics`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.ok(Array.isArray(data.donationsByCategory), "donationsByCategory should be array");
        assert.ok(Array.isArray(data.needsByCategory), "needsByCategory should be array");
        assert.ok(Array.isArray(data.beneficiariesByGovernorate), "beneficiariesByGovernorate should be array");
        assert.ok(Array.isArray(data.distributionsByStatus), "distributionsByStatus should be array");
        assert.ok(Array.isArray(data.monthlyTrend), "monthlyTrend should be array");

        // Strict PII Verification:
        for (const item of data.beneficiariesByGovernorate) {
            assert.ok(typeof item.governorate === "string");
            assert.ok(typeof item.count === "number");
            assert.equal(item.national_id, undefined, "No national ID in aggregate report");
            assert.equal(item.nationalId, undefined, "No national ID in aggregate report");
            assert.equal(item.phone, undefined, "No phone in aggregate report");
            assert.equal(item.address, undefined, "No street address in aggregate report");
            assert.equal(item.email, undefined, "No email in aggregate report");
        }
    });

    // ------------------------------------------------------------------------
    // Operational Notifications
    // ------------------------------------------------------------------------
    await t.test("api: GET /api/notifications returns operational alerts for authorized staff", async () => {
        const res = await fetch(`${baseUrl}/api/notifications`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(typeof data.unreadCount, "number");
        assert.ok(Array.isArray(data.notifications));

        for (const notif of data.notifications) {
            assert.ok(notif.id);
            assert.ok(["warning", "urgent", "info"].includes(notif.type));
            assert.ok(notif.title);
            assert.ok(notif.message);
            assert.ok(notif.link);
            assert.ok(notif.timestamp);
        }
    });

    // ------------------------------------------------------------------------
    // Audit Logs Query & Action Filter
    // ------------------------------------------------------------------------
    await t.test("api: GET /api/admin/audit-logs supports limit and action filter", async () => {
        const resAll = await fetch(`${baseUrl}/api/admin/audit-logs?limit=10`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(resAll.status, 200);
        const dataAll = await resAll.json();
        assert.ok(Array.isArray(dataAll.logs));
        assert.ok(dataAll.logs.length <= 10);

        const resFiltered = await fetch(`${baseUrl}/api/admin/audit-logs?action=login_success`, {
            headers: { Cookie: adminCookie },
        });
        assert.equal(resFiltered.status, 200);
        const dataFiltered = await resFiltered.json();
        assert.ok(Array.isArray(dataFiltered.logs));
        for (const log of dataFiltered.logs) {
            assert.equal(log.action, "login_success");
        }
    });
});

after(async () => {
    server.kill();
    if (testDonorUserId) {
        await pool.query("DELETE FROM users WHERE id = $1", [testDonorUserId]).catch(() => { });
    }
    await pool.end();
});
