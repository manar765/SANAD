// ==========================================================================
// SANAD — Shared Donation Data Store
// One source of truth for donation data across pages, persisted in localStorage.
//
// Approval workflow:
//     User submits donation request  →  approvalStatus = "pending"
//     Admin approves                 →  approvalStatus = "approved"  (becomes public)
//     Admin rejects                  →  approvalStatus = "rejected" (never public)
//
// Public functionality (cards, search, filters, statistics, chart) uses ONLY
// donations with approvalStatus === "approved".
//
// Displayed statistics model:
//     Current Statistics = DEMO baseline + changes caused by APPROVED donations
//
// The demo/baseline numbers displayed in the project (e.g. Total = 1,256,
// Available = 845, Distributed = 411) are FAKE starting values and must stay
// as the baseline. They are captured once from the page and persisted, then
// only newly approved donations increment the relevant counters.
// ==========================================================================

(function () {
    const STORAGE_KEY = "sanad_donations";
    const ADDED_KEY = "sanad_added_donations";
    const BASELINE_KEY = "sanad_stats_baseline";
    const CHART_BASELINE_KEY = "sanad_chart_baseline";

    // Fallback values — these are the ACTUAL current demo numbers already
    // displayed in the project (Donations.html data-target attributes).
    const DEMO_BASELINE = {
        total: 1256,
        available: 845,
        distributed: 411,
        inProgress: 0
    };

    // Fallback chart heights — these are the ACTUAL current demo percentages
    // defined in style.css for the 8 chart bars.
    const DEMO_CHART = [50, 40, 83, 60, 77, 47, 63, 39];

    function readJSON(key) {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            // storage unavailable — keep working in memory for this session
        }
    }

    function readArray(key) {
        const parsed = readJSON(key);
        return Array.isArray(parsed) ? parsed : null;
    }

    // Legacy donation records (created before the approval workflow) have no
    // approvalStatus. They were previously public, so they default to approved.
    function normalize(donation) {
        if (donation && !donation.approvalStatus) {
            donation.approvalStatus = "approved";
        }
        return donation;
    }

    function toDonation(card) {
        const d = card.dataset;
        return {
            id: d.id || "DON-0000",
            title: d.title || "",
            desc: d.desc || "",
            category: d.category || "أخرى",
            location: d.location || "",
            status: d.status || "متاح",
            condition: d.condition || "",
            qty: d.qty || "",
            warehouse: d.warehouse || "",
            date: d.date || "",
            donor: d.donor || "",
            target: d.target || "",
            approvalStatus: "approved"
        };
    }

    function seedFromDom() {
        const cards = Array.from(document.querySelectorAll("#donGrid .don-card"));
        if (!cards.length) return null;
        const donations = cards.map(toDonation);
        writeJSON(STORAGE_KEY, donations);
        return donations;
    }

    // Unified array = sample cards + all submitted requests (any approval
    // status). Used for rendering and id generation.
    function getDonations() {
        const existing = readArray(STORAGE_KEY);
        if (existing) {
            existing.forEach(normalize);
            return existing;
        }
        const seeded = seedFromDom();
        if (seeded) return seeded;
        return [];
    }

    // Public donations = ONLY approved ones. Everything public must use this.
    function getPublicDonations() {
        return getDonations().filter(function (d) {
            return d.approvalStatus === "approved";
        });
    }

    function countByStatus(donations, status) {
        return donations.filter(function (d) { return d.status === status; }).length;
    }

    function readNumberFrom(selector, attr) {
        const el = document.querySelector(selector);
        if (!el) return null;
        const raw = attr ? el.getAttribute(attr) : el.textContent;
        const num = parseInt(String(raw || "").replace(/[^0-9]/g, ""), 10);
        return isNaN(num) ? null : num;
    }

    // ------------------------------------------------------------------
    // Baseline statistics
    // Captured ONCE from the numbers already displayed in the project.
    // ------------------------------------------------------------------

    function getBaselineStats() {
        const stored = readJSON(BASELINE_KEY);
        if (stored && stored.total) return stored;

        let total = readNumberFrom("#totalDonations", "data-target");
        if (total === null) total = readNumberFrom("#dashboardDonations", null);
        if (total === null) total = DEMO_BASELINE.total;

        let available = readNumberFrom("#availableDonations", "data-target");
        if (available === null) available = DEMO_BASELINE.available;

        let distributed = readNumberFrom("#distributedDonations", "data-target");
        if (distributed === null) distributed = DEMO_BASELINE.distributed;

        const baseline = {
            total: total,
            available: available,
            distributed: distributed,
            inProgress: DEMO_BASELINE.inProgress
        };

        writeJSON(BASELINE_KEY, baseline);
        return baseline;
    }

    // ------------------------------------------------------------------
    // Submitted donation requests
    // Every user submission is stored here with an approvalStatus. Only
    // "approved" requests contribute to statistics and public data.
    // ------------------------------------------------------------------

    function getAddedDonations() {
        const existing = readArray(ADDED_KEY);
        if (existing) {
            existing.forEach(normalize);
            return existing;
        }

        // One-time migration for existing localStorage state: anything in the
        // unified array that is NOT a current sample card was added by the user.
        const unified = readArray(STORAGE_KEY);
        const seedCards = Array.from(document.querySelectorAll("#donGrid .don-card"));
        let added = [];
        if (unified && seedCards.length) {
            const seedIds = new Set(seedCards.map(function (c) { return c.dataset.id; }));
            added = unified.filter(function (d) { return !seedIds.has(d.id); });
        }
        added.forEach(normalize);

        writeJSON(ADDED_KEY, added);
        return added;
    }

    function getApprovedAdded() {
        return getAddedDonations().filter(function (d) {
            return d.approvalStatus === "approved";
        });
    }

    // User submits a new donation → stored as a "pending" request.
    // It does NOT appear publicly and does NOT affect any statistic yet.
    function submitRequest(donation) {
        const request = Object.assign({}, donation, { approvalStatus: "pending" });

        const donations = getDonations();
        donations.unshift(request);
        writeJSON(STORAGE_KEY, donations);

        const added = getAddedDonations();
        added.unshift(request);
        writeJSON(ADDED_KEY, added);

        return request;
    }

    // Admin action: change a request's approvalStatus. When a request becomes
    // "approved" it immediately becomes public and starts affecting stats.
    function setApprovalStatus(id, status) {
        let updated = null;

        const donations = getDonations();
        donations.forEach(function (d) {
            if (d.id === id) {
                d.approvalStatus = status;
                updated = d;
            }
        });
        writeJSON(STORAGE_KEY, donations);

        const added = getAddedDonations();
        added.forEach(function (d) {
            if (d.id === id) d.approvalStatus = status;
        });
        writeJSON(ADDED_KEY, added);

        return updated;
    }

    function nextId() {
        const donations = getDonations();
        let max = 0;
        donations.forEach(function (d) {
            const num = parseInt(String(d.id || "").replace("DON-", ""), 10);
            if (!isNaN(num) && num > max) max = num;
        });
        return "DON-" + (max + 1);
    }

    // ------------------------------------------------------------------
    // Displayed statistics = baseline + changes from APPROVED donations
    // ------------------------------------------------------------------

    function computeStats() {
        const baseline = getBaselineStats();
        const approved = getApprovedAdded();
        return {
            total: baseline.total + approved.length,
            available: baseline.available + countByStatus(approved, "متاح"),
            inProgress: baseline.inProgress + countByStatus(approved, "قيد التوزيع"),
            distributed: baseline.distributed + countByStatus(approved, "تم التوزيع")
        };
    }

    const CHART_MONTHS = [
        "يناير", "فبراير", "مارس", "أبريل",
        "مايو", "يونيو", "يوليو", "أغسطس"
    ];

    // ------------------------------------------------------------------
    // Chart baseline
    // Captured ONCE from the demo percentages already displayed. Never
    // rebuilt from the donation cards.
    // ------------------------------------------------------------------

    function getChartBaseline() {
        const stored = readArray(CHART_BASELINE_KEY);
        if (stored) return stored;

        const bars = Array.from(document.querySelectorAll(".chart-bars .chart-bar"));
        if (bars.length === 8) {
            const plot = document.querySelector(".chart-plot");
            const plotHeight = plot ? plot.clientHeight : 0;
            if (plotHeight > 0) {
                const baseline = bars.map(function (bar) {
                    const px = parseFloat(window.getComputedStyle(bar).height) || 0;
                    return Math.min(100, Math.max(0, Math.round((px / plotHeight) * 100)));
                });
                writeJSON(CHART_BASELINE_KEY, baseline);
                return baseline;
            }
        }

        return DEMO_CHART;
    }

    function computeChartData() {
        const baseline = getChartBaseline();
        const counts = CHART_MONTHS.map(function () { return 0; });

        getApprovedAdded().forEach(function (d) {
            const date = String(d.date || "");
            CHART_MONTHS.forEach(function (month, index) {
                if (date.indexOf(month) !== -1) counts[index] += 1;
            });
        });

        return baseline.map(function (value, index) {
            return Math.min(100, Math.round(value + counts[index]));
        });
    }

    window.SANADDonationsStore = {
        STORAGE_KEY: STORAGE_KEY,
        ADDED_KEY: ADDED_KEY,
        getDonations: getDonations,
        getPublicDonations: getPublicDonations,
        getAddedDonations: getAddedDonations,
        submitRequest: submitRequest,
        setApprovalStatus: setApprovalStatus,
        nextId: nextId,
        computeStats: computeStats,
        computeChartData: computeChartData,
        CHART_MONTHS: CHART_MONTHS
    };
})();
