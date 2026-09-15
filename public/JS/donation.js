// ==========================================================================
// SANAD — Donations page
// Sections: Data Source · Filtering · Rendering · Show More/Less · Statistics
//           · Details Drawer · Add Donation Modal
// ==========================================================================

(function () {
    const store = window.SANADDonationsStore;

    const searchInput = document.getElementById("donSearch");
    const categorySelect = document.getElementById("filterCategory");
    const locationSelect = document.getElementById("filterLocation");
    const statusSelect = document.getElementById("filterStatus");
    const resetBtn = document.getElementById("resetFilters");
    const emptyResetBtn = document.getElementById("emptyResetBtn");
    const grid = document.getElementById("donGrid");
    const emptyState = document.getElementById("donEmpty");
    const showMoreBtn = document.getElementById("showMoreBtn");

    // Drawer elements
    const drawer = document.getElementById("donationDrawer");
    const backdrop = document.getElementById("drawerBackdrop");
    const drawerCloseBtn = document.getElementById("drawerCloseBtn");
    const drawerDismissBtn = document.getElementById("drawerDismissBtn");
    const drawerAllocateBtn = document.getElementById("drawerAllocateBtn");

    const drawerItemId = document.getElementById("drawerItemId");
    const drawerItemStatus = document.getElementById("drawerItemStatus");
    const drawerItemTitle = document.getElementById("drawerItemTitle");
    const drawerItemDesc = document.getElementById("drawerItemDesc");
    const drawerItemCategory = document.getElementById("drawerItemCategory");
    const drawerItemCondition = document.getElementById("drawerItemCondition");
    const drawerItemQty = document.getElementById("drawerItemQty");
    const drawerItemWarehouse = document.getElementById("drawerItemWarehouse");
    const drawerItemDate = document.getElementById("drawerItemDate");
    const drawerItemDonor = document.getElementById("drawerItemDonor");
    const drawerItemTarget = document.getElementById("drawerItemTarget");

    let lastFocusedElement = null;

    const PAGE_SIZE = 5;
    let visibleLimit = PAGE_SIZE;
    let isFirstRender = true;

    if (!grid) return;

    /* ---------------------------------------------------------
       1. Filtering & Search Logic (object-based, on the shared data)
    --------------------------------------------------------- */
    function matchesFilters(donation) {
        if (!donation) return false;
        const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
        const category = categorySelect ? categorySelect.value : "";
        const location = locationSelect ? locationSelect.value : "";
        const status = statusSelect ? statusSelect.value : "";

        const haystack = `${donation.title || ""} ${donation.location || ""} ${donation.category || ""} ${donation.desc || ""}`.toLowerCase();

        if (query && haystack.indexOf(query) === -1) return false;
        if (category && donation.category !== category) return false;
        if (location && donation.location !== location) return false;
        if (status && donation.status !== status) return false;

        return true;
    }

    let serverDonations = [];

    function getFilteredDonations() {
        const localDonations = (store && typeof store.getPublicDonations === "function")
            ? store.getPublicDonations()
            : [];
        const serverIds = new Set(serverDonations.map(d => String(d.id || d.referenceCode)));
        const uniqueLocal = localDonations.filter(d => !serverIds.has(String(d.id)));
        return serverDonations.concat(uniqueLocal).filter(matchesFilters);
    }

    async function loadServerDonations() {
        try {
            const response = await fetch("/api/donations", { credentials: "same-origin" });
            if (!response.ok) return;
            const payload = await response.json();
            serverDonations = Array.isArray(payload.donations) ? payload.donations : [];
            renderDonations();
        } catch {
            // Keep the existing demo cards available if the API is temporarily unavailable.
        }
    }

    /* ---------------------------------------------------------
       2. Card Rendering (reuses the existing .don-card structure)
    --------------------------------------------------------- */
    const CATEGORY_META = {
        "ملابس": { media: "m-green", icon: "fa-shirt" },
        "مواد غذائية": { media: "m-orange", icon: "fa-bowl-food" },
        "أدوات مدرسية": { media: "m-blue", icon: "fa-school" },
        "أثاث": { media: "m-coral", icon: "fa-couch" },
        "أجهزة": { media: "m-purple", icon: "fa-tv" },
        "أخرى": { media: "m-mint", icon: "fa-box-open" }
    };

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function buildDonationCard(donation) {
        const card = document.createElement("article");
        card.className = "don-card reveal";
        if (!isFirstRender) card.classList.add("visible");

        card.setAttribute("data-id", donation.id);
        card.setAttribute("data-title", donation.title);
        card.setAttribute("data-desc", donation.desc);
        card.setAttribute("data-category", donation.category);
        card.setAttribute("data-location", donation.location);
        card.setAttribute("data-status", donation.status);
        card.setAttribute("data-condition", donation.condition);
        card.setAttribute("data-qty", donation.qty);
        card.setAttribute("data-warehouse", donation.warehouse);
        card.setAttribute("data-date", donation.date);
        card.setAttribute("data-donor", donation.donor);
        card.setAttribute("data-target", donation.target);

        const meta = CATEGORY_META[donation.category] || CATEGORY_META["أخرى"];
        const statusClass = donation.status === "قيد التوزيع" ? "st-progress" : "st-available";

        card.innerHTML = `
            <div class="don-media ${meta.media}">
                <span class="don-media-icon"><i class="fa-solid ${meta.icon}"></i></span>
                <span class="don-badge">${escapeHtml(donation.category || "أخرى")}</span>
            </div>
            <div class="don-body">
                <h3 class="don-title">${escapeHtml(donation.title)}</h3>
                <p class="don-desc">${escapeHtml(donation.desc || "لا يوجد وصف إضافي متوفر.")}</p>
                <div class="don-meta">
                    <span class="don-meta-item"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(donation.location)}</span>
                    <span class="don-meta-item"><i class="fa-solid fa-boxes-stacked"></i> ${escapeHtml(donation.qty || "—")}</span>
                </div>
                <div class="don-foot">
                    <span class="status-badge ${statusClass}">${escapeHtml(donation.status)}</span>
                    <span class="don-date"><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(donation.date || "—")}</span>
                </div>
                <button type="button" class="btn btn-outline don-btn don-detail-btn" data-id="${escapeHtml(donation.id)}">عرض التفاصيل</button>
            </div>
        `;

        return card;
    }

    function renderDonations() {
        const filtered = getFilteredDonations();
        const shown = filtered.slice(0, visibleLimit);

        grid.innerHTML = "";
        shown.forEach(function (donation) {
            grid.appendChild(buildDonationCard(donation));
        });

        if (emptyState) {
            emptyState.hidden = filtered.length !== 0;
        }

        updateShowMoreButton(filtered.length);
        updateDonationStats();

        isFirstRender = false;
    }

    /* ---------------------------------------------------------
       3. Show More / Show Less
    --------------------------------------------------------- */
    function updateShowMoreButton(totalFiltered) {
        if (!showMoreBtn) return;

        if (totalFiltered <= PAGE_SIZE) {
            showMoreBtn.hidden = true;
            return;
        }

        showMoreBtn.hidden = false;
        showMoreBtn.textContent = visibleLimit >= totalFiltered ? "عرض أقل" : "عرض المزيد";
    }

    if (showMoreBtn) {
        showMoreBtn.addEventListener("click", function () {
            const filtered = getFilteredDonations();

            if (visibleLimit >= filtered.length) {
                visibleLimit = PAGE_SIZE;
            } else {
                visibleLimit = Math.min(visibleLimit + PAGE_SIZE, filtered.length);
            }

            renderDonations();
        });
    }

    /* ---------------------------------------------------------
       4. Statistics (calculated from the shared donation data)
    --------------------------------------------------------- */
    function setStat(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.dataset.target = value;
        el.textContent = value.toLocaleString("en-US");
    }

    function updateDonationStats() {
        if (!store || typeof store.computeStats !== "function") return;
        const stats = store.computeStats();
        setStat("totalDonations", stats.total);
        setStat("availableDonations", stats.available);
        setStat("distributedDonations", stats.distributed);
    }

    /* ---------------------------------------------------------
       5. Filter & Reset Controls
    --------------------------------------------------------- */
    function applyFilters() {
        visibleLimit = PAGE_SIZE;
        renderDonations();
    }

    function resetAllFilters() {
        if (searchInput) searchInput.value = "";
        if (categorySelect) categorySelect.value = "";
        if (locationSelect) locationSelect.value = "";
        if (statusSelect) statusSelect.value = "";
        applyFilters();
        if (searchInput) searchInput.focus();
    }

    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    if (searchInput) {
        searchInput.addEventListener("input", debounce(applyFilters, 150));
    }
    if (categorySelect) categorySelect.addEventListener("change", applyFilters);
    if (locationSelect) locationSelect.addEventListener("change", applyFilters);
    if (statusSelect) statusSelect.addEventListener("change", applyFilters);
    if (resetBtn) resetBtn.addEventListener("click", resetAllFilters);
    if (emptyResetBtn) emptyResetBtn.addEventListener("click", resetAllFilters);

    /* ---------------------------------------------------------
       6. Slide-Over Details Drawer
    --------------------------------------------------------- */
    function openDrawer(card, triggerBtn) {
        if (!drawer || !backdrop) return;
        lastFocusedElement = triggerBtn;

        const data = card.dataset;

        if (drawerItemId) drawerItemId.textContent = data.id || "DON-0000";
        if (drawerItemTitle) drawerItemTitle.textContent = data.title || "تفاصيل التبرع";
        if (drawerItemDesc) drawerItemDesc.textContent = data.desc || "لا يوجد وصف إضافي متوفر.";
        if (drawerItemCategory) drawerItemCategory.textContent = data.category || "—";
        if (drawerItemCondition) drawerItemCondition.textContent = data.condition || "حالة قياسية";
        if (drawerItemQty) drawerItemQty.textContent = data.qty || "—";
        if (drawerItemWarehouse) drawerItemWarehouse.textContent = data.warehouse || "المخزن العام";
        if (drawerItemDate) drawerItemDate.textContent = data.date || "—";
        if (drawerItemDonor) drawerItemDonor.textContent = data.donor || "فاعل خير";
        if (drawerItemTarget) drawerItemTarget.textContent = data.target || "حسب أولويات التوزيع المعتمدة";

        if (drawerItemStatus) {
            drawerItemStatus.textContent = data.status || "متاح";
            drawerItemStatus.className = `status-badge ${data.status === "قيد التوزيع" ? "st-progress" : "st-available"}`;
        }

        backdrop.classList.add("active");
        backdrop.setAttribute("aria-hidden", "false");

        drawer.classList.add("active");
        drawer.setAttribute("aria-hidden", "false");
        document.body.classList.add("no-scroll");

        setTimeout(() => {
            if (drawerCloseBtn) drawerCloseBtn.focus();
        }, 50);
    }

    function closeDrawer() {
        if (!drawer || !backdrop) return;

        backdrop.classList.remove("active");
        backdrop.setAttribute("aria-hidden", "true");

        drawer.classList.remove("active");
        drawer.setAttribute("aria-hidden", "true");
        document.body.classList.remove("no-scroll");

        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus();
        }
    }

    // Event delegation: a single listener on the grid covers all cards,
    // including cards rendered dynamically from the shared data source.
    grid.addEventListener("click", function (e) {
        const detailBtn = e.target.closest(".don-detail-btn");

        if (!detailBtn) return;

        const card = detailBtn.closest(".don-card");

        if (card) {
            e.preventDefault();
            openDrawer(card, detailBtn);
        }
    });

    if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
    if (drawerDismissBtn) drawerDismissBtn.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && drawer && drawer.classList.contains("active")) {
            closeDrawer();
        }
    });

    // Allocate button feedback
    if (drawerAllocateBtn) {
        drawerAllocateBtn.addEventListener("click", function () {
            const id = drawerItemId ? drawerItemId.textContent : "";
            const title = drawerItemTitle ? drawerItemTitle.textContent : "";
            const toast = document.getElementById("toast");
            if (toast) {
                toast.querySelector("span").textContent = `تم فتح نموذج التخصيص للمستفيد: ${title} (${id})`;
                toast.classList.add("show");
                setTimeout(() => toast.classList.remove("show"), 3500);
            }
            closeDrawer();
        });
    }

    /* ---------------------------------------------------------
       7. Public API (used by the Add Donation modal)
    --------------------------------------------------------- */
    window.SANADDonations = window.SANADDonations || {};
    window.SANADDonations.applyFilters = applyFilters;

    // Initial render
    renderDonations();
    loadServerDonations();
})();

/* ==========================================================================
   SANAD — Add Donation Modal
   ========================================================================== */

(function () {
    const modal = document.getElementById("addDonationModal");
    const backdrop = document.getElementById("addDonationModalBackdrop");
    const openBtn = document.getElementById("addDonationBtn");
    const closeBtn = document.getElementById("addDonationCloseBtn");
    const cancelBtn = document.getElementById("addDonationCancelBtn");
    const form = document.getElementById("addDonationForm");

    const nameInput = document.getElementById("donationName");
    const donorInput = document.getElementById("donorName");
    const categoryInput = document.getElementById("donationCategory");
    const qtyInput = document.getElementById("donationQty");
    const conditionInput = document.getElementById("donationCondition");
    const warehouseInput = document.getElementById("donationWarehouse");
    const dateInput = document.getElementById("donationDate");
    const descInput = document.getElementById("donationDesc");

    if (!modal || !backdrop) return;

    const BENEFICIARY_BLOCK_MESSAGE = "لا يمكنك تسجيل تبرع لأن حسابك مسجل كمستفيد، وليس كمتبرع.";

    function getCurrentRoleSync() {
        try {
            const stored = JSON.parse(localStorage.getItem("sanadUser") || "null");
            if (stored?.role) return stored.role;
        } catch { }
        return null;
    }

    let currentRole = getCurrentRoleSync();

    async function refreshCurrentRole() {
        try {
            const response = await fetch("/api/auth/me", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!response.ok) throw new Error("UNAUTHENTICATED");
            const payload = await response.json();
            const user = payload.user || {};
            currentRole = user.role || null;
            localStorage.setItem("sanadUser", JSON.stringify({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            }));
        } catch {
            currentRole = null;
        }
        return currentRole;
    }

    refreshCurrentRole();

    function openModal() {
        backdrop.classList.add("active");
        backdrop.setAttribute("aria-hidden", "false");
        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("add-donation-modal-open");

        setTimeout(function () {
            if (nameInput) nameInput.focus();
        }, 50);
    }

    function closeModal() {
        backdrop.classList.remove("active");
        backdrop.setAttribute("aria-hidden", "true");
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("add-donation-modal-open");

        if (openBtn && typeof openBtn.focus === "function") {
            openBtn.focus();
        }
    }

    if (openBtn) {
        openBtn.addEventListener("click", function (e) {
            e.preventDefault();
            if (currentRole === "beneficiary") {
                showToast(BENEFICIARY_BLOCK_MESSAGE);
                return;
            }
            openModal();
        });
    }
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && modal.classList.contains("active")) {
            closeModal();
        }
    });

    function showToast(message) {
        const toast = document.getElementById("toast");
        if (!toast) return;
        toast.querySelector("span").textContent = message;
        toast.classList.add("show");
        setTimeout(function () {
            toast.classList.remove("show");
        }, 3500);
    }

    const MONTHS_AR = [
        "يناير", "فبراير", "مارس", "أبريل",
        "مايو", "يونيو", "يوليو", "أغسطس",
        "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
    ];

    const LOCATIONS_AR = ["القاهرة", "الجيزة", "مدينة نصر", "العبور"];

    function formatDate(value) {
        if (!value) return "";
        const parts = value.split("-");
        if (parts.length !== 3) return value;
        const day = parseInt(parts[2], 10);
        const month = parseInt(parts[1], 10);
        const year = parts[0];
        if (!day || !month) return value;
        return `${day} ${MONTHS_AR[month - 1] || ""} ${year}`;
    }

    function detectLocation(value) {
        if (!value) return "القاهرة";
        for (const loc of LOCATIONS_AR) {
            if (value.indexOf(loc) !== -1) return loc;
        }
        return "القاهرة";
    }

    if (form) {
        form.addEventListener("submit", async function (e) {
            e.preventDefault();

            if (currentRole === "beneficiary") {
                showToast(BENEFICIARY_BLOCK_MESSAGE);
                return;
            }

            if (!currentRole) {
                await refreshCurrentRole();
                if (currentRole === "beneficiary") {
                    showToast(BENEFICIARY_BLOCK_MESSAGE);
                    return;
                }
            }

            if (!nameInput || !nameInput.value.trim()) {
                if (nameInput) nameInput.focus();
                showToast("يرجى إدخال اسم التبرع");
                return;
            }

            const qty = qtyInput ? qtyInput.value.trim() : "";
            if (qty && (isNaN(Number(qty)) || Number(qty) < 0)) {
                if (qtyInput) qtyInput.focus();
                showToast("يرجى إدخال كمية صحيحة");
                return;
            }

            const warehouse = warehouseInput ? warehouseInput.value.trim() : "";
            const date = dateInput ? dateInput.value : "";
            const category = categoryInput && categoryInput.value ? categoryInput.value : "أخرى";
            const condition = conditionInput && conditionInput.value ? conditionInput.value : "حالة قياسية";

            const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" });
            if (!csrfResponse.ok) {
                showToast("يجب تسجيل الدخول لإضافة تبرع.");
                return;
            }
            const { csrfToken } = await csrfResponse.json();
            const response = await fetch("/api/donations", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify({
                    title: nameInput.value.trim(),
                    description: descInput ? descInput.value.trim() : "",
                    category,
                    quantity: Number(qty),
                    unit: "قطعة",
                    condition,
                    warehouse: warehouse || "المخزن العام",
                    location: detectLocation(warehouse),
                }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                showToast(payload.message || "تعذر إرسال طلب التبرع.");
                return;
            }

            showToast("تم إرسال طلب إضافة التبرع وبانتظار موافقة المسؤول.");

            form.reset();
            closeModal();
            loadServerDonations();
        });
    }
})();
