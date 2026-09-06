import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3148;
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
    throw new Error(`Server did not start on port ${port}.\n${logs}`);
}

await waitForServer();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let adminCookie = "";
let adminCsrf = "";

// Test entity IDs for cleanup
let testUserId = null;
let testBeneficiaryId = null;
let testNeedId = null;
let testInventoryItemId = null;
let testDistributionId = null;

test("Phase 9: Primary Operational Journey — End-to-End Workflow", async () => {
    // ------------------------------------------------------------------------
    // Step 1: Login
    // ------------------------------------------------------------------------
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(loginRes.status, 200, "Admin login must succeed");
    adminCookie = loginRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(adminCookie, "Session cookie must be returned");

    const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: adminCookie } });
    assert.equal(csrfRes.status, 200, "CSRF endpoint must return 200");
    const csrfData = await csrfRes.json();
    adminCsrf = csrfData.csrfToken;
    assert.ok(adminCsrf, "CSRF token must be returned");

    // ------------------------------------------------------------------------
    // Step 2: Dashboard (Initial Baseline State)
    // ------------------------------------------------------------------------
    const initialDashRes = await fetch(`${baseUrl}/api/dashboard/summary`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(initialDashRes.status, 200, "Dashboard summary must return 200");
    const initialDashboard = await initialDashRes.json();
    const initialCompletedDistributions = initialDashboard.kpis.distributionsCompleted;
    const initialAvailableInventory = initialDashboard.kpis.inventoryAvailable;
    assert.equal(typeof initialCompletedDistributions, "number");
    assert.equal(typeof initialAvailableInventory, "number");

    // ------------------------------------------------------------------------
    // Setup Test Data: Create a verified beneficiary, need, and inventory item
    // ------------------------------------------------------------------------
    const userRes = await pool.query(
        `INSERT INTO users (name, full_name, email, password, password_hash, role)
         VALUES ($1, $1, $2, 'dummyPass', 'dummyHash', 'beneficiary') RETURNING id`,
        [`رحلة تجريبية ${testId}`, `journey.${testId}@example.com`]
    );
    testUserId = userRes.rows[0].id;

    const benRes = await pool.query(
        `INSERT INTO beneficiary_profiles
         (user_id, national_id, phone, governorate, district, family_size, children_count, monthly_income, verification_status, notes)
         VALUES ($1, $2, '01011112222', 'الجيزة', 'إمبابة', 6, 4, 1800, 'verified', 'حالة بحث اجتماعي مكتملة')
         RETURNING id, reference_code`,
        [testUserId, `29${testId}123456`]
    );
    testBeneficiaryId = benRes.rows[0].id;
    const benReference = benRes.rows[0].reference_code;

    const needRes = await pool.query(
        `INSERT INTO beneficiary_needs
         (beneficiary_id, title, category, quantity_requested, unit, priority, status)
         VALUES ($1, 'كرتونة غذائية للأسرة', 'مواد غذائية', 2, 'كرتونة', 'urgent', 'open')
         RETURNING id`,
        [testBeneficiaryId]
    );
    testNeedId = needRes.rows[0].id;

    const invRes = await pool.query(
        `INSERT INTO inventory_items
         (name, category, unit, quantity_total, quantity_available, low_stock_threshold, status, warehouse, location)
         VALUES ('كرتونة مواد غذائية متكاملة', 'مواد غذائية', 'كرتونة', 50, 50, 5, 'available', 'مخزن الجيزة', 'رف A-1')
         RETURNING id`,
    );
    testInventoryItemId = invRes.rows[0].id;

    // ------------------------------------------------------------------------
    // Step 3: Search Beneficiary
    // ------------------------------------------------------------------------
    const searchRes = await fetch(`${baseUrl}/api/beneficiaries?search=${encodeURIComponent(`رحلة تجريبية ${testId}`)}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(searchRes.status, 200, "Beneficiary search must succeed");
    const searchPayload = await searchRes.json();
    assert.ok(Array.isArray(searchPayload.beneficiaries), "Should return array of beneficiaries");
    const matchedBeneficiary = searchPayload.beneficiaries.find(b => b.id === testBeneficiaryId);
    assert.ok(matchedBeneficiary, "Should find the registered test beneficiary by search query");
    assert.equal(matchedBeneficiary.verificationStatus, "verified");

    // ------------------------------------------------------------------------
    // Step 4: Review Needs and Support History
    // ------------------------------------------------------------------------
    const detailRes = await fetch(`${baseUrl}/api/beneficiaries/${testBeneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(detailRes.status, 200, "Beneficiary details must return 200");
    const detailPayload = await detailRes.json();
    assert.equal(detailPayload.beneficiary.id, testBeneficiaryId);
    assert.ok(Array.isArray(detailPayload.beneficiary.needs), "Should return needs list");
    const foundNeed = detailPayload.beneficiary.needs.find(n => n.id === testNeedId);
    assert.ok(foundNeed, "Should find the urgent food need");
    assert.equal(foundNeed.priority, "urgent");
    assert.equal(foundNeed.quantityRequested, 2);
    assert.equal(foundNeed.quantityFulfilled, 0);
    assert.ok(Array.isArray(detailPayload.beneficiary.distributions), "Should return distribution history list");
    assert.equal(detailPayload.beneficiary.distributions.length, 0, "No prior distributions initially");

    // ------------------------------------------------------------------------
    // Step 5: Review Recommendation (Rules Engine)
    // ------------------------------------------------------------------------
    const recRes = await fetch(`${baseUrl}/api/beneficiaries/${testBeneficiaryId}/recommendation`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(recRes.status, 200, "Recommendation endpoint must return 200");
    const recPayload = await recRes.json();
    assert.ok(recPayload.recommendation, "Should contain recommendation object");
    const priority = recPayload.recommendation.priority_level || recPayload.recommendation.priorityLevel;
    assert.ok(
        priority === "urgent" || priority === "high",
        "Rule engine should evaluate family with 6 members and low income as high or urgent priority"
    );
    assert.ok(Array.isArray(recPayload.recommendation.reasons), "Should provide structured reasons");
    const disclaimer = recPayload.recommendation.advisory_disclaimer || recPayload.recommendation.advisoryDisclaimer;
    assert.ok(disclaimer, "Advisory disclaimer must be present");
    assert.match(disclaimer, /استرشادية لمساندة القرار البشري/);

    // ------------------------------------------------------------------------
    // Step 6: Select Inventory
    // ------------------------------------------------------------------------
    const invListRes = await fetch(`${baseUrl}/api/inventory?category=${encodeURIComponent("مواد غذائية")}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(invListRes.status, 200, "Inventory query must return 200");
    const invListPayload = await invListRes.json();
    assert.ok(Array.isArray(invListPayload.items), "Items should be an array");
    const selectedItem = invListPayload.items.find(it => it.id === testInventoryItemId);
    assert.ok(selectedItem, "Selected inventory item must exist");
    assert.ok(selectedItem.quantityAvailable >= 2, "Item must have sufficient available quantity");

    // ------------------------------------------------------------------------
    // Step 7: Confirm Distribution
    // ------------------------------------------------------------------------
    const distPayload = {
        beneficiaryId: testBeneficiaryId,
        status: "completed",
        location: "تسليم مقر إمبابة",
        notes: "تم تسليم كرتونتين مواد غذائية للأسرة بنجاح وفق التوصية المعتمدة",
        items: [
            {
                inventoryItemId: testInventoryItemId,
                quantity: 2,
                needId: testNeedId,
            },
        ],
    };

    const confirmRes = await fetch(`${baseUrl}/api/distributions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Cookie": adminCookie,
            "x-csrf-token": adminCsrf,
        },
        body: JSON.stringify(distPayload),
    });
    assert.equal(confirmRes.status, 201, "Distribution creation must return 201 Created");
    const confirmData = await confirmRes.json();
    assert.ok(confirmData.distribution, "Should return created distribution");
    assert.equal(confirmData.distribution.status, "completed");
    testDistributionId = confirmData.distribution.id;

    // ------------------------------------------------------------------------
    // Step 8: Update Inventory and History
    // ------------------------------------------------------------------------
    // 8a. Verify inventory is decremented from 50 to 48
    const updatedInvRes = await pool.query(
        "SELECT quantity_available, quantity_total FROM inventory_items WHERE id = $1",
        [testInventoryItemId]
    );
    assert.equal(updatedInvRes.rows[0].quantity_available, 48, "Available inventory must decrement by delivered quantity");
    assert.equal(updatedInvRes.rows[0].quantity_total, 50, "Total inventory must remain unchanged");

    // 8b. Verify need fulfilled quantity incremented from 0 to 2 and marked fulfilled
    const updatedNeedRes = await pool.query(
        "SELECT quantity_fulfilled, status FROM beneficiary_needs WHERE id = $1",
        [testNeedId]
    );
    assert.equal(updatedNeedRes.rows[0].quantity_fulfilled, 2, "Need fulfilled quantity must increment to 2");
    assert.equal(updatedNeedRes.rows[0].status, "fulfilled", "Need should transition to fulfilled");

    // 8c. Verify beneficiary support history now records the completed distribution
    const historyCheckRes = await fetch(`${baseUrl}/api/beneficiaries/${testBeneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    const historyData = await historyCheckRes.json();
    assert.equal(historyData.beneficiary.distributions.length, 1, "Beneficiary should have 1 completed distribution in history");
    assert.equal(historyData.beneficiary.distributions[0].id, testDistributionId);
    assert.equal(historyData.beneficiary.distributions[0].status, "completed");

    // ------------------------------------------------------------------------
    // Step 9: View Updated Dashboard
    // ------------------------------------------------------------------------
    const finalDashRes = await fetch(`${baseUrl}/api/dashboard/summary`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(finalDashRes.status, 200);
    const finalDashboard = await finalDashRes.json();

    assert.equal(
        finalDashboard.kpis.distributionsCompleted,
        initialCompletedDistributions + 1,
        "Dashboard completed distributions KPI must increment by 1"
    );
    assert.equal(
        finalDashboard.kpis.inventoryAvailable,
        initialAvailableInventory + 48, // Started with 50 newly added, then delivered 2 = net +48
        "Dashboard available inventory KPI must reflect the current available inventory"
    );

    // Verify recent distribution appears in dashboard recent list
    const foundInRecent = finalDashboard.recentDistributions.some(d => d.id === testDistributionId);
    assert.ok(foundInRecent, "New distribution should appear in dashboard recent distributions list");
});

after(async () => {
    try {
        if (testDistributionId) {
            await pool.query("DELETE FROM distributions WHERE id = $1", [testDistributionId]).catch(() => { });
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
