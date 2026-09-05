import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const root = process.cwd();
const port = 3140;
const baseUrl = `http://127.0.0.1:${port}`;
const pageRoutes = [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/dashboard",
    "/profile",
    "/donations",
    "/admin-requests",
    "/inventory",
    "/beneficiaries",
    "/distributions",
    "/verification",
];

const server = spawn(process.execPath, ["server/app.js"], {
    cwd: root,
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

try {
    await waitForServer();
    const pageResults = [];
    for (const route of pageRoutes) {
        const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
        pageResults.push({ route, status: response.status });
        assert.ok(response.status < 500, `${route} returned ${response.status}`);
    }

    const auditUser = {
        role: "donor",
        firstName: "فحص",
        lastName: "الروابط",
        email: `site.audit.${Date.now()}@example.com`,
        phone: "01012345678",
        password: "SiteAuditPass123",
        donorType: "individual",
    };
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(auditUser),
    });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(cookie);
    const protectedResults = [];
    for (const route of pageRoutes.slice(5)) {
        const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, redirect: "manual" });
        protectedResults.push({ route, status: response.status });
        assert.ok(response.status < 500, `${route} returned ${response.status} for an authenticated donor`);
    }

    const references = new Set();
    for (const file of readdirSync(join(root, "public/views/pages"))) {
        if (!file.endsWith(".ejs")) continue;
        const html = readFileSync(join(root, "public/views/pages", file), "utf8");
        for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) references.add(match[1]);
    }

    const assetResults = [];
    for (const reference of references) {
        if (!reference.startsWith("/")) continue;
        if (reference.startsWith("/#") || reference === "/") continue;
        const response = await fetch(`${baseUrl}${reference}`, { redirect: "manual" });
        assetResults.push({ reference, status: response.status });
        assert.ok(response.status < 400, `${reference} returned ${response.status}`);
    }

    console.log(JSON.stringify({ pageResults, protectedResults, assetResults }, null, 2));
} finally {
    const cleanupPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanupPool.query("DELETE FROM users WHERE email LIKE 'site.audit.%@example.com'").catch(() => { });
    await cleanupPool.end().catch(() => { });
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => { });
}
