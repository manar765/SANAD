(() => {
    const $ = selector => document.querySelector(selector);
    const state = { inventory: [], distributions: [], needs: [] };
    const labels = { planned: "مخطط", in_progress: "قيد التنفيذ", completed: "مكتمل", cancelled: "ملغى", urgent: "عاجل", high: "مرتفع", medium: "متوسط", low: "منخفض" };
    const formatNumber = value => Number(value || 0).toLocaleString("ar-EG");
    const formatDate = value => value ? new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short" }) : "—";
    const showState = (loading, error = false) => { $("#dashboardLoading").hidden = !loading; $("#dashboardError").hidden = !error; };
    const emptyRow = (colspan, message) => `<tr><td colspan="${colspan}" class="dashboard-empty">${message}</td></tr>`;

    async function getJson(url) {
        const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "تعذر تحميل البيانات.");
        return payload;
    }

    function filteredDistributions() {
        const from = $("#dashboardFrom").value ? new Date(`${$("#dashboardFrom").value}T00:00:00`) : null;
        const to = $("#dashboardTo").value ? new Date(`${$("#dashboardTo").value}T23:59:59`) : null;
        const status = $("#distributionStatus").value;
        return state.distributions.filter(item => {
            const date = new Date(item.createdAt);
            return (!from || date >= from) && (!to || date <= to) && (!status || item.status === status);
        });
    }

    function renderKpis(distributions, needs) {
        const total = state.inventory.reduce((sum, item) => sum + Number(item.quantityTotal || 0), 0);
        const available = state.inventory.reduce((sum, item) => sum + Number(item.quantityAvailable || 0), 0);
        $("#kpiTotal").textContent = formatNumber(total);
        $("#kpiAvailable").textContent = formatNumber(available);
        $("#kpiDistributions").textContent = formatNumber(distributions.length);
        $("#kpiNeeds").textContent = formatNumber(needs.filter(item => !["fulfilled", "cancelled"].includes(item.status)).length);
    }

    function renderInventoryChart() {
        const counts = { available: 0, low_stock: 0, in_distribution: 0, out_of_stock: 0, surplus: 0 };
        state.inventory.forEach(item => { if (counts[item.status] !== undefined) counts[item.status] += 1; });
        const total = Math.max(state.inventory.length, 1);
        const rows = [["available", "متاح", "green"], ["low_stock", "مخزون منخفض", "orange"], ["in_distribution", "قيد التوزيع", "blue"], ["out_of_stock", "نفد المخزون", "red"], ["surplus", "فائض", "purple"]];
        $("#inventoryChart").innerHTML = rows.map(([key, label, tone]) => `<div class="chart-row"><div class="chart-row-label"><span>${label}</span><strong>${formatNumber(counts[key])}</strong></div><div class="chart-track"><span class="chart-fill ${tone}" style="width:${Math.round((counts[key] / total) * 100)}%"></span></div></div>`).join("");
    }

    function renderAlerts() {
        const low = state.inventory.filter(item => item.status === "low_stock" || (item.quantityAvailable <= item.lowStockThreshold && item.quantityAvailable > 0));
        const out = state.inventory.filter(item => item.status === "out_of_stock" || item.quantityAvailable === 0);
        const surplus = state.inventory.filter(item => item.status === "surplus");
        const urgent = state.needs.filter(item => ["urgent", "high"].includes(item.priority) && !["fulfilled", "cancelled"].includes(item.status));
        const alerts = [["low", "مخزون منخفض", `${formatNumber(low.length)} أصناف تحتاج إلى إعادة توفير`, "orange"], ["out", "أصناف نفدت", `${formatNumber(out.length)} أصناف غير متاحة حاليًا`, "red"], ["surplus", "تنبيه فائض", `${formatNumber(surplus.length)} أصناف مصنفة كفائض`, "purple"], ["urgent", "احتياجات عاجلة", `${formatNumber(urgent.length)} احتياجات بأولوية مرتفعة`, "blue"]];
        $("#dashboardAlerts").innerHTML = alerts.map(([icon, title, detail, tone]) => `<div class="dashboard-alert ${tone}"><span><i class="fa-solid fa-${icon === "low" ? "triangle-exclamation" : icon === "out" ? "circle-xmark" : icon === "surplus" ? "boxes-stacked" : "flag"}"></i></span><div><strong>${title}</strong><small>${detail}</small></div></div>`).join("");
    }

    function renderTables(distributions, needs) {
        $("#distributionCount").textContent = formatNumber(distributions.length);
        $("#needCount").textContent = formatNumber(needs.length);
        $("#distributionRows").innerHTML = distributions.length ? distributions.slice(0, 8).map(item => `<tr><td>${item.beneficiaryName || "—"}</td><td><span class="dashboard-badge ${item.status}">${labels[item.status] || item.status}</span></td><td>${formatDate(item.scheduledAt || item.createdAt)}</td><td>${formatNumber(item.items?.length || 0)}</td></tr>`).join("") : emptyRow(4, "لا توجد توزيعات ضمن الفلاتر الحالية.");
        $("#needRows").innerHTML = needs.length ? needs.slice(0, 8).map(item => `<tr><td>${item.title}</td><td>${item.beneficiaryName || "—"}</td><td><span class="dashboard-badge priority-${item.priority}">${labels[item.priority] || item.priority}</span></td><td>${formatNumber(Math.max(Number(item.quantityRequested || 0) - Number(item.quantityFulfilled || 0), 0))} ${item.unit || ""}</td></tr>`).join("") : emptyRow(4, "لا توجد احتياجات ذات أولوية.");
    }

    function render() {
        const distributions = filteredDistributions();
        const needs = state.needs.filter(item => !["fulfilled", "cancelled"].includes(item.status)).sort((a, b) => ({ urgent: 0, high: 1, medium: 2, low: 3 }[a.priority] ?? 4) - ({ urgent: 0, high: 1, medium: 2, low: 3 }[b.priority] ?? 4));
        renderKpis(distributions, needs); renderInventoryChart(); renderAlerts(); renderTables(distributions, needs);
    }

    async function load() {
        showState(true);
        try {
            const [inventory, distributions, needs] = await Promise.all([
                getJson("/api/inventory"),
                getJson(`/api/distributions?status=${encodeURIComponent($("#distributionStatus").value)}`).catch(() => ({ distributions: [] })),
                getJson("/api/beneficiary/needs").catch(() => ({ needs: [] })),
            ]);
            state.inventory = inventory.items || []; state.distributions = distributions.distributions || []; state.needs = needs.needs || [];
            render(); showState(false);
        } catch (error) { showState(false, true); $("#dashboardError").textContent = error.message; }
    }

    $("#applyDashboardFilters")?.addEventListener("click", render);
    $("#dashboardRefresh")?.addEventListener("click", load);
    load();
})();
