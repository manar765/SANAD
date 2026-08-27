(() => {
    const THEME_KEY = "sanadTheme";

    const currentTheme = () => localStorage.getItem(THEME_KEY) || "light";

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll("[data-theme-toggle]").forEach(button => {
            const isDark = theme === "dark";
            const label = isDark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن";
            button.setAttribute("aria-label", label);
            button.setAttribute("title", label);
            const icon = button.querySelector("i");
            if (icon) icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
        });
    }

    function addThemeControl() {
        const host = document.querySelector("[data-theme-host]") || document.querySelector(".nav-actions") || document.querySelector(".profile-nav") || document.body;
        if (host.querySelector("[data-theme-toggle]")) return;
        const controls = document.createElement("div");
        controls.className = "preference-controls";
        if (host === document.body) controls.classList.add("standalone-preferences");
        controls.innerHTML = `<button type="button" class="preference-btn" data-theme-toggle aria-label="التبديل إلى الوضع الداكن" title="التبديل إلى الوضع الداكن"><i class="fa-solid fa-moon" aria-hidden="true"></i></button>`;
        host.append(controls);
        controls.querySelector("[data-theme-toggle]").addEventListener("click", () => {
            const next = currentTheme() === "dark" ? "light" : "dark";
            localStorage.setItem(THEME_KEY, next);
            applyTheme(next);
        });
    }

    function init() {
        document.documentElement.dataset.theme = currentTheme();
        addThemeControl();
        applyTheme(currentTheme());
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
