import pool from "./database/index.js";
import {
    createAssistanceRequest,
    createBeneficiaryNeed,
    createBeneficiaryProfile,
    createDistribution,
    createInventoryItem,
    deleteBeneficiaryRecords,
    getAssistanceRequest,
    getBeneficiaryDetail,
    getBeneficiaryDistributionLink,
    getBeneficiaryProfileId,
    getBeneficiaryRecommendationHistory,
    getLatestBeneficiaryRecommendation,
    getPendingDuplicateAssistanceRequest,
    listAssistanceRequests,
    listAssistanceRequestsForUser,
    listBeneficiaries,
    listBeneficiaryNeeds,
    listDistributions,
    listInventory,
    saveBeneficiaryRecommendation,
    searchBeneficiariesForVerification,
    syncDonationToInventory,
    updateBeneficiaryNeed,
    updateBeneficiaryProfile,
    updateInventoryItem,
    getDistributionById,
    cancelDistribution,
    getDistributionStats,
    getDashboardSummary,
    getOperationalReports,
    getOperationalNotifications,
} from "./operations-repository.js";
import {
    evaluateBeneficiaryRules,
    matchInventoryToNeeds,
    ADVISORY_DISCLAIMER_AR,
    PRIORITY_LABELS_AR
} from "./rules/recommendation-engine.js";

const INVENTORY_STATUSES = new Set(["available", "low_stock", "out_of_stock", "in_distribution", "surplus", "archived"]);
const NEED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const NEED_STATUSES = new Set(["open", "partially_fulfilled", "fulfilled", "cancelled"]);
const DISTRIBUTION_STATUSES = new Set(["draft", "planned", "in_progress", "completed", "cancelled"]);
const BENEFICIARY_VERIFICATION_STATUSES = new Set(["pending", "verified", "rejected", "needs_review"]);

const text = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const positiveInt = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const nonNegativeInt = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const isValidEgyptianNationalId = (value) => /^\d{14}$/.test(String(value || "").trim());

export async function getInventory(filters) { return listInventory({ status: text(filters?.status, 30) || null, category: text(filters?.category, 80) || null }); }

export async function addInventoryItem(body, userId) {
    const input = {
        sourceDonationId: nonNegativeInt(body?.sourceDonationId), name: text(body?.name, 160), category: text(body?.category, 80),
        description: text(body?.description, 2000), unit: text(body?.unit, 40), quantityTotal: nonNegativeInt(body?.quantityTotal),
        lowStockThreshold: nonNegativeInt(body?.lowStockThreshold ?? 1), status: text(body?.status || "available", 30),
        warehouse: text(body?.warehouse || "المخزن العام", 160), location: text(body?.location, 160), condition: text(body?.condition || "standard", 80),
        expirationDate: body?.expirationDate ? text(body.expirationDate, 10) : null, notes: text(body?.notes, 2000),
    };
    if (!input.name || input.name.length < 2 || !input.category || input.category.length < 2 || !input.unit || !input.location || input.quantityTotal === null || !INVENTORY_STATUSES.has(input.status)) throw new Error("INVALID_INVENTORY");
    return createInventoryItem(input, userId);
}

export async function editInventoryItem(id, body) {
    const input = {
        name: text(body?.name, 160) || null, category: text(body?.category, 80) || null, description: text(body?.description, 2000),
        quantityTotal: body?.quantityTotal === undefined ? null : nonNegativeInt(body.quantityTotal),
        lowStockThreshold: body?.lowStockThreshold === undefined ? null : nonNegativeInt(body.lowStockThreshold),
        status: body?.status === undefined ? null : text(body.status, 30),
        warehouse: text(body?.warehouse, 160) || null, location: text(body?.location, 160) || null,
        expirationDate: body?.expirationDate === undefined ? undefined : (body?.expirationDate ? text(body.expirationDate, 10) : null),
        notes: body?.notes === undefined ? undefined : text(body.notes, 2000),
    };
    if (input.status && !INVENTORY_STATUSES.has(input.status)) throw new Error("INVALID_INVENTORY_STATUS");
    if (body?.lowStockThreshold !== undefined && input.lowStockThreshold === null) throw new Error("INVALID_INVENTORY");
    if (body?.quantityTotal !== undefined && input.quantityTotal === null) throw new Error("INVALID_INVENTORY");
    return updateInventoryItem(id, input);
}

export async function getNeeds(filters) { return listBeneficiaryNeeds({ beneficiaryId: filters?.beneficiaryId || null, priority: filters?.priority || null, status: filters?.status || null }); }

export async function addNeed(body, beneficiaryId) {
    const input = { title: text(body?.title, 160), description: text(body?.description, 2000), category: text(body?.category, 80), quantityRequested: positiveInt(body?.quantityRequested), unit: text(body?.unit, 40), priority: text(body?.priority || "medium", 20), dueDate: body?.dueDate || null };
    if (input.title.length < 2 || input.category.length < 2 || !input.quantityRequested || !input.unit || !NEED_PRIORITIES.has(input.priority)) throw new Error("INVALID_NEED");
    return createBeneficiaryNeed(input, beneficiaryId);
}

export async function editNeed(id, body, beneficiaryId = null) {
    const input = {
        title: body?.title === undefined ? null : text(body.title, 160), description: body?.description === undefined ? null : text(body.description, 2000),
        category: body?.category === undefined ? null : text(body.category, 80), quantityRequested: body?.quantityRequested === undefined ? null : positiveInt(body.quantityRequested),
        quantityFulfilled: body?.quantityFulfilled === undefined ? null : nonNegativeInt(body.quantityFulfilled), unit: body?.unit === undefined ? null : text(body.unit, 40),
        priority: body?.priority === undefined ? null : text(body.priority, 20), status: body?.status === undefined ? null : text(body.status, 30), dueDate: body?.dueDate === undefined ? null : body.dueDate,
    };
    if (input.priority && !NEED_PRIORITIES.has(input.priority)) throw new Error("INVALID_NEED_PRIORITY");
    if (input.status && !NEED_STATUSES.has(input.status)) throw new Error("INVALID_NEED_STATUS");
    if (body?.quantityRequested !== undefined && input.quantityRequested === null) throw new Error("INVALID_NEED");
    if (body?.quantityFulfilled !== undefined && input.quantityFulfilled === null) throw new Error("INVALID_NEED");
    return updateBeneficiaryNeed(id, input, beneficiaryId);
}

const ASSISTANCE_STATUSES = new Set(["pending", "approved", "rejected", "fulfilled"]);

export async function createAssistanceRequestService(body, userId) {
    const input = {
        itemName: text(body?.itemName || body?.item_type || body?.title, 160),
        category: text(body?.category, 80),
        description: text(body?.description, 2000),
        quantity: positiveInt(body?.quantity),
        unit: text(body?.unit || "قطعة", 40),
        notes: text(body?.notes, 2000),
    };

    if (input.itemName.length < 2 || input.category.length < 2 || !input.quantity || !input.unit) {
        const err = new Error("يرجى تقديم تفاصيل صحيحة لطلب المساعدة.");
        err.statusCode = 400;
        err.code = "INVALID_ASSISTANCE_REQUEST";
        throw err;
    }

    if (userId == null) {
        const err = new Error("لم يتم العثور على ملف المستفيد.");
        err.statusCode = 404;
        err.code = "ASSISTANCE_USER_NOT_FOUND";
        throw err;
    }

    const beneficiaryId = await getBeneficiaryProfileId(userId);
    if (!beneficiaryId) {
        const err = new Error("لم يتم العثور على ملف المستفيد. يرجى التواصل مع الإدارة.");
        err.statusCode = 404;
        err.code = "BENEFICIARY_PROFILE_NOT_FOUND";
        throw err;
    }

    const duplicate = await getPendingDuplicateAssistanceRequest(beneficiaryId, input.itemName, input.category);
    if (duplicate) {
        const err = new Error("لديك طلب مساعدة مماثل قيد المراجعة بالفعل.");
        err.statusCode = 409;
        err.code = "DUPLICATE_ASSISTANCE_REQUEST";
        err.details = { referenceCode: duplicate.referenceCode, itemName: duplicate.itemName };
        throw err;
    }

    return createAssistanceRequest(input, userId, beneficiaryId);
}

export async function getAssistanceRequestsService(filters = {}) {
    return listAssistanceRequests({
        status: text(filters?.status, 30) || null,
        search: text(filters?.search, 100) || null,
    });
}

export async function getMyAssistanceRequestsService(userId) {
    return listAssistanceRequestsForUser(userId);
}

export async function reviewAssistanceRequestService(requestId, status, reviewerId) {
    if (!ASSISTANCE_STATUSES.has(status)) {
        const err = new Error("يرجى تقديم حالة صحيحة لطلب المساعدة.");
        err.statusCode = 400;
        err.code = "INVALID_ASSISTANCE_STATUS";
        throw err;
    }
    if (status === "pending") {
        const err = new Error("لا يمكن إعادة طلب المساعدة إلى قيد المراجعة.");
        err.statusCode = 400;
        err.code = "INVALID_ASSISTANCE_TRANSITION";
        throw err;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const updateRes = await client.query(
            `UPDATE assistance_requests
             SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $3
             RETURNING id, beneficiary_id AS "beneficiaryId", item_name AS "itemName",
                       category, description, quantity, unit, status`,
            [status, reviewerId || null, requestId],
        );
        const row = updateRes.rows[0];
        if (!row) {
            await client.query("ROLLBACK");
            return null;
        }

        if (status === "approved") {
            const existingNeed = await client.query(
                `SELECT id FROM beneficiary_needs
                 WHERE assistance_request_id = $1
                    OR (beneficiary_id = $2 AND LOWER(title) = LOWER($3) AND status IN ('open', 'partially_fulfilled'))
                 LIMIT 1`,
                [requestId, row.beneficiaryId, row.itemName],
            );
            if (!existingNeed.rows[0]) {
                await client.query(
                    `INSERT INTO beneficiary_needs (beneficiary_id, title, description, category, quantity_requested, unit, priority, status, assistance_request_id)
                     VALUES ($1, $2, $3, $4, $5, $6, 'medium', 'open', $7)`,
                    [row.beneficiaryId, row.itemName, row.description || "", row.category, row.quantity, row.unit, requestId],
                );
            }
        } else if (status === "rejected" || status === "fulfilled") {
            await client.query(
                `UPDATE beneficiary_needs
                 SET status = $1,
                     quantity_fulfilled = CASE WHEN $1 = 'fulfilled' THEN quantity_requested ELSE quantity_fulfilled END,
                     updated_at = NOW()
                 WHERE assistance_request_id = $2`,
                [status === "fulfilled" ? "fulfilled" : "cancelled", requestId],
            );
        }

        await client.query("COMMIT");
        return getAssistanceRequest(requestId);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export async function approveOrRejectDonation(donationId, status, reviewerId) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const updateRes = await client.query(
            `UPDATE donation_requests
             SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $3
             RETURNING id, status, reference_code AS "referenceCode"`,
            [status, reviewerId || null, donationId],
        );
        if (!updateRes.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }
        const inventoryItemId = await syncDonationToInventory(client, donationId, status, reviewerId);
        await client.query("COMMIT");
        return {
            donation: updateRes.rows[0],
            inventoryItemId,
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function getBeneficiaries(filters) {
    return listBeneficiaries({
        search: text(filters?.search, 100) || null,
        status: text(filters?.status, 30) || null,
        governorate: text(filters?.governorate, 60) || null,
    });
}

export async function getBeneficiary(id) {
    return getBeneficiaryDetail(id);
}

export async function addBeneficiary(body, createdBy) {
    const input = {
        userId: body?.userId ? positiveInt(body.userId) : null,
        name: text(body?.name, 120),
        email: text(body?.email, 120) || null,
        phone: text(body?.phone, 30) || null,
        nationalId: text(body?.nationalId, 30) || null,
        address: text(body?.address, 200) || null,
        governorate: text(body?.governorate, 60) || null,
        district: text(body?.district, 80) || null,
        familySize: body?.familySize !== undefined ? positiveInt(body.familySize) : 1,
        childrenCount: body?.childrenCount !== undefined ? nonNegativeInt(body.childrenCount) : 0,
        housingType: text(body?.housingType, 60) || null,
        monthlyIncome: body?.monthlyIncome !== undefined && !Number.isNaN(Number(body.monthlyIncome)) ? Number(body.monthlyIncome) : null,
        employmentStatus: text(body?.employmentStatus, 80) || null,
        healthConditions: text(body?.healthConditions, 500) || null,
        location: text(body?.location || body?.governorate || "غير محدد", 160),
        verificationStatus: text(body?.verificationStatus || "pending", 30),
        notes: text(body?.notes, 2000),
    };

    if (!input.name || input.name.length < 2) throw new Error("INVALID_BENEFICIARY_NAME");
    if (input.verificationStatus && !BENEFICIARY_VERIFICATION_STATUSES.has(input.verificationStatus)) throw new Error("INVALID_VERIFICATION_STATUS");
    if (input.nationalId && !isValidEgyptianNationalId(input.nationalId)) throw new Error("INVALID_NATIONAL_ID");

    return createBeneficiaryProfile(input, createdBy);
}

export async function editBeneficiary(id, body, updatedBy) {
    const input = {
        name: body?.name !== undefined ? text(body.name, 120) : undefined,
        phone: body?.phone !== undefined ? text(body.phone, 30) : undefined,
        nationalId: body?.nationalId !== undefined ? text(body.nationalId, 30) : undefined,
        address: body?.address !== undefined ? text(body.address, 200) : undefined,
        governorate: body?.governorate !== undefined ? text(body.governorate, 60) : undefined,
        district: body?.district !== undefined ? text(body.district, 80) : undefined,
        familySize: body?.familySize !== undefined ? positiveInt(body.familySize) : undefined,
        childrenCount: body?.childrenCount !== undefined ? nonNegativeInt(body.childrenCount) : undefined,
        housingType: body?.housingType !== undefined ? text(body.housingType, 60) : undefined,
        monthlyIncome: body?.monthlyIncome !== undefined ? Number(body.monthlyIncome) : undefined,
        employmentStatus: body?.employmentStatus !== undefined ? text(body.employmentStatus, 80) : undefined,
        healthConditions: body?.healthConditions !== undefined ? text(body.healthConditions, 500) : undefined,
        location: body?.location !== undefined ? text(body.location, 160) : undefined,
        verificationStatus: body?.verificationStatus !== undefined ? text(body.verificationStatus, 30) : undefined,
        notes: body?.notes !== undefined ? text(body.notes, 2000) : undefined,
    };

    if (input.verificationStatus && !BENEFICIARY_VERIFICATION_STATUSES.has(input.verificationStatus)) {
        throw new Error("INVALID_VERIFICATION_STATUS");
    }
    if (input.nationalId !== undefined && input.nationalId && !isValidEgyptianNationalId(input.nationalId)) {
        throw new Error("INVALID_NATIONAL_ID");
    }

    return updateBeneficiaryProfile(id, input, updatedBy);
}

export async function deleteBeneficiariesByIds(ids, requesterId) {
    const list = (Array.isArray(ids) ? ids : [])
        .map(value => value)
        .filter(value => Number.isInteger(Number(value)));
    const numericIds = list.map(Number).filter(Number.isInteger);
    if (numericIds.length === 0) throw new Error("INVALID_BENEFICIARY_SELECTION");
    return deleteBeneficiaryRecords(numericIds, requesterId);
}

export async function deleteAllBeneficiaries(requesterId) {
    return deleteBeneficiaryRecords(null, requesterId);
}

export async function deleteSingleBeneficiary(id, requesterId) {
    return deleteBeneficiaryRecords([Number(id)], requesterId);
}

export async function evaluateAndSaveRecommendation(beneficiaryId, actorId) {
    const detail = await getBeneficiaryDetail(beneficiaryId);
    if (!detail) throw new Error("BENEFICIARY_NOT_FOUND");

    const inventoryItems = await listInventory();
    const evaluation = evaluateBeneficiaryRules({
        beneficiary: detail,
        needs: detail.needs,
        distributionHistory: detail.distributions,
        inventoryItems,
    });

    const saved = await saveBeneficiaryRecommendation({
        beneficiaryId: detail.id,
        priorityLevel: evaluation.priority_level,
        reasons: evaluation.reasons,
        suggestedItems: evaluation.suggested_items,
        ruleInputs: evaluation.rule_inputs,
        generatedBy: actorId || null,
    });

    return {
        ...evaluation,
        id: saved.id,
        created_at: saved.createdAt,
        generated_by: saved.generatedBy,
    };
}

export async function getBeneficiaryRecommendation(beneficiaryId, actorId, forceRefresh = false) {
    const detail = await getBeneficiaryDetail(beneficiaryId);
    if (!detail) throw new Error("BENEFICIARY_NOT_FOUND");

    if (!forceRefresh) {
        const latest = await getLatestBeneficiaryRecommendation(detail.id);
        if (latest) {
            const inventoryItems = await listInventory();
            const openNeeds = (detail.needs || []).filter(n => n.status === "open" || n.status === "partially_fulfilled");
            const freshSuggestions = matchInventoryToNeeds(openNeeds, inventoryItems);

            const daysAgo = latest.ruleInputs?.days_since_last_distribution;
            const hasRecent = daysAgo !== null && daysAgo !== undefined && Number(daysAgo) < 30;

            return {
                id: latest.id,
                priority_level: latest.priorityLevel,
                priority_label_ar: PRIORITY_LABELS_AR[latest.priorityLevel] || latest.priorityLevel,
                reasons: latest.reasons,
                suggested_items: freshSuggestions.length ? freshSuggestions : (latest.suggestedItems || []),
                rule_inputs: latest.ruleInputs,
                created_at: latest.createdAt,
                generated_by: latest.generatedBy,
                generated_by_name: latest.generatedByName,
                recent_support_warning: {
                    hasRecentSupport: hasRecent,
                    daysAgo: daysAgo ?? null,
                    lastDistributedAt: latest.ruleInputs?.last_distribution_date ?? null,
                    message: hasRecent
                        ? `تنبيه: استفاد المستفيد من مساعدة خلال آخر 30 يوماً (منذ ${daysAgo} يوماً). التوصية للمراجعة والاستثناء وفق تقدير الموظف ولا تمنع الصرف.`
                        : null,
                },
                advisory_disclaimer: ADVISORY_DISCLAIMER_AR,
            };
        }
    }

    return evaluateAndSaveRecommendation(detail.id, actorId);
}

export async function getBeneficiaryVerification(beneficiaryId, actorId) {
    const detail = await getBeneficiaryDetail(beneficiaryId);
    if (!detail) return null;

    const recommendation = await getBeneficiaryRecommendation(detail.id, actorId, false);
    const history = await getBeneficiaryRecommendationHistory(detail.id, 5);

    return {
        beneficiary: detail,
        recommendation,
        history,
        advisory: ADVISORY_DISCLAIMER_AR,
    };
}

export async function searchVerification(query, limit = 20) {
    return searchBeneficiariesForVerification(query, limit);
}

export async function listDistributionsService(params = {}) {
    return listDistributions(params);
}

export async function getDistributionDetailService(id) {
    return getDistributionById(id);
}

export async function getDistributionStatsService() {
    return getDistributionStats();
}

export async function createDistributionService(input, actorId) {
    if (!input || typeof input !== "object") {
        const err = new Error("بيانات عملية التوزيع غير صالحة.");
        err.statusCode = 400;
        throw err;
    }

    const beneficiaryId = Number(input.beneficiaryId);
    if (!Number.isInteger(beneficiaryId) || beneficiaryId <= 0) {
        const err = new Error("يجب تحديد المستفيد المستلم للمساعدة.");
        err.statusCode = 400;
        throw err;
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
        const err = new Error("يجب تحديد صنف واحد على الأقل للتسليم.");
        err.statusCode = 400;
        throw err;
    }

    const cleanedItems = [];
    for (const item of input.items) {
        const inventoryItemId = Number(item.inventoryItemId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0) {
            const err = new Error("معرّف الصنف المخزني غير صالح.");
            err.statusCode = 400;
            throw err;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
            const err = new Error("يجب أن تكون الكمية المحددة لكل صنف عدداً صحيحاً أكبر من صفر.");
            err.statusCode = 400;
            throw err;
        }
        cleanedItems.push({
            inventoryItemId,
            quantity,
            needId: item.needId ? Number(item.needId) : null,
        });
    }

    const validStatuses = ["completed", "planned", "in_progress"];
    const status = input.status && validStatuses.includes(input.status) ? input.status : "completed";

    return createDistribution(
        {
            beneficiaryId,
            items: cleanedItems,
            status,
            location: input.location ? String(input.location).slice(0, 160) : null,
            notes: input.notes ? String(input.notes).slice(0, 2000) : "",
            scheduledAt: input.scheduledAt || null,
            distributedAt: input.distributedAt || null,
        },
        actorId,
    );
}

export async function cancelDistributionService(id, actorId, reason) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        const err = new Error("معرّف عملية التوزيع غير صالح.");
        err.statusCode = 400;
        throw err;
    }
    return cancelDistribution(numericId, actorId, reason);
}

export {
    getBeneficiaryProfileId,
    listDistributionsService as getDistributions,
    createDistributionService as addDistribution,
    cancelDistributionService as changeDistributionStatus,
    getDistributionDetailService as getDistribution,
    getDashboardSummary,
    getOperationalReports,
    getOperationalNotifications,
};



