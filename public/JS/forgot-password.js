const recoveryForm = document.getElementById("forgotPasswordForm");
const recoveryEmail = document.getElementById("recoveryEmail");
const recoverySubmit = document.getElementById("recoverySubmit");
const recoveryStatus = document.getElementById("recoveryStatus");
const resetLinkPreview = document.getElementById("resetLinkPreview");
const resetLink = document.getElementById("resetLink");

function showRecoveryStatus(message, type = "success") {
    recoveryStatus.textContent = message;
    recoveryStatus.className = `form-status ${type}`;
}

recoveryForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const email = recoveryEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showRecoveryStatus("من فضلك أدخل بريدًا إلكترونيًا صحيحًا.", "error");
        return;
    }

    recoverySubmit.disabled = true;
    recoverySubmit.classList.add("loading");
    resetLinkPreview?.classList.add("hidden");
    try {
        const response = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });
        const payload = await response.json();
        showRecoveryStatus(payload.message || "تم إرسال الطلب.");
        if (payload.resetUrl && resetLink && resetLinkPreview) {
            resetLink.href = payload.resetUrl;
            resetLink.textContent = payload.resetUrl;
            resetLinkPreview.classList.remove("hidden");
        }
    } catch {
        showRecoveryStatus("تعذر الاتصال بالخادم. حاول مرة أخرى.", "error");
    } finally {
        recoverySubmit.disabled = false;
        recoverySubmit.classList.remove("loading");
    }
});
