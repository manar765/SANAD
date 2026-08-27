document.addEventListener("DOMContentLoaded", async () => {
    const profileForm = document.getElementById("profileForm");
    const passwordForm = document.getElementById("passwordForm");
    const profileStatus = document.getElementById("profileStatus");
    const passwordStatus = document.getElementById("passwordStatus");

    const setStatus = (element, message, type = "") => {
        if (!element) return;
        element.textContent = message;
        element.className = `profile-status ${type}`.trim();
    };

    const getCsrfToken = async () => {
        const response = await fetch("/api/auth/csrf", { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("SESSION_EXPIRED");
        const payload = await response.json();
        return payload.csrfToken;
    };

    try {
        const response = await fetch("/api/profile", { credentials: "same-origin", headers: { Accept: "application/json" } });
        if (response.status === 401) {
            window.location.assign("/login?returnTo=%2Fprofile");
            return;
        }
        if (!response.ok) throw new Error("PROFILE_UNAVAILABLE");
        const { user } = await response.json();
        profileForm.elements.firstName.value = user.first_name || "";
        profileForm.elements.lastName.value = user.last_name || "";
        profileForm.elements.phone.value = user.phone || "";
        profileForm.elements.email.value = user.email || "";
        const displayName = document.getElementById("accountDisplayName");
        const accountRole = document.getElementById("accountRole");
        const accountEmail = document.getElementById("accountEmail");
        const accountPhone = document.getElementById("accountPhone");
        if (displayName) displayName.textContent = user.full_name || `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
        if (accountRole) accountRole.textContent = user.role === "admin" ? "مسؤول النظام" : user.role === "beneficiary" ? "مستفيد" : "متبرع";
        if (accountEmail) accountEmail.textContent = user.email || "—";
        if (accountPhone) accountPhone.textContent = user.phone || "لم تتم الإضافة بعد";
    } catch (error) {
        setStatus(profileStatus, error.message === "SESSION_EXPIRED" ? "انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى." : "تعذر تحميل بيانات الحساب.", "error");
    }

    const sessionsList = document.getElementById("sessionsList");
    const sessionsStatus = document.getElementById("sessionsStatus");
    const revokeOtherSessions = document.getElementById("revokeOtherSessions");

    const formatSessionDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "غير متاح" : date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
    };

    const renderSessions = sessions => {
        if (!sessionsList) return;
        sessionsList.replaceChildren();
        if (!sessions.length) {
            const empty = document.createElement("p");
            empty.className = "sessions-empty";
            empty.textContent = "لا توجد جلسات نشطة.";
            sessionsList.appendChild(empty);
            return;
        }
        sessions.forEach(session => {
            const item = document.createElement("article");
            item.className = `session-item${session.current ? " current" : ""}`;
            const icon = document.createElement("span");
            icon.className = "session-icon";
            icon.innerHTML = '<i class="fa-solid fa-desktop" aria-hidden="true"></i>';
            const details = document.createElement("div");
            details.className = "session-details";
            const title = document.createElement("strong");
            title.textContent = session.current ? "الجلسة الحالية" : "جلسة مسجلة الدخول";
            const metadata = document.createElement("span");
            metadata.textContent = `آخر نشاط: ${formatSessionDate(session.lastSeenAt)} — تنتهي: ${formatSessionDate(session.expiresAt)}`;
            details.append(title, metadata);
            const badge = document.createElement("span");
            badge.className = "session-badge";
            badge.textContent = session.rememberMe ? "تذكرني" : "جلسة عادية";
            item.append(icon, details, badge);
            sessionsList.appendChild(item);
        });
    };

    const loadSessions = async () => {
        if (!sessionsList) return;
        try {
            const response = await fetch("/api/auth/sessions", { credentials: "same-origin", headers: { Accept: "application/json" } });
            if (!response.ok) throw new Error("تعذر تحميل الجلسات.");
            const payload = await response.json();
            renderSessions(payload.sessions || []);
        } catch (error) {
            sessionsList.textContent = error.message;
        }
    };

    revokeOtherSessions?.addEventListener("click", async () => {
        revokeOtherSessions.disabled = true;
        setStatus(sessionsStatus, "جارٍ إنهاء الجلسات الأخرى…");
        try {
            const csrfToken = await getCsrfToken();
            const response = await fetch("/api/auth/sessions/revoke-others", {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json", "X-CSRF-Token": csrfToken },
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || "تعذر إنهاء الجلسات الأخرى.");
            setStatus(sessionsStatus, `تم إنهاء ${payload.revoked} جلسة أخرى.`, "success");
            await loadSessions();
        } catch (error) {
            setStatus(sessionsStatus, error.message, "error");
        } finally {
            revokeOtherSessions.disabled = false;
        }
    });

    await loadSessions();

    profileForm?.addEventListener("submit", async event => {
        event.preventDefault();
        setStatus(profileStatus, "جارٍ حفظ التعديلات…");
        const button = profileForm.querySelector("button[type=submit]");
        button.disabled = true;
        try {
            const csrfToken = await getCsrfToken();
            const response = await fetch("/api/profile", {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify({
                    firstName: profileForm.elements.firstName.value,
                    lastName: profileForm.elements.lastName.value,
                    phone: profileForm.elements.phone.value,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || "تعذر حفظ التعديلات.");
            profileForm.elements.firstName.value = payload.user.first_name;
            profileForm.elements.lastName.value = payload.user.last_name;
            const displayName = document.getElementById("accountDisplayName");
            const accountPhone = document.getElementById("accountPhone");
            if (displayName) displayName.textContent = payload.user.full_name;
            if (accountPhone) accountPhone.textContent = payload.user.phone || "لم تتم الإضافة بعد";
            setStatus(profileStatus, payload.message, "success");
        } catch (error) {
            setStatus(profileStatus, error.message === "SESSION_EXPIRED" ? "انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى." : error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    passwordForm?.addEventListener("submit", async event => {
        event.preventDefault();
        setStatus(passwordStatus, "جارٍ تغيير كلمة المرور…");
        const button = passwordForm.querySelector("button[type=submit]");
        button.disabled = true;
        try {
            const csrfToken = await getCsrfToken();
            const response = await fetch("/api/profile/password", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify({
                    currentPassword: passwordForm.elements.currentPassword.value,
                    newPassword: passwordForm.elements.newPassword.value,
                    confirmPassword: passwordForm.elements.confirmPassword.value,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || "تعذر تغيير كلمة المرور.");
            passwordForm.reset();
            setStatus(passwordStatus, payload.message, "success");
        } catch (error) {
            setStatus(passwordStatus, error.message === "SESSION_EXPIRED" ? "انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى." : error.message, "error");
        } finally {
            button.disabled = false;
        }
    });
});
