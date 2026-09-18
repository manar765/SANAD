import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Pool } from "pg";

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

const insertedIds = [];

test("Inventory status badges are derived from the real available quantity", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: process.env.ADMIN_EMAIL || "admin@sanad.com",
            password: process.env.ADMIN_PASSWORD || "Sanad@2026",
        }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.getSetCookie().join(";").match(/sanad_session=([^;]+)/)?.[0];
    assert.ok(cookie, "admin session cookie");

    const rows = [
        { key: "stale_out", name: `inv-check-out-${testId}`, total: 0, available: 0, threshold: 1, storage: "available", expected: "out_of_stock" },
        { key: "low", name: `inv-check-low-${testId}`, total: 10, available: 3, threshold: 5, storage: "available", expected: "low_stock" },
        { key: "ok", name: `inv-check-ok-${testId}`, total: 100, available: 100, threshold: 15, storage: "available", expected: "available" },
        { key: "surplus", name: `inv-check-surplus-${testId}`, total: 50, available: 50, threshold: 5, storage: "surplus", expected: "surplus" },
        { key: "surplus_stale", name: `inv-check-surplus-stale-${testId}`, total: 0, available: 0, threshold: 5, storage: "surplus", expected: "out_of_stock" },
        { key: "stale_out_override", name: `inv-check-stale-out-${testId}`, total: 100, available: 100, threshold: 5, storage: "out_of_stock", expected: "available" },
    ];

    for (const r of rows) {
        const res = await pool.query(
            `INSERT INTO inventory_items
               (name, category, unit, quantity_total, quantity_available, quantity_reserved,
                low_stock_threshold, status, warehouse, location, condition, description, notes)
             VALUES ($1, $2, 'حقيبة', $3, $4, 0, $5, $6, 'مخزن الاختبار', 'القاهرة', 'جديدة', '', '')
             RETURNING id`,
            [r.name, "مستلزمات مدرسية", r.total, r.available, r.threshold, r.storage],
        );
        insertedIds.push(res.rows[0].id);
    }

    const listRes = await fetch(`${baseUrl}/api/inventory`, { headers: { Cookie: cookie } });
    assert.equal(listRes.status, 200);
    const payload = await listRes.json();
    const byName = {};
    for (const item of payload.items) byName[item.name] = item;

    for (const r of rows) {
        const item = byName[r.name];
        assert.ok(item, `item ${r.key} should be listed`);
        assert.equal(item.status, r.expected, `${r.key}: ${r.name} shows ${item.status}, expected ${r.expected}`);
        assert.equal(item.quantityAvailable, r.available, `${r.key}: quantity must be the real DB quantity`);
    }

    const lowFilter = await fetch(`${baseUrl}/api/inventory?status=low_stock`, { headers: { Cookie: cookie } });
    assert.equal(lowFilter.status, 200);
    const lowPayload = await lowFilter.json();
    const lowNames = lowPayload.items.map(item => item.name);
    assert.ok(lowNames.includes(rows[1].name), "low_stock filter returns the low-stock item");
    assert.ok(!lowNames.includes(rows[2].name), "low_stock filter excludes available items");
});

after(async () => {
    if (insertedIds.length > 0) {
        await pool.query("DELETE FROM inventory_items WHERE id = ANY($1::bigint[])", [insertedIds]).catch(() => { });
    }
    await pool.end().catch(() => { });
    server.kill();
});