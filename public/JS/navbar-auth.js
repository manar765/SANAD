(() => {
    const guestActions = document.getElementById("guestActions");
    const userActions = document.getElementById("userActions");
    const userName = document.getElementById("homeUserName");
    const adminUserName = document.getElementById("adminUserName");
    const nameElement = userName || adminUserName;
    if (!nameElement) return;

    const getStoredUser = () => {
        try { return JSON.parse(localStorage.getItem("sanadUser") || "null"); } catch { return null; }
    };
    const displayName = user => String(user?.name || user?.full_name || [user?.firstName || user?.first_name, user?.lastName || user?.last_name].filter(Boolean).join(" ") || user?.email || "صديق سند").trim();

    const applyRoleVisibility = role => {
        const isAdmin = role === "admin";
        document.documentElement.classList.toggle("role-admin", isAdmin);
        document.body.classList.toggle("role-admin", isAdmin);
        document.documentElement.classList.toggle("role-beneficiary", role === "beneficiary");
        document.body.classList.toggle("role-beneficiary", role === "beneficiary");

        document.querySelectorAll("[data-role]").forEach(el => {
            const wanted = el.getAttribute("data-role");
            const visible = !!wanted && wanted === role;
            if (visible) {
                el.removeAttribute("hidden");
                el.style.display = "";
            } else {
                el.setAttribute("hidden", "hidden");
                el.style.display = "none";
            }
        });
    };

    const showUser = user => {
        const label = displayName(user);
        if (adminUserName) {
            const span = adminUserName.querySelector("span");
            const adminLabel = user?.role === "admin" ? "المشرف" : label;
            if (span) span.textContent = adminLabel;
            else adminUserName.textContent = adminLabel;
        } else if (nameElement) {
            nameElement.textContent = label;
        }
        if (guestActions) guestActions.classList.add("hidden");
        document.querySelectorAll(".user-actions").forEach(el => el.classList.remove("hidden"));
        applyRoleVisibility(user?.role);
    };
    const showGuest = () => {
        if (guestActions) guestActions.classList.remove("hidden");
        document.querySelectorAll(".user-actions").forEach(el => el.classList.add("hidden"));
        applyRoleVisibility(null);
    };

    const storedUser = getStoredUser();
    if (storedUser) {
        showUser(storedUser);
    } else {
        applyRoleVisibility(null);
    }

    fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(async response => {
            if (!response.ok) throw new Error("UNAUTHENTICATED");
            const payload = await response.json();
            const user = payload.user || {};
            localStorage.setItem("sanadUser", JSON.stringify({ id: user.id, name: displayName(user), email: user.email, role: user.role }));
            showUser(user);
        })
        .catch(() => {
            localStorage.removeItem("sanadUser");
            showGuest();
        })
        .finally(() => {
            document.body.classList.remove("auth-pending");
            document.body.classList.add("auth-ready");
        });
})();