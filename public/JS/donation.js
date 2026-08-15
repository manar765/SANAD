// SANAD — Donations page: search, filter & reset

(function () {
    const searchInput = document.getElementById("donSearch");
    const categorySelect = document.getElementById("filterCategory");
    const locationSelect = document.getElementById("filterLocation");
    const statusSelect = document.getElementById("filterStatus");
    const resetBtn = document.getElementById("resetFilters");
    const grid = document.getElementById("donGrid");
    const emptyState = document.getElementById("donEmpty");

    if (!searchInput || !grid) return;

    const cards = Array.from(grid.querySelectorAll(".don-card"));

    function matchesFilters(card) {
        const query = searchInput.value.trim().toLowerCase();
        const category = categorySelect.value;
        const location = locationSelect.value;
        const status = statusSelect.value;

        const title = (card.dataset.title || "").toLowerCase();
        const cardLocation = (card.dataset.location || "").toLowerCase();
        const haystack = `${title} ${cardLocation}`;

        if (query && !haystack.includes(query)) return false;
        if (category && card.dataset.category !== category) return false;
        if (location && card.dataset.location !== location) return false;
        if (status && card.dataset.status !== status) return false;

        return true;
    }

    function applyFilters() {
        let visible = 0;

        cards.forEach(function (card) {
            const show = matchesFilters(card);
            card.hidden = !show;
            if (show) visible += 1;
        });

        if (emptyState) {
            emptyState.hidden = visible !== 0;
        }
    }

    searchInput.addEventListener("input", applyFilters);
    categorySelect.addEventListener("change", applyFilters);
    locationSelect.addEventListener("change", applyFilters);
    statusSelect.addEventListener("change", applyFilters);

    if (resetBtn) {
        resetBtn.addEventListener("click", function () {
            searchInput.value = "";
            categorySelect.value = "";
            locationSelect.value = "";
            statusSelect.value = "";
            applyFilters();
        });
    }
})();
