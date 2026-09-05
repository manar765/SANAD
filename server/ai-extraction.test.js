import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import {
    extractCaseNotes,
    extractNotesHeuristic,
    normalizeArabicNumbers,
    MANDATORY_AI_DISCLAIMER,
} from "./ai-service.js";

const port = 3146;
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

test("Phase 7: AI-Assisted Case Note Extraction — Unit & End-to-End Suite", async (t) => {
    // ------------------------------------------------------------------------
    // 1. Unit Tests for Arabic NLP Heuristic Extractor
    // ------------------------------------------------------------------------
    await t.test("unit: normalizeArabicNumbers converts Eastern digits to ASCII", () => {
        assert.equal(normalizeArabicNumbers("٠١٢٣٤٥٦٧٨٩"), "0123456789");
        assert.equal(normalizeArabicNumbers("أسرة من ٥ أفراد ودخل ٢٥٠٠ جنيه"), "أسرة من 5 أفراد ودخل 2500 جنيه");
    });

    await t.test("unit: extractNotesHeuristic parses complex Arabic social report", () => {
        const rawNote = `
        تقرير زيارة ميدانية:
        قام الباحث بزيارة أسرة المواطن محمود أحمد الشريف (هاتف: 01012345678، رقم قومي: 28904011234567) المقيم بمركز أوسيم بمحافظة الجيزة.
        الأسرة مكونة من 6 أفراد بينهم 4 أطفال، منهم 3 في سن المدرسة.
        تسكن الأسرة في شقة إيجار جديد.
        يعمل رب الأسرة عمالة يومية في البناء بدخل شهري لا يتجاوز 2500 جنيه.
        الزوجة تعاني من مرض السكري المزمن وتتطلب علاجاً شهرياً مستمراً.
        تحتاج الأسرة بشكل عاجل إلى طرد مواد غذائية، وكسوة مدرسية للأطفال، ودعم علاجي للزوجة.
        `;

        const res = extractNotesHeuristic(rawNote);

        assert.equal(res.name, "محمود أحمد الشريف");
        assert.equal(res.phone, "01012345678");
        assert.equal(res.nationalId, "28904011234567");
        assert.equal(res.governorate, "الجيزة");
        assert.equal(res.district, "أوسيم");
        assert.equal(res.familySize, 6);
        assert.equal(res.childrenCount, 4);
        assert.equal(res.schoolAgeChildren, 3);
        assert.equal(res.housingType, "إيجار جديد");
        assert.equal(res.monthlyIncome, 2500);
        assert.match(res.employmentStatus, /عمالة يومية/);
        assert.match(res.healthConditions, /مرض السكري/);
        assert.ok(res.needs.length >= 2, "Must extract food, clothing or medical needs");
        assert.ok(res.needs.some(n => n.category === "طعام"));
        assert.ok(res.needs.some(n => n.category === "كسوة"));
        assert.ok(res.needs.some(n => n.category === "أدوية ومستلزمات طبية"));
        assert.ok(res.summary.includes("محمود أحمد الشريف"));
    });

    await t.test("unit: extractCaseNotes enforces input length validation and disclaimer", async () => {
        await assert.rejects(
            async () => extractCaseNotes("قصير"),
            (err) => err.code === "NOTE_TOO_SHORT" && err.statusCode === 400
        );

        const longText = "أ".repeat(10001);
        await assert.rejects(
            async () => extractCaseNotes(longText),
            (err) => err.code === "NOTE_TOO_LONG" && err.statusCode === 400
        );

        const validRes = await extractCaseNotes("تقرير حالة المواطن أحمد علي في القاهرة برقم 01112223334 ولديه 3 أطفال", { forceHeuristic: true });
        assert.equal(validRes.success, true);
        assert.equal(validRes.disclaimer, MANDATORY_AI_DISCLAIMER);
        assert.equal(validRes.data.governorate, "القاهرة");
    });

    // ------------------------------------------------------------------------
    // 2. Integration / API Route Tests for POST /api/ai/analyze
    // ------------------------------------------------------------------------

    // Admin login
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

    const adminCsrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: adminCookie } });
    assert.equal(adminCsrfRes.status, 200);
    adminCsrf = (await adminCsrfRes.json()).csrfToken;
    assert.ok(adminCsrf);

    // Create donor session directly in DB
    const sessionToken = `test_donor_session_${testId}`;
    const tokenHash = (await import("node:crypto")).createHash("sha256").update(sessionToken).digest("hex");
    donorCsrf = `donor-csrf-${testId}`;
    await pool.query(
        `INSERT INTO user_sessions (token_hash, role, email, csrf_token, expires_at, last_seen_at)
         VALUES ($1, 'donor', $2, $3, NOW() + INTERVAL '1 hour', NOW())`,
        [tokenHash, `donor.${testId}@test.com`, donorCsrf]
    );
    donorCookie = `sanad_session=${sessionToken}`;

    await t.test("api: rejects unauthenticated requests with 401", async () => {
        const res = await fetch(`${baseUrl}/api/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: "تقرير اجتماعي مفصل يحتوي على نص كافٍ." }),
        });
        assert.equal(res.status, 401);
    });

    await t.test("api: rejects non-admin users with 403", async () => {
        const res = await fetch(`${baseUrl}/api/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: donorCookie, "X-CSRF-Token": donorCsrf },
            body: JSON.stringify({ notes: "تقرير اجتماعي مفصل يحتوي على نص كافٍ." }),
        });
        assert.equal(res.status, 403);
    });

    await t.test("api: rejects missing CSRF token with 403", async () => {
        const res = await fetch(`${baseUrl}/api/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: adminCookie },
            body: JSON.stringify({ notes: "تقرير اجتماعي مفصل يحتوي على نص كافٍ." }),
        });
        assert.equal(res.status, 403);
    });

    await t.test("api: rejects short or empty notes with 400", async () => {
        const res = await fetch(`${baseUrl}/api/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
            body: JSON.stringify({ notes: "قصير" }),
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.code, "NOTE_TOO_SHORT");
    });

    let extractedResult = null;
    await t.test("api: successful case note extraction returns structured fields and disclaimer", async () => {
        const caseNote = `
        بحث اجتماعي عاجل: المواطنة فاطمة إبراهيم خليل (هاتف: 01223344556، رقم قومي: 29205121234567) تقيم بحي المطرية بمحافظة القاهرة.
        الأسرة تتكون من 5 أفراد ولديها 3 أطفال بينهم 2 في سن المدرسة.
        السكن بنظام إيجار جديد بألف جنيه، ودخل الأسرة الشهري حوالي 1800 جنيه من عمل باليومية.
        الأسرة تطلب سلة تموينية غذائية وكسوة مدرسية للأطفال.
        `;

        // Record initial count of beneficiaries in DB to verify safety
        const countBefore = await pool.query("SELECT COUNT(*) FROM beneficiary_profiles");

        const res = await fetch(`${baseUrl}/api/ai/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
            body: JSON.stringify({ notes: caseNote, forceHeuristic: true }),
        });
        assert.equal(res.status, 200);

        extractedResult = await res.json();
        assert.equal(extractedResult.success, true);
        assert.ok(extractedResult.provider);
        assert.equal(extractedResult.disclaimer, MANDATORY_AI_DISCLAIMER);
        assert.equal(extractedResult.data.name, "فاطمة إبراهيم خليل");
        assert.equal(extractedResult.data.phone, "01223344556");
        assert.equal(extractedResult.data.nationalId, "29205121234567");
        assert.equal(extractedResult.data.governorate, "القاهرة");
        assert.equal(extractedResult.data.familySize, 5);
        assert.equal(extractedResult.data.childrenCount, 3);
        assert.equal(extractedResult.data.monthlyIncome, 1800);
        assert.ok(extractedResult.data.needs.length > 0);

        // Safety verification: calling AI analyze MUST NOT insert any beneficiary record directly
        const countAfter = await pool.query("SELECT COUNT(*) FROM beneficiary_profiles");
        assert.equal(countBefore.rows[0].count, countAfter.rows[0].count, "AI extraction must never insert records directly without human staff saving!");
    });

    await t.test("api: audit log recorded for AI extraction event", async () => {
        const auditRes = await pool.query(
            `SELECT action, metadata FROM audit_logs
             WHERE action = 'ai_case_note_extracted'
             ORDER BY created_at DESC LIMIT 1`
        );
        assert.ok(auditRes.rows.length > 0, "Audit log must contain ai_case_note_extracted event");
        assert.equal(auditRes.rows[0].action, "ai_case_note_extracted");
        assert.equal(auditRes.rows[0].metadata.hasName, true);
        assert.equal(auditRes.rows[0].metadata.familySize, 5);
    });
});

after(async () => {
    try {
        await pool.query("DELETE FROM user_sessions WHERE token_hash LIKE $1", [`%${testId}%`]).catch(() => { });
    } finally {
        await pool.end().catch(() => { });
        server.kill("SIGTERM");
        server.kill();
        await once(server, "exit").catch(() => { });
    }
});
