import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3145;
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
let testBeneficiaryId = null;
let testInventoryItemId = null;
let testNeedId = null;
let testUserId = null;
let createdDistributionId = null;

test("Phase 6: Distributions Workflow — End-to-End Verification", async (t) => {
    // 1. Admin login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(loginRes.status, 200);
    adminCookie = loginRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(adminCookie);

    // 2. CSRF token
    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: adminCookie } });
    assert.equal(csrfRes.status, 200);
    const csrfData = await csrfRes.json();
    adminCsrf = csrfData.csrfToken;
    assert.ok(adminCsrf);

    // 3. Unauthorized access check
    const unauthRes = await fetch(`${baseUrl}/api/distributions`);
    assert.equal(unauthRes.status, 401);

    // 4. Page rendering check
    const pageRes = await fetch(`${baseUrl}/distributions`, { headers: { Cookie: adminCookie } });
    assert.equal(pageRes.status, 200);
    const pageHtml = await pageRes.text();
    assert.ok(pageHtml.includes("سجل التوزيعات وتسليم المساعدات"));
    assert.ok(pageHtml.includes("/JS/distributions.js"));
    assert.ok(pageHtml.includes("/CSS/distributions.css"));

    // 5. Seed Test Data: Beneficiary, Need, and Inventory Item
    const benRes = await fetch(`${baseUrl}/api/beneficiaries`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: `مستفيد التوزيع ${testId}`,
            phone: `010${testId}99`,
            nationalId: `29${testId}123456`,
            governorate: "القاهرة",
            district: "المعادي",
            address: "شارع التحرير",
            familySize: 5,
            childrenCount: 3,
            verificationStatus: "verified",
        }),
    });
    assert.equal(benRes.status, 201);
    const benData = await benRes.json();
    testBeneficiaryId = benData.beneficiary.id;

    // Beneficiary Need: 5 School Bags
    const needInsert = await pool.query(
        `INSERT INTO beneficiary_needs (beneficiary_id, title, category, quantity_requested, quantity_fulfilled, unit, priority, status)
         VALUES ($1, 'شنط مدرسية للأطفال', 'مستلزمات مدرسية', 5, 0, 'حقيبة', 'high', 'open')
         RETURNING id`,
        [testBeneficiaryId],
    );
    testNeedId = needInsert.rows[0].id;

    // Inventory Item: 10 School Bags Available
    const invInsert = await pool.query(
        `INSERT INTO inventory_items (name, category, description, unit, quantity_total, quantity_available, quantity_reserved, low_stock_threshold, status, warehouse, location)
         VALUES ('شنطة مدرسية فاخرة', 'مستلزمات مدرسية', 'شنطة متينة', 'حقيبة', 10, 10, 0, 2, 'available', 'مخزن القاهرة', 'الممر 3')
         RETURNING id`,
    );
    testInventoryItemId = invInsert.rows[0].id;

    // 6. Test Insufficient Stock Rejection
    const overRequestRes = await fetch(`${baseUrl}/api/distributions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminCsrf,
            Cookie: adminCookie,
        },
        body: JSON.stringify({
            beneficiaryId: testBeneficiaryId,
            status: "completed",
            items: [
                { inventoryItemId: testInventoryItemId, quantity: 25, needId: testNeedId },
            ],
        }),
    });
    assert.equal(overRequestRes.status, 409);
    const overData = await overRequestRes.json();
    assert.ok(overData.message.includes("تتجاوز المخزون المتاح"));

    // Verify inventory untouched
    const invCheck1 = await pool.query("SELECT quantity_available FROM inventory_items WHERE id = $1", [testInventoryItemId]);
    assert.equal(invCheck1.rows[0].quantity_available, 10);

    // 7. Test Successful Distribution Execution (Atomic Handover of 3 Bags)
    const createRes = await fetch(`${baseUrl}/api/distributions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminCsrf,
            Cookie: adminCookie,
        },
        body: JSON.stringify({
            beneficiaryId: testBeneficiaryId,
            status: "completed",
            location: "المستودع الرئيسي",
            notes: "تسليم باليد للمستفيد",
            items: [
                { inventoryItemId: testInventoryItemId, quantity: 3, needId: testNeedId },
            ],
        }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.ok(createData.distribution);
    assert.ok(createData.distribution.referenceCode.startsWith("DIST-"));
    assert.equal(createData.distribution.status, "completed");
    assert.equal(createData.distribution.items.length, 1);
    assert.equal(createData.distribution.items[0].quantity, 3);
    createdDistributionId = createData.distribution.id;

    // 8. Verify Atomic Side Effects
    // Inventory: 10 - 3 = 7
    const invCheck2 = await pool.query("SELECT quantity_available, status FROM inventory_items WHERE id = $1", [testInventoryItemId]);
    assert.equal(invCheck2.rows[0].quantity_available, 7);

    // Beneficiary Need: fulfilled = 3, status = partially_fulfilled
    const needCheck = await pool.query("SELECT quantity_fulfilled, status FROM beneficiary_needs WHERE id = $1", [testNeedId]);
    assert.equal(needCheck.rows[0].quantity_fulfilled, 3);
    assert.equal(needCheck.rows[0].status, "partially_fulfilled");

    // 9. Verify Listing and Filtering
    const listRes = await fetch(`${baseUrl}/api/distributions?status=completed`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.distributions));
    const found = listData.distributions.find(d => d.id === createdDistributionId);
    assert.ok(found, "Newly created distribution should appear in completed list");
    assert.equal(found.beneficiaryName, `مستفيد التوزيع ${testId}`);

    // 10. Verify Stats Endpoint
    const statsRes = await fetch(`${baseUrl}/api/distributions/stats`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(statsRes.status, 200);
    const statsData = await statsRes.json();
    assert.ok(statsData.stats.total >= 1);
    assert.ok(statsData.stats.completed >= 1);
    assert.ok(statsData.stats.totalItemsDelivered >= 3);

    // 11. Verify Voucher Detail Endpoint
    const detailRes = await fetch(`${baseUrl}/api/distributions/${createdDistributionId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.equal(detailData.distribution.id, createdDistributionId);
    assert.equal(detailData.distribution.beneficiaryAddress, "شارع التحرير");
    assert.equal(detailData.distribution.items[0].itemName, "شنطة مدرسية فاخرة");

    // 12. Verify 30-Day Recent Support Alert is Triggered in Recommendation Engine
    const verifRes = await fetch(`${baseUrl}/api/verification/${testBeneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(verifRes.status, 200);
    const verifData = await verifRes.json();
    assert.ok(verifData.verification.recommendation);
    assert.equal(
        verifData.verification.recommendation.recent_support_warning?.hasRecentSupport,
        true,
        "Recommendation engine must detect the aid distributed today and trigger 30-day warning",
    );

    // 13. Test Distribution Cancellation and Stock Restoration
    const cancelRes = await fetch(`${baseUrl}/api/distributions/${createdDistributionId}/cancel`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": adminCsrf,
            Cookie: adminCookie,
        },
        body: JSON.stringify({ reason: "إلغاء تجريبي للاختبار" }),
    });
    assert.equal(cancelRes.status, 200);

    // Verify Inventory Restored from 7 back to 10
    const invCheck3 = await pool.query("SELECT quantity_available FROM inventory_items WHERE id = $1", [testInventoryItemId]);
    assert.equal(invCheck3.rows[0].quantity_available, 10, "Inventory must be restored upon cancellation");

    // Verify Need Reverted back to open
    const needCheck2 = await pool.query("SELECT quantity_fulfilled, status FROM beneficiary_needs WHERE id = $1", [testNeedId]);
    assert.equal(needCheck2.rows[0].quantity_fulfilled, 0, "Need fulfilled quantity must be decremented back");
    assert.equal(needCheck2.rows[0].status, "open");
});

after(async () => {
    try {
        if (createdDistributionId) {
            await pool.query("DELETE FROM distributions WHERE id = $1", [createdDistributionId]).catch(() => { });
        }
        if (testNeedId) {
            await pool.query("DELETE FROM beneficiary_needs WHERE id = $1", [testNeedId]).catch(() => { });
        }
        if (testInventoryItemId) {
            await pool.query("DELETE FROM inventory_items WHERE id = $1", [testInventoryItemId]).catch(() => { });
        }
        if (testBeneficiaryId) {
            await pool.query("DELETE FROM beneficiary_profiles WHERE id = $1", [testBeneficiaryId]).catch(() => { });
        }
        if (testUserId) {
            await pool.query("DELETE FROM users WHERE id = $1", [testUserId]).catch(() => { });
        }
    } finally {
        await pool.end().catch(() => { });
        server.kill("SIGTERM");
        server.kill();
        await once(server, "exit").catch(() => { });
    }
});
