// SANAD — Admin Donation Requests
// PostgreSQL-backed moderation for donation requests.

(function () {
    const tbody = document.getElementById("adminTableBody");
    const emptyState = document.getElementById("adminEmpty");
    const filterSelect = document.getElementById("approvalFilter");
    const pendingCount = document.getElementById("pendingCount");
    const loadingState = document.getElementById("adminLoading");
    const errorState = document.getElementById("adminError");

    if (!tbody) return;

    const APPROVAL_META = {
        pending: { label: "بانتظار الموافقة", className: "st-progress", icon: "fa-hourglass-half" },
        approved: { label: "تمت الموافقة", className: "st-done", icon: "fa-circle-check" },
        rejected: { label: "مرفوض", className: "st-rejected", icon: "fa-circle-xmark" },
        in_progress: { label: "قيد التوزيع", className: "st-progress", icon: "fa-truck-fast" },
        distributed: { label: "تم التوزيع", className: "st-done", icon: "fa-box-open" }
    };
    const ORDER = { pending: 0, approved: 1, in_progress: 2, distributed: 3, rejected: 4 };
    let requests = [];

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function showToast(message) {
        const toast = document.getElementById("toast");
        if (!toast) return;
        const span = toast.querySelector("span");
        if (span) span.textContent = message;
        toast.classList.add("show");
        setTimeout(function () { toast.classList.remove("show"); }, 3500);
    }

    function statusLabel(status) {
        return APPROVAL_META[status]?.label || status;
    }

    function buildRow(request) {
        const tr = document.createElement("tr");
        const approval = APPROVAL_META[request.approvalStatus] || APPROVAL_META.pending;
        const quantity = `${request.qty || "—"} ${request.unit || ""}`.trim();
        const date = request.createdAt ? new Date(request.createdAt).toLocaleDateString("ar-EG") : "—";
        let actions = '<span class="admin-no-actions">—</span>';
        if (request.approvalStatus === "pending") {
            actions = '<div class="admin-actions">' +
                '<button type="button" class="btn btn-sm btn-primary admin-approve-btn"><i class="fa-solid fa-check" aria-hidden="true"></i> موافقة</button>' +
                '<button type="button" class="btn btn-sm btn-danger admin-reject-btn"><i class="fa-solid fa-xmark" aria-hidden="true"></i> رفض</button>' +
                '</div>';
        }

        tr.innerHTML =
            '<td class="admin-id">' + escapeHtml(request.id) + '</td>' +
            '<td><strong>' + escapeHtml(request.title) + '</strong></td>' +
            '<td>' + escapeHtml(request.donor) + '</td>' +
            '<td>' + escapeHtml(request.category) + '</td>' +
            '<td>' + escapeHtml(quantity) + '</td>' +
            '<td><span class="status-badge ' + (request.approvalStatus === "approved" ? "st-done" : "st-progress") + '">' + escapeHtml(statusLabel(request.approvalStatus)) + '</span></td>' +
            '<td>' + escapeHtml(request.warehouse || request.location || "—") + '</td>' +
            '<td class="admin-desc-cell" title="' + escapeHtml(request.desc) + '">' + escapeHtml(request.desc || "—") + '</td>' +
            '<td>' + escapeHtml(date) + '</td>' +
            '<td><span class="status-badge ' + approval.className + '"><i class="fa-solid ' + approval.icon + '" aria-hidden="true"></i> ' + approval.label + '</span></td>' +
            '<td>' + actions + '</td>';

        const updateStatus = async function (status) {
            const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" });
            if (!csrfResponse.ok) throw new Error("csrf");
            const { csrfToken } = await csrfResponse.json();
            const response = await fetch(`/api/admin/donations/${encodeURIComponent(request.id)}/status`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify({ status })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.message || "update");
            }
        };

        const approveBtn = tr.querySelector(".admin-approve-btn");
        const rejectBtn = tr.querySelector(".admin-reject-btn");
        if (approveBtn) approveBtn.addEventListener("click", async function () {
            approveBtn.disabled = true;
            try {
                await updateStatus("approved");
                showToast("تمت الموافقة على طلب التبرع.");
                await loadRequests();
            } catch (error) {
                approveBtn.disabled = false;
                showToast(error.message || "تعذر تحديث حالة التبرع.");
            }
        });
        if (rejectBtn) rejectBtn.addEventListener("click", async function () {
            rejectBtn.disabled = true;
            try {
                await updateStatus("rejected");
                showToast("تم رفض طلب التبرع.");
                await loadRequests();
            } catch (error) {
                rejectBtn.disabled = false;
                showToast(error.message || "تعذر تحديث حالة التبرع.");
            }
        });
        return tr;
    }

    function render() {
        const filter = filterSelect ? filterSelect.value : "all";
        const visible = requests.filter(function (item) {
            return filter === "all" || item.approvalStatus === filter;
        }).sort(function (a, b) {
            return (ORDER[a.approvalStatus] ?? 99) - (ORDER[b.approvalStatus] ?? 99);
        });
        tbody.innerHTML = "";
        visible.forEach(function (request) { tbody.appendChild(buildRow(request)); });
        if (emptyState) emptyState.hidden = visible.length !== 0;
        if (pendingCount) pendingCount.textContent = requests.filter(item => item.approvalStatus === "pending").length;
    }

    async function loadRequests() {
        window.SANADUI?.setLoading(loadingState, true, "جارٍ تحميل طلبات التبرعات…");
        if (errorState) errorState.hidden = true;
        try {
            const response = await fetch("/api/admin/donations", { credentials: "same-origin" });
            if (!response.ok) throw new Error("تعذر تحميل طلبات التبرعات.");
            const payload = await response.json();
            requests = Array.isArray(payload.donations) ? payload.donations : [];
            render();
        } catch (error) {
            requests = [];
            render();
            window.SANADUI?.setError(errorState, error.message || "تعذر تحميل طلبات التبرعات.", loadRequests);
        } finally {
            window.SANADUI?.setLoading(loadingState, false);
        }
    }

    if (filterSelect) filterSelect.addEventListener("change", render);
    loadRequests();
})();
