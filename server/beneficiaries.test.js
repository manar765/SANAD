import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3142;
const baseUrl = `http://127.0.0.1:${port}`;
const testPhone = `010${Date.now().toString().slice(-8)}`;
const testNationalId = "29801011234567";

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

test("beneficiary workflow — creation, listing, masking, search, and verification", async (t) => {
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
    const unauthRes = await fetch(`${baseUrl}/api/beneficiaries`);
    assert.equal(unauthRes.status, 401);

    // 4. Create Beneficiary Profile
    const createRes = await fetch(`${baseUrl}/api/beneficiaries`, {
        method: "POST",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: "عائلة محمد حسن علي",
            phone: testPhone,
            nationalId: testNationalId,
            governorate: "الجيزة",
            district: "الدقي",
            address: "شارع مصدق، عمارة 12",
            familySize: 5,
            childrenCount: 3,
            housingType: "إيجار جديد",
            monthlyIncome: 3200,
            employmentStatus: "عمالة غير منتظمة",
            healthConditions: "طفل يعاني من حساسية صدرية مزمنة",
            notes: "حالة تستحق الدعم الغذائي والعلاجي الشهري",
            verificationStatus: "pending",
        }),
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.ok(createData.beneficiary);
    createdBeneficiaryId = createData.beneficiary.id;
    assert.match(createData.beneficiary.referenceCode, /^BEN-\d{4}$/);
    assert.equal(createData.beneficiary.familySize, 5);
    assert.equal(createData.beneficiary.childrenCount, 3);
    assert.equal(createData.beneficiary.verificationStatus, "pending");

    // 5. List beneficiaries and check data masking (nationalId masked in list)
    const listRes = await fetch(`${baseUrl}/api/beneficiaries`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.beneficiaries));
    const found = listData.beneficiaries.find(b => b.id === createdBeneficiaryId);
    assert.ok(found);
    assert.equal(found.referenceCode, createData.beneficiary.referenceCode);
    assert.equal(found.nationalId, `${testNationalId.slice(0, 3)}****${testNationalId.slice(-4)}`);

    // 6. Search by name and reference code
    const searchRes = await fetch(`${baseUrl}/api/beneficiaries?search=${encodeURIComponent("محمد حسن")}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(searchData.beneficiaries.some(b => b.id === createdBeneficiaryId));

    const codeSearchRes = await fetch(`${baseUrl}/api/beneficiaries?search=${createData.beneficiary.referenceCode}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(codeSearchRes.status, 200);
    const codeSearchData = await codeSearchRes.json();
    assert.ok(codeSearchData.beneficiaries.some(b => b.id === createdBeneficiaryId));

    // 7. Get single beneficiary detail (full nationalId exposed for authorized detail view)
    const detailRes = await fetch(`${baseUrl}/api/beneficiaries/${createdBeneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.equal(detailData.beneficiary.nationalId, testNationalId);
    assert.ok(Array.isArray(detailData.beneficiary.needs));
    assert.ok(Array.isArray(detailData.beneficiary.distributions));

    // 8. Update verification status
    const verifyRes = await fetch(`${baseUrl}/api/beneficiaries/${createdBeneficiaryId}/verification`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.beneficiary.verificationStatus, "verified");
    assert.ok(verifyData.beneficiary.verifiedAt);

    // 9. Check page route /beneficiaries renders
    const pageRes = await fetch(`${baseUrl}/beneficiaries`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(pageRes.status, 200);
    const pageHtml = await pageRes.text();
    assert.ok(pageHtml.includes("سجل المستفيدين"));
    assert.ok(pageHtml.includes("/JS/beneficiaries.js"));
    assert.ok(pageHtml.includes("/CSS/style.css"));

    // 10. National ID validation — invalid values rejected on create
    const invalidNationalIds = [
        "2890401123",            // too short
        "289040112345678",       // too long
        "28a04011234567",        // contains letters
        "28904011 234567",       // contains separators
        "28904011234567a",       // trailing letter
    ];
    for (const bad of invalidNationalIds) {
        const badRes = await fetch(`${baseUrl}/api/beneficiaries`, {
            method: "POST",
            headers: {
                Cookie: adminCookie,
                "X-CSRF-Token": adminCsrf,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: "حالة اختبار رقم قومي غير صالح",
                phone: `011${Date.now().toString().slice(-8)}`,
                nationalId: bad,
                governorate: "الجيزة",
            }),
        });
        assert.equal(badRes.status, 400, `nationalId '${bad}' must be rejected`);
        const badData = await badRes.json();
        assert.ok(String(badData.message).includes("14"), "rejection message must explain the 14-digit rule");
    }

    // 11. National ID validation — invalid value rejected on edit
    const badEditRes = await fetch(`${baseUrl}/api/beneficiaries/${createdBeneficiaryId}`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ nationalId: "123" }),
    });
    assert.equal(badEditRes.status, 400, "invalid nationalId must be rejected on edit");
});

after(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    if (createdBeneficiaryId) {
        const userQuery = await pool.query(
            "SELECT user_id FROM beneficiary_profiles WHERE id = $1",
            [createdBeneficiaryId],
        ).catch(() => ({ rows: [] }));
        const userId = userQuery.rows[0]?.user_id;

        await pool.query("DELETE FROM beneficiary_profiles WHERE id = $1", [createdBeneficiaryId]).catch(() => { });
        if (userId) {
            await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => { });
        }
    }
    await pool.query("DELETE FROM users WHERE email LIKE 'ben.%@sanad.local'").catch(() => { });
    await pool.end();
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => { });
});
