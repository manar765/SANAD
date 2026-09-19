(function () {
    const layout = document.getElementById("adminLayout");
    const toggle = document.getElementById("adminSidebarToggle");
    const overlay = document.getElementById("adminSidebarOverlay");
    const sidebar = document.getElementById("adminSidebar");
    const collapse = document.getElementById("adminSidebarCollapse");
    if (!layout || !toggle || !overlay || !sidebar) return;

    const STORAGE_KEY = "sanad_admin_sidebar_collapsed";
    const mobileQuery = window.matchMedia("(max-width: 900px)");

    function isMobile() {
        return mobileQuery.matches;
    }

    function applyCollapsedState() {
        const collapsed = !isMobile() && localStorage.getItem(STORAGE_KEY) === "true";
        layout.classList.toggle("sidebar-collapsed", collapsed);
        if (collapse) {
            collapse.setAttribute("aria-expanded", String(!collapsed));
            collapse.setAttribute("aria-label", collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية");
            const label = collapse.querySelector("span");
            if (label) label.textContent = collapsed ? "توسيع القائمة" : "طي القائمة";
        }
    }

    function closeSidebar() {
        layout.classList.remove("sidebar-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("no-scroll");
    }

    toggle.addEventListener("click", function () {
        const notifDropdown = document.getElementById("headerNotificationDropdown");
        if (notifDropdown && notifDropdown.classList.contains("active")) {
            const notifBtn = document.getElementById("headerNotificationBtn");
            notifDropdown.classList.remove("active");
            notifDropdown.hidden = true;
            if (notifBtn) notifBtn.setAttribute("aria-expanded", "false");
        }

        const isOpen = layout.classList.toggle("sidebar-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        document.body.classList.toggle("no-scroll", isOpen);
        if (isOpen) {
            const firstLink = sidebar.querySelector(".admin-sidebar-link");
            if (firstLink) firstLink.focus();
        }
    });

    if (collapse) {
        collapse.addEventListener("click", function () {
            if (isMobile()) return;
            const collapsed = layout.classList.toggle("sidebar-collapsed");
            localStorage.setItem(STORAGE_KEY, String(collapsed));
            applyCollapsedState();
        });
    }

    overlay.addEventListener("click", closeSidebar);
    sidebar.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", closeSidebar);
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeSidebar();
    });
    mobileQuery.addEventListener("change", function () {
        closeSidebar();
        applyCollapsedState();
    });

    applyCollapsedState();
})();
