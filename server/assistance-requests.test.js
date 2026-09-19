import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3149;
const baseUrl = `http://127.0.0.1:${port}`;

const suffix = Date.now().toString().slice(-8);
const benPassword = "TestPass123";
const beneficiary = {
    role: "beneficiary",
    firstName: "أحمد",
    lastName: "المستفيد",
    email: `req.beneficiary.${suffix}@sanad.local`,
    phone: `010${suffix.padStart(7, "0")}`.slice(0, 11),
    nationalId: "29801011234567",
    password: benPassword,
};
const donor = {
    role: "donor",
    firstName: "خالد",
    lastName: "المتبرع",
    email: `req.donor.${suffix}@sanad.local`,
    phone: `011${suffix.padStart(7, "0")}`.slice(0, 11),
    password: benPassword,
    donorType: "individual",
};

const server = spawn(process.execPath, ["server/app.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", chunk => { logs += chunk.toString(); });
server.stderr.on("data", chunk => { logs += chunk.toString(); });

async function waitForServer() {
    let startedAt = Date.now();
    for (let attempt = 0; attempt < 600; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
            if (response.status === 200 || response.status === 503) return;
        } catch { }
        if (Date.now() - startedAt > 150000) break;
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error(`Server did not start.\n${logs}`);
}

await waitForServer();

let adminCookie = "";
let adminCsrf = "";
let benCookie = "";
let benCsrf = "";
let donorCookie = "";
let requestId = null;

function cookieFrom(response) {
    const value = response.headers.getSetCookie?.().join(";").match(/sanad_session=([^;]+)/)?.[1];
    assert.ok(value, "Expected a sanad_session cookie");
    return `sanad_session=${value}`;
}

async function login(email, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    return cookieFrom(response);
}

async function getCsrf(cookie) {
    const response = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).csrfToken;
}

test("assistance requests workflow — beneficiary submission, duplicate guard, review, and page guard", async (t) => {
    // 1. Admin login
    adminCookie = await login(
        process.env.ADMIN_EMAIL || "admin@sanad.com",
        process.env.ADMIN_PASSWORD || "Sanad@2026",
    );
    adminCsrf = await getCsrf(adminCookie);

    // 2. Unauthenticated access is rejected
    const unauthRes = await fetch(`${baseUrl}/api/assistance-requests`);
    assert.equal(unauthRes.status, 401);

    // 3. Register beneficiary + donor accounts
    const benSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beneficiary),
    });
    assert.equal(benSignupRes.status, 201);
    benCookie = cookieFrom(benSignupRes);
    benCsrf = await getCsrf(benCookie);

    const donSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(donor),
    });
    assert.equal(donSignupRes.status, 201);
    donorCookie = cookieFrom(donSignupRes);

    // 4. Donor is not allowed to submit or view assistance requests
    const donorPostRes = await fetch(`${baseUrl}/api/assistance-requests`, {
        method: "POST",
        headers: {
            Cookie: donorCookie,
            "X-CSRF-Token": await getCsrf(donorCookie),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemName: "شنط مدرسية", category: "شنط مدرسية", quantity: 2 }),
    });
    assert.equal(donorPostRes.status, 403);

    const donorMyRes = await fetch(`${baseUrl}/api/assistance-requests/my`, {
        headers: { Cookie: donorCookie },
    });
    assert.equal(donorMyRes.status, 403);

    // 5. Beneficiary submits an assistance request
    const createRes = await fetch(`${baseUrl}/api/assistance-requests`, {
        method: "POST",
        headers: {
            Cookie: benCookie,
            "X-CSRF-Token": benCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            itemName: "شنط مدرسية",
            category: "شنط مدرسية",
            description: "3 أطفال في المدرسة ويحتاجون شنط جديدة",
            quantity: 3,
            unit: "حقيبة",
            notes: "بداية العام الدراسي",
        }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()).request;
    assert.ok(created);
    requestId = created.id;
    assert.match(created.referenceCode, /^REQ-\d{4}$/);
    assert.equal(created.status, "pending");
    assert.equal(created.quantity, 3);
    assert.equal(created.unit, "حقيبة");
    assert.equal(created.beneficiaryName, beneficiary.fullName || `${beneficiary.firstName} ${beneficiary.lastName}`);

    // 5b. The requested item is immediately linked to the beneficiary's needs as an open need
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const needRes = await pool.query(
        `SELECT id, title, status, category, quantity_requested AS "quantityRequested", unit, assistance_request_id AS "aid"
         FROM beneficiary_needs WHERE beneficiary_id = $1`,
        [created.beneficiaryId],
    );
    assert.equal(needRes.rowCount, 1);
    assert.equal(needRes.rows[0].title, "شنط مدرسية");
    assert.equal(needRes.rows[0].category, "شنط مدرسية");
    assert.equal(needRes.rows[0].status, "open");
    assert.equal(Number(needRes.rows[0].quantityRequested), 3);
    assert.equal(needRes.rows[0].unit, "حقيبة");
    assert.equal(Number(needRes.rows[0].aid), requestId);

    // 5c. Admin opens the beneficiary from the Beneficiaries page — the requested item
    //     appears in the beneficiary's Needs section with the related request code.
    const benDetailRes = await fetch(`${baseUrl}/api/beneficiaries/${created.beneficiaryId}`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(benDetailRes.status, 200);
    const benDetail = (await benDetailRes.json()).beneficiary;
    assert.ok(Array.isArray(benDetail.needs), "Beneficiary detail must include a needs array");
    const matchedNeed = benDetail.needs.find(n => Number(n.assistanceRequestId) === requestId);
    assert.ok(matchedNeed, "The requested item must be linked as a need of this beneficiary");
    assert.equal(matchedNeed.title, "شنط مدرسية");
    assert.equal(matchedNeed.category, "شنط مدرسية");
    assert.equal(Number(matchedNeed.quantityRequested), 3);
    assert.equal(matchedNeed.unit, "حقيبة");
    assert.equal(matchedNeed.assistanceRequestCode, created.referenceCode);
    assert.equal(matchedNeed.status, "open");

    // 6. Duplicate pending request is rejected with 409
    const duplicateRes = await fetch(`${baseUrl}/api/assistance-requests`, {
        method: "POST",
        headers: {
            Cookie: benCookie,
            "X-CSRF-Token": benCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemName: "شنط مدرسية", category: "شنط مدرسية", quantity: 1 }),
    });
    assert.equal(duplicateRes.status, 409);
    const duplicateData = await duplicateRes.json();
    assert.equal(duplicateData.code, "DUPLICATE_ASSISTANCE_REQUEST");
    assert.equal(duplicateData.details.referenceCode, created.referenceCode);

    // 7. Validation — missing quantity
    const invalidRes = await fetch(`${baseUrl}/api/assistance-requests`, {
        method: "POST",
        headers: {
            Cookie: benCookie,
            "X-CSRF-Token": benCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemName: "ملابس", category: "ملابس" }),
    });
    assert.equal(invalidRes.status, 400);

    // 8. Beneficiary lists own requests
    const myRes = await fetch(`${baseUrl}/api/assistance-requests/my`, {
        headers: { Cookie: benCookie },
    });
    assert.equal(myRes.status, 200);
    const myData = await myRes.json();
    assert.ok(Array.isArray(myData.requests));
    assert.ok(myData.requests.some(r => r.id === requestId));
    assert.ok(myData.requests.every(r => r.statusLabel));

    // 9. Admin lists all requests and filters by pending
    const listRes = await fetch(`${baseUrl}/api/assistance-requests`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.requests));
    assert.ok(listData.requests.some(r => r.id === requestId));

    const pendingRes = await fetch(`${baseUrl}/api/assistance-requests?status=pending`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(pendingRes.status, 200);
    const pendingData = await pendingRes.json();
    assert.ok(pendingData.requests.some(r => r.id === requestId && r.status === "pending"));

    // 10. Admin approves the request → a beneficiary need is created
    const approveRes = await fetch(`${baseUrl}/api/admin/assistance-requests/${requestId}/status`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(approveRes.status, 200);
    const approved = (await approveRes.json()).request;
    assert.equal(approved.status, "approved");
    assert.equal(approved.statusLabel, "تمت الموافقة");
    assert.ok(approved.reviewedAt);

    const needAfterApprove = await pool.query(
        `SELECT id, title, status, assistance_request_id AS "aid" FROM beneficiary_needs WHERE beneficiary_id = $1`,
        [created.beneficiaryId],
    );
    assert.equal(needAfterApprove.rowCount, 1);
    assert.equal(needAfterApprove.rows[0].title, "شنط مدرسية");
    assert.equal(needAfterApprove.rows[0].status, "open");
    assert.equal(Number(needAfterApprove.rows[0].aid), requestId);

    // 11. Invalid status transition — pending is not allowed
    const invalidStatusRes = await fetch(`${baseUrl}/api/admin/assistance-requests/${requestId}/status`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "pending" }),
    });
    assert.equal(invalidStatusRes.status, 400);

    // 12. Admin marks as fulfilled
    const fulfillRes = await fetch(`${baseUrl}/api/admin/assistance-requests/${requestId}/status`, {
        method: "PATCH",
        headers: {
            Cookie: adminCookie,
            "X-CSRF-Token": adminCsrf,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "fulfilled" }),
    });
    assert.equal(fulfillRes.status, 200);
    assert.equal((await fulfillRes.json()).request.status, "fulfilled");

    // 12b. The linked need is marked fulfilled with quantity_fulfilled set
    const needAfterFulfill = await pool.query(
        `SELECT status, quantity_fulfilled AS "quantityFulfilled" FROM beneficiary_needs WHERE assistance_request_id = $1`,
        [requestId],
    );
    assert.equal(needAfterFulfill.rowCount, 1);
    assert.equal(needAfterFulfill.rows[0].status, "fulfilled");
    assert.equal(Number(needAfterFulfill.rows[0].quantityFulfilled), 3);

    // 13. /request-assistance page renders for beneficiaries but is blocked for donors
    const pageRes = await fetch(`${baseUrl}/request-assistance`, { headers: { Cookie: benCookie } });
    assert.equal(pageRes.status, 200);
    const pageHtml = await pageRes.text();
    assert.ok(pageHtml.includes("طلب مساعدة"));
    assert.ok(pageHtml.includes("/JS/request-assistance.js"));

    const donorPageRes = await fetch(`${baseUrl}/request-assistance`, { headers: { Cookie: donorCookie } });
    assert.equal(donorPageRes.status, 403);

    // 14. The admin requests page renders with the assistance tab
    const adminPageRes = await fetch(`${baseUrl}/admin-requests`, { headers: { Cookie: adminCookie } });
    assert.equal(adminPageRes.status, 200);
    const adminHtml = await adminPageRes.text();
    assert.ok(adminHtml.includes("tabAssistanceBtn"));
    assert.ok(adminHtml.includes("assistanceTableBody"));

    await pool.end();

    });

after(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const emails = [beneficiary.email, donor.email];
    const userRows = await pool.query(
        "SELECT id, role FROM users WHERE email = ANY($1)",
        [emails],
    ).catch(() => ({ rows: [] }));

    for (const user of userRows.rows) {
        await pool.query("DELETE FROM beneficiary_profiles WHERE user_id = $1", [user.id]).catch(() => { });
        await pool.query("DELETE FROM donor_profiles WHERE user_id = $1", [user.id]).catch(() => { });
        await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [user.id]).catch(() => { });
        await pool.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => { });
    }

    if (requestId) {
        await pool.query("DELETE FROM assistance_requests WHERE id = $1", [requestId]).catch(() => { });
    }
    await pool.query(
        "DELETE FROM users WHERE email LIKE 'req.beneficiary.%@sanad.local' OR email LIKE 'req.donor.%@sanad.local'",
    ).catch(() => { });
    await pool.end().catch(() => { });
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => { });
});