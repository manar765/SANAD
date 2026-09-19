import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { createTotpCode } from "./mfa-service.js";

const port = 3149;
const baseUrl = `http://127.0.0.1:${port}`;
const testSuffix = `${Date.now()}-${process.pid}`;
const testUser = {
    role: "donor",
    firstName: "اختبار",
    lastName: "مفتاح",
    email: `mfa.test.${testSuffix}@example.com`,
    phone: "01099998888",
    password: "MfaPassword123!",
    donorType: "individual",
};

let server;
let pool;

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

async function csrf(cookie) {
    const response = await request("/api/auth/csrf", {
        headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()).csrfToken;
}

before(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
        await pool.query("DELETE FROM users WHERE email = $1", [testUser.email]).catch(() => {});
        await pool.end().catch(() => {});
    }
    if (server && !server.killed) {
        server.kill("SIGTERM");
    }
});

test("MFA Lifecycle: setup, wrong code, reload persistence, enable, disable, and cancel", async (t) => {
    // 1. Sign up test user
    const signupRes = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testUser),
    });
    assert.equal(signupRes.status, 201);
    const sessionCookie = cookieFrom(signupRes);
    const csrfToken = await csrf(sessionCookie);

    // 2. Initial state: MFA is disabled
    await t.test("Initial MFA state is disabled", async () => {
        const res = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.enabled, false);
        assert.equal(data.enabledAt, null);
    });

    // 3. Start setup, then enter wrong code
    let setupData;
    await t.test("Start setup and fail with wrong code", async () => {
        const setupRes = await request("/api/profile/mfa/setup", {
            method: "POST",
            headers: { Cookie: sessionCookie, "X-CSRF-Token": csrfToken },
        });
        assert.equal(setupRes.status, 200);
        setupData = await setupRes.json();
        assert.ok(setupData.secret);
        assert.ok(setupData.setupToken);

        // Submit wrong code
        const enableRes = await request("/api/profile/mfa/enable", {
            method: "POST",
            headers: {
                Cookie: sessionCookie,
                "X-CSRF-Token": csrfToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: "000000", setupToken: setupData.setupToken }),
        });
        assert.equal(enableRes.status, 400);
    });

    // 4. CRITICAL CHECK: Reloading screen after wrong code MUST NOT show MFA as enabled
    await t.test("After wrong code, reloading MFA profile returns enabled: false", async () => {
        const reloadRes = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(reloadRes.status, 200);
        const reloadData = await reloadRes.json();
        assert.equal(reloadData.enabled, false, "MFA must not be enabled after failed attempt and reload");
        assert.equal(reloadData.enabledAt, null);
    });

    // 5. Setup again and enable with valid code
    await t.test("Enable MFA with valid TOTP code", async () => {
        const setupRes = await request("/api/profile/mfa/setup", {
            method: "POST",
            headers: { Cookie: sessionCookie, "X-CSRF-Token": csrfToken },
        });
        assert.equal(setupRes.status, 200);
        setupData = await setupRes.json();

        const validCode = createTotpCode(setupData.secret);
        const enableRes = await request("/api/profile/mfa/enable", {
            method: "POST",
            headers: {
                Cookie: sessionCookie,
                "X-CSRF-Token": csrfToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: validCode, setupToken: setupData.setupToken }),
        });
        assert.equal(enableRes.status, 200);

        const profileRes = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(profileRes.status, 200);
        const profileData = await profileRes.json();
        assert.equal(profileData.enabled, true);
        assert.ok(profileData.enabledAt);
    });

    // 6. Disable MFA
    await t.test("Disable MFA with password", async () => {
        const disableRes = await request("/api/profile/mfa/disable", {
            method: "POST",
            headers: {
                Cookie: sessionCookie,
                "X-CSRF-Token": csrfToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ password: testUser.password }),
        });
        assert.equal(disableRes.status, 200);

        const profileRes = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(profileRes.status, 200);
        const profileData = await profileRes.json();
        assert.equal(profileData.enabled, false);
        assert.equal(profileData.enabledAt, null);
    });

    // 7. Test user scenario: re-enable, enter wrong code, reload, verify still disabled
    await t.test("Re-enabling with wrong code then reloading keeps MFA disabled", async () => {
        const setupRes = await request("/api/profile/mfa/setup", {
            method: "POST",
            headers: { Cookie: sessionCookie, "X-CSRF-Token": csrfToken },
        });
        assert.equal(setupRes.status, 200);
        const secondSetup = await setupRes.json();

        // Wrong code
        const wrongRes = await request("/api/profile/mfa/enable", {
            method: "POST",
            headers: {
                Cookie: sessionCookie,
                "X-CSRF-Token": csrfToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: "999999", setupToken: secondSetup.setupToken }),
        });
        assert.equal(wrongRes.status, 400);

        // Screen reload
        const reloadRes = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(reloadRes.status, 200);
        const reloadData = await reloadRes.json();
        assert.equal(reloadData.enabled, false);
        assert.equal(reloadData.enabledAt, null);
    });

    // 8. Cancel setup flow
    await t.test("Cancel pending MFA setup clears setup state", async () => {
        const setupRes = await request("/api/profile/mfa/setup", {
            method: "POST",
            headers: { Cookie: sessionCookie, "X-CSRF-Token": csrfToken },
        });
        assert.equal(setupRes.status, 200);

        const cancelRes = await request("/api/profile/mfa/cancel", {
            method: "POST",
            headers: { Cookie: sessionCookie, "X-CSRF-Token": csrfToken },
        });
        assert.equal(cancelRes.status, 200);

        const profileRes = await request("/api/profile/mfa", {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(profileRes.status, 200);
        const profileData = await profileRes.json();
        assert.equal(profileData.enabled, false);
        assert.equal(profileData.enabledAt, null);
    });
});
