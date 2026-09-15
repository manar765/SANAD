(() => {
    const form = document.getElementById("assistanceRequestForm");
    const submitBtn = document.getElementById("reqSubmitBtn");
    const benNameInput = document.getElementById("reqBeneficiaryName");
    const itemInput = document.getElementById("reqItemName");
    const categorySelect = document.getElementById("reqCategory");
    const qtyInput = document.getElementById("reqQuantity");
    const unitSelect = document.getElementById("reqUnit");
    const descInput = document.getElementById("reqDescription");
    const notesInput = document.getElementById("reqNotes");
    const myRequestsContainer = document.getElementById("reqMyRequests");
    const myRequestsEmpty = document.getElementById("reqMyRequestsEmpty");

    let csrfToken = null;
    let currentUser = null;

    const STATUS_META = {
        pending: { label: "قيد المراجعة", cls: "req-status-pending" },
        approved: { label: "تمت الموافقة", cls: "req-status-approved" },
        rejected: { label: "مرفوض", cls: "req-status-rejected" },
        fulfilled: { label: "تم التنفيذ", cls: "req-status-fulfilled" },
    };

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

    async function loadCurrentUser() {
        try {
            const stored = JSON.parse(localStorage.getItem("sanadUser") || "null");
            if (stored) currentUser = stored;
        } catch { }
        try {
            const response = await fetch("/api/auth/me", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (response.ok) {
                const payload = await response.json();
                currentUser = payload.user || null;
                if (currentUser) {
                    localStorage.setItem("sanadUser", JSON.stringify({
                        id: currentUser.id,
                        name: currentUser.name || currentUser.email,
                        email: currentUser.email,
                        role: currentUser.role,
                    }));
                }
            } else {
                currentUser = null;
            }
        } catch {
            currentUser = null;
        }
        return currentUser;
    }

    async function initIdentity() {
        const user = await loadCurrentUser();
        if (user?.name && benNameInput) {
            benNameInput.value = user.name;
        } else if (benNameInput) {
            benNameInput.value = "—";
        }
        if (user && user.role !== "beneficiary") {
            if (submitBtn) submitBtn.disabled = true;
            showToast("هذه الصفحة مخصصة للمستفيدين فقط.");
        }
    }

    /* ---------------------------------------------------------
       My previous requests
    --------------------------------------------------------- */
    function statusBadge(status) {
        const meta = STATUS_META[status] || { label: status, cls: "req-status-pending" };
        return `<span class="req-item-status status-badge ${meta.cls}">${escapeHtml(meta.label)}</span>`;
    }

    function renderMyRequests(requests = []) {
        if (!myRequestsContainer) return;
        myRequestsContainer.querySelectorAll(".req-item").forEach((el) => el.remove());

        if (!requests.length) {
            if (myRequestsEmpty) {
                myRequestsEmpty.querySelector("p").textContent = "لم ترسل أي طلبات بعد.";
                myRequestsEmpty.removeAttribute("hidden");
            }
            return;
        }

        if (myRequestsEmpty) myRequestsEmpty.setAttribute("hidden", "hidden");

        const fragment = document.createDocumentFragment();
        requests.forEach((request) => {
            const item = document.createElement("div");
            item.className = "req-item";

            const categoryLabel = escapeHtml(request.category);

            item.innerHTML =
                `<span class="req-item-icon"><i class="fa-solid fa-boxes-packing" aria-hidden="true"></i></span>` +
                `<div class="req-item-main">` +
                `<p class="req-item-title">${escapeHtml(request.itemName)}</p>` +
                `<div class="req-item-meta">` +
                `<span>${categoryLabel}</span>` +
                `<span>${escapeHtml(request.quantity)} ${escapeHtml(request.unit)}</span>` +
                `<span class="req-item-code">${escapeHtml(request.referenceCode)}</span>` +
                `<span>${escapeHtml(request.date || "")}</span>` +
                `</div>` +
                `</div>` +
                statusBadge(request.status);

            fragment.appendChild(item);
        });
        myRequestsContainer.appendChild(fragment);
    }

    async function loadMyRequests() {
        try {
            const response = await fetch("/api/assistance-requests/my", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!response.ok) throw new Error("FAILED");
            const payload = await response.json();
            renderMyRequests(payload.requests || []);
        } catch {
            if (myRequestsEmpty) {
                myRequestsEmpty.querySelector("p").textContent = "تعذر تحميل طلباتك السابقة.";
                myRequestsEmpty.removeAttribute("hidden");
            }
        }
    }

    /* ---------------------------------------------------------
       Submit
    --------------------------------------------------------- */
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            if (!currentUser) await initIdentity();
            if (!currentUser || currentUser.role !== "beneficiary") {
                showToast("هذه الصفحة مخصصة للمستفيدين فقط.");
                return;
            }

            const itemName = itemInput?.value.trim() || "";
            const category = categorySelect?.value || "";
            const quantity = qtyInput?.value.trim() || "";
            const unit = unitSelect?.value || "قطعة";

            if (itemName.length < 2) {
                itemInput?.focus();
                showToast("يرجى إدخال الاحتياج / الصنف المطلوب.");
                return;
            }
            if (!category) {
                categorySelect?.focus();
                showToast("يرجى اختيار الفئة.");
                return;
            }
            if (!quantity || Number(quantity) < 1) {
                qtyInput?.focus();
                showToast("يرجى إدخال كمية صحيحة.");
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add("loading");
            }

            try {
                const token = await getCsrf();
                const response = await fetch("/api/assistance-requests", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
                    body: JSON.stringify({
                        itemName,
                        category,
                        description: descInput?.value.trim() || "",
                        quantity: Number(quantity),
                        unit,
                        notes: notesInput?.value.trim() || "",
                    }),
                });
                const payload = await response.json().catch(() => ({}));

                if (response.status === 409 && payload.code === "DUPLICATE_ASSISTANCE_REQUEST") {
                    showToast(payload.message || "لديك طلب مساعدة مماثل قيد المراجعة بالفعل.");
                    return;
                }

                if (!response.ok) {
                    showToast(payload.message || "تعذر إرسال طلب المساعدة.");
                    return;
                }

                showToast("تم إرسال طلب المساعدة، وسيتم مراجعته من قبل الفريق.");
                form.reset();
                if (unitSelect) unitSelect.value = "قطعة";
                await loadMyRequests();
                myRequestsContainer?.scrollIntoView({ behavior: "smooth", block: "start" });
            } catch {
                showToast("تعذر إرسال طلب المساعدة، حاول مرة أخرى.");
            } finally {
                if (submitBtn) {
                    submitBtn.classList.remove("loading");
                    submitBtn.disabled = false;
                }
            }
        });
    }

    initIdentity();
    loadMyRequests();
})();