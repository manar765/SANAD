import pool from "./database/index.js";

const inventoryStatusExpr = `
  CASE
    WHEN i.status = 'archived' THEN 'archived'
    WHEN i.quantity_available <= 0 THEN 'out_of_stock'
    WHEN i.quantity_available <= i.low_stock_threshold THEN 'low_stock'
    WHEN i.status IN ('surplus', 'in_distribution') THEN i.status
    ELSE 'available'
  END
`;

const inventorySelect = `
  SELECT i.id, i.source_donation_id AS "sourceDonationId", i.name, i.category,
         i.description, i.unit, i.quantity_total AS "quantityTotal",
         i.quantity_available AS "quantityAvailable", i.quantity_reserved AS "quantityReserved",
         i.low_stock_threshold AS "lowStockThreshold", ${inventoryStatusExpr} AS status, i.warehouse, i.location,
         i.condition, i.expiration_date AS "expirationDate", i.notes,
         i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt"
  FROM inventory_items i
`;

export async function listInventory({ status, category } = {}) {
    const values = [];
    const where = [];
    if (status) { values.push(status); where.push(`${inventoryStatusExpr} = $${values.length}`); }
    if (category) { values.push(category); where.push(`i.category = $${values.length}`); }
    const result = await pool.query(`${inventorySelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.updated_at DESC`, values);
    return result.rows;
}

export async function createInventoryItem(input, userId) {
    const statusAtInsert = input.status === "archived" ? "archived"
        : input.quantityTotal <= 0 ? "out_of_stock"
        : input.quantityTotal <= input.lowStockThreshold ? "low_stock"
        : input.status === "surplus" || input.status === "in_distribution" ? input.status
        : "available";
    const result = await pool.query(
        `INSERT INTO inventory_items
      (source_donation_id, name, category, description, unit, quantity_total, quantity_available,
       quantity_reserved, low_stock_threshold, status, warehouse, location, condition, expiration_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
        [input.sourceDonationId || null, input.name, input.category, input.description, input.unit,
        input.quantityTotal, input.lowStockThreshold, statusAtInsert, input.warehouse, input.location, input.condition,
        input.expirationDate || null, input.notes || "", userId || null],
    );
    const rows = await pool.query(`${inventorySelect} WHERE i.id = $1`, [result.rows[0].id]);
    return rows.rows[0];
}

export async function updateInventoryItem(id, input) {
    const availableExpr = `CASE WHEN $11 IS NOT NULL THEN GREATEST(0, $11 + quantity_available - quantity_total) ELSE quantity_available END`;
    const result = await pool.query(
        `UPDATE inventory_items SET
       name = COALESCE($2, name), category = COALESCE($3, category), description = COALESCE($4, description),
       low_stock_threshold = COALESCE($5, low_stock_threshold),
       quantity_total = COALESCE($11, quantity_total),
       quantity_available = ${availableExpr},
       quantity_reserved = CASE
                             WHEN $11 IS NOT NULL THEN LEAST(quantity_reserved, $11 - ${availableExpr})
                             ELSE quantity_reserved
                           END,
       status = CASE
                  WHEN COALESCE($6, status) = 'archived' THEN 'archived'
                  WHEN ${availableExpr} <= 0 THEN 'out_of_stock'
                  WHEN ${availableExpr} <= COALESCE($5, low_stock_threshold) THEN 'low_stock'
                  WHEN COALESCE($6, status) IN ('surplus', 'in_distribution') THEN COALESCE($6, status)
                  ELSE 'available'
                END,
       warehouse = COALESCE($7, warehouse), location = COALESCE($8, location),
       expiration_date = COALESCE($9, expiration_date), notes = COALESCE($10, notes),
       updated_at = NOW()
     WHERE id = $1 RETURNING id`,
        [id, input.name ?? null, input.category ?? null, input.description ?? null, input.lowStockThreshold ?? null,
            input.status ?? null, input.warehouse ?? null, input.location ?? null, input.expirationDate ?? null, input.notes ?? null, input.quantityTotal ?? null],
    );
    if (!result.rows[0]) return null;
    const rows = await pool.query(`${inventorySelect} WHERE i.id = $1`, [id]);
    return rows.rows[0];
}

const needSelect = `
  SELECT n.id, n.beneficiary_id AS "beneficiaryId", n.title, n.description, n.category,
         n.quantity_requested AS "quantityRequested", n.quantity_fulfilled AS "quantityFulfilled",
         n.unit, n.priority, n.status, n.due_date AS "dueDate", n.created_at AS "createdAt", n.updated_at AS "updatedAt",
         n.assistance_request_id AS "assistanceRequestId",
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

const assistanceRequestSelect = `
  SELECT ar.id, ar.beneficiary_id AS "beneficiaryId", ar.user_id AS "userId",
         ar.item_name AS "itemName", ar.category, ar.description, ar.quantity, ar.unit,
         ar.notes, ar.status, ar.reference_code AS "referenceCode",
         ar.reviewed_by AS "reviewedBy", ar.reviewed_at AS "reviewedAt",
         ar.created_at AS "createdAt", ar.updated_at AS "updatedAt",
         COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName"
  FROM assistance_requests ar
  JOIN beneficiary_profiles bp ON bp.id = ar.beneficiary_id
  JOIN users u ON u.id = bp.user_id
`;

export async function listAssistanceRequests({ status, search } = {}) {
    const values = [];
    const where = [];
    if (status) { values.push(status); where.push(`ar.status = $${values.length}`); }
    if (search) {
        values.push(`%${search.trim().toLowerCase()}%`);
        const param = `$${values.length}`;
        where.push(`(
            LOWER(COALESCE(u.full_name, u.name, '')) LIKE ${param} OR
            LOWER(ar.item_name) LIKE ${param} OR
            ar.reference_code LIKE ${param}
        )`);
    }
    const result = await pool.query(
        `${assistanceRequestSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ar.created_at DESC`,
        values,
    );
    return result.rows;
}

export async function listAssistanceRequestsForUser(userId) {
    const result = await pool.query(
        `${assistanceRequestSelect} WHERE ar.user_id = $1 ORDER BY ar.created_at DESC`,
        [userId],
    );
    return result.rows;
}

export async function getAssistanceRequest(id) {
    const result = await pool.query(`${assistanceRequestSelect} WHERE ar.id = $1`, [id]);
    return result.rows[0] || null;
}

export async function getPendingDuplicateAssistanceRequest(beneficiaryId, itemName, category) {
    const result = await pool.query(
        `SELECT id, reference_code AS "referenceCode", item_name AS "itemName", created_at AS "createdAt"
         FROM assistance_requests
         WHERE beneficiary_id = $1 AND LOWER(item_name) = LOWER($2) AND LOWER(category) = LOWER($3) AND status = 'pending'
         LIMIT 1`,
        [beneficiaryId, itemName, category],
    );
    return result.rows[0] || null;
}

export async function createAssistanceRequest(input, userId, beneficiaryId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO assistance_requests (beneficiary_id, user_id, item_name, category, description, quantity, unit, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, reference_code AS "referenceCode"`,
            [beneficiaryId, userId, input.itemName, input.category, input.description, input.quantity, input.unit, input.notes],
        );
        const requestId = result.rows[0].id;
        await client.query(
            `INSERT INTO beneficiary_needs
              (beneficiary_id, title, description, category, quantity_requested, unit, priority, status, assistance_request_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'medium', 'open', $7)`,
            [beneficiaryId, input.itemName, input.description || "", input.category, input.quantity, input.unit, requestId],
        );
        await client.query("COMMIT");
        const rows = await pool.query(`${assistanceRequestSelect} WHERE ar.id = $1`, [requestId]);
        return rows.rows[0];
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function syncDonationToInventory(client, donationId, status, reviewerId) {
    const donationRes = await client.query(
        `SELECT id, title, description, category, quantity, unit, item_condition, warehouse, location, expiration_date, notes
         FROM donation_requests WHERE id = $1 FOR UPDATE`,
        [donationId],
    );
    const donation = donationRes.rows[0];
    if (!donation) return null;

    const existingRes = await client.query(
        `SELECT id, quantity_total, quantity_available, quantity_reserved, low_stock_threshold, status
         FROM inventory_items WHERE source_donation_id = $1 FOR UPDATE`,
        [donationId],
    );
    const existing = existingRes.rows[0];

    if (status === "approved") {
        if (existing) {
            await client.query(
                `UPDATE inventory_items
                 SET name = $2, category = $3, description = $4, unit = $5,
                     warehouse = $6, location = $7, condition = $8,
                     expiration_date = $9, notes = $10,
                     status = CASE
                                WHEN status = 'archived' THEN 'archived'
                                WHEN quantity_available <= 0 THEN 'out_of_stock'
                                WHEN quantity_available <= low_stock_threshold THEN 'low_stock'
                                WHEN status IN ('surplus', 'in_distribution') THEN status
                                ELSE 'available'
                              END,
                     updated_at = NOW()
                 WHERE id = $1`,
                [existing.id, donation.title, donation.category, donation.description, donation.unit,
                donation.warehouse, donation.location, donation.item_condition, donation.expiration_date, donation.notes],
            );
            return existing.id;
        }

        const insertRes = await client.query(
            `INSERT INTO inventory_items
              (source_donation_id, name, category, description, unit, quantity_total, quantity_available,
               quantity_reserved, low_stock_threshold, status, warehouse, location, condition, expiration_date, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $6, 0, 1, 'available', $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [donation.id, donation.title, donation.category, donation.description, donation.unit, donation.quantity,
            donation.warehouse, donation.location, donation.item_condition, donation.expiration_date, donation.notes, reviewerId || null],
        );
        return insertRes.rows[0].id;
    }

    if (status === "rejected" && existing) {
        if (existing.quantity_reserved > 0 || existing.quantity_available < existing.quantity_total) {
            throw new Error("CANNOT_REVERT_DISTRIBUTED_DONATION");
        }
        await client.query(
            `UPDATE inventory_items SET status = 'archived', quantity_available = 0, updated_at = NOW() WHERE id = $1`,
            [existing.id],
        );
        return existing.id;
    }

    return existing ? existing.id : null;
}

export async function listBeneficiaries({ search, status, governorate } = {}) {
    const values = [];
    const where = [];

    if (status) {
        values.push(status);
        where.push(`bp.verification_status = $${values.length}`);
    }

    if (governorate) {
        values.push(governorate);
        where.push(`bp.governorate = $${values.length}`);
    }

    if (search) {
        values.push(`%${search.trim().toLowerCase()}%`);
        where.push(`(
            LOWER(bp.reference_code) LIKE $${values.length} OR
            LOWER(COALESCE(u.full_name, u.name, '')) LIKE $${values.length} OR
            LOWER(u.email) LIKE $${values.length} OR
            LOWER(COALESCE(bp.phone, u.phone, '')) LIKE $${values.length} OR
            LOWER(COALESCE(bp.national_id, '')) LIKE $${values.length} OR
            LOWER(COALESCE(bp.address, '')) LIKE $${values.length} OR
            LOWER(COALESCE(bp.district, '')) LIKE $${values.length}
        )`);
    }

    const query = `
        SELECT
            bp.id,
            bp.user_id AS "userId",
            bp.reference_code AS "referenceCode",
            bp.national_id AS "nationalId",
            COALESCE(bp.phone, u.phone) AS phone,
            bp.address,
            bp.governorate,
            bp.district,
            bp.family_size AS "familySize",
            bp.children_count AS "childrenCount",
            bp.housing_type AS "housingType",
            bp.monthly_income AS "monthlyIncome",
            bp.employment_status AS "employmentStatus",
            bp.health_conditions AS "healthConditions",
            bp.location,
            bp.current_needs AS "currentNeeds",
            bp.verification_status AS "verificationStatus",
            bp.notes,
            bp.created_at AS "createdAt",
            bp.updated_at AS "updatedAt",
            COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS name,
            u.email,
            (SELECT COUNT(*)::int FROM beneficiary_needs bn WHERE bn.beneficiary_id = bp.id AND bn.status IN ('open', 'partially_fulfilled')) AS "activeNeedsCount",
            COALESCE((
                SELECT json_agg(json_build_object(
                    'id', bn.id,
                    'title', bn.title,
                    'category', bn.category,
                    'quantityRequested', bn.quantity_requested,
                    'unit', bn.unit,
                    'priority', bn.priority,
                    'status', bn.status,
                    'assistanceRequestId', bn.assistance_request_id,
                    'assistanceRequestCode', ar.reference_code,
                    'createdAt', bn.created_at
                ) ORDER BY bn.created_at DESC)
                FROM beneficiary_needs bn
                LEFT JOIN assistance_requests ar ON ar.id = bn.assistance_request_id
                WHERE bn.beneficiary_id = bp.id AND bn.status IN ('open', 'partially_fulfilled')
            ), '[]'::json) AS "openNeeds",
            (SELECT COUNT(*)::int FROM distributions d WHERE d.beneficiary_id = bp.id AND d.status = 'completed') AS "completedDistributionsCount"
        FROM beneficiary_profiles bp
        JOIN users u ON u.id = bp.user_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY bp.created_at DESC
    `;

    const result = await pool.query(query, values);
    return result.rows.map(row => {
        let maskedNationalId = null;
        if (row.nationalId) {
            const raw = String(row.nationalId).trim();
            maskedNationalId = raw.length >= 8 ? `${raw.slice(0, 3)}****${raw.slice(-4)}` : raw;
        }
        return {
            ...row,
            nationalId: maskedNationalId,
        };
    });
}

export async function getBeneficiaryDetail(id) {
    const isIdNumeric = Number.isInteger(Number(id));
    const profileSelect = `
        SELECT
            bp.id,
            bp.user_id AS "userId",
            bp.reference_code AS "referenceCode",
            bp.national_id AS "nationalId",
            COALESCE(bp.phone, u.phone) AS phone,
            bp.address,
            bp.governorate,
            bp.district,
            bp.family_size AS "familySize",
            bp.children_count AS "childrenCount",
            bp.housing_type AS "housingType",
            bp.monthly_income AS "monthlyIncome",
            bp.employment_status AS "employmentStatus",
            bp.health_conditions AS "healthConditions",
            bp.location,
            bp.current_needs AS "currentNeeds",
            bp.verification_status AS "verificationStatus",
            bp.verified_by AS "verifiedBy",
            bp.verified_at AS "verifiedAt",
            bp.notes,
            bp.created_at AS "createdAt",
            bp.updated_at AS "updatedAt",
            COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS name,
            u.email,
            v.full_name AS "verifierName"
        FROM beneficiary_profiles bp
        JOIN users u ON u.id = bp.user_id
        LEFT JOIN users v ON v.id = bp.verified_by
    `;

    let profile = null;
    if (isIdNumeric) {
        const numericId = Number(id);
        const byProfileRes = await pool.query(`${profileSelect} WHERE bp.id = $1`, [numericId]);
        profile = byProfileRes.rows[0] || null;
        if (!profile) {
            const byUserRes = await pool.query(`${profileSelect} WHERE bp.user_id = $1`, [numericId]);
            profile = byUserRes.rows[0] || null;
        }
    } else {
        const byCodeRes = await pool.query(`${profileSelect} WHERE bp.reference_code = $1`, [String(id)]);
        profile = byCodeRes.rows[0] || null;
    }
    if (!profile) return null;

    const needsRes = await pool.query(
        `SELECT n.id, n.title, n.description, n.category, n.quantity_requested AS "quantityRequested",
                n.quantity_fulfilled AS "quantityFulfilled", n.unit, n.priority, n.status,
                n.due_date AS "dueDate", n.assistance_request_id AS "assistanceRequestId",
                ar.reference_code AS "assistanceRequestCode",
                ar.created_at AS "assistanceRequestDate",
                n.created_at AS "createdAt"
         FROM beneficiary_needs n
         LEFT JOIN assistance_requests ar ON ar.id = n.assistance_request_id
         WHERE n.beneficiary_id = $1
         ORDER BY CASE n.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, n.created_at DESC`,
        [profile.id],
    );

    const distributionsRes = await pool.query(
        `SELECT d.id, d.status, d.scheduled_at AS "scheduledAt", d.distributed_at AS "distributedAt",
                d.location, d.notes, d.created_at AS "createdAt",
                COALESCE(json_agg(json_build_object(
                    'inventoryItemId', di.inventory_item_id,
                    'itemName', ii.name,
                    'category', ii.category,
                    'quantity', di.quantity,
                    'unit', ii.unit
                )) FILTER (WHERE di.inventory_item_id IS NOT NULL), '[]') AS items
         FROM distributions d
         LEFT JOIN distribution_items di ON di.distribution_id = d.id
         LEFT JOIN inventory_items ii ON ii.id = di.inventory_item_id
         WHERE d.beneficiary_id = $1
         GROUP BY d.id
         ORDER BY d.created_at DESC`,
        [profile.id],
    );

    return {
        ...profile,
        needs: needsRes.rows,
        distributions: distributionsRes.rows,
    };
}

export async function createBeneficiaryProfile(input, createdBy) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        let userId = input.userId;
        const fullName = input.name || "مستفيد جديد";
        const parts = fullName.trim().split(/\s+/);
        const firstName = parts[0] || "مستفيد";
        const lastName = parts.slice(1).join(" ") || "جديد";

        if (!userId) {
            const email = input.email ? input.email.trim().toLowerCase() : `ben.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@sanad.local`;
            const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [email]);
            if (existingUser.rows[0]) {
                userId = existingUser.rows[0].id;
            } else {
                const passwordHash = "managed_account";
                const userRes = await client.query(
                    `INSERT INTO users (name, first_name, last_name, full_name, email, password, password_hash, role, phone)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'beneficiary', $8)
                     RETURNING id`,
                    [fullName, firstName, lastName, fullName, email, passwordHash, passwordHash, input.phone || null],
                );
                userId = userRes.rows[0].id;
            }
        }

        const existingProfile = await client.query("SELECT id FROM beneficiary_profiles WHERE user_id = $1", [userId]);
        let profileId;
        if (existingProfile.rows[0]) {
            profileId = existingProfile.rows[0].id;
            await client.query(
                `UPDATE beneficiary_profiles SET
                  national_id = COALESCE($2, national_id),
                  phone = COALESCE($3, phone),
                  address = COALESCE($4, address),
                  governorate = COALESCE($5, governorate),
                  district = COALESCE($6, district),
                  family_size = COALESCE($7, family_size),
                  children_count = COALESCE($8, children_count),
                  housing_type = COALESCE($9, housing_type),
                  monthly_income = COALESCE($10, monthly_income),
                  employment_status = COALESCE($11, employment_status),
                  health_conditions = COALESCE($12, health_conditions),
                  location = COALESCE($13, location),
                  verification_status = COALESCE($14, verification_status),
                  verified_by = CASE WHEN $14 = 'verified' THEN $15 ELSE verified_by END,
                  verified_at = CASE WHEN $14 = 'verified' THEN NOW() ELSE verified_at END,
                  notes = COALESCE($16, notes),
                  updated_at = NOW()
                 WHERE id = $1`,
                [
                    profileId,
                    input.nationalId || null,
                    input.phone || null,
                    input.address || null,
                    input.governorate || null,
                    input.district || null,
                    input.familySize || null,
                    input.childrenCount || null,
                    input.housingType || null,
                    input.monthlyIncome || null,
                    input.employmentStatus || null,
                    input.healthConditions || null,
                    input.location || null,
                    input.verificationStatus || "pending",
                    input.verificationStatus === "verified" ? (createdBy || null) : null,
                    input.notes || "",
                ],
            );
        } else {
            const profileRes = await client.query(
                `INSERT INTO beneficiary_profiles
                  (user_id, national_id, phone, address, governorate, district, family_size, children_count,
                   housing_type, monthly_income, employment_status, health_conditions, location,
                   verification_status, verified_by, verified_at, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                 RETURNING id`,
                [
                    userId,
                    input.nationalId || null,
                    input.phone || null,
                    input.address || null,
                    input.governorate || null,
                    input.district || null,
                    input.familySize || null,
                    input.childrenCount || null,
                    input.housingType || null,
                    input.monthlyIncome || null,
                    input.employmentStatus || null,
                    input.healthConditions || null,
                    input.location || null,
                    input.verificationStatus || "pending",
                    input.verificationStatus === "verified" ? (createdBy || null) : null,
                    input.verificationStatus === "verified" ? new Date() : null,
                    input.notes || "",
                ],
            );
            profileId = profileRes.rows[0].id;
        }

        await client.query("COMMIT");
        return getBeneficiaryDetail(profileId);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function updateBeneficiaryProfile(id, input, updatedBy) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const existing = await client.query("SELECT id, user_id, verification_status FROM beneficiary_profiles WHERE id = $1 FOR UPDATE", [id]);
        if (!existing.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }

        await client.query(
            `UPDATE beneficiary_profiles SET
                national_id = COALESCE($2, national_id),
                phone = COALESCE($3, phone),
                address = COALESCE($4, address),
                governorate = COALESCE($5, governorate),
                district = COALESCE($6, district),
                family_size = COALESCE($7, family_size),
                children_count = COALESCE($8, children_count),
                housing_type = COALESCE($9, housing_type),
                monthly_income = COALESCE($10, monthly_income),
                employment_status = COALESCE($11, employment_status),
                health_conditions = COALESCE($12, health_conditions),
                location = COALESCE($13, location),
                verification_status = COALESCE($14, verification_status),
                verified_by = CASE WHEN $14 = 'verified' THEN $15 WHEN $14 IS NOT NULL AND $14 != 'verified' THEN NULL ELSE verified_by END,
                verified_at = CASE WHEN $14 = 'verified' THEN NOW() WHEN $14 IS NOT NULL AND $14 != 'verified' THEN NULL ELSE verified_at END,
                notes = COALESCE($16, notes),
                updated_at = NOW()
             WHERE id = $1`,
            [
                id,
                input.nationalId === undefined ? null : input.nationalId,
                input.phone === undefined ? null : input.phone,
                input.address === undefined ? null : input.address,
                input.governorate === undefined ? null : input.governorate,
                input.district === undefined ? null : input.district,
                input.familySize === undefined ? null : input.familySize,
                input.childrenCount === undefined ? null : input.childrenCount,
                input.housingType === undefined ? null : input.housingType,
                input.monthlyIncome === undefined ? null : input.monthlyIncome,
                input.employmentStatus === undefined ? null : input.employmentStatus,
                input.healthConditions === undefined ? null : input.healthConditions,
                input.location === undefined ? null : input.location,
                input.verificationStatus === undefined ? null : input.verificationStatus,
                updatedBy || null,
                input.notes === undefined ? null : input.notes,
            ],
        );

        if (input.name) {
            await client.query("UPDATE users SET full_name = $1 WHERE id = $2", [input.name, existing.rows[0].user_id]);
        }

        await client.query("COMMIT");
        return getBeneficiaryDetail(id);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function saveBeneficiaryRecommendation({
    beneficiaryId,
    priorityLevel,
    reasons = [],
    suggestedItems = [],
    ruleInputs = {},
    generatedBy = null
}) {
    const result = await pool.query(
        `INSERT INTO beneficiary_recommendations
          (beneficiary_id, priority_level, reasons, suggested_items, rule_inputs, generated_by)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
         RETURNING id, beneficiary_id AS "beneficiaryId", priority_level AS "priorityLevel",
                   reasons, suggested_items AS "suggestedItems", rule_inputs AS "ruleInputs",
                   generated_by AS "generatedBy", created_at AS "createdAt"`,
        [
            beneficiaryId,
            priorityLevel,
            JSON.stringify(reasons),
            JSON.stringify(suggestedItems),
            JSON.stringify(ruleInputs),
            generatedBy || null
        ]
    );
    return result.rows[0];
}

export async function getLatestBeneficiaryRecommendation(beneficiaryId) {
    const result = await pool.query(
        `SELECT r.id, r.beneficiary_id AS "beneficiaryId", r.priority_level AS "priorityLevel",
                r.reasons, r.suggested_items AS "suggestedItems", r.rule_inputs AS "ruleInputs",
                r.generated_by AS "generatedBy", r.created_at AS "createdAt",
                u.full_name AS "generatedByName"
         FROM beneficiary_recommendations r
         LEFT JOIN users u ON u.id = r.generated_by
         WHERE r.beneficiary_id = $1
         ORDER BY r.created_at DESC
         LIMIT 1`,
        [beneficiaryId]
    );
    return result.rows[0] || null;
}

export async function getBeneficiaryRecommendationHistory(beneficiaryId, limit = 10) {
    const result = await pool.query(
        `SELECT r.id, r.beneficiary_id AS "beneficiaryId", r.priority_level AS "priorityLevel",
                r.reasons, r.suggested_items AS "suggestedItems", r.rule_inputs AS "ruleInputs",
                r.generated_by AS "generatedBy", r.created_at AS "createdAt",
                u.full_name AS "generatedByName"
         FROM beneficiary_recommendations r
         LEFT JOIN users u ON u.id = r.generated_by
         WHERE r.beneficiary_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2`,
        [beneficiaryId, limit]
    );
    return result.rows;
}

export async function searchBeneficiariesForVerification(query = "", limit = 20) {
    const term = (query || "").trim();
    const isTermPresent = term.length > 0;
    const filter = isTermPresent ? `%${term}%` : null;

    const sql = `
        SELECT bp.id,
               bp.reference_code AS "referenceCode",
               bp.national_id AS "nationalId",
               bp.phone,
               bp.governorate,
               bp.district,
               bp.family_size AS "familySize",
               bp.children_count AS "childrenCount",
               bp.monthly_income AS "monthlyIncome",
               bp.employment_status AS "employmentStatus",
               bp.health_conditions AS "healthConditions",
               bp.verification_status AS "verificationStatus",
               bp.created_at AS "createdAt",
               bp.updated_at AS "updatedAt",
               COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS name,
               u.email,
               COUNT(DISTINCT bn.id) FILTER (WHERE bn.status IN ('open', 'partially_fulfilled')) AS "openNeedsCount",
               rec.priority_level AS "latestPriority",
               rec.created_at AS "latestRecommendationAt"
        FROM beneficiary_profiles bp
        JOIN users u ON u.id = bp.user_id
        LEFT JOIN beneficiary_needs bn ON bn.beneficiary_id = bp.id
        LEFT JOIN LATERAL (
            SELECT priority_level, created_at
            FROM beneficiary_recommendations
            WHERE beneficiary_id = bp.id
            ORDER BY created_at DESC
            LIMIT 1
        ) rec ON true
        ${isTermPresent ? `
        WHERE bp.reference_code ILIKE $1
           OR bp.phone ILIKE $1
           OR bp.national_id ILIKE $1
           OR u.full_name ILIKE $1
           OR u.name ILIKE $1
           OR u.email ILIKE $1
           OR bp.governorate ILIKE $1
        ` : ""}
        GROUP BY bp.id, u.full_name, u.name, u.email, rec.priority_level, rec.created_at
        ORDER BY
            CASE WHEN rec.priority_level = 'urgent' THEN 1
                 WHEN rec.priority_level = 'high' THEN 2
                 WHEN rec.priority_level = 'medium' THEN 3
                 WHEN rec.priority_level = 'low' THEN 4
                 ELSE 5
            END,
            bp.updated_at DESC
        LIMIT $${isTermPresent ? 2 : 1}
    `;

    const params = isTermPresent ? [filter, limit] : [limit];
    const result = await pool.query(sql, params);
    return result.rows;
}

export async function listDistributions({ status, beneficiaryId, search, limit = 50, offset = 0 } = {}) {
    const values = [];
    const where = [];

    if (status) {
        values.push(status);
        where.push(`d.status = $${values.length}`);
    }

    if (beneficiaryId) {
        values.push(Number(beneficiaryId));
        where.push(`d.beneficiary_id = $${values.length}`);
    }

    if (search) {
        const pattern = `%${search.trim()}%`;
        values.push(pattern);
        where.push(`(
            d.reference_code ILIKE $${values.length} OR
            bp.reference_code ILIKE $${values.length} OR
            bp.phone ILIKE $${values.length} OR
            bp.national_id ILIKE $${values.length} OR
            bu.full_name ILIKE $${values.length} OR
            bu.name ILIKE $${values.length} OR
            bu.email ILIKE $${values.length}
        )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countSql = `
        SELECT COUNT(DISTINCT d.id) AS total
        FROM distributions d
        JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
        JOIN users bu ON bu.id = bp.user_id
        ${whereClause}
    `;

    const countResult = await pool.query(countSql, values);
    const total = Number(countResult.rows[0]?.total || 0);

    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
    const safeOffset = Math.max(0, Number(offset) || 0);

    values.push(safeLimit);
    const limitParam = `$${values.length}`;
    values.push(safeOffset);
    const offsetParam = `$${values.length}`;

    const sql = `
        SELECT
            d.id,
            d.reference_code AS "referenceCode",
            d.beneficiary_id AS "beneficiaryId",
            d.status,
            d.scheduled_at AS "scheduledAt",
            d.distributed_at AS "distributedAt",
            d.location,
            d.notes,
            d.created_at AS "createdAt",
            d.updated_at AS "updatedAt",
            COALESCE(NULLIF(bu.full_name, ''), NULLIF(bu.name, ''), bu.email) AS "beneficiaryName",
            bp.reference_code AS "beneficiaryReferenceCode",
            bp.national_id AS "beneficiaryNationalId",
            COALESCE(bp.phone, bu.phone) AS "beneficiaryPhone",
            COALESCE(NULLIF(cu.full_name, ''), NULLIF(cu.name, ''), cu.email) AS "createdByName",
            COALESCE(json_agg(json_build_object(
                'inventoryItemId', di.inventory_item_id,
                'itemName', ii.name,
                'category', ii.category,
                'quantity', di.quantity,
                'unit', ii.unit,
                'warehouse', ii.warehouse,
                'needId', di.need_id,
                'needTitle', bn.title
            )) FILTER (WHERE di.inventory_item_id IS NOT NULL), '[]') AS items
        FROM distributions d
        JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
        JOIN users bu ON bu.id = bp.user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        LEFT JOIN distribution_items di ON di.distribution_id = d.id
        LEFT JOIN inventory_items ii ON ii.id = di.inventory_item_id
        LEFT JOIN beneficiary_needs bn ON bn.id = di.need_id
        ${whereClause}
        GROUP BY d.id, bu.full_name, bu.name, bu.email, bp.reference_code, bp.national_id, bp.phone, bu.phone, cu.full_name, cu.name, cu.email
        ORDER BY d.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query(sql, values);
    return {
        distributions: result.rows,
        total,
        limit: safeLimit,
        offset: safeOffset,
    };
}

export async function getDistributionById(id) {
    const isIdNumeric = Number.isInteger(Number(id));
    const result = await pool.query(
        `SELECT
            d.id,
            d.reference_code AS "referenceCode",
            d.beneficiary_id AS "beneficiaryId",
            d.status,
            d.scheduled_at AS "scheduledAt",
            d.distributed_at AS "distributedAt",
            d.location,
            d.notes,
            d.created_at AS "createdAt",
            d.updated_at AS "updatedAt",
            COALESCE(NULLIF(bu.full_name, ''), NULLIF(bu.name, ''), bu.email) AS "beneficiaryName",
            bp.reference_code AS "beneficiaryReferenceCode",
            bp.national_id AS "beneficiaryNationalId",
            COALESCE(bp.phone, bu.phone) AS "beneficiaryPhone",
            bp.address AS "beneficiaryAddress",
            bp.family_size AS "familySize",
            bp.district AS "beneficiaryDistrict",
            bp.governorate AS "beneficiaryGovernorate",
            COALESCE(NULLIF(cu.full_name, ''), NULLIF(cu.name, ''), cu.email) AS "createdByName",
            COALESCE(json_agg(json_build_object(
                'inventoryItemId', di.inventory_item_id,
                'itemName', ii.name,
                'category', ii.category,
                'quantity', di.quantity,
                'unit', ii.unit,
                'warehouse', ii.warehouse,
                'needId', di.need_id,
                'needTitle', bn.title
            )) FILTER (WHERE di.inventory_item_id IS NOT NULL), '[]') AS items
        FROM distributions d
        JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
        JOIN users bu ON bu.id = bp.user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        LEFT JOIN distribution_items di ON di.distribution_id = d.id
        LEFT JOIN inventory_items ii ON ii.id = di.inventory_item_id
        LEFT JOIN beneficiary_needs bn ON bn.id = di.need_id
        WHERE ${isIdNumeric ? "d.id = $1 OR d.reference_code = $2" : "d.reference_code = $1"}
        GROUP BY d.id, bu.full_name, bu.name, bu.email, bp.reference_code, bp.national_id, bp.phone, bu.phone,
                 bp.address, bp.family_size, bp.district, bp.governorate, cu.full_name, cu.name, cu.email`,
        isIdNumeric ? [Number(id), String(id)] : [String(id)],
    );

    return result.rows[0] || null;
}

export async function createDistribution(input, userId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const beneficiaryRes = await client.query(
            `SELECT bp.id, COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS name
             FROM beneficiary_profiles bp
             JOIN users u ON u.id = bp.user_id
             WHERE bp.id = $1`,
            [input.beneficiaryId],
        );
        const beneficiary = beneficiaryRes.rows[0];
        if (!beneficiary) {
            const err = new Error("BENEFICIARY_NOT_FOUND");
            err.code = "BENEFICIARY_NOT_FOUND";
            throw err;
        }

        const items = Array.isArray(input.items) ? input.items : [];
        if (items.length === 0) {
            const err = new Error("NO_ITEMS_SPECIFIED");
            err.code = "NO_ITEMS_SPECIFIED";
            throw err;
        }

        const status = input.status || "completed";
        const isCompleted = status === "completed";

        // For each item, check available stock and lock row
        for (const item of items) {
            const qty = Number(item.quantity);
            if (!Number.isInteger(qty) || qty <= 0) {
                const err = new Error("INVALID_ITEM_QUANTITY");
                err.code = "INVALID_ITEM_QUANTITY";
                throw err;
            }

            const invRes = await client.query(
                `SELECT id, name, category, unit, quantity_available, low_stock_threshold
                 FROM inventory_items
                 WHERE id = $1
                 FOR UPDATE`,
                [item.inventoryItemId],
            );
            const invRow = invRes.rows[0];
            if (!invRow) {
                const err = new Error(`INVENTORY_ITEM_NOT_FOUND:${item.inventoryItemId}`);
                err.code = "INVENTORY_ITEM_NOT_FOUND";
                throw err;
            }

            if (isCompleted && qty > invRow.quantity_available) {
                const err = new Error(`الكمية المطلوبة (${qty}) للصنف "${invRow.name}" تتجاوز المخزون المتاح حالياً (${invRow.quantity_available} ${invRow.unit}).`);
                err.code = "INSUFFICIENT_STOCK";
                err.details = {
                    itemId: invRow.id,
                    itemName: invRow.name,
                    requestedQuantity: qty,
                    availableQuantity: invRow.quantity_available,
                    unit: invRow.unit,
                };
                throw err;
            }
        }

        const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
        const distributedAt = isCompleted ? (input.distributedAt ? new Date(input.distributedAt) : new Date()) : null;
        const location = input.location ? String(input.location).trim() : null;
        const notes = input.notes ? String(input.notes).trim() : "";

        // Insert into distributions
        const distInsertRes = await client.query(
            `INSERT INTO distributions (beneficiary_id, created_by, status, scheduled_at, distributed_at, location, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, reference_code`,
            [beneficiary.id, userId || null, status, scheduledAt, distributedAt, location, notes],
        );
        const distId = distInsertRes.rows[0].id;
        const referenceCode = distInsertRes.rows[0].reference_code;

        // Process items and inventory
        for (const item of items) {
            const qty = Number(item.quantity);
            const needId = item.needId ? Number(item.needId) : null;

            await client.query(
                `INSERT INTO distribution_items (distribution_id, inventory_item_id, quantity, need_id)
                 VALUES ($1, $2, $3, $4)`,
                [distId, item.inventoryItemId, qty, needId],
            );

            if (isCompleted) {
                // Decrement inventory
                await client.query(
                    `UPDATE inventory_items
                     SET quantity_available = quantity_available - $1,
                         status = CASE
                             WHEN status = 'archived' THEN 'archived'
                             WHEN (quantity_available - $1) <= 0 THEN 'out_of_stock'
                             WHEN (quantity_available - $1) <= low_stock_threshold THEN 'low_stock'
                             WHEN status IN ('surplus', 'in_distribution') THEN status
                             ELSE 'available'
                         END,
                         updated_at = NOW()
                     WHERE id = $2`,
                    [qty, item.inventoryItemId],
                );

                // Update beneficiary need if specified
                if (needId) {
                    await client.query(
                        `UPDATE beneficiary_needs
                         SET quantity_fulfilled = LEAST(quantity_requested, quantity_fulfilled + $1),
                             status = CASE
                                 WHEN (quantity_fulfilled + $1) >= quantity_requested THEN 'fulfilled'
                                 ELSE 'partially_fulfilled'
                             END,
                             updated_at = NOW()
                         WHERE id = $2 AND beneficiary_id = $3`,
                        [qty, needId, beneficiary.id],
                    );
                }
            }
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (user_id, action, success, metadata)
             VALUES ($1, 'distribution.create', true, $2::jsonb)`,
            [
                userId || null,
                JSON.stringify({
                    distributionId: distId,
                    referenceCode,
                    beneficiaryId: beneficiary.id,
                    status,
                    itemsCount: items.length,
                }),
            ],
        );

        await client.query("COMMIT");

        return getDistributionById(distId);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function cancelDistribution(id, userId, reason = "") {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const distRes = await client.query(
            `SELECT id, status, beneficiary_id AS "beneficiaryId", reference_code AS "referenceCode"
             FROM distributions
             WHERE id = $1
             FOR UPDATE`,
            [id],
        );
        const dist = distRes.rows[0];
        if (!dist) {
            const err = new Error("DISTRIBUTION_NOT_FOUND");
            err.code = "DISTRIBUTION_NOT_FOUND";
            throw err;
        }

        if (dist.status === "cancelled") {
            await client.query("ROLLBACK");
            return getDistributionById(id);
        }

        // If it was completed, restore inventory items
        if (dist.status === "completed") {
            const itemsRes = await client.query(
                `SELECT inventory_item_id, quantity, need_id
                 FROM distribution_items
                 WHERE distribution_id = $1`,
                [id],
            );

            for (const it of itemsRes.rows) {
                await client.query(
                    `UPDATE inventory_items
                     SET quantity_available = quantity_available + $1,
                         status = CASE
                             WHEN status = 'archived' THEN 'archived'
                             WHEN (quantity_available + $1) <= 0 THEN 'out_of_stock'
                             WHEN (quantity_available + $1) <= low_stock_threshold THEN 'low_stock'
                             WHEN status IN ('surplus', 'in_distribution') THEN status
                             ELSE 'available'
                         END,
                         updated_at = NOW()
                     WHERE id = $2`,
                    [it.quantity, it.inventory_item_id],
                );

                if (it.need_id) {
                    await client.query(
                        `UPDATE beneficiary_needs
                         SET quantity_fulfilled = GREATEST(0, quantity_fulfilled - $1),
                             status = CASE
                                 WHEN (quantity_fulfilled - $1) <= 0 THEN 'open'
                                 ELSE 'partially_fulfilled'
                             END,
                             updated_at = NOW()
                         WHERE id = $2`,
                        [it.quantity, it.need_id],
                    );
                }
            }
        }

        await client.query(
            `UPDATE distributions
             SET status = 'cancelled',
                 distributed_at = NULL,
                 notes = CASE WHEN notes = '' THEN $2 ELSE notes || E'\n' || $2 END,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, `تم إلغاء التوزيع بواسطة المستخدم #${userId || '—'}${reason ? `: ${reason}` : ''}`],
        );

        await client.query(
            `INSERT INTO audit_logs (user_id, action, success, metadata)
             VALUES ($1, 'distribution.cancel', true, $2::jsonb)`,
            [userId || null, JSON.stringify({ distributionId: id, reason })],
        );

        await client.query("COMMIT");
        return getDistributionById(id);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function getDistributionStats() {
    const res = await pool.query(`
        SELECT
            COUNT(DISTINCT d.id) AS total,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'completed') AS completed,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'planned') AS planned,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'in_progress') AS "inProgress",
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'cancelled') AS cancelled,
            COUNT(DISTINCT d.id) FILTER (WHERE DATE(d.created_at) = CURRENT_DATE) AS "todayCount",
            COALESCE(SUM(di.quantity) FILTER (WHERE d.status = 'completed'), 0) AS "totalItemsDelivered"
        FROM distributions d
        LEFT JOIN distribution_items di ON di.distribution_id = d.id
    `);
    const row = res.rows[0] || {};
    return {
        total: Number(row.total || 0),
        completed: Number(row.completed || 0),
        planned: Number(row.planned || 0),
        inProgress: Number(row.inProgress || 0),
        cancelled: Number(row.cancelled || 0),
        todayCount: Number(row.todayCount || 0),
        totalItemsDelivered: Number(row.totalItemsDelivered || 0),
    };
}

export const AUDIT_ACTION_LABELS = {
    login_success: "تسجيل دخول ناجح",
    login_failed: "فشل تسجيل الدخول",
    logout_success: "تسجيل خروج",
    signup_success: "إنشاء حساب جديد",
    email_verified: "تأكيد البريد الإلكتروني",
    password_changed: "تغيير كلمة المرور",
    password_reset_success: "استعادة كلمة المرور",
    mfa_enabled: "تفعيل التحقق الثنائي (MFA)",
    mfa_disabled: "تعطيل التحقق الثنائي (MFA)",
    profile_updated: "تحديث الملف الشخصي",
    user_role_updated: "تعديل صلاحية مستخدم",
    donation_submitted: "تسجيل تبرع جديد",
    inventory_item_created: "إضافة صنف مخزني",
    inventory_item_updated: "تعديل صنف مخزني",
    beneficiary_created: "تسجيل مستفيد جديد",
    beneficiary_updated: "تحديث ملف مستفيد",
    beneficiary_verified: "اعتماد وتحقق ملف مستفيد",
    beneficiary_need_created: "إضافة احتياج مستفيد",
    beneficiary_need_updated: "تحديث احتياج مستفيد",
    distribution_created: "إنشاء أمر توزيع",
    distribution_completed: "اكتمال تسليم التوزيع",
    distribution_status_changed: "تعديل حالة توزيع",
    "distribution.cancel": "إلغاء أمر توزيع",
    ai_case_note_extracted: "استخراج ذكي لبيانات الحالة",
    recommendation_generated: "احتساب توصية الأولوية"
};

export async function getDashboardSummary() {
    const [
        donationStatsRes,
        inventoryStatsRes,
        beneficiaryStatsRes,
        distStats,
        needsStatsRes,
        recentDonationsRes,
        recentDistributionsRes,
        lowStockRes,
        surplusRes,
        urgentNeedsRes,
        inventoryStatusRes,
        recentAuditRes
    ] = await Promise.all([
        // 1. Donations summary
        pool.query(`
            SELECT COUNT(*) AS total_count,
                   COALESCE(SUM(quantity), 0) AS total_units,
                   COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
                   COUNT(*) FILTER (WHERE status = 'approved') AS approved_count
            FROM donation_requests
        `),
        // 2. Inventory summary
        pool.query(`
            SELECT COUNT(*) AS item_count,
                   COALESCE(SUM(quantity_total), 0) AS total_units,
                   COALESCE(SUM(quantity_available), 0) AS available_units,
                   COALESCE(SUM(quantity_reserved), 0) AS reserved_units
            FROM inventory_items
        `),
        // 3. Beneficiaries summary
        pool.query(`
            SELECT COUNT(*) AS total_count,
                   COUNT(*) FILTER (WHERE verification_status = 'verified') AS verified_count,
                   COUNT(*) FILTER (WHERE verification_status = 'pending') AS pending_count,
                   COUNT(*) FILTER (WHERE verification_status = 'needs_review') AS review_count
            FROM beneficiary_profiles
        `),
        // 4. Distributions stats
        getDistributionStats(),
        // 5. Open needs summary
        pool.query(`
            SELECT COUNT(*) AS total_open,
                   COUNT(*) FILTER (WHERE priority IN ('urgent', 'high')) AS high_priority,
                   COALESCE(SUM(quantity_requested - quantity_fulfilled), 0) AS units_needed
            FROM beneficiary_needs
            WHERE status IN ('open', 'partially_fulfilled')
        `),
        // 6. Recent donations (latest 5)
        pool.query(`
            SELECT d.id, d.title, d.category, d.quantity, d.unit, d.status,
                   d.reference_code AS "referenceCode", d.created_at AS "createdAt",
                   COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "donorName"
            FROM donation_requests d
            JOIN users u ON u.id = d.donor_id
            ORDER BY d.created_at DESC
            LIMIT 5
        `),
        // 7. Recent distributions (latest 5)
        pool.query(`
            SELECT d.id, d.reference_code AS "referenceCode", d.status,
                   d.scheduled_at AS "scheduledAt", d.distributed_at AS "distributedAt",
                   d.created_at AS "createdAt",
                   COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName",
                   COUNT(di.inventory_item_id) AS "itemsCount"
            FROM distributions d
            JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
            JOIN users u ON u.id = bp.user_id
            LEFT JOIN distribution_items di ON di.distribution_id = d.id
            GROUP BY d.id, u.full_name, u.name, u.email
            ORDER BY d.created_at DESC
            LIMIT 5
        `),
        // 8. Low stock items
        pool.query(`
            SELECT id, name, category, quantity_available AS "quantityAvailable",
                   low_stock_threshold AS "lowStockThreshold", unit, warehouse
            FROM inventory_items
            WHERE status = 'low_stock' OR (quantity_available <= low_stock_threshold AND status = 'available')
            ORDER BY quantity_available ASC
            LIMIT 6
        `),
        // 9. Surplus items
        pool.query(`
            SELECT id, name, category, quantity_available AS "quantityAvailable", unit, warehouse
            FROM inventory_items
            WHERE status = 'surplus'
            ORDER BY quantity_available DESC
            LIMIT 6
        `),
        // 10. Urgent needs
        pool.query(`
            SELECT n.id, n.title, n.category, n.priority, n.unit,
                   n.quantity_requested AS "quantityRequested",
                   n.quantity_fulfilled AS "quantityFulfilled",
                   COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName"
            FROM beneficiary_needs n
            JOIN beneficiary_profiles bp ON bp.id = n.beneficiary_id
            JOIN users u ON u.id = bp.user_id
            WHERE n.status IN ('open', 'partially_fulfilled')
              AND n.priority IN ('urgent', 'high')
            ORDER BY CASE WHEN n.priority = 'urgent' THEN 1 ELSE 2 END, n.created_at ASC
            LIMIT 8
        `),
        // 11. Inventory status breakdown
        pool.query(`
            SELECT status, COUNT(*) AS count
            FROM inventory_items
            GROUP BY status
        `),
        // 12. Recent audit logs (latest 10)
        pool.query(`
            SELECT a.id, a.action, a.success, a.ip_address AS "ipAddress",
                   a.created_at AS "createdAt",
                   COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email, 'النظام') AS "userName"
            FROM audit_logs a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
            LIMIT 10
        `)
    ]);

    const donRow = donationStatsRes.rows[0] || {};
    const invRow = inventoryStatsRes.rows[0] || {};
    const benRow = beneficiaryStatsRes.rows[0] || {};
    const needsRow = needsStatsRes.rows[0] || {};

    const activeDists = distStats.total - distStats.cancelled;
    const distributionRate = activeDists > 0 ? Math.round((distStats.completed / activeDists) * 100) : 0;

    const inventoryStatusCounts = {
        available: 0,
        low_stock: 0,
        in_distribution: 0,
        out_of_stock: 0,
        surplus: 0,
    };
    for (const r of inventoryStatusRes.rows) {
        if (inventoryStatusCounts[r.status] !== undefined) {
            inventoryStatusCounts[r.status] = Number(r.count || 0);
        }
    }

    const recentActivity = recentAuditRes.rows.map(log => ({
        id: log.id,
        action: log.action,
        actionLabel: AUDIT_ACTION_LABELS[log.action] || log.action,
        success: log.success,
        userName: log.userName,
        createdAt: log.createdAt,
    }));

    return {
        kpis: {
            totalDonations: Number(donRow.total_count || 0),
            totalDonationUnits: Number(donRow.total_units || 0),
            inventoryTotal: Number(invRow.total_units || 0),
            inventoryAvailable: Number(invRow.available_units || 0),
            inventoryReserved: Number(invRow.reserved_units || 0),
            beneficiariesTotal: Number(benRow.total_count || 0),
            beneficiariesVerified: Number(benRow.verified_count || 0),
            beneficiariesPending: Number(benRow.pending_count || 0),
            distributionsTotal: distStats.total,
            distributionsCompleted: distStats.completed,
            distributionsPlanned: distStats.planned,
            distributionsInProgress: distStats.inProgress,
            distributionsCancelled: distStats.cancelled,
            distributionRate,
            openNeedsTotal: Number(needsRow.total_open || 0),
            openNeedsUrgent: Number(needsRow.high_priority || 0),
        },
        recentDonations: recentDonationsRes.rows,
        recentDistributions: recentDistributionsRes.rows,
        lowStockItems: lowStockRes.rows,
        surplusItems: surplusRes.rows,
        urgentNeeds: urgentNeedsRes.rows,
        inventoryStatusCounts,
        recentActivity,
    };
}

export async function getOperationalReports({ from = null, to = null, category = null } = {}) {
    const whereDon = [];
    const valuesDon = [];
    if (from) { valuesDon.push(from); whereDon.push(`created_at >= $${valuesDon.length}`); }
    if (to) { valuesDon.push(to); whereDon.push(`created_at <= $${valuesDon.length}`); }
    if (category) { valuesDon.push(category); whereDon.push(`category = $${valuesDon.length}`); }

    const whereNeeds = [];
    const valuesNeeds = [];
    if (from) { valuesNeeds.push(from); whereNeeds.push(`created_at >= $${valuesNeeds.length}`); }
    if (to) { valuesNeeds.push(to); whereNeeds.push(`created_at <= $${valuesNeeds.length}`); }
    if (category) { valuesNeeds.push(category); whereNeeds.push(`category = $${valuesNeeds.length}`); }

    const [
        donationsByCategoryRes,
        needsByCategoryRes,
        beneficiariesByGovRes,
        distributionsByStatusRes,
        monthlyTrendRes
    ] = await Promise.all([
        // 1. Donations by category
        pool.query(`
            SELECT category,
                   COUNT(*) AS count,
                   COALESCE(SUM(quantity), 0) AS "totalUnits"
            FROM donation_requests
            ${whereDon.length ? `WHERE ${whereDon.join(" AND ")}` : ""}
            GROUP BY category
            ORDER BY count DESC
        `, valuesDon),
        // 2. Needs by category (anonymized aggregates)
        pool.query(`
            SELECT category,
                   COUNT(*) AS count,
                   COALESCE(SUM(quantity_requested), 0) AS "requestedUnits",
                   COALESCE(SUM(quantity_fulfilled), 0) AS "fulfilledUnits"
            FROM beneficiary_needs
            ${whereNeeds.length ? `WHERE ${whereNeeds.join(" AND ")}` : ""}
            GROUP BY category
            ORDER BY count DESC
        `, valuesNeeds),
        // 3. Beneficiaries by governorate (Strictly privacy-safe: governorate + count only, NO PII)
        pool.query(`
            SELECT COALESCE(NULLIF(trim(governorate), ''), 'غير محدد') AS governorate,
                   COUNT(*) AS count
            FROM beneficiary_profiles
            GROUP BY governorate
            ORDER BY count DESC
        `),
        // 4. Distributions by status
        pool.query(`
            SELECT status, COUNT(*) AS count
            FROM distributions
            GROUP BY status
            ORDER BY count DESC
        `),
        // 5. Monthly trend over the past 6 months
        pool.query(`
            SELECT TO_CHAR(d.created_at, 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM distributions d
            WHERE d.created_at >= NOW() - INTERVAL '6 months'
            GROUP BY month
            ORDER BY month ASC
        `)
    ]);

    return {
        donationsByCategory: donationsByCategoryRes.rows.map(r => ({
            category: r.category,
            count: Number(r.count),
            totalUnits: Number(r.totalUnits)
        })),
        needsByCategory: needsByCategoryRes.rows.map(r => ({
            category: r.category,
            count: Number(r.count),
            requestedUnits: Number(r.requestedUnits),
            fulfilledUnits: Number(r.fulfilledUnits)
        })),
        beneficiariesByGovernorate: beneficiariesByGovRes.rows.map(r => ({
            governorate: r.governorate,
            count: Number(r.count)
        })),
        distributionsByStatus: distributionsByStatusRes.rows.map(r => ({
            status: r.status,
            count: Number(r.count)
        })),
        monthlyTrend: monthlyTrendRes.rows.map(r => ({
            month: r.month,
            count: Number(r.count)
        }))
    };
}

export async function getOperationalNotifications() {
    const notifications = [];

    // 1. Low stock alerts
    const lowStock = await pool.query(`
        SELECT id, name, category, quantity_available AS "quantityAvailable",
               low_stock_threshold AS "lowStockThreshold", unit, warehouse
        FROM inventory_items
        WHERE status = 'low_stock' OR (quantity_available <= low_stock_threshold AND status = 'available')
        ORDER BY quantity_available ASC
        LIMIT 5
    `);
    for (const item of lowStock.rows) {
        notifications.push({
            id: `low_stock_${item.id}`,
            type: "warning",
            category: "inventory",
            title: "تنبيه انخفاض مخزون",
            message: `الصنف «${item.name}» شارف على النفاد (المتاح: ${item.quantityAvailable} ${item.unit || "وحدة"} في ${item.warehouse || "المخزن"})`,
            link: "/inventory",
            timestamp: new Date().toISOString()
        });
    }

    // 2. Urgent beneficiary needs
    const urgentNeeds = await pool.query(`
        SELECT n.id, n.title, n.category, n.quantity_requested AS "quantityRequested", n.unit,
               COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName"
        FROM beneficiary_needs n
        JOIN beneficiary_profiles bp ON bp.id = n.beneficiary_id
        JOIN users u ON u.id = bp.user_id
        WHERE n.status IN ('open', 'partially_fulfilled') AND n.priority = 'urgent'
        ORDER BY n.created_at DESC
        LIMIT 4
    `);
    for (const need of urgentNeeds.rows) {
        notifications.push({
            id: `urgent_need_${need.id}`,
            type: "urgent",
            category: "needs",
            title: "احتياج عاجل لمستفيد",
            message: `احتياج عاجل للمستفيد (${need.beneficiaryName}): «${need.title}» مطلوب ${need.quantityRequested} ${need.unit || ""}`,
            link: "/verification",
            timestamp: new Date().toISOString()
        });
    }

    // 3. Pending/planned distributions
    const pendingDists = await pool.query(`
        SELECT d.id, d.reference_code AS "referenceCode", d.scheduled_at AS "scheduledAt",
               COALESCE(NULLIF(u.full_name, ''), NULLIF(u.name, ''), u.email) AS "beneficiaryName"
        FROM distributions d
        JOIN beneficiary_profiles bp ON bp.id = d.beneficiary_id
        JOIN users u ON u.id = bp.user_id
        WHERE d.status IN ('planned', 'in_progress')
        ORDER BY d.created_at DESC
        LIMIT 3
    `);
    for (const dist of pendingDists.rows) {
        notifications.push({
            id: `dist_${dist.id}`,
            type: "info",
            category: "distributions",
            title: "أمر توزيع قيد الانتظار",
            message: `التوزيع ${dist.referenceCode || `#${dist.id}`} مخصص للمستفيد (${dist.beneficiaryName}) بانتظار التسليم`,
            link: "/distributions",
            timestamp: new Date().toISOString()
        });
    }

    // 4. Pending verifications
    const pendingBens = await pool.query(`
        SELECT COUNT(*) AS count
        FROM beneficiary_profiles
        WHERE verification_status = 'pending'
    `);
    const pendingCount = Number(pendingBens.rows[0]?.count || 0);
    if (pendingCount > 0) {
        notifications.push({
            id: `pending_bens_count`,
            type: "info",
            category: "beneficiaries",
            title: "طلبات مستفيدين بانتظار الاعتماد",
            message: `يوجد ${pendingCount} طلب تسجيل مستفيد جديد بحاجة إلى المراجعة والتحقق`,
            link: "/beneficiaries",
            timestamp: new Date().toISOString()
        });
    }

    return {
        unreadCount: notifications.length,
        notifications
    };
}




