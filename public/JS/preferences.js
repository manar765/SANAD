(() => {
    const THEME_KEY = "sanadTheme";

    const currentTheme = () => {
        try {
            return localStorage.getItem(THEME_KEY) || "light";
        } catch {
            return "light";
        }
    };

    // Apply dataset attribute immediately to prevent white flash
    try {
        document.documentElement.dataset.theme = currentTheme();
    } catch { }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll("[data-theme-toggle]").forEach(button => {
            const isDark = theme === "dark";
            const label = isDark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن";
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            const icon = button.querySelector("i");
            if (icon) {
                icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
            }
        });
    }

    function addThemeControl() {
        const host = document.querySelector("[data-theme-host]") || document.querySelector(".nav-actions") || document.body;
        if (!host || host.querySelector("[data-theme-toggle]")) return;

        const controls = document.createElement("div");
        controls.className = "preference-controls";
        if (host === document.body) {
            controls.classList.add("standalone-preferences");
        }

        const isDark = currentTheme() === "dark";
        const label = isDark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن";
        const iconClass = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";

        controls.innerHTML = `<button type="button" class="preference-btn" data-theme-toggle aria-label="${label}" title="${label}"><i class="${iconClass}" aria-hidden="true"></i></button>`;
        host.append(controls);

        controls.querySelector("[data-theme-toggle]").addEventListener("click", () => {
            const next = currentTheme() === "dark" ? "light" : "dark";
            try {
                localStorage.setItem(THEME_KEY, next);
            } catch { }
            applyTheme(next);
        });
    }

    function init() {
        applyTheme(currentTheme());
        addThemeControl();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // Sync theme if changed in another tab/window
    window.addEventListener("storage", (e) => {
        if (e.key === THEME_KEY) {
            applyTheme(e.newValue || "light");
        }
    });
})();
