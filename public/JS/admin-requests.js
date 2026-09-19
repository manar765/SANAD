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
    // Admin Tabs Navigation (Donations <-> Users & Roles <-> Assistance <-> Database)
    // ==========================================================================
    const tabDonationsBtn = document.getElementById("tabDonationsBtn");
    const tabUsersBtn = document.getElementById("tabUsersBtn");
    const tabAssistanceBtn = document.getElementById("tabAssistanceBtn");
    const tabDatabaseBtn = document.getElementById("tabDatabaseBtn");
    const donationsSection = document.getElementById("donationsSection");
    const usersSection = document.getElementById("usersSection");
    const assistanceSection = document.getElementById("assistanceSection");
    const databaseSection = document.getElementById("databaseSection");

    function switchAdminTab(target) {
        const showDonations = target === "donations";
        const showUsers = target === "users";
        const showAssistance = target === "assistance";
        const showDatabase = target === "database";

        if (tabDonationsBtn) {
            tabDonationsBtn.classList.toggle("active", showDonations);
            tabDonationsBtn.setAttribute("aria-selected", showDonations);
        }
        if (tabUsersBtn) {
            tabUsersBtn.classList.toggle("active", showUsers);
            tabUsersBtn.setAttribute("aria-selected", showUsers);
        }
        if (tabAssistanceBtn) {
            tabAssistanceBtn.classList.toggle("active", showAssistance);
            tabAssistanceBtn.setAttribute("aria-selected", showAssistance);
        }
        if (tabDatabaseBtn) {
            tabDatabaseBtn.classList.toggle("active", showDatabase);
            tabDatabaseBtn.setAttribute("aria-selected", showDatabase);
        }

        if (donationsSection) donationsSection.hidden = !showDonations;
        if (usersSection) usersSection.hidden = !showUsers;
        if (assistanceSection) assistanceSection.hidden = !showAssistance;
        if (databaseSection) databaseSection.hidden = !showDatabase;

        if (showUsers && users.length === 0) {
            loadUsers();
        }
        if (showAssistance && assistanceLoaded === false) {
            loadAssistanceRequests();
        }
        if (showDatabase) {
            loadDatabaseStats();
        }
    }

    if (tabDonationsBtn) tabDonationsBtn.addEventListener("click", () => switchAdminTab("donations"));
    if (tabUsersBtn) tabUsersBtn.addEventListener("click", () => switchAdminTab("users"));
    if (tabAssistanceBtn) tabAssistanceBtn.addEventListener("click", () => switchAdminTab("assistance"));
    if (tabDatabaseBtn) tabDatabaseBtn.addEventListener("click", () => switchAdminTab("database"));

    // ==========================================================================
    // Assistance Requests (طلبات المساعدة)
    // ==========================================================================
    const assistanceTableBody = document.getElementById("assistanceTableBody");
    const assistanceEmptyState = document.getElementById("assistanceEmpty");
    const assistanceFilterSelect = document.getElementById("assistanceFilter");
    const assistancePendingCount = document.getElementById("assistancePendingCount");
    const assistanceLoadingState = document.getElementById("assistanceLoading");
    const assistanceErrorState = document.getElementById("assistanceError");
    const assistanceRetryBtn = document.getElementById("assistanceRetryBtn");

    let assistanceRequests = [];
    let assistanceLoaded = false;

    const ASSISTANCE_META = {
        pending: { label: "قيد المراجعة", className: "st-progress", icon: "fa-hourglass-half" },
        approved: { label: "تمت الموافقة", className: "st-done", icon: "fa-circle-check" },
        rejected: { label: "مرفوض", className: "st-rejected", icon: "fa-circle-xmark" },
        fulfilled: { label: "تم التنفيذ", className: "st-done", icon: "fa-box-open" }
    };
    const ASSISTANCE_ORDER = { pending: 0, approved: 1, fulfilled: 2, rejected: 3 };
    const ASSISTANCE_ACTIONS = {
        pending: "approve|reject",
        approved: "fulfill"
    };

    function buildAssistanceRow(request) {
        const tr = document.createElement("tr");
        const meta = ASSISTANCE_META[request.status] || ASSISTANCE_META.pending;
        const quantity = `${request.quantity || "—"} ${request.unit || ""}`.trim();
        const date = request.date || "—";

        const allowedActions = ASSISTANCE_ACTIONS[request.status] || "";
        let actions = '<span class="admin-no-actions">—</span>';
        if (allowedActions) {
            actions = '<div class="admin-actions">';
            if (allowedActions.includes("approve")) {
                actions += '<button type="button" class="btn btn-sm btn-primary admin-assist-approve-btn"><i class="fa-solid fa-check" aria-hidden="true"></i> موافقة</button>';
            }
            if (allowedActions.includes("reject")) {
                actions += '<button type="button" class="btn btn-sm btn-danger admin-assist-reject-btn"><i class="fa-solid fa-xmark" aria-hidden="true"></i> رفض</button>';
            }
            if (allowedActions.includes("fulfill")) {
                actions += '<button type="button" class="btn btn-sm btn-outline admin-assist-fulfill-btn"><i class="fa-solid fa-box-open" aria-hidden="true"></i> تم التنفيذ</button>';
            }
            actions += '</div>';
        }

        tr.innerHTML =
            '<td class="admin-id">' + escapeHtml(request.referenceCode || request.id) + '</td>' +
            '<td><strong>' + escapeHtml(request.itemName) + '</strong></td>' +
            '<td>' + escapeHtml(request.beneficiaryName || "—") + '</td>' +
            '<td>' + escapeHtml(request.category) + '</td>' +
            '<td>' + escapeHtml(quantity) + '</td>' +
            '<td><span class="status-badge ' + meta.className + '"><i class="fa-solid ' + meta.icon + '" aria-hidden="true"></i> ' + meta.label + '</span></td>' +
            '<td class="admin-desc-cell" title="' + escapeHtml(request.description) + '">' + escapeHtml(request.description || "—") + '</td>' +
            '<td>' + escapeHtml(date) + '</td>' +
            '<td>' + actions + '</td>';

        const updateStatus = async function (status) {
            const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" });
            if (!csrfResponse.ok) throw new Error("تعذر جلب رمز الأمان.");
            const { csrfToken } = await csrfResponse.json();
            const response = await fetch(`/api/admin/assistance-requests/${encodeURIComponent(request.id)}/status`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify({ status })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.message || "تعذر تحديث حالة طلب المساعدة.");
            }
        };

        const bindAction = function (btn, status) {
            if (!btn) return;
            btn.addEventListener("click", async function () {
                btn.disabled = true;
                try {
                    await updateStatus(status);
                    showToast(status === "approved" ? "تمت الموافقة على طلب المساعدة." : "تم تحديث حالة طلب المساعدة.");
                    await loadAssistanceRequests();
                } catch (error) {
                    btn.disabled = false;
                    showToast(error.message || "تعذر تحديث حالة طلب المساعدة.");
                }
            });
        };

        bindAction(tr.querySelector(".admin-assist-approve-btn"), "approved");
        bindAction(tr.querySelector(".admin-assist-reject-btn"), "rejected");
        bindAction(tr.querySelector(".admin-assist-fulfill-btn"), "fulfilled");
        return tr;
    }

    function renderAssistanceRequests() {
        if (!assistanceTableBody) return;
        const filter = assistanceFilterSelect ? assistanceFilterSelect.value : "all";
        const visible = assistanceRequests.filter(function (item) {
            return filter === "all" || item.status === filter;
        }).sort(function (a, b) {
            return (ASSISTANCE_ORDER[a.status] ?? 99) - (ASSISTANCE_ORDER[b.status] ?? 99);
        });
        assistanceTableBody.innerHTML = "";
        visible.forEach(function (request) { assistanceTableBody.appendChild(buildAssistanceRow(request)); });
        if (assistanceEmptyState) assistanceEmptyState.hidden = visible.length !== 0;
        if (assistancePendingCount) assistancePendingCount.textContent = assistanceRequests.filter(item => item.status === "pending").length;
    }

    async function loadAssistanceRequests() {
        if (!assistanceTableBody) return;
        window.SANADUI?.setLoading(assistanceLoadingState, true, "جارٍ تحميل طلبات المساعدة…");
        if (assistanceErrorState) assistanceErrorState.hidden = true;
        try {
            const response = await fetch("/api/assistance-requests", { credentials: "same-origin" });
            if (!response.ok) throw new Error("تعذر تحميل طلبات المساعدة.");
            const payload = await response.json();
            assistanceRequests = Array.isArray(payload.requests) ? payload.requests : [];
            assistanceLoaded = true;
            renderAssistanceRequests();
        } catch (error) {
            assistanceRequests = [];
            renderAssistanceRequests();
            window.SANADUI?.setError(assistanceErrorState, error.message || "تعذر تحميل طلبات المساعدة.", loadAssistanceRequests);
        } finally {
            window.SANADUI?.setLoading(assistanceLoadingState, false);
        }
    }

    if (assistanceFilterSelect) assistanceFilterSelect.addEventListener("change", renderAssistanceRequests);
    if (assistanceRetryBtn) assistanceRetryBtn.addEventListener("click", loadAssistanceRequests);
    if (tabAssistanceBtn) tabAssistanceBtn.addEventListener("click", () => switchAdminTab("assistance"));

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

        let purgePermCell = '<span style="color:var(--text-muted); font-size:0.85rem;">—</span>';
        if (user.isSuperAdmin) {
            purgePermCell = '<span class="badge" style="background:#fee2e2; color:#dc2626; font-size:0.8rem; padding:4px 8px; border-radius:6px; font-weight:700;"><i class="fa-solid fa-shield-halved"></i> الأدمن الأعلى</span>';
        } else if (user.role === "admin") {
            const isChecked = user.canClearDatabase ? " checked" : "";
            const isDisabled = currentUserIsSuperAdmin ? "" : " disabled";
            const tooltip = currentUserIsSuperAdmin ? "تعديل صلاحية مسح البيانات" : "تعديل الصلاحية متاح للأدمن الأعلى فقط";
            purgePermCell =
                '<label style="display:inline-flex; align-items:center; gap:6px; cursor:' + (currentUserIsSuperAdmin ? 'pointer' : 'not-allowed') + ';" title="' + tooltip + '">' +
                '<input type="checkbox" class="can-clear-db-toggle"' + isChecked + isDisabled + ' data-user-id="' + escapeHtml(user.id) + '">' +
                '<small class="perm-status-text" style="font-weight:600; color:' + (user.canClearDatabase ? '#16a34a' : '#64748b') + ';">' + (user.canClearDatabase ? 'مفعلة' : 'معطلة') + '</small>' +
                '</label>';
        }

        tr.innerHTML =
            '<td class="admin-id">' + escapeHtml(user.id) + '</td>' +
            '<td><strong>' + escapeHtml(user.name) + '</strong></td>' +
            '<td>' + escapeHtml(user.email) + '</td>' +
            '<td>' + escapeHtml(phone) + '</td>' +
            '<td><span class="role-badge ' + roleMeta.className + '">' + escapeHtml(roleMeta.label) + '</span></td>' +
            '<td>' + purgePermCell + '</td>' +
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
        const permToggle = tr.querySelector(".can-clear-db-toggle");

        if (permToggle && currentUserIsSuperAdmin) {
            permToggle.addEventListener("change", async function () {
                const newChecked = permToggle.checked;
                permToggle.disabled = true;
                const statusText = tr.querySelector(".perm-status-text");

                try {
                    const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
                    if (!csrfRes.ok) throw new Error("تعذر جلب رمز الأمان.");
                    const { csrfToken } = await csrfRes.json();

                    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/permissions`, {
                        method: "PATCH",
                        credentials: "same-origin",
                        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                        body: JSON.stringify({ canClearDatabase: newChecked })
                    });

                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(payload.message || "تعذر تعديل الصلاحية.");
                    }

                    user.canClearDatabase = newChecked;
                    if (statusText) {
                        statusText.textContent = newChecked ? "مفعلة" : "معطلة";
                        statusText.style.color = newChecked ? "#16a34a" : "#64748b";
                    }
                    showToast("تم تحديث صلاحية مسح البيانات للمشرف بنجاح.");
                } catch (error) {
                    permToggle.checked = !newChecked;
                    showToast(error.message || "تعذر تحديث الصلاحية.");
                } finally {
                    permToggle.disabled = false;
                }
            });
        }

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

    // ==========================================================================
    // Database Management & Purge Module
    // ==========================================================================
    let currentUserIsSuperAdmin = false;
    let currentUserCanClearDatabase = false;
    let databaseStats = null;
    let currentPurgeAction = null;

    const dbPermissionBadge = document.getElementById("dbPermissionBadge");
    const dbLoading = document.getElementById("dbLoading");
    const dbError = document.getElementById("dbError");
    const dbRetryBtn = document.getElementById("dbRetryBtn");
    const dbAccessDenied = document.getElementById("dbAccessDenied");
    const dbContentArea = document.getElementById("dbContentArea");
    const dbStatsGrid = document.getElementById("dbStatsGrid");
    const btnRefreshDbStats = document.getElementById("btnRefreshDbStats");

    const btnSelectAllTargets = document.getElementById("btnSelectAllTargets");
    const btnDeselectAllTargets = document.getElementById("btnDeselectAllTargets");
    const btnInitiateSelectivePurge = document.getElementById("btnInitiateSelectivePurge");
    const btnInitiateFullPurge = document.getElementById("btnInitiateFullPurge");
    const fullPurgeKeepAudit = document.getElementById("fullPurgeKeepAudit");

    // Modal elements
    const purgeConfirmModal = document.getElementById("purgeConfirmModal");
    const modalPurgeTitle = document.getElementById("modalPurgeTitle");
    const modalPurgeSubtitle = document.getElementById("modalPurgeSubtitle");
    const modalPurgeSummary = document.getElementById("modalPurgeSummary");
    const purgeConfirmationInput = document.getElementById("purgeConfirmationInput");
    const btnCancelPurgeModal = document.getElementById("btnCancelPurgeModal");
    const btnExecutePurgeConfirmed = document.getElementById("btnExecutePurgeConfirmed");

    const STAT_CARD_CONFIG = [
        { key: "donations", label: "طلبات التبرعات", icon: "fa-inbox", color: "#3b82f6" },
        { key: "inventory", label: "أصناف المخزون", icon: "fa-boxes-stacked", color: "#10b981" },
        { key: "distributions", label: "عمليات التوزيع", icon: "fa-truck-fast", color: "#8b5cf6" },
        { key: "assistanceRequests", label: "طلبات المساعدة", icon: "fa-hand-holding-heart", color: "#f59e0b" },
        { key: "beneficiaries", label: "ملفات المستفيدين", icon: "fa-people-roof", color: "#ec4899" },
        { key: "needs", label: "احتياجات المستفيدين", icon: "fa-clipboard-list", color: "#06b6d4" },
        { key: "donors", label: "ملفات المتبرعين", icon: "fa-user-heart", color: "#6366f1" },
        { key: "auditLogs", label: "سجلات التدقيق", icon: "fa-clock-rotate-left", color: "#64748b" }
    ];

    const TARGET_LABELS = {
        donations: "طلبات التبرعات",
        inventory: "أصناف المخزون",
        distributions: "التوزيعات وعمليات الصرف",
        assistance_requests: "طلبات المساعدة",
        beneficiaries: "المستفيدون والاحتياجات والتوصيات",
        donors: "ملفات وحسابات المتبرعين",
        audit_logs: "سجلات التدقيق والرقابة"
    };

    function renderDatabaseStats(stats) {
        if (!dbStatsGrid) return;
        dbStatsGrid.innerHTML = "";

        STAT_CARD_CONFIG.forEach(item => {
            const count = stats[item.key] ?? 0;
            const card = document.createElement("div");
            card.className = "db-stat-card";
            card.style.cssText = "background:var(--bg-surface,#fff); border:1px solid var(--border); border-radius:12px; padding:16px; display:flex; align-items:center; gap:14px; box-shadow:0 1px 3px rgba(0,0,0,0.04);";
            card.innerHTML =
                '<div style="width:42px; height:42px; border-radius:10px; background:' + item.color + '15; color:' + item.color + '; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0;">' +
                '<i class="fa-solid ' + item.icon + '"></i>' +
                '</div>' +
                '<div>' +
                '<div style="font-size:1.35rem; font-weight:700; color:var(--text-primary); line-height:1.2;">' + count.toLocaleString("ar-EG") + '</div>' +
                '<div style="font-size:0.85rem; color:var(--text-muted);">' + item.label + '</div>' +
                '</div>';
            dbStatsGrid.appendChild(card);
        });

        // Update target badges
        const setBadge = (id, count) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (count || 0).toLocaleString("ar-EG");
        };

        setBadge("badgeCountDonations", stats.donations);
        setBadge("badgeCountInventory", stats.inventory);
        setBadge("badgeCountDistributions", stats.distributions);
        setBadge("badgeCountAssistance", stats.assistanceRequests);
        setBadge("badgeCountBeneficiaries", stats.beneficiaries);
        setBadge("badgeCountDonors", stats.donors);
        setBadge("badgeCountAudit", stats.auditLogs);
    }

    async function loadDatabaseStats() {
        if (!dbLoading) return;
        window.SANADUI?.setLoading(dbLoading, true, "جارٍ تحميل إحصائيات وصلاحيات قاعدة البيانات…");
        if (dbError) dbError.hidden = true;

        try {
            const res = await fetch("/api/admin/database/stats", { credentials: "same-origin" });
            if (!res.ok) throw new Error("تعذر جلب إحصائيات قاعدة البيانات.");
            const payload = await res.json();

            currentUserIsSuperAdmin = Boolean(payload.isSuperAdmin);
            currentUserCanClearDatabase = Boolean(payload.canClearDatabase || payload.isSuperAdmin);
            databaseStats = payload.stats || {};

            if (dbPermissionBadge) {
                if (currentUserIsSuperAdmin) {
                    dbPermissionBadge.innerHTML = '<i class="fa-solid fa-shield-halved"></i> الأدمن الأعلى (صلاحية كاملة)';
                    dbPermissionBadge.style.background = "rgba(220, 38, 38, 0.1)";
                    dbPermissionBadge.style.color = "#dc2626";
                    dbPermissionBadge.style.borderColor = "rgba(220, 38, 38, 0.25)";
                } else if (currentUserCanClearDatabase) {
                    dbPermissionBadge.innerHTML = '<i class="fa-solid fa-user-check"></i> مشرف مخوّل بمسح البيانات';
                    dbPermissionBadge.style.background = "rgba(16, 185, 129, 0.1)";
                    dbPermissionBadge.style.color = "#059669";
                    dbPermissionBadge.style.borderColor = "rgba(16, 185, 129, 0.25)";
                } else {
                    dbPermissionBadge.innerHTML = '<i class="fa-solid fa-lock"></i> غير مصرح بالمسح';
                    dbPermissionBadge.style.background = "rgba(100, 116, 139, 0.1)";
                    dbPermissionBadge.style.color = "#64748b";
                    dbPermissionBadge.style.borderColor = "rgba(100, 116, 139, 0.25)";
                }
            }

            if (currentUserCanClearDatabase) {
                if (dbAccessDenied) dbAccessDenied.style.display = "none";
                if (dbContentArea) dbContentArea.style.display = "block";
                renderDatabaseStats(databaseStats);
            } else {
                if (dbAccessDenied) dbAccessDenied.style.display = "block";
                if (dbContentArea) dbContentArea.style.display = "none";
            }
        } catch (error) {
            window.SANADUI?.setError(dbError, error.message || "تعذر تحميل إحصائيات قاعدة البيانات.", loadDatabaseStats);
        } finally {
            window.SANADUI?.setLoading(dbLoading, false);
        }
    }

    if (btnRefreshDbStats) btnRefreshDbStats.addEventListener("click", loadDatabaseStats);
    if (dbRetryBtn) dbRetryBtn.addEventListener("click", loadDatabaseStats);

    if (btnSelectAllTargets) {
        btnSelectAllTargets.addEventListener("click", () => {
            document.querySelectorAll(".target-checkbox").forEach(cb => cb.checked = true);
        });
    }

    if (btnDeselectAllTargets) {
        btnDeselectAllTargets.addEventListener("click", () => {
            document.querySelectorAll(".target-checkbox").forEach(cb => cb.checked = false);
        });
    }

    function openPurgeModal({ title, subtitle, summaryHtml, action }) {
        currentPurgeAction = action;
        if (modalPurgeTitle) modalPurgeTitle.textContent = title;
        if (modalPurgeSubtitle) modalPurgeSubtitle.textContent = subtitle;
        if (modalPurgeSummary) modalPurgeSummary.innerHTML = summaryHtml;
        if (purgeConfirmationInput) purgeConfirmationInput.value = "";
        if (btnExecutePurgeConfirmed) btnExecutePurgeConfirmed.disabled = true;
        if (purgeConfirmModal) purgeConfirmModal.style.display = "flex";
        if (purgeConfirmationInput) setTimeout(() => purgeConfirmationInput.focus(), 100);
    }

    function closePurgeModal() {
        if (purgeConfirmModal) purgeConfirmModal.style.display = "none";
        currentPurgeAction = null;
        if (purgeConfirmationInput) purgeConfirmationInput.value = "";
    }

    if (btnCancelPurgeModal) btnCancelPurgeModal.addEventListener("click", closePurgeModal);

    if (purgeConfirmationInput) {
        purgeConfirmationInput.addEventListener("input", () => {
            const val = purgeConfirmationInput.value.trim();
            const isValid = val === "مسح البيانات" || val === "CLEAR_DATA" || val === "تأكيد المسح";
            if (btnExecutePurgeConfirmed) {
                btnExecutePurgeConfirmed.disabled = !isValid;
            }
        });
    }

    // Selective purge click
    if (btnInitiateSelectivePurge) {
        btnInitiateSelectivePurge.addEventListener("click", () => {
            const selected = Array.from(document.querySelectorAll(".target-checkbox:checked")).map(cb => cb.value);
            if (selected.length === 0) {
                showToast("يرجى تحديد قسم واحد على الأقل للمسح الانتقائي.");
                return;
            }

            const itemsList = selected.map(s => '<li><strong>' + (TARGET_LABELS[s] || s) + '</strong></li>').join("");
            const summaryHtml =
                '<div style="color:#92400e; font-weight:700; margin-bottom:8px;"><i class="fa-solid fa-triangle-exclamation"></i> سيتم مسح الأقسام التالية نهائياً:</div>' +
                '<ul style="margin:0; padding-inline-start:20px; color:var(--text-primary);">' + itemsList + '</ul>' +
                '<div style="margin-top:10px; font-size:0.85rem; color:var(--text-muted);">باقي بيانات المنظومة وحسابات المشرفين ستبقى دون أي تعديل.</div>';

            openPurgeModal({
                title: "تأكيد المسح المخصص",
                subtitle: "سيتم مسح الأقسام المحددة فقط",
                summaryHtml,
                action: { mode: "selective", targets: selected }
            });
        });
    }

    // Full purge click
    if (btnInitiateFullPurge) {
        btnInitiateFullPurge.addEventListener("click", () => {
            const keepAudit = Boolean(fullPurgeKeepAudit && fullPurgeKeepAudit.checked);
            const summaryHtml =
                '<div style="color:#991b1b; font-weight:700; margin-bottom:8px;"><i class="fa-solid fa-radiation"></i> تحذير عالي الخطورة — مسح شامل:</div>' +
                '<div style="color:#7f1d1d; font-size:0.9rem; line-height:1.6;">' +
                'سيتم مسح كافة التبرعات، أصناف المخزون، المستفيدين، التوزيعات، طلبات المساعدة، وحسابات المتبرعين/المستفيدين.' +
                (keepAudit ? '<br>• <strong>سيتم الاحتفاظ بسجلات التدقيق والرقابة.</strong>' : '<br>• <strong>سيتم تفريغ كافة سجلات التدقيق.</strong>') +
                '<br>• <strong>حسابات المشرفين (Admins) وحساب الأدمن الأعلى لن تُمس نهائياً.</strong>' +
                '</div>';

            openPurgeModal({
                title: "تأكيد المسح الشامل لقاعدة البيانات",
                subtitle: "إعادة ضبط المنظومة مع الحفاظ على المشرفين",
                summaryHtml,
                action: { mode: "full", targets: ["all"], preserveAuditLogs: keepAudit }
            });
        });
    }

    // Execute purge confirmed
    if (btnExecutePurgeConfirmed) {
        btnExecutePurgeConfirmed.addEventListener("click", async () => {
            if (!currentPurgeAction) return;
            const confirmationText = (purgeConfirmationInput ? purgeConfirmationInput.value : "").trim();

            btnExecutePurgeConfirmed.disabled = true;
            btnExecutePurgeConfirmed.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ تنفيذ المسح…';
            if (btnCancelPurgeModal) btnCancelPurgeModal.disabled = true;

            try {
                const csrfRes = await fetch("/api/auth/csrf", { credentials: "same-origin" });
                if (!csrfRes.ok) throw new Error("تعذر جلب رمز الأمان.");
                const { csrfToken } = await csrfRes.json();

                const response = await fetch("/api/admin/database/purge", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                    body: JSON.stringify({
                        mode: currentPurgeAction.mode,
                        targets: currentPurgeAction.targets,
                        preserveAuditLogs: currentPurgeAction.preserveAuditLogs,
                        confirmationText
                    })
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.message || "حدث خطأ أثناء تنفيذ عملية المسح.");
                }

                closePurgeModal();
                showToast(payload.message || "تمت عملية مسح البيانات بنجاح.");

                // Refresh all relevant views
                await loadDatabaseStats();
                await loadRequests();
                if (typeof loadAssistanceRequests === "function") await loadAssistanceRequests();
                if (typeof loadUsers === "function") await loadUsers();
            } catch (error) {
                showToast(error.message || "تعذر تنفيذ عملية المسح.");
                btnExecutePurgeConfirmed.disabled = false;
                btnExecutePurgeConfirmed.innerHTML = '<i class="fa-solid fa-check"></i> تأكيد وحذف الآن';
                if (btnCancelPurgeModal) btnCancelPurgeModal.disabled = false;
            }
        });
    }

    // Hash check on load
    if (window.location.hash === "#database") {
        switchAdminTab("database");
    } else if (window.location.hash === "#users") {
        switchAdminTab("users");
    } else if (window.location.hash === "#assistance") {
        switchAdminTab("assistance");
    }

    // Initial pre-load of database permissions/stats in background
    loadDatabaseStats();
})();

