// ==========================================================================
// SANAD — Case Verification & Rule Recommendation Controller
// Features: Search / Quick Lookup · Split-screen Review Dossier
//           · Advisory Rules Engine Presentation · 30-day Support Detector
//           · Inventory Match View · Verification Action Workflow
// ==========================================================================

(function () {
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    const searchForm = $("#verificationSearchForm");
    const searchInput = $("#verificationSearchInput");
    const searchBtn = $("#verificationSearchBtn");
    const resetBtn = $("#verificationResetBtn");

    const casesCount = $("#casesCount");
    const casesLoading = $("#casesLoading");
    const casesList = $("#casesList");
    const casesEmpty = $("#casesEmpty");

    const dossierPlaceholder = $("#dossierPlaceholder");
    const dossierContent = $("#dossierContent");

    // Dossier Elements
    const dosRefreshBtn = $("#dosRefreshBtn");
    const dosStartDistBtn = $("#dosStartDistBtn");
    const dosRecentSupportWarning = $("#dosRecentSupportWarning");
    const dosRecentSupportMsg = $("#dosRecentSupportMsg");
    const dosName = $("#dosName");
    const dosCodeBadge = $("#dosCodeBadge");
    const dosVerificationBadge = $("#dosVerificationBadge");
    const dosPhone = $("#dosPhone");
    const dosNationalId = $("#dosNationalId");
    const dosPriorityBadge = $("#dosPriorityBadge");
    const dosLocation = $("#dosLocation");
    const dosFamily = $("#dosFamily");
    const dosIncomeWork = $("#dosIncomeWork");
    const dosHousing = $("#dosHousing");
    const dosHealth = $("#dosHealth");
    const dosReasonsList = $("#dosReasonsList");
    const dosInventoryTbody = $("#dosInventoryTbody");
    const dosInventoryEmpty = $("#dosInventoryEmpty");

    const dosApproveBtn = $("#dosApproveBtn");
    const dosReviewBtn = $("#dosReviewBtn");
    const dosRejectBtn = $("#dosRejectBtn");

    let cases = [];
    let currentCaseId = null;
    let csrfToken = null;

    const STATUS_META = {
        verified: { label: "تم التحقق", badge: "ben-badge-verified", icon: "fa-solid fa-circle-check" },
        pending: { label: "قيد المراجعة", badge: "ben-badge-pending", icon: "fa-solid fa-hourglass-half" },
        needs_review: { label: "يحتاج فحص ميداني", badge: "ben-badge-review", icon: "fa-solid fa-clipboard-question" },
        rejected: { label: "مرفوض", badge: "ben-badge-rejected", icon: "fa-solid fa-circle-xmark" },
    };

    const PRIORITY_META = {
        urgent: { label: "عاجلة جداً", cls: "rec-pri-urgent" },
        high: { label: "عالية", cls: "rec-pri-high" },
        medium: { label: "متوسطة", cls: "rec-pri-medium" },
        low: { label: "منخفضة", cls: "rec-pri-low" },
    };

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
        setTimeout(() => toast.classList.remove("show"), 3500);
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
       Search & List Rendering
    --------------------------------------------------------- */
    async function searchCases(query = "") {
        if (casesLoading) casesLoading.hidden = false;
        if (casesEmpty) casesEmpty.hidden = true;
        casesList.innerHTML = "";

        try {
            const res = await fetch(`/api/verification/search?q=${encodeURIComponent(query)}`, {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "تعذر جلب نتائج البحث.");

            cases = Array.isArray(data.results) ? data.results : [];
            renderCaseList();
        } catch (error) {
            cases = [];
            renderCaseList();
            showToast(error.message || "خطأ أثناء البحث عن الحالات.");
        } finally {
            if (casesLoading) casesLoading.hidden = true;
        }
    }

    function renderCaseList() {
        casesList.innerHTML = "";
        if (casesCount) casesCount.textContent = formatNumber(cases.length);

        if (cases.length === 0) {
            if (casesEmpty) casesEmpty.hidden = false;
            return;
        }

        if (casesEmpty) casesEmpty.hidden = true;

        cases.forEach((item) => {
            const card = document.createElement("div");
            card.className = `verification-case-card ${item.id === currentCaseId ? "active" : ""}`;
            card.setAttribute("data-id", item.id);

            const vMeta = STATUS_META[item.verificationStatus] || STATUS_META.pending;
            const pMeta = item.latestPriority ? (PRIORITY_META[item.latestPriority] || PRIORITY_META.medium) : null;

            card.innerHTML = `
                <div class="case-card-header">
                    <span class="ben-code-badge">${escapeHtml(item.referenceCode || `BEN-${String(item.id).padStart(4, "0")}`)}</span>
                    <span class="ben-badge ${vMeta.badge}"><i class="${vMeta.icon}"></i> ${vMeta.label}</span>
                </div>
                <h4 class="case-card-name">${escapeHtml(item.name || "مستفيد")}</h4>
                <div class="case-card-info">
                    <span><i class="fa-solid fa-phone"></i> ${escapeHtml(item.phone || "—")}</span>
                    <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.governorate || "—")}</span>
                </div>
                <div class="case-card-footer">
                    ${pMeta ? `<span class="rec-priority-badge ${pMeta.cls}"><i class="fa-solid fa-bolt"></i> ${pMeta.label}</span>` : `<span class="rec-priority-badge rec-pri-low">غير مقيم</span>`}
                    <span class="case-needs-count">${formatNumber(item.openNeedsCount || 0)} احتياج</span>
                </div>
            `;

            card.addEventListener("click", () => selectCase(item.id));
            casesList.appendChild(card);
        });

        // If no case is selected yet, select the first one
        if (!currentCaseId && cases.length > 0) {
            selectCase(cases[0].id);
        }
    }

    function selectCase(id) {
        currentCaseId = id;
        $$(".verification-case-card").forEach((c) => {
            c.classList.toggle("active", c.getAttribute("data-id") === String(id));
        });
        loadDossier(id);
    }

    /* ---------------------------------------------------------
       Case Verification Dossier
    --------------------------------------------------------- */
    async function loadDossier(id, forceRefresh = false) {
        if (!id) return;
        if (dossierPlaceholder) dossierPlaceholder.hidden = true;
        if (dossierContent) dossierContent.hidden = false;

        // Set loading markers
        if (dosPriorityBadge) {
            dosPriorityBadge.innerHTML = `<span class="rec-badge-loading"><i class="fa-solid fa-spinner fa-spin"></i> جارٍ التحقق...</span>`;
        }
        if (dosReasonsList) {
            dosReasonsList.innerHTML = `<li>جارٍ تقييم القواعد الاسترشادية...</li>`;
        }

        try {
            let res;
            if (forceRefresh) {
                const token = await getCsrf();
                res = await fetch(`/api/beneficiaries/${encodeURIComponent(id)}/recommendation/refresh`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                });
                const refreshData = await res.json();
                if (!res.ok) throw new Error(refreshData.message || "تعذر إعادة تقييم التوصية.");
                showToast("تم تحديث التوصية ومطابقة المخزون بنجاح.");
                // Fetch full verification snapshot
                res = await fetch(`/api/verification/${encodeURIComponent(id)}`, { credentials: "same-origin" });
            } else {
                res = await fetch(`/api/verification/${encodeURIComponent(id)}`, { credentials: "same-origin" });
            }

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "تعذر جلب ملف التحقق.");

            const { beneficiary, recommendation } = data.verification;
            renderDossier(beneficiary, recommendation);
        } catch (error) {
            showToast(error.message || "خطأ أثناء تحميل ملف الحالة.");
        }
    }

    function renderDossier(b, rec) {
        if (!b) return;

        dosName.textContent = b.name || "مستفيد";
        dosCodeBadge.textContent = b.referenceCode || `BEN-${String(b.id).padStart(4, "0")}`;

        const vMeta = STATUS_META[b.verificationStatus] || STATUS_META.pending;
        dosVerificationBadge.innerHTML = `<span class="ben-badge ${vMeta.badge}"><i class="${vMeta.icon}"></i> ${vMeta.label}</span>`;

        dosPhone.innerHTML = `<i class="fa-solid fa-phone"></i> ${escapeHtml(b.phone || "—")}`;
        dosNationalId.innerHTML = `<i class="fa-solid fa-id-card"></i> ${escapeHtml(b.nationalId || "غير مسجل")}`;
        if (dosStartDistBtn) dosStartDistBtn.href = `/distributions?beneficiaryId=${b.id}&action=new`;

        dosLocation.textContent = [b.governorate, b.district].filter(Boolean).join(" — ") || b.location || "—";

        const famText = [];
        if (b.familySize) famText.push(`${formatNumber(b.familySize)} أفراد`);
        if (b.childrenCount !== null && b.childrenCount !== undefined) famText.push(`منهم ${formatNumber(b.childrenCount)} أطفال`);
        dosFamily.textContent = famText.join("، ") || "—";

        const incomeText = b.monthlyIncome ? `${formatNumber(b.monthlyIncome)} ج.م شهرياً` : "غير محدد";
        const empText = b.employmentStatus || "حالة العمل غير مسجلة";
        dosIncomeWork.textContent = `${empText} (${incomeText})`;

        dosHousing.textContent = b.housingType || "—";
        dosHealth.textContent = b.healthConditions || "لا توجد أمراض أو إعاقات مسجلة";

        // Render Recommendation
        if (rec) {
            const pLevel = rec.priority_level || "medium";
            const priorityClass = `rec-pri-${pLevel}`;
            const label = rec.priority_label_ar || (PRIORITY_META[pLevel]?.label) || pLevel;

            if (dosPriorityBadge) {
                dosPriorityBadge.innerHTML = `<span class="rec-priority-badge ${priorityClass}"><i class="fa-solid fa-bolt"></i> أولوية ${escapeHtml(label)}</span>`;
            }

            // 30-Day Warning
            if (dosRecentSupportWarning && dosRecentSupportMsg) {
                if (rec.recent_support_warning?.hasRecentSupport) {
                    dosRecentSupportWarning.hidden = false;
                    dosRecentSupportMsg.textContent = rec.recent_support_warning.message ||
                        `استفاد المستفيد من مساعدة منذ ${rec.recent_support_warning.daysAgo} يوماً. التوصية للمراجعة والاستثناء وفق تقدير الموظف ولا تمنع الصرف.`;
                } else {
                    dosRecentSupportWarning.hidden = true;
                }
            }

            // Reasons
            if (dosReasonsList) {
                dosReasonsList.innerHTML = "";
                const reasons = Array.isArray(rec.reasons) ? rec.reasons : [];
                if (reasons.length === 0) {
                    dosReasonsList.innerHTML = `<li>لا توجد مبررات مسجلة.</li>`;
                } else {
                    reasons.forEach((r) => {
                        const li = document.createElement("li");
                        li.textContent = r;
                        dosReasonsList.appendChild(li);
                    });
                }
            }

            // Inventory Matching Table
            if (dosInventoryTbody) {
                dosInventoryTbody.innerHTML = "";
                const items = Array.isArray(rec.suggested_items) ? rec.suggested_items : [];
                if (items.length === 0) {
                    if (dosInventoryEmpty) dosInventoryEmpty.hidden = false;
                } else {
                    if (dosInventoryEmpty) dosInventoryEmpty.hidden = true;
                    items.forEach((it) => {
                        const tr = document.createElement("tr");
                        const statusCls = it.match_status === "full" ? "match-full" : it.match_status === "partial" ? "match-partial" : "match-none";
                        const statusLabel = it.match_label_ar || (it.match_status === "full" ? "متوفر بالكامل" : it.match_status === "partial" ? "متوفر جزئياً" : "غير متوفر");

                        tr.innerHTML = `
                            <td><strong>${escapeHtml(it.need_title || "احتياج")}</strong></td>
                            <td>${escapeHtml(it.category || "—")}</td>
                            <td>${formatNumber(it.needed_quantity)} ${escapeHtml(it.unit || "")}</td>
                            <td>${it.inventory_item_name ? `<strong>${escapeHtml(it.inventory_item_name)}</strong>` : `<span style="color: var(--text-muted);">لا يوجد تطابق</span>`}</td>
                            <td>${formatNumber(it.available_quantity)} ${escapeHtml(it.unit || "")}</td>
                            <td><span class="match-badge ${statusCls}">${escapeHtml(statusLabel)}</span></td>
                        `;
                        dosInventoryTbody.appendChild(tr);
                    });
                }
            }
        }
    }

    /* ---------------------------------------------------------
       Verification Actions
    --------------------------------------------------------- */
    async function updateCaseVerification(newStatus) {
        if (!currentCaseId) return;
        try {
            const token = await getCsrf();
            const res = await fetch(`/api/beneficiaries/${encodeURIComponent(currentCaseId)}/verification`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                body: JSON.stringify({ status: newStatus }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.message || "تعذر تحديث حالة التحقق.");
            showToast("تم تحديث حالة التحقق بنجاح.");
            await searchCases(searchInput.value.trim());
            await loadDossier(currentCaseId);
        } catch (error) {
            showToast(error.message || "تعذر تحديث حالة التحقق.");
        }
    }

    /* ---------------------------------------------------------
       Wiring & Events
    --------------------------------------------------------- */
    if (searchForm) {
        searchForm.addEventListener("submit", (e) => {
            e.preventDefault();
            searchCases(searchInput.value.trim());
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            searchCases("");
        });
    }

    if (dosRefreshBtn) {
        dosRefreshBtn.addEventListener("click", () => {
            if (currentCaseId) loadDossier(currentCaseId, true);
        });
    }

    if (dosApproveBtn) dosApproveBtn.addEventListener("click", () => updateCaseVerification("verified"));
    if (dosReviewBtn) dosReviewBtn.addEventListener("click", () => updateCaseVerification("needs_review"));
    if (dosRejectBtn) dosRejectBtn.addEventListener("click", () => updateCaseVerification("rejected"));

    // Init
    (function init() {
        searchCases("");
    })();
})();
