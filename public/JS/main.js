document.addEventListener("DOMContentLoaded", async () => {
    const navbar = document.getElementById("navbar");
    const navToggle = document.getElementById("navToggle");
    const progressBar = document.getElementById("progressBar");
    const backToTop = document.getElementById("backToTop");
    const toast = document.getElementById("toast");
    let toastTimer;

    const showToast = (message) => {
        const label = toast?.querySelector("span");
        if (!toast || !label) return;

        label.textContent = message;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
    };

    const closeMenu = () => {
        if (!navbar || !navToggle) return;
        navbar.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("no-scroll");
    };

    const updateScrollState = () => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;

        if (progressBar) progressBar.style.transform = `scaleX(${progress})`;
        if (backToTop) backToTop.classList.toggle("show", window.scrollY > 600);
    };

    window.addEventListener("scroll", updateScrollState, { passive: true });
    updateScrollState();

    backToTop?.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    navToggle?.addEventListener("click", () => {
        if (!navbar) return;
        const isOpen = navbar.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", String(isOpen));
        document.body.classList.toggle("no-scroll", isOpen);
    });

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (event) => {
            const selector = link.getAttribute("href");
            const target = selector && selector.length > 1 ? document.querySelector(selector) : null;
            if (!target) return;

            event.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            closeMenu();
        });
    });

    document.querySelectorAll(".placeholder").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            showToast(`قريباً … صفحة «${link.dataset.page || "هذه الخدمة"}» قيد الإعداد`);
        });
    });

    const revealElements = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("visible");
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.12 });
        revealElements.forEach((element) => revealObserver.observe(element));
    } else {
        revealElements.forEach((element) => element.classList.add("visible"));
    }

    const animateCounter = (element) => {
        const target = Number(element.dataset.target);
        if (!Number.isFinite(target)) return;

        const suffix = element.dataset.suffix || "";
        const start = performance.now();
        const duration = 1600;
        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = `${Math.round(target * eased).toLocaleString("en-US")}${suffix}`;
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    const counters = document.querySelectorAll(".stat-value[data-target]");
    if ("IntersectionObserver" in window) {
        const counterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.4 });
        counters.forEach((counter) => counterObserver.observe(counter));
    } else {
        counters.forEach(animateCounter);
    }

    const sections = document.querySelectorAll("section[id], footer[id]");
    const navLinks = document.querySelectorAll(".nav-link");

    const setPathActiveLink = () => {
        const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
        const hash = window.location.hash || "";
        navLinks.forEach((link) => {
            const hrefParts = String(link.getAttribute("href") || "").split("#");
            const linkPath = (hrefParts[0] || "").replace(/\/+$/, "") || "/";
            const linkHash = hrefParts[1] ? `#${hrefParts[1]}` : "";
            link.classList.toggle("active", linkPath === path && (linkHash ? linkHash === hash : !hash));
        });
    };

    const isHome = ["/", ""].includes((window.location.pathname || "/").replace(/\/+$/, ""));
    if (isHome && sections.length && "IntersectionObserver" in window) {
        const spyObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const activeHash = `#${entry.target.id}`;
                let hashMatched = false;
                navLinks.forEach((link) => {
                    const href = String(link.getAttribute("href") || "");
                    const hashIndex = href.indexOf("#");
                    if (hashIndex < 0) return;
                    const matches = href.slice(hashIndex) === activeHash;
                    hashMatched = hashMatched || matches;
                    link.classList.toggle("active", matches);
                });
                if (hashMatched) {
                    navLinks.forEach((link) => {
                        const href = String(link.getAttribute("href") || "");
                        if (href.indexOf("#") < 0) link.classList.remove("active");
                    });
                } else {
                    setPathActiveLink();
                }
            });
        }, { rootMargin: "-45% 0px -50% 0px" });
        sections.forEach((section) => spyObserver.observe(section));
    }

    const store = window.SANADDonationsStore;
    if (!store) return;

    const stats = store.computeStats();
    const donationCount = document.getElementById("dashboardDonations");
    if (donationCount) donationCount.textContent = `${stats.total.toLocaleString("en-US")}+`;

    const chartData = store.computeChartData();
    document.querySelectorAll(".chart-bars .chart-bar").forEach((bar, index) => {
        bar.style.height = `${chartData[index] || 0}%`;
    });
});
