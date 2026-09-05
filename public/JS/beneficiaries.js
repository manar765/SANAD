// ==========================================================================
// SANAD — Beneficiaries & Needs Management Controller
// Sections: Data Fetching · Role Gate · Filtering · KPI Computation
//           · Detail Drawer & Tabbed Views · Verification Actions · Add/Edit Modal
// ==========================================================================

(function () {
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    const tbody = $("#beneficiariesTableBody");
    if (!tbody) return;

    const loadingState = $("#beneficiariesLoading");
    const errorState = $("#beneficiariesError");
    const emptyState = $("#beneficiariesEmpty");
    const countBadge = $("#beneficiariesCount");

    const searchInput = $("#beneficiarySearch");
    const statusFilter = $("#beneficiaryStatusFilter");
    const govFilter = $("#beneficiaryGovFilter");
    const resetBtn = $("#beneficiariesResetBtn");
    const refreshBtn = $("#beneficiariesRefreshBtn");

    const addBtn = $("#addBeneficiaryBtn");
    const adminOnlyEls = $$(".admin-only");

    // Drawer Elements
    const drawerOverlay = $("#beneficiaryDrawerOverlay");
    const drawerCloseBtn = $("#drawerCloseBtn");
    const drawerCodeBadge = $("#drawerCodeBadge");
    const drawerTitle = $("#drawerTitle");
    const drawerTabs = $$(".ben-tab-btn");
    const drawerPanes = $$(".ben-tab-pane");

    const drawerNeedsTbody = $("#drawerNeedsTbody");
    const drawerNeedsEmpty = $("#drawerNeedsEmpty");
    const drawerNeedsCount = $("#drawerNeedsCount");

    const drawerHistoryTbody = $("#drawerHistoryTbody");
    const drawerHistoryEmpty = $("#drawerHistoryEmpty");
    const drawerHistoryCount = $("#drawerHistoryCount");

    const verifyApproveBtn = $("#verifyApproveBtn");
    const verifyReviewBtn = $("#verifyReviewBtn");
    const verifyRejectBtn = $("#verifyRejectBtn");

    // Modal Elements
    const modalOverlay = $("#beneficiaryModalOverlay");
    const modalTitle = $("#benModalTitle");
    const modalCloseBtn = $("#benModalCloseBtn");
    const modalCancelBtn = $("#benModalCancelBtn");
    const form = $("#beneficiaryForm");
    const saveBtn = $("#benModalSaveBtn");

    const STATUS_META = {
        verified: { label: "تم التحقق", badge: "ben-badge-verified", icon: "fa-solid fa-circle-check" },
        pending: { label: "قيد المراجعة", badge: "ben-badge-pending", icon: "fa-solid fa-hourglass-half" },
        needs_review: { label: "يحتاج فحص ميداني", badge: "ben-badge-review", icon: "fa-solid fa-clipboard-question" },
        rejected: { label: "مرفوض", badge: "ben-badge-rejected", icon: "fa-solid fa-circle-xmark" },
    };

    const PRIORITY_META = {
        urgent: { label: "عاجلة", cls: "pri-urgent" },
        high: { label: "عالية", cls: "pri-high" },
        medium: { label: "متوسطة", cls: "pri-medium" },
        low: { label: "منخفضة", cls: "pri-low" },
    };

    let beneficiaries = [];
    let isAdmin = false;
    let csrfToken = null;
    let currentBeneficiary = null;

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
       Filtering & KPIs
    --------------------------------------------------------- */
    function matchesFilters(item) {
        const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
        const status = statusFilter ? statusFilter.value : "";
        const gov = govFilter ? govFilter.value : "";

        const haystack = `${item.referenceCode || ""} ${item.name || ""} ${item.phone || ""} ${item.nationalId || ""} ${item.governorate || ""} ${item.district || ""} ${item.location || ""}`.toLowerCase();

        if (query && haystack.indexOf(query) === -1) return false;
        if (status && item.verificationStatus !== status) return false;
        if (gov && item.governorate !== gov) return false;
        return true;
    }

    function renderKpis() {
        const total = beneficiaries.length;
        const verified = beneficiaries.filter(b => b.verificationStatus === "verified").length;
        const pending = beneficiaries.filter(b => b.verificationStatus === "pending" || b.verificationStatus === "needs_review").length;
        const activeNeeds = beneficiaries.reduce((sum, b) => sum + Number(b.activeNeedsCount || 0), 0);

        if ($("#kpiTotalBeneficiaries")) $("#kpiTotalBeneficiaries").textContent = formatNumber(total);
        if ($("#kpiVerifiedCount")) $("#kpiVerifiedCount").textContent = formatNumber(verified);
        if ($("#kpiPendingCount")) $("#kpiPendingCount").textContent = formatNumber(pending);
        if ($("#kpiActiveNeedsCount")) $("#kpiActiveNeedsCount").textContent = formatNumber(activeNeeds);
    }

    /* ---------------------------------------------------------
       Table Rendering
    --------------------------------------------------------- */
    function buildRow(item) {
        const meta = STATUS_META[item.verificationStatus] || STATUS_META.pending;
        const tr = document.createElement("tr");

        const govDistrict = [item.governorate, item.district].filter(Boolean).join(" — ") || item.location || "—";
        const familyInfo = item.familySize ? `${formatNumber(item.familySize)} أفراد` : "—";
        const needsText = item.activeNeedsCount > 0
            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #dc2626; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 9999px;">${formatNumber(item.activeNeedsCount)} احتياج</span>`
            : `<span style="color: var(--text-muted); font-size: 0.85rem;">لا توجد</span>`;

        tr.innerHTML =
            `<td><span class="ben-code-badge">${escapeHtml(item.referenceCode || `BEN-${String(item.id).padStart(4, "0")}`)}</span></td>` +
            `<td><div class="ben-name-cell"><span class="ben-name-primary">${escapeHtml(item.name || "مستفيد")}</span>${item.nationalId ? `<span class="ben-name-meta"><i class="fa-solid fa-id-card"></i> ${escapeHtml(item.nationalId)}</span>` : ""}</div></td>` +
            `<td>${escapeHtml(item.phone || "—")}</td>` +
            `<td>${escapeHtml(govDistrict)}</td>` +
            `<td>${escapeHtml(familyInfo)}</td>` +
            `<td><span class="ben-badge ${meta.badge}"><i class="${meta.icon}" aria-hidden="true"></i> ${meta.label}</span></td>` +
            `<td>${needsText}</td>` +
            `<td><div class="ben-actions">` +
            `<button type="button" class="btn btn-sm btn-outline ben-view-btn" data-id="${item.id}" title="عرض وتفاصيل الملف"><i class="fa-solid fa-eye" aria-hidden="true"></i> عرض الملف</button>` +
            (isAdmin ? `<button type="button" class="btn btn-sm btn-outline ben-edit-btn" data-id="${item.id}" title="تعديل البيانات"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>` : "") +
            `</div></td>`;

        const viewBtn = tr.querySelector(".ben-view-btn");
        if (viewBtn) viewBtn.addEventListener("click", () => openDrawer(item.id));

        if (isAdmin) {
            const editBtn = tr.querySelector(".ben-edit-btn");
            if (editBtn) editBtn.addEventListener("click", () => openModal(item));
        }

        return tr;
    }

    function render() {
        const filtered = beneficiaries.filter(matchesFilters);
        tbody.innerHTML = "";
        filtered.forEach((item) => tbody.appendChild(buildRow(item)));
        if (emptyState) emptyState.hidden = filtered.length !== 0;
        if (countBadge) countBadge.textContent = formatNumber(filtered.length);
        renderKpis();
    }

    /* ---------------------------------------------------------
       Role Management
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
       Data Loading
    --------------------------------------------------------- */
    async function loadBeneficiaries() {
        window.SANADUI?.setLoading(loadingState, true, "جارٍ تحميل سجل المستفيدين…");
        if (errorState) errorState.hidden = true;
        try {
            const response = await fetch("/api/beneficiaries", { credentials: "same-origin", headers: { Accept: "application/json" } });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || "تعذر تحميل بيانات المستفيدين.");
            beneficiaries = Array.isArray(payload.beneficiaries) ? payload.beneficiaries : [];
            render();
        } catch (error) {
            beneficiaries = [];
            render();
            window.SANADUI?.setError(errorState, error.message || "تعذر تحميل بيانات المستفيدين.", loadBeneficiaries);
        } finally {
            window.SANADUI?.setLoading(loadingState, false);
        }
    }

    /* ---------------------------------------------------------
       Detail Drawer
    --------------------------------------------------------- */
    function switchTab(tabId) {
        drawerTabs.forEach(btn => {
            const isActive = btn.getAttribute("data-tab") === tabId;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        drawerPanes.forEach(pane => {
            pane.classList.toggle("active", pane.id === tabId);
        });
    }

    async function openDrawer(id) {
        if (!drawerOverlay) return;
        switchTab("tab-profile");
        drawerOverlay.classList.add("active");
        drawerOverlay.setAttribute("aria-hidden", "false");

        // Clear previous detail
        $("#dName").textContent = "جارٍ التحميل…";
        $("#dPhone").textContent = "—";
        $("#dNationalId").textContent = "—";
        $("#dVerificationBadge").textContent = "—";
        $("#dLocation").textContent = "—";
        $("#dAddress").textContent = "—";
        $("#dFamily").textContent = "—";
        $("#dHousing").textContent = "—";
        $("#dIncome").textContent = "—";
        $("#dEmployment").textContent = "—";
        $("#dHealth").textContent = "—";
        $("#dNotes").textContent = "—";

        try {
            const res = await fetch(`/api/beneficiaries/${encodeURIComponent(id)}`, { credentials: "same-origin" });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.message || "تعذر جلب تفاصيل المستفيد.");

            const b = payload.beneficiary;
            currentBeneficiary = b;

            drawerCodeBadge.textContent = b.referenceCode || `BEN-${String(b.id).padStart(4, "0")}`;
            drawerTitle.textContent = b.name || "ملف المستفيد";

            $("#dName").textContent = b.name || "—";
            $("#dPhone").textContent = b.phone || "—";
            $("#dNationalId").textContent = b.nationalId || "غير مسجل";

            const meta = STATUS_META[b.verificationStatus] || STATUS_META.pending;
            $("#dVerificationBadge").innerHTML = `<span class="ben-badge ${meta.badge}"><i class="${meta.icon}"></i> ${meta.label}</span>`;

            $("#dLocation").textContent = [b.governorate, b.district].filter(Boolean).join(" — ") || b.location || "—";
            $("#dAddress").textContent = b.address || "—";

            const famDetails = [];
            if (b.familySize) famDetails.push(`${formatNumber(b.familySize)} أفراد`);
            if (b.childrenCount !== null && b.childrenCount !== undefined) famDetails.push(`منهم ${formatNumber(b.childrenCount)} أطفال`);
            $("#dFamily").textContent = famDetails.join("، ") || "—";

            $("#dHousing").textContent = b.housingType || "—";
            $("#dIncome").textContent = b.monthlyIncome ? `${formatNumber(b.monthlyIncome)} ج.م شهرياً` : "غير محدد";
            $("#dEmployment").textContent = b.employmentStatus || "—";
            $("#dHealth").textContent = b.healthConditions || "لا توجد أمراض أو إعاقات مسجلة";
            $("#dNotes").textContent = b.notes || "لا توجد ملاحظات إضافية";

            // Populate Needs
            const needs = Array.isArray(b.needs) ? b.needs : [];
            drawerNeedsCount.textContent = formatNumber(needs.length);
            drawerNeedsTbody.innerHTML = "";
            if (needs.length === 0) {
                drawerNeedsEmpty.hidden = false;
            } else {
                drawerNeedsEmpty.hidden = true;
                needs.forEach(n => {
                    const pMeta = PRIORITY_META[n.priority] || PRIORITY_META.medium;
                    const row = document.createElement("tr");
                    row.innerHTML =
                        `<td><strong>${escapeHtml(n.title)}</strong>${n.description ? `<div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(n.description)}</div>` : ""}</td>` +
                        `<td>${escapeHtml(n.category)}</td>` +
                        `<td>${formatNumber(n.quantityRequested)} ${escapeHtml(n.unit)}</td>` +
                        `<td><span class="pri-badge ${pMeta.cls}">${pMeta.label}</span></td>` +
                        `<td><span style="font-size: 0.85rem; font-weight: 600;">${escapeHtml(n.status === "open" ? "مفتوح" : n.status === "fulfilled" ? "مكتمل" : n.status)}</span></td>`;
                    drawerNeedsTbody.appendChild(row);
                });
            }

            // Populate Distribution History
            const distributions = Array.isArray(b.distributions) ? b.distributions : [];
            drawerHistoryCount.textContent = formatNumber(distributions.length);
            drawerHistoryTbody.innerHTML = "";
            if (distributions.length === 0) {
                drawerHistoryEmpty.hidden = false;
            } else {
                drawerHistoryEmpty.hidden = true;
                distributions.forEach(d => {
                    const itemsText = Array.isArray(d.items) && d.items.length > 0
                        ? d.items.map(it => `${escapeHtml(it.itemName || "صنف")}: ${formatNumber(it.quantity)} ${escapeHtml(it.unit || "")}`).join("، ")
                        : "—";
                    const dateStr = d.distributedAt || d.scheduledAt || d.createdAt;
                    const dateFormatted = dateStr ? new Date(dateStr).toLocaleDateString("ar-EG") : "—";
                    const row = document.createElement("tr");
                    row.innerHTML =
                        `<td>#${d.id}</td>` +
                        `<td>${dateFormatted}</td>` +
                        `<td>${itemsText}</td>` +
                        `<td><span class="badge" style="background: #eef2ff; color: #4338ca; font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 9999px;">${escapeHtml(d.status === "completed" ? "تم التسليم" : d.status === "planned" ? "مجدول" : d.status)}</span></td>`;
                    drawerHistoryTbody.appendChild(row);
                });
            }

        } catch (error) {
            showToast(error.message || "تعذر تحميل تفاصيل الملف.");
        }
    }

    function closeDrawer() {
        if (!drawerOverlay) return;
        drawerOverlay.classList.remove("active");
        drawerOverlay.setAttribute("aria-hidden", "true");
        currentBeneficiary = null;
    }

    /* ---------------------------------------------------------
       Verification Actions (Admin)
    --------------------------------------------------------- */
    async function updateVerification(newStatus) {
        if (!currentBeneficiary || !isAdmin) return;
        try {
            const token = await getCsrf();
            const res = await fetch(`/api/beneficiaries/${encodeURIComponent(currentBeneficiary.id)}/verification`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                body: JSON.stringify({ status: newStatus }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.message || "تعذر تحديث حالة التحقق.");
            showToast("تم تحديث حالة التحقق بنجاح.");
            await loadBeneficiaries();
            await openDrawer(currentBeneficiary.id);
        } catch (error) {
            showToast(error.message || "تعذر تحديث حالة التحقق.");
        }
    }

    /* ---------------------------------------------------------
       Add / Edit Modal
    --------------------------------------------------------- */
    function resetForm() {
        if (!form) return;
        form.reset();
        $("#benId").value = "";
        $("#benFamilySize").value = "1";
        $("#benChildrenCount").value = "0";
        $("#benVerificationStatus").value = "pending";
    }

    function openModal(item) {
        if (!isAdmin || !modalOverlay) return;
        resetForm();
        if (item) {
            modalTitle.textContent = "تعديل بيانات المستفيد";
            $("#benId").value = item.id;
            $("#benName").value = item.name || "";
            $("#benPhone").value = item.phone || "";
            $("#benNationalId").value = item.nationalId || "";
            $("#benGov").value = item.governorate || "";
            $("#benDistrict").value = item.district || "";
            $("#benAddress").value = item.address || "";
            $("#benFamilySize").value = item.familySize ?? 1;
            $("#benChildrenCount").value = item.childrenCount ?? 0;
            $("#benHousingType").value = item.housingType || "إيجار جديد";
            $("#benMonthlyIncome").value = item.monthlyIncome ?? "";
            $("#benEmploymentStatus").value = item.employmentStatus || "";
            $("#benVerificationStatus").value = item.verificationStatus || "pending";
            $("#benHealthConditions").value = item.healthConditions || "";
            $("#benNotes").value = item.notes || "";
        } else {
            modalTitle.textContent = "تسجيل مستفيد جديد";
        }
        modalOverlay.classList.add("active");
        modalOverlay.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
        if (!modalOverlay) return;
        modalOverlay.classList.remove("active");
        modalOverlay.setAttribute("aria-hidden", "true");
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        if (!isAdmin) return;

        const id = $("#benId").value;
        const body = {
            name: $("#benName").value.trim(),
            phone: $("#benPhone").value.trim(),
            nationalId: $("#benNationalId").value.trim() || null,
            governorate: $("#benGov").value,
            district: $("#benDistrict").value.trim() || null,
            address: $("#benAddress").value.trim() || null,
            familySize: Number($("#benFamilySize").value) || 1,
            childrenCount: Number($("#benChildrenCount").value) || 0,
            housingType: $("#benHousingType").value,
            monthlyIncome: $("#benMonthlyIncome").value ? Number($("#benMonthlyIncome").value) : null,
            employmentStatus: $("#benEmploymentStatus").value.trim() || null,
            verificationStatus: $("#benVerificationStatus").value,
            healthConditions: $("#benHealthConditions").value.trim() || null,
            notes: $("#benNotes").value.trim() || "",
            location: $("#benGov").value,
        };

        if (!body.name || !body.phone || !body.governorate) {
            showToast("يرجى إدخال الاسم ورقم الهاتف والمحافظة.");
            return;
        }

        saveBtn.disabled = true;
        try {
            const token = await getCsrf();
            const url = id ? `/api/beneficiaries/${encodeURIComponent(id)}` : "/api/beneficiaries";
            const method = id ? "PATCH" : "POST";
            const res = await fetch(url, {
                method,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                body: JSON.stringify(body),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.message || "تعذر حفظ بيانات المستفيد.");
            showToast(id ? "تم تحديث بيانات المستفيد بنجاح." : "تم تسجيل المستفيد بنجاح.");
            closeModal();
            await loadBeneficiaries();
        } catch (error) {
            showToast(error.message || "تعذر حفظ بيانات المستفيد.");
        } finally {
            saveBtn.disabled = false;
        }
    }

    /* ---------------------------------------------------------
       Event Listeners & Wiring
    --------------------------------------------------------- */
    if (searchInput) searchInput.addEventListener("input", render);
    if (statusFilter) statusFilter.addEventListener("change", render);
    if (govFilter) govFilter.addEventListener("change", render);
    if (resetBtn) resetBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (statusFilter) statusFilter.value = "";
        if (govFilter) govFilter.value = "";
        render();
    });
    if (refreshBtn) refreshBtn.addEventListener("click", loadBeneficiaries);
    if (addBtn) addBtn.addEventListener("click", () => openModal(null));

    // Drawer Tabs
    drawerTabs.forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener("click", (e) => {
        if (e.target === drawerOverlay) closeDrawer();
    });

    // Verification Buttons
    if (verifyApproveBtn) verifyApproveBtn.addEventListener("click", () => updateVerification("verified"));
    if (verifyReviewBtn) verifyReviewBtn.addEventListener("click", () => updateVerification("needs_review"));
    if (verifyRejectBtn) verifyRejectBtn.addEventListener("click", () => updateVerification("rejected"));

    // Modal
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);
    if (modalOverlay) modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    if (form) form.addEventListener("submit", handleFormSubmit);

    // Escape Key Support
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (drawerOverlay && drawerOverlay.classList.contains("active")) closeDrawer();
            if (modalOverlay && modalOverlay.classList.contains("active")) closeModal();
        }
    });

    // Init
    (async function init() {
        await loadRole();
        await loadBeneficiaries();
    })();
})();
