import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import pool from "./database/index.js";
import {
    evaluateBeneficiaryRules,
    checkRecentSupport,
    matchInventoryToNeeds,
    ADVISORY_DISCLAIMER_AR,
    PRIORITY_LEVELS
} from "./rules/recommendation-engine.js";

const port = 3144;
const baseUrl = `http://127.0.0.1:${port}`;
const testPhone = `010${Date.now().toString().slice(-8)}`;
const testNationalId = "29901019876543";

/* ==========================================================================
   PART 1: PURE UNIT TESTS FOR RULE ENGINE
   ========================================================================== */

test("rule engine — computes urgent priority and reasons deterministically", () => {
    const beneficiary = {
        family_size: 8,
        children_count: 5,
        monthly_income: 400,
        employment_status: "عاطل عن العمل",
        housing_type: "إيجار قديم متصدع",
        health_conditions: "شلل نصفي وفشل كلوي مزمن",
        verification_status: "verified"
    };

    const needs = [
        { id: 1, title: "سلة غذائية كبرى", category: "أغذية", quantity_requested: 2, quantity_fulfilled: 0, priority: "urgent", status: "open", unit: "سلة" },
        { id: 2, title: "دواء ضغط وغسيل كلى", category: "أدوية", quantity_requested: 3, quantity_fulfilled: 0, priority: "high", status: "open", unit: "علبة" }
    ];

    const distributionHistory = [];
    const inventoryItems = [
        { id: 101, name: "سلة غذائية متكاملة", category: "أغذية", quantity_available: 50, unit: "سلة" },
        { id: 102, name: "مستلزمات طبية", category: "أدوية", quantity_available: 1, unit: "علبة" }
    ];

    const result = evaluateBeneficiaryRules({
        beneficiary,
        needs,
        distributionHistory,
        inventoryItems,
        now: new Date("2026-09-05T12:00:00Z")
    });

    assert.equal(result.priority_level, PRIORITY_LEVELS.URGENT);
    assert.equal(result.priority_label_ar, "عاجلة جداً");
    assert.ok(result.score >= 70, `Expected score >= 70, got ${result.score}`);
    assert.ok(result.reasons.length >= 5);
    assert.ok(result.reasons.some(r => r.includes("أسرة")));
    assert.ok(result.reasons.some(r => r.includes("أطفال")));
    assert.ok(result.reasons.some(r => r.includes("عاطل عن العمل")));
    assert.ok(result.reasons.some(r => r.includes("مزمنة") || r.includes("إعاقة")));
    assert.equal(result.advisory_disclaimer, ADVISORY_DISCLAIMER_AR);

    // Inventory suggestions match
    assert.equal(result.suggested_items.length, 2);
    const foodSuggestion = result.suggested_items.find(s => s.category === "أغذية");
    assert.ok(foodSuggestion);
    assert.equal(foodSuggestion.match_status, "full");
    assert.equal(foodSuggestion.inventory_item_id, 101);

    const medSuggestion = result.suggested_items.find(s => s.category === "أدوية");
    assert.ok(medSuggestion);
    assert.equal(medSuggestion.match_status, "partial");
    assert.equal(medSuggestion.inventory_item_id, 102);
});

test("rule engine — 30-day recent support detector flags warning without blocking", () => {
    const now = new Date("2026-09-05T12:00:00Z");

    // Case 1: Distribution 10 days ago (< 30 days)
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const recentCheck = checkRecentSupport([{ id: 1, distributed_at: tenDaysAgo.toISOString() }], now);
    assert.equal(recentCheck.hasRecentSupport, true);
    assert.equal(recentCheck.daysAgo, 10);
    assert.ok(recentCheck.message.includes("10 يوماً"));
    assert.ok(recentCheck.message.includes("لا تمنع الصرف"));

    // Case 2: Distribution 45 days ago (>= 30 days)
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    const olderCheck = checkRecentSupport([{ id: 2, distributed_at: fortyFiveDaysAgo.toISOString() }], now);
    assert.equal(olderCheck.hasRecentSupport, false);
    assert.equal(olderCheck.daysAgo, 45);
    assert.equal(olderCheck.message, null);

    // Case 3: No past distributions
    const emptyCheck = checkRecentSupport([], now);
    assert.equal(emptyCheck.hasRecentSupport, false);
    assert.equal(emptyCheck.daysAgo, null);
});

/* ==========================================================================
   PART 2: INTEGRATION & HTTP API TESTS
   ========================================================================== */

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

let adminCookie = "";
let adminCsrf = "";
let createdBeneficiaryId = null;
let createdInventoryId = null;
let createdNeedId = null;
let createdDistributionId = null;

test("Phase 5 — end-to-end verification, rule recommendation, refresh, and search workflow", async () => {
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

    // 3. Security: unauthenticated access to recommendation endpoint must be rejected
    const unauthRes = await fetch(`${baseUrl}/api/beneficiaries/1/recommendation`);
    assert.equal(unauthRes.status, 401);

    // 4. Security: unauthenticated access to /verification page must redirect to login
    const unauthPageRes = await fetch(`${baseUrl}/verification`, { redirect: "manual" });
    assert.equal(unauthPageRes.status, 302);
    assert.ok(unauthPageRes.headers.get("location")?.includes("/login"));

    // 5. Create test inventory item
    const invRes = await fetch(`${baseUrl}/api/admin/inventory`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: "سلة مواد تموينية طارئة",
            category: "مواد غذائية",
            description: "سلة غذائية للمستفيدين ذوي الأولوية",
            unit: "سلة",
            quantityTotal: 40,
            lowStockThreshold: 5,
            status: "available",
            warehouse: "المخزن الرئيسي",
            location: "الجيزة",
            condition: "standard",
        }),
    });
    assert.equal(invRes.status, 201);
    const invData = await invRes.json();
    assert.ok(invData.item);
    createdInventoryId = invData.item.id;

    // 6. Create high-vulnerability beneficiary
    const benRes = await fetch(`${baseUrl}/api/beneficiaries`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: "عائلة كمال إبراهيم مصطفى",
            phone: testPhone,
            nationalId: testNationalId,
            governorate: "القاهرة",
            district: "عين شمس",
            address: "شارع أحمد عصمت",
            familySize: 7,
            childrenCount: 4,
            housingType: "إيجار شهري",
            monthlyIncome: 650,
            employmentStatus: "عاطل عن العمل بسبب إصابة",
            healthConditions: "مرض مزمن بالقلب",
            verificationStatus: "pending",
        }),
    });
    assert.equal(benRes.status, 201);
    const benData = await benRes.json();
    assert.ok(benData.beneficiary);
    createdBeneficiaryId = benData.beneficiary.id;

    // 7. Add urgent open need matching available inventory category
    const needRes = await fetch(`${baseUrl}/api/beneficiary/needs`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            beneficiaryId: createdBeneficiaryId,
            title: "سلة مواد تموينية عاجلة",
            category: "مواد غذائية",
            quantityRequested: 2,
            unit: "سلة",
            priority: "urgent",
            description: "احتياج عاجل للأطفال",
        }),
    });
    assert.equal(needRes.status, 201);
    const needData = await needRes.json();
    assert.ok(needData.need);
    createdNeedId = needData.need.id;

    // 8. Call GET /api/beneficiaries/:id/recommendation
    const recRes = await fetch(`${baseUrl}/api/beneficiaries/${createdBeneficiaryId}/recommendation`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(recRes.status, 200);
    const recData = await recRes.json();
    assert.ok(recData.recommendation);
    const rec = recData.recommendation;

    assert.equal(rec.priority_level, "urgent");
    assert.equal(rec.priority_label_ar, "عاجلة جداً");
    assert.ok(Array.isArray(rec.reasons));
    assert.ok(rec.reasons.length > 0);
    assert.equal(rec.advisory_disclaimer, ADVISORY_DISCLAIMER_AR);

    // Check inventory match in recommendation
    assert.ok(Array.isArray(rec.suggested_items));
    const matchedSuggestion = rec.suggested_items.find(s => s.category === "مواد غذائية");
    assert.ok(matchedSuggestion);
    assert.equal(matchedSuggestion.match_status, "full");
    assert.equal(matchedSuggestion.inventory_item_id, createdInventoryId);

    // Initial state: No recent distributions
    assert.equal(rec.recent_support_warning?.hasRecentSupport, false);

    // 9. Add a distribution distributed 5 days ago to test the 30-day Recent Support Detector
    const distRes = await fetch(`${baseUrl}/api/admin/distributions`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            beneficiaryId: createdBeneficiaryId,
            items: [{ inventoryItemId: createdInventoryId, quantity: 1 }],
            scheduledAt: new Date().toISOString(),
            notes: "توزيع تجريبي لاختبار كاشف الدعم الحديث",
        }),
    });
    assert.equal(distRes.status, 201);
    const distData = await distRes.json();
    createdDistributionId = distData.distribution.id;

    // Mark distribution as completed in DB to simulate recent support
    await pool.query(
        "UPDATE distributions SET status = 'completed', distributed_at = NOW() - INTERVAL '5 days' WHERE id = $1",
        [createdDistributionId]
    );

    // 10. Call POST /api/beneficiaries/:id/recommendation/refresh with CSRF
    const refreshRes = await fetch(`${baseUrl}/api/beneficiaries/${createdBeneficiaryId}/recommendation/refresh`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
    });
    assert.equal(refreshRes.status, 200);
    const refreshData = await refreshRes.json();
    assert.ok(refreshData.recommendation);
    const refreshedRec = refreshData.recommendation;

    // Verify 30-day recent support detector is active
    assert.equal(refreshedRec.recent_support_warning?.hasRecentSupport, true);
    assert.equal(refreshedRec.recent_support_warning?.daysAgo, 5);
    assert.ok(refreshedRec.recent_support_warning?.message.includes("5 يوماً"));
    assert.ok(refreshedRec.recent_support_warning?.message.includes("لا تمنع الصرف"));
    assert.ok(refreshedRec.reasons.some(r => r.includes("تنبيه تدقيق: استلم المستفيد دعماً مؤخراً")));

    // 11. Call GET /api/verification/search
    const searchRes = await fetch(`${baseUrl}/api/verification/search?q=${encodeURIComponent("كمال إبراهيم")}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(Array.isArray(searchData.results));
    const foundInSearch = searchData.results.find(r => r.id === createdBeneficiaryId);
    assert.ok(foundInSearch);
    assert.equal(foundInSearch.latestPriority, "urgent");
    assert.equal(foundInSearch.referenceCode, benData.beneficiary.referenceCode);

    // 12. Call GET /api/verification/:id
    const dossierRes = await fetch(`${baseUrl}/api/verification/${createdBeneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(dossierRes.status, 200);
    const dossierData = await dossierRes.json();
    assert.ok(dossierData.verification);
    assert.equal(dossierData.verification.beneficiary.id, createdBeneficiaryId);
    assert.equal(dossierData.verification.recommendation.priority_level, "urgent");
    assert.equal(dossierData.verification.advisory, ADVISORY_DISCLAIMER_AR);

    // 13. Access GET /verification admin page
    const pageRes = await fetch(`${baseUrl}/verification`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(pageRes.status, 200);
    const pageHtml = await pageRes.text();
    assert.ok(pageHtml.includes("التحقق والتوصيات الذكية للحالات"));
    assert.ok(pageHtml.includes("/JS/verification.js"));
    assert.ok(pageHtml.includes("إشعار استرشادي"));
});

after(async () => {

    if (createdDistributionId) {
        await pool.query("DELETE FROM distribution_items WHERE distribution_id = $1", [createdDistributionId]).catch(() => { });
        await pool.query("DELETE FROM distributions WHERE id = $1", [createdDistributionId]).catch(() => { });
    }
    if (createdNeedId) {
        await pool.query("DELETE FROM beneficiary_needs WHERE id = $1", [createdNeedId]).catch(() => { });
    }
    if (createdBeneficiaryId) {
        await pool.query("DELETE FROM beneficiary_recommendations WHERE beneficiary_id = $1", [createdBeneficiaryId]).catch(() => { });
        const userQuery = await pool.query("SELECT user_id FROM beneficiary_profiles WHERE id = $1", [createdBeneficiaryId]).catch(() => ({ rows: [] }));
        const userId = userQuery.rows[0]?.user_id;
        await pool.query("DELETE FROM beneficiary_profiles WHERE id = $1", [createdBeneficiaryId]).catch(() => { });
        if (userId) {
            await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => { });
        }
    }
    if (createdInventoryId) {
        await pool.query("DELETE FROM inventory_items WHERE id = $1", [createdInventoryId]).catch(() => { });
    }
    await pool.query("DELETE FROM users WHERE email LIKE 'ben.%@sanad.local'").catch(() => { });
    await pool.end();

    server.kill("SIGTERM");
    await once(server, "exit").catch(() => { });
});
