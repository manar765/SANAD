(() => {
    const disabledState = document.getElementById("mfaDisabledState");
    const setupState = document.getElementById("mfaSetupState");
    const enabledState = document.getElementById("mfaEnabledState");
    const status = document.getElementById("mfaStatus");
    const setStatus = (message, type = "") => { status.textContent = message; status.className = `profile-status ${type}`.trim(); };
    const csrf = async () => (await (await fetch("/api/auth/csrf", { credentials: "same-origin" })).json()).csrfToken;
    const request = async (url, options = {}) => {
        const token = await csrf();
        const response = await fetch(url, { ...options, credentials: "same-origin", headers: { Accept: "application/json", "X-CSRF-Token": token, ...(options.headers || {}) } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "تعذر تنفيذ العملية.");
        return payload;
    };
    const show = state => { disabledState.hidden = state !== "disabled"; setupState.hidden = state !== "setup"; enabledState.hidden = state !== "enabled"; };
    const load = async () => {
        try {
            const response = await fetch("/api/profile/mfa", { credentials: "same-origin", headers: { Accept: "application/json" } });
            const payload = await response.json();
            show(payload.enabled ? "enabled" : "disabled");
        } catch { setStatus("تعذر تحميل حالة المصادقة الثنائية.", "error"); }
    };
    document.getElementById("startMfaSetup")?.addEventListener("click", async () => {
        try {
            setStatus("جارٍ تجهيز المصادقة الثنائية…");
            const payload = await request("/api/profile/mfa/setup", { method: "POST" });
            document.getElementById("mfaSecret").textContent = payload.secret;
            document.getElementById("mfaUri").value = payload.otpauthUri;
            document.getElementById("mfaRecoveryCodes").textContent = payload.recoveryCodes.join("\n");
            document.getElementById("mfaSetupToken").value = payload.setupToken;
            show("setup"); setStatus("أدخل رمز التطبيق لتأكيد الإعداد.");
        } catch (error) { setStatus(error.message, "error"); }
    });
    document.getElementById("mfaEnableForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const payload = await request("/api/profile/mfa/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: document.getElementById("mfaCode").value, setupToken: document.getElementById("mfaSetupToken").value }) });
            show("enabled"); setStatus(payload.message, "success");
        } catch (error) { setStatus(error.message, "error"); }
    });
    document.getElementById("mfaDisableForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        if (!window.confirm("هل تريد تعطيل المصادقة الثنائية؟")) return;
        try {
            const payload = await request("/api/profile/mfa/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.getElementById("mfaDisablePassword").value }) });
            show("disabled"); setStatus(payload.message, "success"); event.target.reset();
        } catch (error) { setStatus(error.message, "error"); }
    });
    load();
})();
