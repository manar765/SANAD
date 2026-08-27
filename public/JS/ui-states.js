(() => {
    const ICONS = {
        info: "fa-circle-info",
        success: "fa-circle-check",
        warning: "fa-triangle-exclamation",
        error: "fa-circle-exclamation"
    };

    function setLoading(element, isLoading, text = "جارٍ التحميل…") {
        if (!element) return;
        element.hidden = !isLoading;
        element.setAttribute("aria-busy", String(isLoading));
        const label = element.querySelector("[data-state-message]");
        if (label) label.textContent = text;
    }

    function setMessage(element, message, type = "info") {
        if (!element) return;
        element.hidden = !message;
        element.className = `ui-state ui-alert ${type}`;
        element.setAttribute("role", type === "error" ? "alert" : "status");
        const icon = element.querySelector("i");
        const label = element.querySelector("[data-state-message]");
        if (icon) icon.className = `fa-solid ${ICONS[type] || ICONS.info}`;
        if (label) label.textContent = message || "";
    }

    function setError(element, message, onRetry) {
        if (!element) return;
        element.hidden = false;
        element.className = "ui-state ui-error";
        element.setAttribute("role", "alert");
        const label = element.querySelector("[data-state-message]");
        if (label) label.textContent = message;
        const retry = element.querySelector("[data-state-retry]");
        if (retry) {
            retry.hidden = typeof onRetry !== "function";
            retry.onclick = typeof onRetry === "function" ? onRetry : null;
        }
    }

    window.SANADUI = Object.freeze({ setLoading, setMessage, setError });
})();
