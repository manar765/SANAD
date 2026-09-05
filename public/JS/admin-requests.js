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
            '<td class="admin-id">' + escapeHtml(request.referenceCode || request.id) + '</td>' +
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

    // ==========================================================================
    // Admin Tabs Navigation (Donations <-> Users & Roles)
    // ==========================================================================
    const tabDonationsBtn = document.getElementById("tabDonationsBtn");
    const tabUsersBtn = document.getElementById("tabUsersBtn");
    const donationsSection = document.getElementById("donationsSection");
    const usersSection = document.getElementById("usersSection");

    function switchAdminTab(target) {
        const showUsers = target === "users";
        if (tabDonationsBtn) {
            tabDonationsBtn.classList.toggle("active", !showUsers);
            tabDonationsBtn.setAttribute("aria-selected", !showUsers);
        }
        if (tabUsersBtn) {
            tabUsersBtn.classList.toggle("active", showUsers);
            tabUsersBtn.setAttribute("aria-selected", showUsers);
        }
        if (donationsSection) donationsSection.hidden = showUsers;
        if (usersSection) usersSection.hidden = !showUsers;

        if (showUsers && users.length === 0) {
            loadUsers();
        }
    }

    if (tabDonationsBtn) tabDonationsBtn.addEventListener("click", () => switchAdminTab("donations"));
    if (tabUsersBtn) tabUsersBtn.addEventListener("click", () => switchAdminTab("users"));

    // ==========================================================================
    // Users & Roles Management
    // ==========================================================================
    const usersTableBody = document.getElementById("usersTableBody");
    const usersEmptyState = document.getElementById("usersEmpty");
    const userSearchInput = document.getElementById("userSearchInput");
    const userRoleFilter = document.getElementById("userRoleFilter");
    const usersTotalCount = document.getElementById("usersTotalCount");
    const usersLoadingState = document.getElementById("usersLoading");
    const usersErrorState = document.getElementById("usersError");
    const usersRetryBtn = document.getElementById("usersRetryBtn");

    let users = [];

    const ROLE_LABELS = {
        admin: { label: "مدير نظام", className: "role-admin" },
        donor: { label: "متبرع", className: "role-donor" },
        beneficiary: { label: "مستفيد", className: "role-beneficiary" }
    };

    function buildUserRow(user) {
        const tr = document.createElement("tr");
        const roleMeta = ROLE_LABELS[user.role] || { label: user.role, className: "" };
        const phone = user.phone || "—";

        tr.innerHTML =
            '<td class="admin-id">' + escapeHtml(user.id) + '</td>' +
            '<td><strong>' + escapeHtml(user.name) + '</strong></td>' +
            '<td>' + escapeHtml(user.email) + '</td>' +
            '<td>' + escapeHtml(phone) + '</td>' +
            '<td><span class="role-badge ' + roleMeta.className + '">' + escapeHtml(roleMeta.label) + '</span></td>' +
            '<td>' +
                '<select class="role-select" aria-label="تغيير دور ' + escapeHtml(user.name) + '">' +
                    '<option value="admin"' + (user.role === "admin" ? " selected" : "") + '>مدير (Admin)</option>' +
                    '<option value="donor"' + (user.role === "donor" ? " selected" : "") + '>متبرع (Donor)</option>' +
                    '<option value="beneficiary"' + (user.role === "beneficiary" ? " selected" : "") + '>مستفيد (Beneficiary)</option>' +
                '</select>' +
            '</td>' +
            '<td>' +
                '<button type="button" class="btn btn-sm btn-primary btn-save-role" disabled>' +
                    '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> حفظ' +
                '</button>' +
            '</td>';

        const roleSelect = tr.querySelector(".role-select");
        const saveBtn = tr.querySelector(".btn-save-role");

        roleSelect.addEventListener("change", function () {
            saveBtn.disabled = roleSelect.value === user.role;
        });

        saveBtn.addEventListener("click", async function () {
            const newRole = roleSelect.value;
            if (newRole === user.role) return;

            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> حفظ…';

            try {
                const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
                if (!csrfRes.ok) throw new Error("تعذر جلب رمز الأمان.");
                const { csrfToken } = await csrfRes.json();

                const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
                    method: "PATCH",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                    body: JSON.stringify({ role: newRole })
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.message || "تعذر تحديث دور المستخدم.");
                }

                user.role = newRole;
                showToast("تم تحديث دور المستخدم بنجاح.");
                renderUsers();
            } catch (error) {
                showToast(error.message || "تعذر تحديث دور المستخدم.");
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> حفظ';
            }
        });

        return tr;
    }

    function renderUsers() {
        if (!usersTableBody) return;
        const searchTerm = (userSearchInput ? userSearchInput.value : "").trim().toLowerCase();
        const roleFilter = userRoleFilter ? userRoleFilter.value : "";

        const visible = users.filter(function (u) {
            const matchesSearch = !searchTerm ||
                String(u.name || "").toLowerCase().includes(searchTerm) ||
                String(u.email || "").toLowerCase().includes(searchTerm) ||
                String(u.phone || "").toLowerCase().includes(searchTerm);
            const matchesRole = !roleFilter || u.role === roleFilter;
            return matchesSearch && matchesRole;
        });

        usersTableBody.innerHTML = "";
        visible.forEach(function (u) { usersTableBody.appendChild(buildUserRow(u)); });

        if (usersEmptyState) usersEmptyState.hidden = visible.length !== 0;
        if (usersTotalCount) usersTotalCount.textContent = users.length;
    }

    async function loadUsers() {
        if (!usersTableBody) return;
        window.SANADUI?.setLoading(usersLoadingState, true, "جارٍ تحميل بيانات المستخدمين…");
        if (usersErrorState) usersErrorState.hidden = true;

        try {
            const response = await fetch("/api/admin/users?limit=100", { credentials: "same-origin" });
            if (!response.ok) throw new Error("تعذر تحميل قائمة المستخدمين.");
            const payload = await response.json();
            users = Array.isArray(payload.users) ? payload.users : [];
            renderUsers();
        } catch (error) {
            users = [];
            renderUsers();
            window.SANADUI?.setError(usersErrorState, error.message || "تعذر تحميل بيانات المستخدمين.", loadUsers);
        } finally {
            window.SANADUI?.setLoading(usersLoadingState, false);
        }
    }

    if (userSearchInput) userSearchInput.addEventListener("input", renderUsers);
    if (userRoleFilter) userRoleFilter.addEventListener("change", renderUsers);
    if (usersRetryBtn) usersRetryBtn.addEventListener("click", loadUsers);
})();
