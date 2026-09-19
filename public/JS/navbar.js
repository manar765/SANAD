(() => {
    function initNavbar() {
        const navbar = document.getElementById("navbar");
        const navToggle = document.getElementById("navToggle");
        const navMenu = document.getElementById("navMenu");
        if (!navbar || !navToggle) return;

        // Prevent duplicate initialization
        if (navToggle.dataset.navInitialized) return;
        navToggle.dataset.navInitialized = "true";

        const openMenu = () => {
            const notifDropdown = document.getElementById("headerNotificationDropdown");
            if (notifDropdown && notifDropdown.classList.contains("active")) {
                const notifBtn = document.getElementById("headerNotificationBtn");
                notifDropdown.classList.remove("active");
                notifDropdown.hidden = true;
                if (notifBtn) notifBtn.setAttribute("aria-expanded", "false");
            }
            navbar.classList.add("open");
            navToggle.setAttribute("aria-expanded", "true");
            document.body.classList.add("no-scroll");
        };

        const closeMenu = () => {
            navbar.classList.remove("open");
            navToggle.setAttribute("aria-expanded", "false");
            document.body.classList.remove("no-scroll");
        };

        const toggleMenu = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const isOpen = navbar.classList.contains("open");
            if (isOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        };

        navToggle.addEventListener("click", toggleMenu);

        // Close on clicking links within navMenu
        navMenu?.addEventListener("click", (e) => {
            const link = e.target.closest("a");
            if (link) {
                closeMenu();
            }
        });

        // Close when clicking outside of the navbar
        document.addEventListener("click", (e) => {
            if (navbar.classList.contains("open") && !navbar.contains(e.target)) {
                closeMenu();
            }
        });

        // Close when pressing the Escape key
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && navbar.classList.contains("open")) {
                closeMenu();
                navToggle.focus();
            }
        });

        // Close when viewport is resized beyond mobile breakpoint
        window.addEventListener("resize", () => {
            if (window.innerWidth > 992 && navbar.classList.contains("open")) {
                closeMenu();
            }
        }, { passive: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initNavbar);
    } else {
        initNavbar();
    }
})();
