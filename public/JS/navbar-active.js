(() => {
    const getCurrentPath = () => (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    const getCurrentHash = () => window.location.hash || "";

    const parseHref = (href) => {
        const [pathPart, hashPart] = String(href || "").split("#");
        return {
            path: (pathPart || "").replace(/\/+$/, "") || "/",
            hash: hashPart ? `#${hashPart}` : "",
        };
    };

    const setActiveLink = () => {
        const currentPath = getCurrentPath();
        const currentHash = getCurrentHash();
        document.querySelectorAll(".nav-links .nav-link").forEach((link) => {
            const { path, hash } = parseHref(link.getAttribute("href"));
            const isActive = path === currentPath && (hash ? hash === currentHash : !currentHash);
            link.classList.toggle("active", isActive);
        });
    };

    const init = () => {
        setActiveLink();
        window.addEventListener("hashchange", setActiveLink);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();