import pool from "./database/index.js";

const inventorySelect = `
  SELECT i.id, i.source_donation_id AS "sourceDonationId", i.name, i.category,
         i.description, i.unit, i.quantity_total AS "quantityTotal",
         i.quantity_available AS "quantityAvailable", i.quantity_reserved AS "quantityReserved",
         i.low_stock_threshold AS "lowStockThreshold", i.status, i.warehouse, i.location,
         i.condition, i.expiration_date AS "expirationDate", i.notes,
         i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt"
  FROM inventory_items i
`;

export async function listInventory({ status, category } = {}) {
    const values = [];
    const where = [];
    if (status) { values.push(status); where.push(`i.status = $${values.length}`); }
    if (category) { values.push(category); where.push(`i.category = $${values.length}`); }
    const result = await pool.query(`${inventorySelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.updated_at DESC`, values);
    return result.rows;
}

export async function createInventoryItem(input, userId) {
    const result = await pool.query(
        `INSERT INTO inventory_items
      (source_donation_id, name, category, description, unit, quantity_total, quantity_available,
       quantity_reserved, low_stock_threshold, status, warehouse, location, condition, expiration_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
        [input.sourceDonationId || null, input.name, input.category, input.description, input.unit,
        input.quantityTotal, input.lowStockThreshold, input.status, input.warehouse, input.location, input.condition,
        input.expirationDate || null, input.notes || "", userId || null],
    );
    const rows = await pool.query(`${inventorySelect} WHERE i.id = $1`, [result.rows[0].id]);
    return rows.rows[0];
}

export async function updateInventoryItem(id, input) {
    const result = await pool.query(
        `UPDATE inventory_items SET
       name = COALESCE($2, name), category = COALESCE($3, category), description = COALESCE($4, description),
       low_stock_threshold = COALESCE($5, low_stock_threshold), status = COALESCE($6, status),
       warehouse = COALESCE($7, warehouse), location = COALESCE($8, location),
       expiration_date = COALESCE($9, expiration_date), notes = COALESCE($10, notes),
       updated_at = NOW()
     WHERE id = $1 RETURNING id`,
        [id, input.name ?? null, input.category ?? null, input.description ?? null, input.lowStockThreshold ?? null,
            input.status ?? null, input.warehouse ?? null, input.location ?? null, input.expirationDate ?? null, input.notes ?? null],
    );
    if (!result.rows[0]) return null;
    const rows = await pool.query(`${inventorySelect} WHERE i.id = $1`, [id]);
    return rows.rows[0];
}

const needSelect = `
  SELECT n.id, n.beneficiary_id AS "beneficiaryId", n.title, n.description, n.category,
         n.quantity_requested AS "quantityRequested", n.quantity_fulfilled AS "quantityFulfilled",
         n.unit, n.priority, n.status, n.due_date AS "dueDate", n.created_at AS "createdAt", n.updated_at AS "updatedAt",
         COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName"
  FROM beneficiary_needs n
  JOIN beneficiary_profiles bp ON bp.id = n.beneficiary_id
  JOIN users u ON u.id = bp.user_id
`;

export async function listBeneficiaryNeeds({ beneficiaryId, priority, status } = {}) {
    const values = [];
    const where = [];
    if (beneficiaryId) { values.push(beneficiaryId); where.push(`n.beneficiary_id = $${values.length}`); }
    if (priority) { values.push(priority); where.push(`n.priority = $${values.length}`); }
    if (status) { values.push(status); where.push(`n.status = $${values.length}`); }
    const result = await pool.query(`${needSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY n.priority DESC, n.created_at DESC`, values);
    return result.rows;
}

export async function getBeneficiaryProfileId(userId) {
    const result = await pool.query("SELECT id FROM beneficiary_profiles WHERE user_id = $1", [userId]);
    return result.rows[0]?.id || null;
}

export async function createBeneficiaryNeed(input, beneficiaryId) {
    const result = await pool.query(
        `INSERT INTO beneficiary_needs
      (beneficiary_id, title, description, category, quantity_requested, unit, priority, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [beneficiaryId, input.title, input.description, input.category, input.quantityRequested, input.unit, input.priority, input.dueDate || null],
    );
    const rows = await pool.query(`${needSelect} WHERE n.id = $1`, [result.rows[0].id]);
    return rows.rows[0];
}

export async function updateBeneficiaryNeed(id, input, beneficiaryId = null) {
    const result = await pool.query(
        `UPDATE beneficiary_needs SET
       title = COALESCE($2, title), description = COALESCE($3, description), category = COALESCE($4, category),
       quantity_requested = COALESCE($5, quantity_requested), quantity_fulfilled = COALESCE($6, quantity_fulfilled),
       unit = COALESCE($7, unit), priority = COALESCE($8, priority), status = COALESCE($9, status),
       due_date = COALESCE($10, due_date), updated_at = NOW()
     WHERE id = $1 AND ($11::integer IS NULL OR beneficiary_id = $11)
     RETURNING id`,
        [id, input.title ?? null, input.description ?? null, input.category ?? null, input.quantityRequested ?? null,
            input.quantityFulfilled ?? null, input.unit ?? null, input.priority ?? null, input.status ?? null, input.dueDate ?? null, beneficiaryId],
    );
    if (!result.rows[0]) return null;
    const rows = await pool.query(`${needSelect} WHERE n.id = $1`, [id]);
    return rows.rows[0];
}

export async function listDistributions({ beneficiaryId, status } = {}) {
    const values = [];
    const where = [];
    if (beneficiaryId) { values.push(beneficiaryId); where.push(`d.beneficiary_id = $${values.length}`); }
    if (status) { values.push(status); where.push(`d.status = $${values.length}`); }
    const result = await pool.query(
        `SELECT d.id, d.beneficiary_id AS "beneficiaryId", d.created_by AS "createdBy", d.status,
            d.scheduled_at AS "scheduledAt", d.distributed_at AS "distributedAt", d.location, d.notes,
            d.created_at AS "createdAt", d.updated_at AS "updatedAt",
            COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName",
            COALESCE(json_agg(json_build_object('inventoryItemId', di.inventory_item_id, 'quantity', di.quantity))
              FILTER (WHERE di.inventory_item_id IS NOT NULL), '[]') AS items
     FROM distributions d
     JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
     JOIN users u ON u.id = bp.user_id
     LEFT JOIN distribution_items di ON di.distribution_id = d.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY d.id, u.full_name, u.name, u.email
     ORDER BY d.created_at DESC`,
        values,
    );
    return result.rows;
}

export async function createDistribution(input, createdBy) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const distribution = await client.query(
            `INSERT INTO distributions (beneficiary_id, created_by, status, scheduled_at, location, notes)
       VALUES ($1, $2, 'planned', $3, $4, $5) RETURNING id`,
            [input.beneficiaryId, createdBy || null, input.scheduledAt || null, input.location || null, input.notes || ""],
        );
        for (const item of input.items) {
            const inventory = await client.query(
                "SELECT id, quantity_available, quantity_reserved, quantity_total, low_stock_threshold FROM inventory_items WHERE id = $1 FOR UPDATE",
                [item.inventoryItemId],
            );
            const row = inventory.rows[0];
            if (!row || row.quantity_available < item.quantity) throw new Error("INSUFFICIENT_INVENTORY");
            const available = row.quantity_available - item.quantity;
            const reserved = row.quantity_reserved + item.quantity;
            const status = available === 0 ? "out_of_stock" : available <= row.low_stock_threshold ? "low_stock" : "in_distribution";
            await client.query(
                "UPDATE inventory_items SET quantity_available = $2, quantity_reserved = $3, status = $4, updated_at = NOW() WHERE id = $1",
                [row.id, available, reserved, status],
            );
            await client.query("INSERT INTO distribution_items (distribution_id, inventory_item_id, quantity) VALUES ($1, $2, $3)", [distribution.rows[0].id, row.id, item.quantity]);
        }
        await client.query("COMMIT");
        const rows = await listDistributions({ status: "planned" });
        return rows.find(row => String(row.id) === String(distribution.rows[0].id));
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally { client.release(); }
}

export async function updateDistributionStatus(id, status) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query("SELECT status FROM distributions WHERE id = $1 FOR UPDATE", [id]);
        if (!current.rows[0]) { await client.query("ROLLBACK"); return null; }
        if (current.rows[0].status === status) { await client.query("COMMIT"); return true; }
        if (["completed", "cancelled"].includes(current.rows[0].status)) {
            await client.query("ROLLBACK");
            throw new Error("INVALID_DISTRIBUTION_TRANSITION");
        }
        const items = await client.query("SELECT inventory_item_id, quantity FROM distribution_items WHERE distribution_id = $1", [id]);
        if (status === "cancelled") {
            for (const item of items.rows) {
                await client.query(
                    `UPDATE inventory_items SET quantity_available = quantity_available + $2,
             quantity_reserved = quantity_reserved - $2,
             status = CASE WHEN quantity_available + $2 = 0 THEN 'out_of_stock' WHEN quantity_available + $2 <= low_stock_threshold THEN 'low_stock' ELSE 'available' END,
             updated_at = NOW() WHERE id = $1`,
                    [item.inventory_item_id, item.quantity],
                );
            }
        } else if (status === "completed") {
            for (const item of items.rows) {
                await client.query(
                    `UPDATE inventory_items SET quantity_reserved = quantity_reserved - $2,
             quantity_total = quantity_total - $2,
             status = CASE WHEN quantity_available = 0 THEN 'out_of_stock' WHEN quantity_available <= low_stock_threshold THEN 'low_stock' ELSE 'available' END,
             updated_at = NOW() WHERE id = $1`,
                    [item.inventory_item_id, item.quantity],
                );
            }
        }
        await client.query("UPDATE distributions SET status = $2, distributed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE distributed_at END, updated_at = NOW() WHERE id = $1", [id, status]);
        await client.query("COMMIT");
        return true;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally { client.release(); }
}
