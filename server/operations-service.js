import {
    createBeneficiaryNeed,
    createDistribution,
    createInventoryItem,
    getBeneficiaryProfileId,
    listBeneficiaryNeeds,
    listDistributions,
    listInventory,
    updateBeneficiaryNeed,
    updateDistributionStatus,
    updateInventoryItem,
} from "./operations-repository.js";

const INVENTORY_STATUSES = new Set(["available", "low_stock", "out_of_stock", "in_distribution", "surplus", "archived"]);
const NEED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const NEED_STATUSES = new Set(["open", "partially_fulfilled", "fulfilled", "cancelled"]);
const DISTRIBUTION_STATUSES = new Set(["draft", "planned", "in_progress", "completed", "cancelled"]);

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
    };
    if (!input.name || input.name.length < 2 || !input.category || input.category.length < 2 || !input.unit || !input.location || input.quantityTotal === null || !INVENTORY_STATUSES.has(input.status)) throw new Error("INVALID_INVENTORY");
    return createInventoryItem(input, userId);
}

export async function editInventoryItem(id, body) {
    const input = { name: text(body?.name, 160) || null, category: text(body?.category, 80) || null, description: text(body?.description, 2000), lowStockThreshold: body?.lowStockThreshold === undefined ? null : nonNegativeInt(body.lowStockThreshold), status: body?.status === undefined ? null : text(body.status, 30), warehouse: text(body?.warehouse, 160) || null, location: text(body?.location, 160) || null };
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

export { getBeneficiaryProfileId };
