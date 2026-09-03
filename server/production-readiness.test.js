import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

const port = 3141;
const baseUrl = `http://127.0.0.1:${port}`;
const email = `production.audit.${Date.now()}@example.com`;
const server = spawn(process.execPath, ["server/app.js"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
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
    throw new Error(`Production server did not start.\n${logs}`);
}

await waitForServer();

test("uses Secure cookies and generic production API errors", async () => {
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            role: "donor",
            firstName: "اختبار",
            lastName: "الإنتاج",
            email,
            phone: "01012345678",
            password: "ProductionPass123",
            donorType: "individual",
        }),
    });
    assert.equal(signup.status, 201);
    const cookies = signup.headers.getSetCookie().join(";");
    assert.match(cookies, /HttpOnly/);
    assert.match(cookies, /SameSite=Lax/);
    assert.match(cookies, /Secure/);

    const missingApi = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(missingApi.status, 404);
    const body = await missingApi.text();
    assert.doesNotMatch(body, /stack|Error:|node_modules/i);
});

after(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("DELETE FROM users WHERE email = $1", [email]).catch(() => { });
    await pool.end();
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => { });
});
