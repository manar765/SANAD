/**
 * SANAD — Distributions Management Script
 * Arabic-first RTL, interactive wizard, real-time inventory checks, printable vouchers.
 */

(() => {
    "use strict";

    // --- State ---
    const state = {
        distributions: [],
        inventory: [],
        beneficiaries: [],
        selectedBeneficiary: null,
        loading: false,
    };

    // --- DOM Elements ---
    const $ = selector => document.querySelector(selector);
    const $$ = selector => document.querySelectorAll(selector);

    const distTableBody = $("#distTableBody");
    const distEmptyState = $("#distEmptyState");
    const distLoadingState = $("#distLoadingState");
    const distSearchInput = $("#distSearchInput");
    const distStatusFilter = $("#distStatusFilter");
    const distRefreshBtn = $("#distRefreshBtn");

    // Stats
    const statTotal = $("#statTotalDistributions");
    const statCompleted = $("#statCompletedDistributions");
    const statItemsDelivered = $("#statItemsDelivered");
    const statToday = $("#statTodayDistributions");

    // Wizard Modal Elements
    const openCreateDistModalBtn = $("#openCreateDistModalBtn");
    const createDistModal = $("#createDistModal");
    const closeCreateDistModalBtn = $("#closeCreateDistModalBtn");
    const cancelCreateDistModalBtn = $("#cancelCreateDistModalBtn");
    const createDistForm = $("#createDistForm");
    const distBeneficiarySelect = $("#distBeneficiarySelect");
    const distBeneficiaryPreview = $("#distBeneficiaryPreview");
    const prevBenPhone = $("#prevBenPhone");
    const prevBenFamily = $("#prevBenFamily");
    const prevBenStatus = $("#prevBenStatus");
    const prevBenNeedsChips = $("#prevBenNeedsChips");
    const distModalItemsBody = $("#distModalItemsBody");
    const addDistItemRowBtn = $("#addDistItemRowBtn");

    // Voucher Modal Elements
    const voucherModal = $("#voucherModal");
    const closeVoucherModalBtn = $("#closeVoucherModalBtn");
    const dismissVoucherModalBtn = $("#dismissVoucherModalBtn");
    const printVoucherBtn = $("#printVoucherBtn");

    // Voucher content
    const vouchRefCode = $("#vouchRefCode");
    const vouchDate = $("#vouchDate");
    const vouchBenName = $("#vouchBenName");
    const vouchBenId = $("#vouchBenId");
    const vouchBenPhone = $("#vouchBenPhone");
    const vouchBenAddress = $("#vouchBenAddress");
    const vouchItemsBody = $("#vouchItemsBody");
    const vouchNotesText = $("#vouchNotesText");
    const vouchStaffName = $("#vouchStaffName");

    // Helpers
    const formatNumber = num => Number(num || 0).toLocaleString("ar-EG");
    const formatDate = d => d ? new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—";
    const escapeHtml = str => String(str || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.getAttribute("content");
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }

    function showToast(message, type = "info") {
        let toastContainer = document.getElementById("toastContainer");
        if (!toastContainer) {
            toastContainer = document.createElement("div");
            toastContainer.id = "toastContainer";
            toastContainer.style.cssText = "position: fixed; bottom: 2rem; left: 2rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.75rem;";
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement("div");
        const bg = type === "error" ? "#ef4444" : type === "success" ? "#10b981" : "#0d9488";
        toast.style.cssText = `background: ${bg}; color: #fff; padding: 0.85rem 1.4rem; border-radius: 0.65rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2); font-weight: 600; font-size: 0.9rem; animation: fadeIn 0.2s ease; display: flex; align-items: center; gap: 0.6rem;`;
        toast.innerHTML = `<i class="fa-solid fa-${type === "error" ? "triangle-exclamation" : type === "success" ? "circle-check" : "circle-info"}"></i> <span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // --- API Calls ---
    async function apiFetch(url, options = {}) {
        const res = await fetch(url, {
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-CSRF-Token": getCsrfToken(),
                ...(options.headers || {}),
            },
            ...options,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.message || "حدث خطأ أثناء معالجة الطلب.");
            err.status = res.status;
            err.details = data.details;
            throw err;
        }
        return data;
    }

    // --- Load Distributions ---
    async function loadDistributions() {
        distTableBody.innerHTML = "";
        distLoadingState.hidden = false;
        distEmptyState.hidden = true;

        try {
            const status = distStatusFilter?.value || "";
            const search = distSearchInput?.value?.trim() || "";
            const queryParams = new URLSearchParams();
            if (status) queryParams.set("status", status);
            if (search) queryParams.set("search", search);

            const data = await apiFetch(`/api/distributions?${queryParams.toString()}`);
            state.distributions = Array.isArray(data.distributions) ? data.distributions : [];

            renderTable(state.distributions);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            distLoadingState.hidden = true;
        }
    }

    // --- Load Stats ---
    async function loadStats() {
        try {
            const data = await apiFetch("/api/distributions/stats");
            const s = data.stats || {};
            if (statTotal) statTotal.textContent = formatNumber(s.total);
            if (statCompleted) statCompleted.textContent = formatNumber(s.completed);
            if (statItemsDelivered) statItemsDelivered.textContent = formatNumber(s.totalItemsDelivered);
            if (statToday) statToday.textContent = formatNumber(s.todayCount);
        } catch {
            // Stats load silently fails without breaking table
        }
    }

    // --- Render Table ---
    function renderTable(list) {
        distTableBody.innerHTML = "";
        if (!list || list.length === 0) {
            distEmptyState.hidden = false;
            return;
        }
        distEmptyState.hidden = true;

        const statusLabels = {
            completed: "تم التسليم",
            planned: "مجدول",
            in_progress: "قيد التنفيذ",
            cancelled: "ملغى",
        };

        list.forEach(d => {
            const tr = document.createElement("tr");

            // Items tags preview
            const items = Array.isArray(d.items) ? d.items : [];
            const itemsPreview = items.length > 0
                ? `<div class="dist-items-preview">
                     <span style="font-weight:600;">${formatNumber(items.length)} أصناف:</span>
                     <div class="dist-items-tags">
                        ${items.slice(0, 3).map(it => `<span class="dist-item-tag">${escapeHtml(it.itemName)} (${formatNumber(it.quantity)} ${escapeHtml(it.unit || "")})</span>`).join("")}
                        ${items.length > 3 ? `<span class="dist-item-tag">+${items.length - 3} أخرى</span>` : ""}
                     </div>
                   </div>`
                : '<span style="color:#94a3b8;">—</span>';

            const statusClass = d.status || "completed";
            const dateStr = formatDate(d.distributedAt || d.scheduledAt || d.createdAt);

            tr.innerHTML = `
                <td>
                    <span class="dist-code-badge">${escapeHtml(d.referenceCode || `DIST-${d.id}`)}</span>
                </td>
                <td class="dist-beneficiary-cell">
                    <strong>${escapeHtml(d.beneficiaryName || "مستفيد")}</strong>
                    <small><i class="fa-solid fa-phone"></i> ${escapeHtml(d.beneficiaryPhone || "—")}</small>
                </td>
                <td>${itemsPreview}</td>
                <td>${dateStr}</td>
                <td>
                    <span class="dist-badge ${statusClass}">
                        <i class="fa-solid fa-${statusClass === "completed" ? "circle-check" : statusClass === "planned" ? "calendar-clock" : statusClass === "cancelled" ? "circle-xmark" : "spinner"}"></i>
                        ${statusLabels[d.status] || d.status}
                    </span>
                </td>
                <td><small style="color:#64748b;">${escapeHtml(d.location || "المخزن العام")}</small></td>
                <td>
                    <div class="dist-actions-cell">
                        <button type="button" class="btn-icon-dist print" data-action="view-voucher" data-id="${d.id}" title="عرض وطباعة سند الاستلام">
                            <i class="fa-solid fa-receipt"></i>
                        </button>
                        ${d.status !== "cancelled" ? `
                        <button type="button" class="btn-icon-dist" data-action="cancel-dist" data-id="${d.id}" title="إلغاء التوزيع">
                            <i class="fa-solid fa-ban text-red" style="color:#ef4444;"></i>
                        </button>` : ""}
                    </div>
                </td>
            `;

            distTableBody.appendChild(tr);
        });
    }

    // --- Pre-Load Inventory & Beneficiaries for Wizard ---
    async function loadWizardPrerequisites() {
        try {
            const [invRes, benRes] = await Promise.all([
                apiFetch("/api/inventory"),
                apiFetch("/api/beneficiaries"),
            ]);

            state.inventory = (invRes.items || []).filter(item => Number(item.quantityAvailable) > 0);
            state.beneficiaries = benRes.beneficiaries || [];

            // Populate Beneficiary Select
            if (distBeneficiarySelect) {
                distBeneficiarySelect.innerHTML = '<option value="">— اختر مستفيداً من القائمة —</option>' +
                    state.beneficiaries.map(b => `
                        <option value="${b.id}">
                            ${escapeHtml(b.name)} — هاتف: ${escapeHtml(b.phone || "—")} (${b.referenceCode || `#${b.id}`})
                        </option>
                    `).join("");
            }
        } catch {
            // Silently handled
        }
    }

    // --- On Beneficiary Change inside Wizard ---
    async function onBeneficiarySelected(beneficiaryId) {
        if (!beneficiaryId) {
            distBeneficiaryPreview.classList.remove("active");
            state.selectedBeneficiary = null;
            return;
        }

        try {
            prevBenNeedsChips.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ فحص الاحتياجات والتوصية…';
            distBeneficiaryPreview.classList.add("active");

            const data = await apiFetch(`/api/beneficiaries/${beneficiaryId}`);
            const b = data.beneficiary;
            state.selectedBeneficiary = b;

            if (prevBenPhone) prevBenPhone.textContent = b.phone || "غير مسجل";
            if (prevBenFamily) prevBenFamily.textContent = `${b.familySize || 1} أفراد (${b.childrenCount || 0} أطفال)`;
            if (prevBenStatus) prevBenStatus.textContent = b.verificationStatus === "verified" ? "معتمد ومحقق" : "قيد المراجعة";

            // Open Needs
            const openNeeds = (b.needs || []).filter(n => n.status === "open" || n.status === "partially_fulfilled");
            if (openNeeds.length === 0) {
                prevBenNeedsChips.innerHTML = '<span style="color:#64748b;">لا توجد احتياجات مفتوحة مسجلة حالياً لهذا المستفيد.</span>';
            } else {
                prevBenNeedsChips.innerHTML = openNeeds.map(n => `
                    <span class="dist-item-tag" style="background:#e0f2fe; color:#0369a1; font-weight:600;">
                        <i class="fa-solid fa-tag"></i> ${escapeHtml(n.title)} (${formatNumber(Math.max(0, n.quantityRequested - (n.quantityFulfilled || 0)))} ${escapeHtml(n.unit)})
                    </span>
                `).join(" ");
            }

            // If items table is empty, auto-seed one matching row
            if (distModalItemsBody.children.length === 0) {
                addItemRow();
            }
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    // --- Add Item Row in Wizard ---
    function addItemRow() {
        const row = document.createElement("tr");

        const invOptions = state.inventory.map(inv => `
            <option value="${inv.id}" data-available="${inv.quantityAvailable}" data-unit="${escapeHtml(inv.unit)}" data-category="${escapeHtml(inv.category)}">
                ${escapeHtml(inv.name)} (المتاح: ${formatNumber(inv.quantityAvailable)} ${escapeHtml(inv.unit)})
            </option>
        `).join("");

        const openNeeds = state.selectedBeneficiary && Array.isArray(state.selectedBeneficiary.needs)
            ? state.selectedBeneficiary.needs.filter(n => n.status !== "fulfilled" && n.status !== "cancelled")
            : [];

        const needOptions = openNeeds.map(n => `
            <option value="${n.id}">${escapeHtml(n.title)} (${escapeHtml(n.category)})</option>
        `).join("");

        row.innerHTML = `
            <td>
                <select class="dist-item-select item-inv-select" required>
                    <option value="">— اختر صنفاً من المخزن —</option>
                    ${invOptions}
                </select>
                <small class="stock-hint" style="color:#0d9488; display:block; margin-top:0.25rem; font-size:0.775rem;"></small>
            </td>
            <td>
                <div style="display:flex; align-items:center; gap:0.35rem;">
                    <input type="number" class="dist-qty-input item-qty-input" min="1" value="1" required>
                    <span class="item-unit-label" style="font-size:0.8rem; color:#64748b;">وحدة</span>
                </div>
            </td>
            <td>
                <select class="dist-item-select item-need-select">
                    <option value="">— بدون ربط باحتياج —</option>
                    ${needOptions}
                </select>
            </td>
            <td>
                <button type="button" class="btn-remove-item" title="حذف الصنف">&times;</button>
            </td>
        `;

        const invSelect = row.querySelector(".item-inv-select");
        const qtyInput = row.querySelector(".item-qty-input");
        const unitLabel = row.querySelector(".item-unit-label");
        const stockHint = row.querySelector(".stock-hint");
        const removeBtn = row.querySelector(".btn-remove-item");

        invSelect.addEventListener("change", () => {
            const opt = invSelect.selectedOptions[0];
            if (opt && opt.dataset.available) {
                const avail = Number(opt.dataset.available);
                unitLabel.textContent = opt.dataset.unit || "وحدة";
                qtyInput.max = avail;
                stockHint.textContent = `المتوفر في المستودع: ${avail} ${opt.dataset.unit || ""}`;
                stockHint.style.color = "#0d9488";
            } else {
                unitLabel.textContent = "وحدة";
                stockHint.textContent = "";
            }
        });

        qtyInput.addEventListener("input", () => {
            const opt = invSelect.selectedOptions[0];
            if (opt && opt.dataset.available) {
                const avail = Number(opt.dataset.available);
                const current = Number(qtyInput.value);
                if (current > avail) {
                    stockHint.textContent = `تحذير: الكمية المطلوبة تتجاوز المتاح (${avail})!`;
                    stockHint.style.color = "#ef4444";
                    qtyInput.style.borderColor = "#ef4444";
                } else {
                    stockHint.textContent = `المتوفر في المستودع: ${avail} ${opt.dataset.unit || ""}`;
                    stockHint.style.color = "#0d9488";
                    qtyInput.style.borderColor = "#cbd5e1";
                }
            }
        });

        removeBtn.addEventListener("click", () => {
            row.remove();
        });

        distModalItemsBody.appendChild(row);
    }

    // --- Submit Distribution ---
    async function handleCreateDistribution(e) {
        e.preventDefault();

        const beneficiaryId = distBeneficiarySelect.value;
        if (!beneficiaryId) {
            showToast("يرجى اختيار المستفيد أولاً.", "error");
            return;
        }

        const itemRows = distModalItemsBody.querySelectorAll("tr");
        if (itemRows.length === 0) {
            showToast("يرجى إضافة صنف واحد على الأقل للتسليم.", "error");
            return;
        }

        const items = [];
        for (const row of itemRows) {
            const invSelect = row.querySelector(".item-inv-select");
            const qtyInput = row.querySelector(".item-qty-input");
            const needSelect = row.querySelector(".item-need-select");

            const inventoryItemId = Number(invSelect.value);
            const quantity = Number(qtyInput.value);
            const needId = needSelect?.value ? Number(needSelect.value) : null;

            if (!inventoryItemId) {
                showToast("يرجى تحديد الصنف المخزني لكل سطر.", "error");
                return;
            }
            if (!quantity || quantity <= 0) {
                showToast("يرجى إدخال كمية صحيحة موجبة.", "error");
                return;
            }

            const opt = invSelect.selectedOptions[0];
            const avail = opt ? Number(opt.dataset.available) : 0;
            if (quantity > avail) {
                showToast(`الكمية المطلوبة (${quantity}) للصنف تتجاوز المتاح (${avail}).`, "error");
                return;
            }

            items.push({ inventoryItemId, quantity, needId });
        }

        const status = $("#distStatusSelect")?.value || "completed";
        const location = $("#distLocationInput")?.value?.trim() || "";
        const notes = $("#distNotesInput")?.value?.trim() || "";

        const submitBtn = $("#submitCreateDistBtn");
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ تأكيد وحسم المخزون…';

        try {
            const result = await apiFetch("/api/distributions", {
                method: "POST",
                body: JSON.stringify({
                    beneficiaryId,
                    items,
                    status,
                    location,
                    notes,
                }),
            });

            showToast("تم تسجيل عملية التوزيع وحسم المخزون بنجاح!", "success");
            closeModal(createDistModal);

            // Refresh table & stats & reload inventory stock
            await Promise.all([
                loadDistributions(),
                loadStats(),
                loadWizardPrerequisites(),
            ]);

            // Open Voucher automatically for newly created distribution
            if (result.distribution && result.distribution.id) {
                showVoucher(result.distribution.id);
            }
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> تأكيد وحسم المخزون فورياً';
        }
    }

    // --- Show Voucher Modal ---
    async function showVoucher(distId) {
        try {
            const data = await apiFetch(`/api/distributions/${distId}`);
            const d = data.distribution;
            if (!d) return;

            vouchRefCode.textContent = d.referenceCode || `DIST-${d.id}`;
            vouchDate.textContent = formatDate(d.distributedAt || d.scheduledAt || d.createdAt);
            vouchBenName.textContent = d.beneficiaryName || "—";
            vouchBenId.textContent = d.beneficiaryNationalId || d.beneficiaryReferenceCode || `#${d.beneficiaryId}`;
            vouchBenPhone.textContent = d.beneficiaryPhone || "—";
            vouchBenAddress.textContent = [d.beneficiaryGovernorate, d.beneficiaryDistrict, d.beneficiaryAddress].filter(Boolean).join("، ") || "—";

            const items = Array.isArray(d.items) ? d.items : [];
            vouchItemsBody.innerHTML = items.map((it, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(it.itemName)}</strong></td>
                    <td>${escapeHtml(it.category || "عام")}</td>
                    <td><strong>${formatNumber(it.quantity)}</strong></td>
                    <td>${escapeHtml(it.unit || "وحدة")}</td>
                </tr>
            `).join("");

            vouchNotesText.textContent = d.notes || "تم تسليم المساعدة المقررة بحالة قياسية وسليمة.";
            vouchStaffName.textContent = d.createdByName || "الموظف المسؤول";

            openModal(voucherModal);
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    // --- Cancel Distribution ---
    async function cancelDistribution(distId) {
        if (!confirm("هل أنت متأكد من إلغاء عملية التوزيع؟ سيتم إرجاع الأصناف للمخزون إذا كانت مكتملة.")) return;

        try {
            await apiFetch(`/api/distributions/${distId}/cancel`, {
                method: "POST",
                body: JSON.stringify({ reason: "إلغاء بناء على طلب الإدارة" }),
            });
            showToast("تم إلغاء عملية التوزيع بنجاح.", "success");
            loadDistributions();
            loadStats();
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    // --- Modal Controls ---
    function openModal(modal) {
        if (!modal) return;
        modal.hidden = false;
        requestAnimationFrame(() => modal.classList.add("active"));
        document.body.style.overflow = "hidden";
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove("active");
        setTimeout(() => {
            modal.hidden = true;
            document.body.style.overflow = "";
        }, 200);
    }

    // --- Check URL Params (for deep linking from verification/profile) ---
    async function handleUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const beneficiaryId = params.get("beneficiaryId");
        const action = params.get("action");

        if (beneficiaryId || action === "new") {
            openModal(createDistModal);
            await loadWizardPrerequisites();
            if (beneficiaryId) {
                distBeneficiarySelect.value = beneficiaryId;
                await onBeneficiarySelected(beneficiaryId);
            }
        }
    }

    // --- Event Listeners ---
    function initEvents() {
        // Toolbar
        distRefreshBtn?.addEventListener("click", () => {
            loadDistributions();
            loadStats();
        });

        distStatusFilter?.addEventListener("change", loadDistributions);

        let searchTimer = null;
        distSearchInput?.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadDistributions, 300);
        });

        // Wizard Modal
        openCreateDistModalBtn?.addEventListener("click", async () => {
            createDistForm.reset();
            distModalItemsBody.innerHTML = "";
            distBeneficiaryPreview.classList.remove("active");
            openModal(createDistModal);
            await loadWizardPrerequisites();
            addItemRow();
        });

        closeCreateDistModalBtn?.addEventListener("click", () => closeModal(createDistModal));
        cancelCreateDistModalBtn?.addEventListener("click", () => closeModal(createDistModal));

        distBeneficiarySelect?.addEventListener("change", e => {
            onBeneficiarySelected(e.target.value);
        });

        addDistItemRowBtn?.addEventListener("click", addItemRow);
        createDistForm?.addEventListener("submit", handleCreateDistribution);

        // Voucher Modal
        closeVoucherModalBtn?.addEventListener("click", () => closeModal(voucherModal));
        dismissVoucherModalBtn?.addEventListener("click", () => closeModal(voucherModal));
        printVoucherBtn?.addEventListener("click", () => window.print());

        // Close on overlay click
        [createDistModal, voucherModal].forEach(m => {
            m?.addEventListener("click", e => {
                if (e.target === m) closeModal(m);
            });
        });

        // Table Action Delegations
        distTableBody?.addEventListener("click", e => {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            if (action === "view-voucher") {
                showVoucher(id);
            } else if (action === "cancel-dist") {
                cancelDistribution(id);
            }
        });
    }

    // --- Init ---
    async function init() {
        initEvents();
        await Promise.all([
            loadDistributions(),
            loadStats(),
            loadWizardPrerequisites(),
        ]);
        await handleUrlParams();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
