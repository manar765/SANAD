(() => {
    const guestActions = document.getElementById("guestActions");
    const userActions = document.getElementById("userActions");
    const userName = document.getElementById("homeUserName");
    if (!guestActions || !userActions || !userName) return;

    const getStoredUser = () => {
        try { return JSON.parse(localStorage.getItem("sanadUser") || "null"); } catch { return null; }
    };
    const displayName = user => String(user?.name || user?.full_name || [user?.firstName || user?.first_name, user?.lastName || user?.last_name].filter(Boolean).join(" ") || user?.email || "صديق سند").trim();

    const applyRoleVisibility = role => {
        const isAdmin = role === "admin";
        document.documentElement.classList.toggle("role-admin", isAdmin);
        document.body.classList.toggle("role-admin", isAdmin);
        document.querySelectorAll('[data-role="admin"]').forEach(el => {
            if (isAdmin) {
                el.removeAttribute("hidden");
            } else {
                el.setAttribute("hidden", "hidden");
            }
        });
    };

    const showUser = user => {
        userName.textContent = displayName(user);
        guestActions.classList.add("hidden");
        userActions.classList.remove("hidden");
        applyRoleVisibility(user?.role);
    };
    const showGuest = () => {
        guestActions.classList.remove("hidden");
        userActions.classList.add("hidden");
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
