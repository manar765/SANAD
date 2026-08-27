import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3137;
const baseUrl = `http://127.0.0.1:${port}`;
const testSuffix = `${Date.now()}-${process.pid}`;
const users = {
    donor: {
        role: "donor",
        firstName: "اختبار",
        lastName: "متبرع",
        email: `test.donor.${testSuffix}@example.com`,
        phone: "01012345678",
        password: "TestPass123",
        donorType: "individual",
    },
    beneficiary: {
        role: "beneficiary",
        firstName: "اختبار",
        lastName: "مستفيد",
        email: `test.beneficiary.${testSuffix}@example.com`,
        phone: "01087654321",
        password: "TestPass123",
    },
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

async function signup(user) {
    const response = await request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
    });
    assert.equal(response.status, 201);
    return { response, cookie: cookieFrom(response) };
}

async function csrf(cookie) {
    const response = await request("/api/auth/csrf", {
        headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()).csrfToken;
}

async function logout(cookie) {
    const response = await request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, "X-CSRF-Token": await csrf(cookie) },
    });
    assert.equal(response.status, 200);
}

async function login(user) {
    const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, password: user.password }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.name, `${user.firstName} ${user.lastName}`);
    return { response, cookie: cookieFrom(response) };
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
        const timer = setTimeout(() => reject(new Error(`SANAD server did not start. Output: ${output}`)), 15000);
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
        const emails = [users.donor.email, users.beneficiary.email];
        await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
        await pool.end();
    }
    if (server && !server.killed) {
        server.kill("SIGTERM");
        await once(server, "exit").catch(() => { });
    }
});

test("protects pages and APIs from unauthenticated access", async () => {
    const page = await request("/donations");
    assert.equal(page.status, 302);
    assert.match(page.headers.get("location"), /\/login\?returnTo=/);

    const adminPage = await request("/admin-requests");
    assert.equal(adminPage.status, 302);

    const api = await request("/api/auth/me");
    assert.equal(api.status, 401);
});

test("allows authenticated users into protected pages but denies admin pages", async () => {
    const donor = await signup(users.donor);
    const donorPage = await request("/donations", { headers: { Cookie: donor.cookie } });
    assert.equal(donorPage.status, 200);

    const donorAdminPage = await request("/admin-requests", { headers: { Cookie: donor.cookie } });
    assert.equal(donorAdminPage.status, 403);

    const donorMe = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(donorMe.status, 200);
    assert.equal((await donorMe.json()).user.name, "اختبار متبرع");
    await logout(donor.cookie);

    const beneficiary = await signup(users.beneficiary);
    const beneficiaryPage = await request("/profile", { headers: { Cookie: beneficiary.cookie } });
    assert.equal(beneficiaryPage.status, 200);

    const beneficiaryAdminPage = await request("/admin-requests", { headers: { Cookie: beneficiary.cookie } });
    assert.equal(beneficiaryAdminPage.status, 403);
    await logout(beneficiary.cookie);
});

test("allows the configured administrator to access the admin page", async () => {
    const response = await request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(response.status, 200);
    const cookie = cookieFrom(response);
    const adminPage = await request("/admin-requests", { headers: { Cookie: cookie } });
    assert.equal(adminPage.status, 200);
    await logout(cookie);
});

test("returns the full Arabic name on login and invalidates the session on logout", async () => {
    const donor = await login(users.donor);
    const me = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.name, "اختبار متبرع");
    await logout(donor.cookie);

    const afterLogout = await request("/api/auth/me", { headers: { Cookie: donor.cookie } });
    assert.equal(afterLogout.status, 401);
});
