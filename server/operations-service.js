import pool from "./database/index.js";
import {
    createBeneficiaryNeed,
    createBeneficiaryProfile,
    createDistribution,
    createInventoryItem,
    getBeneficiaryDetail,
    getBeneficiaryProfileId,
    getBeneficiaryRecommendationHistory,
    getLatestBeneficiaryRecommendation,
    listBeneficiaries,
    listBeneficiaryNeeds,
    listDistributions,
    listInventory,
    saveBeneficiaryRecommendation,
    searchBeneficiariesForVerification,
    syncDonationToInventory,
    updateBeneficiaryNeed,
    updateBeneficiaryProfile,
    updateDistributionStatus,
    updateInventoryItem,
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
        lowStockThreshold: body?.lowStockThreshold === undefined ? null : nonNegativeInt(body.lowStockThreshold),
        status: body?.status === undefined ? null : text(body.status, 30),
        warehouse: text(body?.warehouse, 160) || null, location: text(body?.location, 160) || null,
        expirationDate: body?.expirationDate === undefined ? undefined : (body?.expirationDate ? text(body.expirationDate, 10) : null),
        notes: body?.notes === undefined ? undefined : text(body.notes, 2000),
    };
    if (input.status && !INVENTORY_STATUSES.has(input.status)) throw new Error("INVALID_INVENTORY_STATUS");
    if (body?.lowStockThreshold !== undefined && input.lowStockThreshold === null) throw new Error("INVALID_INVENTORY");
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

export async function getDistributions(filters) { return listDistributions({ beneficiaryId: filters?.beneficiaryId || null, status: filters?.status || null }); }

export async function addDistribution(body, userId) {
    const beneficiaryId = positiveInt(body?.beneficiaryId);
    const items = Array.isArray(body?.items) ? body.items.map(item => ({ inventoryItemId: positiveInt(item?.inventoryItemId), quantity: positiveInt(item?.quantity) })) : [];
    if (!beneficiaryId || !items.length || items.some(item => !item.inventoryItemId || !item.quantity)) throw new Error("INVALID_DISTRIBUTION");
    const unique = new Set(items.map(item => item.inventoryItemId));
    if (unique.size !== items.length) throw new Error("DUPLICATE_DISTRIBUTION_ITEM");
    return createDistribution({ beneficiaryId, items, scheduledAt: body?.scheduledAt || null, location: text(body?.location, 160) || null, notes: text(body?.notes, 2000) }, userId);
}

export async function changeDistributionStatus(id, status) {
    if (!DISTRIBUTION_STATUSES.has(status) || status === "draft") throw new Error("INVALID_DISTRIBUTION_STATUS");
    return updateDistributionStatus(id, status);
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

    return updateBeneficiaryProfile(id, input, updatedBy);
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

export { getBeneficiaryProfileId };


