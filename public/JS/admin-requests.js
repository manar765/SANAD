// ==========================================================================
// SANAD — Admin Donation Requests
// Lists all user-submitted donation requests with their approval status.
// Approve → the donation becomes public and affects statistics.
// Reject → the donation is refused and never becomes public.
// ==========================================================================

(function () {
    const store = window.SANADDonationsStore;

    const tbody = document.getElementById("adminTableBody");
    const emptyState = document.getElementById("adminEmpty");
    const filterSelect = document.getElementById("approvalFilter");
    const pendingCount = document.getElementById("pendingCount");

    if (!store || !tbody) return;

    const APPROVAL_META = {
        pending:  { label: "بانتظار الموافقة", className: "st-progress", icon: "fa-hourglass-half" },
        approved: { label: "تمت الموافقة",     className: "st-done",     icon: "fa-circle-check" },
        rejected: { label: "مرفوض",            className: "st-rejected", icon: "fa-circle-xmark" }
    };

    const ORDER = { pending: 0, approved: 1, rejected: 2 };

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function donationStatusClass(status) {
        if (status === "قيد التوزيع") return "st-progress";
        if (status === "تم التوزيع") return "st-done";
        return "st-available";
    }

    function showToast(message) {
        const toast = document.getElementById("toast");
        if (!toast) return;
        const span = toast.querySelector("span");
        if (span) span.textContent = message;
        toast.classList.add("show");
        setTimeout(function () {
            toast.classList.remove("show");
        }, 3500);
    }

    function buildRow(request) {
        const tr = document.createElement("tr");
        const approval = APPROVAL_META[request.approvalStatus] || APPROVAL_META.pending;

        let actions = '<span class="admin-no-actions">—</span>';
        if (request.approvalStatus === "pending") {
            actions =
                '<div class="admin-actions">' +
                '<button type="button" class="btn btn-sm btn-primary admin-approve-btn">' +
                '<i class="fa-solid fa-check"></i> موافقة</button>' +
                '<button type="button" class="btn btn-sm btn-danger admin-reject-btn">' +
                '<i class="fa-solid fa-xmark"></i> رفض</button>' +
                '</div>';
        }

        tr.innerHTML =
            '<td class="admin-id">' + escapeHtml(request.id) + '</td>' +
            '<td><strong>' + escapeHtml(request.title) + '</strong></td>' +
            '<td>' + escapeHtml(request.donor) + '</td>' +
            '<td>' + escapeHtml(request.category) + '</td>' +
            '<td>' + escapeHtml(request.qty || "—") + '</td>' +
            '<td><span class="status-badge ' + donationStatusClass(request.status) + '">' + escapeHtml(request.status) + '</span></td>' +
            '<td>' + escapeHtml(request.warehouse || request.location || "—") + '</td>' +
            '<td class="admin-desc-cell" title="' + escapeHtml(request.desc) + '">' + escapeHtml(request.desc || "—") + '</td>' +
            '<td>' + escapeHtml(request.date || "—") + '</td>' +
            '<td><span class="status-badge ' + approval.className + '"><i class="fa-solid ' + approval.icon + '"></i> ' + approval.label + '</span></td>' +
            '<td>' + actions + '</td>';

        const approveBtn = tr.querySelector(".admin-approve-btn");
        const rejectBtn = tr.querySelector(".admin-reject-btn");

        if (approveBtn) {
            approveBtn.addEventListener("click", function () {
                store.setApprovalStatus(request.id, "approved");
                showToast("تمت الموافقة على التبرع «" + request.title + "» وأصبح متاحاً للعرض.");
                render();
            });
        }

        if (rejectBtn) {
            rejectBtn.addEventListener("click", function () {
                store.setApprovalStatus(request.id, "rejected");
                showToast("تم رفض طلب التبرع «" + request.title + "».");
                render();
            });
        }

        return tr;
    }

    function getRequests() {
        return store.getAddedDonations().slice().sort(function (a, b) {
            const orderA = ORDER[a.approvalStatus] !== undefined ? ORDER[a.approvalStatus] : 1;
            const orderB = ORDER[b.approvalStatus] !== undefined ? ORDER[b.approvalStatus] : 1;
            return orderA - orderB;
        });
    }

    function render() {
        const filter = filterSelect ? filterSelect.value : "all";
        const requests = getRequests().filter(function (r) {
            return filter === "all" || r.approvalStatus === filter;
        });

        tbody.innerHTML = "";
        requests.forEach(function (request) {
            tbody.appendChild(buildRow(request));
        });

        if (emptyState) {
            emptyState.hidden = requests.length !== 0;
        }

        if (pendingCount) {
            const pending = getRequests().filter(function (r) {
                return r.approvalStatus === "pending";
            }).length;
            pendingCount.textContent = pending;
        }
    }

    if (filterSelect) {
        filterSelect.addEventListener("change", render);
    }

    render();
})();
