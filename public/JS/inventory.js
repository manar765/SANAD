// ==========================================================================
// SANAD — Inventory page
// Sections: Data Source · Role Gate · Filtering · Rendering · KPIs
//           · Add/Edit Modal · CSRF
// ==========================================================================

(function () {
    const $ = (selector) => document.querySelector(selector);

    const tbody = $("#inventoryTableBody");
    if (!tbody) return;

    const loadingState = $("#inventoryLoading");
    const errorState = $("#inventoryError");
    const emptyState = $("#inventoryEmpty");
    const countBadge = $("#inventoryCount");

    const searchInput = $("#inventorySearch");
    const categoryFilter = $("#inventoryCategoryFilter");
    const statusFilter = $("#inventoryStatusFilter");
    const resetBtn = $("#inventoryResetBtn");
    const refreshBtn = $("#inventoryRefreshBtn");

    const addBtn = $("#addInventoryBtn");
    const adminOnlyEls = document.querySelectorAll(".admin-only");

    const modalOverlay = $("#inventoryModalOverlay");
    const modalTitle = $("#inventoryModalTitle");
    const modalCloseBtn = $("#inventoryModalCloseBtn");
    const modalCancelBtn = $("#inventoryModalCancelBtn");
    const form = $("#inventoryForm");
    const saveBtn = $("#inventoryModalSaveBtn");

    const STATUS_META = {
        available: { label: "متاح", badge: "inv-badge-available" },
        low_stock: { label: "مخزون منخفض", badge: "inv-badge-low" },
        out_of_stock: { label: "نفد المخزون", badge: "inv-badge-out" },
        in_distribution: { label: "قيد التوزيع", badge: "inv-badge-distribution" },
        surplus: { label: "فائض", badge: "inv-badge-surplus" },
        archived: { label: "مؤرشف", badge: "inv-badge-archived" },
    };

    let items = [];
    let isAdmin = false;
    let csrfToken = null;

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const formatNumber = (value) => Number(value || 0).toLocaleString("ar-EG");

    function showToast(message) {
        const toast = document.getElementById("toast");
        if (!toast) return;
        const span = toast.querySelector("span");
        if (span) span.textContent = message;
        toast.classList.add("show");
        setTimeout(function () { toast.classList.remove("show"); }, 3500);
    }

    async function getCsrf() {
        if (csrfToken) return csrfToken;
        const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        if (!response.ok) throw new Error("يجب تسجيل الدخول لإتمام هذا الإجراء.");
        const payload = await response.json();
        csrfToken = payload.csrfToken;
        return csrfToken;
    }

    /* ---------------------------------------------------------
       Filtering
    --------------------------------------------------------- */
    function matchesFilters(item) {
        const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
        const category = categoryFilter ? categoryFilter.value : "";
        const status = statusFilter ? statusFilter.value : "";
        const haystack = `${item.name} ${item.warehouse} ${item.location} ${item.category}`.toLowerCase();
        if (query && haystack.indexOf(query) === -1) return false;
        if (category && item.category !== category) return false;
        if (status && item.status !== status) return false;
        return true;
    }

    /* ---------------------------------------------------------
       Rendering
    --------------------------------------------------------- */
    function expirationCell(item) {
        if (!item.expirationDate) return "—";
        const expiry = new Date(item.expirationDate);
        const days = Math.ceil((expiry - new Date()) / 86400000);
        const cls = days < 0 ? "exp-badge exp-badge-danger" : days <= 30 ? "exp-badge exp-badge-warning" : "exp-badge";
        const date = expiry.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
        return `<span class="${cls}"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> ${escapeHtml(date)}</span>`;
    }

    function renderKpis() {
        const total = items.reduce((sum, item) => sum + Number(item.quantityTotal || 0), 0);
        const available = items.reduce((sum, item) => sum + Number(item.quantityAvailable || 0), 0);
        const reserved = items.reduce((sum, item) => sum + Number(item.quantityReserved || 0), 0);
        const alerts = items.filter((item) => item.status === "low_stock" || item.status === "out_of_stock").length;
        if ($("#kpiTotalUnits")) $("#kpiTotalUnits").textContent = formatNumber(total);
        if ($("#kpiAvailableUnits")) $("#kpiAvailableUnits").textContent = formatNumber(available);
        if ($("#kpiReservedUnits")) $("#kpiReservedUnits").textContent = formatNumber(reserved);
        if ($("#kpiLowStockCount")) $("#kpiLowStockCount").textContent = formatNumber(alerts);
    }

    function buildRow(item) {
        const meta = STATUS_META[item.status] || STATUS_META.available;
        const tr = document.createElement("tr");
        tr.innerHTML =
            `<td><div class="inventory-item-title">${escapeHtml(item.name)}</div><div class="inventory-item-meta">${escapeHtml(item.condition || "")}</div></td>` +
            `<td>${escapeHtml(item.category)}</td>` +
            `<td>${escapeHtml(item.warehouse)}<div class="inventory-item-meta">${escapeHtml(item.location)}</div></td>` +
            `<td><span class="inv-badge ${meta.badge}">${meta.label}</span></td>` +
            `<td><span class="inventory-qty-pill">${formatNumber(item.quantityAvailable)} ${escapeHtml(item.unit)}</span><span class="inventory-qty-sub">من ${formatNumber(item.quantityTotal)} إجمالي</span></td>` +
            `<td>${expirationCell(item)}</td>` +
            (isAdmin ? `<td><button type="button" class="btn btn-sm btn-outline inv-edit-btn" data-id="${item.id}"><i class="fa-solid fa-pen" aria-hidden="true"></i> تعديل</button></td>` : "");

        if (isAdmin) {
            const editBtn = tr.querySelector(".inv-edit-btn");
            if (editBtn) editBtn.addEventListener("click", () => openModal(item));
        }
        return tr;
    }

    function render() {
        const filtered = items.filter(matchesFilters);
        tbody.innerHTML = "";
        filtered.forEach((item) => tbody.appendChild(buildRow(item)));
        if (emptyState) emptyState.hidden = filtered.length !== 0;
        if (countBadge) countBadge.textContent = formatNumber(filtered.length);
        renderKpis();
    }

    /* ---------------------------------------------------------
       Role gating (admin-only actions)
    --------------------------------------------------------- */
    function applyAdminVisibility() {
        adminOnlyEls.forEach((el) => { el.hidden = !isAdmin; });
    }

    async function loadRole() {
        try {
            const response = await fetch("/api/auth/me", { credentials: "same-origin" });
            if (response.ok) {
                const payload = await response.json();
                isAdmin = payload.user?.role === "admin";
            }
        } catch { isAdmin = false; }
        applyAdminVisibility();
    }

    /* ---------------------------------------------------------
       Data loading
    --------------------------------------------------------- */
    async function loadInventory() {
        window.SANADUI?.setLoading(loadingState, true, "جارٍ تحميل المخزون…");
        if (errorState) errorState.hidden = true;
        try {
            const response = await fetch("/api/inventory", { credentials: "same-origin", headers: { Accept: "application/json" } });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || "تعذر تحميل بيانات المخزون.");
            items = Array.isArray(payload.items) ? payload.items : [];
            render();
        } catch (error) {
            items = [];
            render();
            window.SANADUI?.setError(errorState, error.message || "تعذر تحميل بيانات المخزون.", loadInventory);
        } finally {
            window.SANADUI?.setLoading(loadingState, false);
        }
    }

    /* ---------------------------------------------------------
       Add / Edit modal
    --------------------------------------------------------- */
    function resetForm() {
        if (!form) return;
        form.reset();
        $("#invItemId").value = "";
        $("#invQuantityTotal").disabled = false;
        $("#invLowStockThreshold").value = "1";
        $("#invStatus").value = "available";
        $("#invCondition").value = "جيدة";
        $("#invWarehouse").value = "المخزن العام";
    }

    function openModal(item) {
        if (!isAdmin || !modalOverlay) return;
        resetForm();
        if (item) {
            modalTitle.textContent = "تعديل صنف";
            $("#invItemId").value = item.id;
            $("#invName").value = item.name || "";
            $("#invCategory").value = item.category || "";
            $("#invUnit").value = item.unit || "";
            $("#invQuantityTotal").value = item.quantityTotal ?? "";
            $("#invLowStockThreshold").value = item.lowStockThreshold ?? 1;
            $("#invWarehouse").value = item.warehouse || "";
            $("#invLocation").value = item.location || "";
            $("#invCondition").value = item.condition || "";
            $("#invStatus").value = item.status || "available";
            $("#invExpirationDate").value = item.expirationDate ? String(item.expirationDate).slice(0, 10) : "";
            $("#invDescription").value = item.description || "";
            $("#invNotes").value = item.notes || "";
        } else {
            modalTitle.textContent = "إضافة صنف جديد";
        }
        modalOverlay.classList.add("active");
        modalOverlay.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
        if (!modalOverlay) return;
        modalOverlay.classList.remove("active");
        modalOverlay.setAttribute("aria-hidden", "true");
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!isAdmin) return;

        const id = $("#invItemId").value;
        const body = {
            name: $("#invName").value.trim(),
            category: $("#invCategory").value,
            unit: $("#invUnit").value.trim(),
            quantityTotal: Number($("#invQuantityTotal").value),
            lowStockThreshold: Number($("#invLowStockThreshold").value || 0),
            warehouse: $("#invWarehouse").value.trim(),
            location: $("#invLocation").value.trim(),
            condition: $("#invCondition").value.trim(),
            status: $("#invStatus").value,
            expirationDate: $("#invExpirationDate").value || null,
            description: $("#invDescription").value.trim(),
            notes: $("#invNotes").value.trim(),
        };

        if (!body.name || !body.category || !body.unit || !body.location) {
            showToast("يرجى تعبئة الحقول المطلوبة.");
            return;
        }

        saveBtn.disabled = true;
        try {
            const token = await getCsrf();
            const url = id ? `/api/admin/inventory/${encodeURIComponent(id)}` : "/api/admin/inventory";
            const method = id ? "PATCH" : "POST";
            const response = await fetch(url, {
                method,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                body: JSON.stringify(body),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || "تعذر حفظ بيانات الصنف.");
            showToast(id ? "تم تحديث بيانات الصنف." : "تمت إضافة الصنف بنجاح.");
            closeModal();
            await loadInventory();
        } catch (error) {
            showToast(error.message || "تعذر حفظ بيانات الصنف.");
        } finally {
            saveBtn.disabled = false;
        }
    }

    /* ---------------------------------------------------------
       Wiring
    --------------------------------------------------------- */
    if (searchInput) searchInput.addEventListener("input", render);
    if (categoryFilter) categoryFilter.addEventListener("change", render);
    if (statusFilter) statusFilter.addEventListener("change", render);
    if (resetBtn) resetBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (categoryFilter) categoryFilter.value = "";
        if (statusFilter) statusFilter.value = "";
        render();
    });
    if (refreshBtn) refreshBtn.addEventListener("click", loadInventory);
    if (addBtn) addBtn.addEventListener("click", () => openModal(null));
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);
    if (modalOverlay) modalOverlay.addEventListener("click", (event) => { if (event.target === modalOverlay) closeModal(); });
    if (form) form.addEventListener("submit", handleSubmit);

    (async function init() {
        await loadRole();
        await loadInventory();
    })();
})();
