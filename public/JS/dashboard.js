(() => {
    const $ = selector => document.querySelector(selector);
    const $$ = selector => document.querySelectorAll(selector);

    const labels = {
        planned: "مخطط",
        in_progress: "قيد التنفيذ",
        completed: "مكتمل",
        cancelled: "ملغى",
        urgent: "عاجل",
        high: "مرتفع",
        medium: "متوسط",
        low: "منخفض",
        pending: "قيد المراجعة",
        approved: "معتمد",
        rejected: "مرفوض",
        available: "متاح",
        low_stock: "مخزون منخفض",
        out_of_stock: "نفد المخزون",
        surplus: "فائض",
        in_distribution: "قيد التوزيع"
    };

    const AUDIT_ACTION_MAP = {
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
        ai_case_note_extracted: "استخراج ذكي بالذكاء الاصطناعي",
        recommendation_generated: "احتساب توصية الأولوية"
    };

    const formatNumber = value => Number(value || 0).toLocaleString("ar-EG");
    const formatDate = value => value ? new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) : "—";
    const formatDateTime = value => value ? new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

    const showState = (loading, error = false, errorMsg = "") => {
        const loadingEl = $("#dashboardLoading");
        const errorEl = $("#dashboardError");
        if (loadingEl) loadingEl.hidden = !loading;
        if (errorEl) {
            errorEl.hidden = !error;
            if (errorMsg) errorEl.textContent = errorMsg;
        }
    };

    const emptyRow = (colspan, message) => `<tr><td colspan="${colspan}" class="dashboard-empty">${message}</td></tr>`;

    async function getJson(url) {
        const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "تعذر تحميل البيانات.");
        return payload;
    }

    // State
    let summaryData = null;
    let reportsData = null;
    let auditData = null;

    /* ---------------------------------------------------------
       1. Tab Navigation
    --------------------------------------------------------- */
    function initTabs() {
        const tabBtns = $$(".dash-tab-btn");
        tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                tabBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const targetTab = btn.dataset.tab;
                $$(".dash-tab-pane").forEach(pane => {
                    pane.hidden = true;
                    pane.classList.remove("active");
                });

                const activePane = $(`#tab-${targetTab}`);
                if (activePane) {
                    activePane.hidden = false;
                    activePane.classList.add("active");
                }

                if (targetTab === "reports" && !reportsData) {
                    loadReports();
                } else if (targetTab === "audit" && !auditData) {
                    loadAudit();
                }
            });
        });
    }

    /* ---------------------------------------------------------
       2. Overview Rendering
    --------------------------------------------------------- */
    function renderOverview(data) {
        const kpis = data.kpis || {};

        // 1. KPI Cards
        $("#kpiDonations").textContent = formatNumber(kpis.totalDonations);
        $("#kpiDonationUnits").textContent = `${formatNumber(kpis.totalDonationUnits)} وحدة مسجلة`;

        $("#kpiAvailable").textContent = formatNumber(kpis.inventoryAvailable);
        $("#kpiTotalUnits").textContent = `من إجمالي ${formatNumber(kpis.inventoryTotal)} وحدة`;

        $("#kpiBeneficiaries").textContent = formatNumber(kpis.beneficiariesTotal);
        $("#kpiVerifiedCount").textContent = `${formatNumber(kpis.beneficiariesVerified)} معتمد ومحقق`;

        $("#kpiDistributions").textContent = formatNumber(kpis.distributionsCompleted);
        $("#kpiDistRate").textContent = `نسبة الإنجاز: ${kpis.distributionRate || 0}%`;

        $("#kpiNeeds").textContent = formatNumber(kpis.openNeedsUrgent);
        $("#kpiTotalOpenNeeds").textContent = `من ${formatNumber(kpis.openNeedsTotal)} طلب مفتوح`;

        // 2. Inventory Status Chart
        const invCounts = data.inventoryStatusCounts || {};
        const totalInvItems = Object.values(invCounts).reduce((a, b) => a + Number(b), 0) || 1;
        const chartRows = [
            ["available", "متاح", "green"],
            ["low_stock", "مخزون منخفض", "orange"],
            ["in_distribution", "قيد التوزيع", "blue"],
            ["out_of_stock", "نفد المخزون", "red"],
            ["surplus", "فائض", "purple"]
        ];
        $("#inventoryChart").innerHTML = chartRows.map(([key, label, tone]) => {
            const count = Number(invCounts[key] || 0);
            const pct = Math.round((count / totalInvItems) * 100);
            return `
                <div class="chart-row">
                    <div class="chart-row-label">
                        <span>${label}</span>
                        <strong>${formatNumber(count)} (${pct}%)</strong>
                    </div>
                    <div class="chart-track">
                        <span class="chart-fill ${tone}" style="width:${pct}%"></span>
                    </div>
                </div>
            `;
        }).join("");

        // 3. Operational Alerts
        const lowStock = data.lowStockItems || [];
        const surplus = data.surplusItems || [];
        const urgent = data.urgentNeeds || [];
        const pendingBens = kpis.beneficiariesPending || 0;

        const alerts = [
            ["triangle-exclamation", "مخزون منخفض", `${formatNumber(lowStock.length)} أصناف بحاجة إلى إعادة توريد`, "orange"],
            ["flag", "احتياجات عاجلة", `${formatNumber(urgent.length)} طلبات ذات أولوية قصوى غير مغطاة`, "red"],
            ["boxes-stacked", "تنبيه فائض", `${formatNumber(surplus.length)} أصناف مصنفة كفائض بالمستودع`, "purple"],
            ["users", "مستفيدون جدد", `${formatNumber(pendingBens)} حالات بانتظار التحقق والاعتماد`, "blue"]
        ];

        $("#dashboardAlerts").innerHTML = alerts.map(([icon, title, detail, tone]) => `
            <div class="dashboard-alert ${tone}">
                <span><i class="fa-solid fa-${icon}"></i></span>
                <div>
                    <strong>${title}</strong>
                    <small>${detail}</small>
                </div>
            </div>
        `).join("");

        // 4. Latest Distributions Table
        const dists = data.recentDistributions || [];
        $("#distributionCount").textContent = formatNumber(dists.length);
        $("#distributionRows").innerHTML = dists.length
            ? dists.map(d => `
                <tr>
                    <td><strong>${d.referenceCode || `#${d.id}`}</strong></td>
                    <td>${d.beneficiaryName || "—"}</td>
                    <td><span class="dashboard-badge ${d.status}">${labels[d.status] || d.status}</span></td>
                    <td>${formatDate(d.distributedAt || d.scheduledAt || d.createdAt)}</td>
                    <td>${formatNumber(d.itemsCount || 0)} أصناف</td>
                </tr>
            `).join("")
            : emptyRow(5, "لا توجد توزيعات مسجلة حديثاً.");

        // 5. Priority Needs Table
        const needs = data.urgentNeeds || [];
        $("#needCount").textContent = formatNumber(needs.length);
        $("#needRows").innerHTML = needs.length
            ? needs.map(n => {
                const remaining = Math.max(Number(n.quantityRequested || 0) - Number(n.quantityFulfilled || 0), 0);
                return `
                    <tr>
                        <td><strong>${n.title}</strong></td>
                        <td>${n.beneficiaryName || "—"}</td>
                        <td><span class="dashboard-badge priority-${n.priority}">${labels[n.priority] || n.priority}</span></td>
                        <td>${formatNumber(remaining)} ${n.unit || ""}</td>
                    </tr>
                `;
            }).join("")
            : emptyRow(4, "لا توجد احتياجات عاجلة حالياً.");

        // 6. Recent Donations Table
        const dons = data.recentDonations || [];
        $("#donationCount").textContent = formatNumber(dons.length);
        $("#donationRows").innerHTML = dons.length
            ? dons.map(d => `
                <tr>
                    <td><strong>${d.referenceCode || `#${d.id}`}</strong></td>
                    <td>${d.title} <small class="text-muted">(${d.category})</small></td>
                    <td>${d.donorName || "فاعل خير"}</td>
                    <td>${formatNumber(d.quantity)} ${d.unit || ""}</td>
                    <td><span class="dashboard-badge ${d.status}">${labels[d.status] || d.status}</span></td>
                    <td>${formatDate(d.createdAt)}</td>
                </tr>
            `).join("")
            : emptyRow(6, "لا توجد تبرعات مسجلة حديثاً.");
    }

    /* ---------------------------------------------------------
       3. Reports & Analytics Rendering
    --------------------------------------------------------- */
    function renderReports(data) {
        // Donations by Category
        const donsCat = data.donationsByCategory || [];
        const maxDonUnits = Math.max(...donsCat.map(d => Number(d.totalUnits || 0)), 1);
        $("#donationsCategoryList").innerHTML = donsCat.length
            ? donsCat.map(d => {
                const pct = Math.round((Number(d.totalUnits) / maxDonUnits) * 100);
                return `
                    <div class="report-bar-row">
                        <div class="report-bar-label">
                            <span>${d.category}</span>
                            <strong>${formatNumber(d.totalUnits)} وحدة (${formatNumber(d.count)} تبرع)</strong>
                        </div>
                        <div class="chart-track">
                            <span class="chart-fill green" style="width: ${pct}%"></span>
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="dashboard-empty">لا توجد بيانات تبرعات كافية.</div>`;

        // Needs by Category
        const needsCat = data.needsByCategory || [];
        $("#needsCategoryList").innerHTML = needsCat.length
            ? needsCat.map(n => {
                const req = Number(n.requestedUnits || 0);
                const ful = Number(n.fulfilledUnits || 0);
                const pct = req > 0 ? Math.round((ful / req) * 100) : 0;
                return `
                    <div class="report-bar-row">
                        <div class="report-bar-label">
                            <span>${n.category}</span>
                            <strong>تغطية ${pct}% (${formatNumber(ful)} / ${formatNumber(req)})</strong>
                        </div>
                        <div class="chart-track">
                            <span class="chart-fill ${pct >= 70 ? 'green' : pct >= 40 ? 'orange' : 'coral'}" style="width: ${pct}%"></span>
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="dashboard-empty">لا توجد احتياجات مسجلة.</div>`;

        // Beneficiaries by Governorate (Privacy Preserving)
        const govList = data.beneficiariesByGovernorate || [];
        const maxGovCount = Math.max(...govList.map(g => Number(g.count || 0)), 1);
        $("#governorateList").innerHTML = govList.length
            ? govList.map(g => {
                const count = Number(g.count || 0);
                const pct = Math.round((count / maxGovCount) * 100);
                return `
                    <div class="report-bar-row">
                        <div class="report-bar-label">
                            <span>محافظة ${g.governorate}</span>
                            <strong>${formatNumber(count)} مستفيد</strong>
                        </div>
                        <div class="chart-track">
                            <span class="chart-fill blue" style="width: ${pct}%"></span>
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="dashboard-empty">لا توجد بيانات مستفيدين بالمحافظات.</div>`;

        // Monthly Trend
        const trend = data.monthlyTrend || [];
        const maxTrend = Math.max(...trend.map(t => Number(t.count || 0)), 1);
        $("#monthlyTrendList").innerHTML = trend.length
            ? trend.map(t => {
                const count = Number(t.count || 0);
                const pct = Math.round((count / maxTrend) * 100);
                return `
                    <div class="report-bar-row">
                        <div class="report-bar-label">
                            <span>${t.month}</span>
                            <strong>${formatNumber(count)} عملية توزيع</strong>
                        </div>
                        <div class="chart-track">
                            <span class="chart-fill purple" style="width: ${pct}%"></span>
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="dashboard-empty">لا توجد بيانات توزيعات خلال الأشهر الماضية.</div>`;
    }

    /* ---------------------------------------------------------
       4. Audit History Rendering
    --------------------------------------------------------- */
    function renderAudit(logs) {
        $("#auditCount").textContent = formatNumber(logs.length);
        $("#auditRows").innerHTML = logs.length
            ? logs.map(l => {
                const actionText = AUDIT_ACTION_MAP[l.action] || l.action;
                const statusBadge = l.success
                    ? `<span class="dashboard-badge completed">ناجح</span>`
                    : `<span class="dashboard-badge cancelled">فشل</span>`;
                return `
                    <tr>
                        <td><strong>${actionText}</strong> <small class="text-muted" style="display:block;font-size:0.75rem">${l.action}</small></td>
                        <td>${l.userName || "—"}</td>
                        <td>${statusBadge}</td>
                        <td><code style="font-size:0.8rem">${l.ipAddress || "—"}</code></td>
                        <td>${formatDateTime(l.createdAt)}</td>
                    </tr>
                `;
            }).join("")
            : emptyRow(5, "لا توجد سجلات رقابة مطابقة للفلتر.");
    }

    /* ---------------------------------------------------------
       5. Data Fetchers
    --------------------------------------------------------- */
    async function loadSummary() {
        showState(true);
        try {
            summaryData = await getJson("/api/dashboard/summary");
            renderOverview(summaryData);
            showState(false);
        } catch (error) {
            showState(false, true, error.message);
        }
    }

    async function loadReports() {
        try {
            const from = $("#reportFrom")?.value || "";
            const to = $("#reportTo")?.value || "";
            const category = $("#reportCategory")?.value || "";
            const query = new URLSearchParams();
            if (from) query.set("from", from);
            if (to) query.set("to", to);
            if (category) query.set("category", category);

            reportsData = await getJson(`/api/reports/analytics?${query.toString()}`);
            renderReports(reportsData);
        } catch { }
    }

    async function loadAudit() {
        try {
            const action = $("#auditActionFilter")?.value || "";
            const query = action ? `?action=${encodeURIComponent(action)}` : "";
            const res = await getJson(`/api/admin/audit-logs${query}`);
            auditData = res.logs || [];
            renderAudit(auditData);
        } catch { }
    }

    /* ---------------------------------------------------------
       6. Event Handlers & Initialization
    --------------------------------------------------------- */
    $("#dashboardRefresh")?.addEventListener("click", () => {
        loadSummary();
        if ($(".dash-tab-btn[data-tab='reports']").classList.contains("active")) loadReports();
        if ($(".dash-tab-btn[data-tab='audit']").classList.contains("active")) loadAudit();
    });

    $("#applyReportFilters")?.addEventListener("click", loadReports);
    $("#applyAuditFilters")?.addEventListener("click", loadAudit);

    $("#printReportBtn")?.addEventListener("click", () => {
        const header = $("#printGeneratedAt");
        if (header) {
            header.textContent = `تاريخ استخراج التقرير: ${new Date().toLocaleString("ar-EG")}`;
        }
        window.print();
    });

    // Boot
    initTabs();
    loadSummary();
})();
