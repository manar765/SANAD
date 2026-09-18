/* ==========================================================================
   SANAD — My Donations Section (تبرعاتي)
   Renders ONLY the logged-in donor's own donations (real DB data) inside the
   Profile (لوحتي) page. The status comes from the backend /api/donations/my:
   Pending (قيد المراجعة) / Accepted (مقبول) / Rejected (مرفوض).
   ========================================================================== */

(function () {
    const section = document.getElementById("myDonationsSection");
    const list = document.getElementById("myDonationsList");
    const loading = document.getElementById("myDonationsLoading");
    const emptyState = document.getElementById("myDonationsEmpty");
    const errorState = document.getElementById("myDonationsError");
    const retryBtn = document.getElementById("myDonationsRetryBtn");

    if (!section || !list) return;

    const STATUS_CLASS = {
        pending: "st-progress",
        approved: "st-done",
        rejected: "st-rejected",
        in_progress: "st-progress",
        distributed: "st-done"
    };

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function getCurrentUser() {
        try {
            const response = await fetch("/api/auth/me", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!response.ok) return null;
            const payload = await response.json();
            const user = payload.user || null;
            if (user) {
                localStorage.setItem("sanadUser", JSON.stringify({
                    id: user.id,
                    name: user.name || user.email,
                    email: user.email,
                    role: user.role,
                }));
            }
            return user;
        } catch {
            try {
                return JSON.parse(localStorage.getItem("sanadUser") || "null");
            } catch {
                return null;
            }
        }
    }

    function renderMyDonations(donations) {
        if (!list) return;
        list.querySelectorAll(".req-item").forEach(el => el.remove());

        if (errorState) errorState.hidden = true;

        if (donations.length === 0) {
            if (emptyState) emptyState.removeAttribute("hidden");
            return;
        }
        if (emptyState) emptyState.setAttribute("hidden", "hidden");

        const fragment = document.createDocumentFragment();
        donations.forEach(donation => {
            const item = document.createElement("div");
            item.className = "req-item";

            const statusClass = STATUS_CLASS[donation.statusKey] || "st-gray";
            const meta = [
                donation.category,
                donation.qtyLabel,
                donation.location,
                donation.date,
                donation.desc
            ].filter(Boolean);

            item.innerHTML =
                `<span class="req-item-icon"><i class="fa-solid fa-hand-holding-heart" aria-hidden="true"></i></span>` +
                `<div class="req-item-main">` +
                `<p class="req-item-title">${escapeHtml(donation.title)}</p>` +
                `<div class="req-item-meta">` +
                `<span class="req-item-code">${escapeHtml(donation.referenceCode)}</span>` +
                meta.map(v => `<span>${escapeHtml(v)}</span>`).join("") +
                `</div>` +
                `</div>` +
                `<span class="req-item-status status-badge ${statusClass}">${escapeHtml(donation.status)}</span>`;

            fragment.appendChild(item);
        });
        list.appendChild(fragment);
    }

    async function loadMyDonations() {
        if (loading) loading.hidden = false;
        if (errorState) errorState.hidden = true;

        try {
            const response = await fetch("/api/donations/my", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!response.ok) throw new Error("FAILED");
            const payload = await response.json();
            renderMyDonations(Array.isArray(payload.donations) ? payload.donations : []);
        } catch {
            if (emptyState) emptyState.setAttribute("hidden", "hidden");
            if (errorState) {
                errorState.hidden = false;
                list.querySelectorAll(".req-item").forEach(el => el.remove());
            }
        } finally {
            if (loading) loading.hidden = true;
        }
    }

    if (retryBtn) retryBtn.addEventListener("click", loadMyDonations);

    async function init() {
        const user = await getCurrentUser();
        if (!user || user.role !== "donor") {
            section.hidden = true;
            return;
        }
        section.hidden = false;
        loadMyDonations();
    }

    init();
})();