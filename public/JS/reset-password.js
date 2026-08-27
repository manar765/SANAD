const resetForm = document.getElementById("resetPasswordForm");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const resetSubmit = document.getElementById("resetSubmit");
const resetStatus = document.getElementById("resetStatus");
const resetToken = new URLSearchParams(window.location.search).get("token") || "";

function showResetStatus(message, type = "success") {
    resetStatus.textContent = message;
    resetStatus.className = `form-status ${type}`;
}

resetForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!resetToken) {
        showResetStatus("رابط الاستعادة غير صالح أو منتهي.", "error");
        return;
    }
    if (newPassword.value.length < 8) {
        showResetStatus("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.", "error");
        return;
    }
    if (newPassword.value !== confirmPassword.value) {
        showResetStatus("تأكيد كلمة المرور غير متطابق.", "error");
        return;
    }

    resetSubmit.disabled = true;
    resetSubmit.classList.add("loading");
    try {
        const response = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: resetToken, newPassword: newPassword.value, confirmPassword: confirmPassword.value }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "تعذر تغيير كلمة المرور.");
        showResetStatus(payload.message || "تم تغيير كلمة المرور بنجاح.");
        resetForm.reset();
        setTimeout(() => window.location.assign("/login"), 1500);
    } catch (error) {
        showResetStatus(error.message, "error");
    } finally {
        resetSubmit.disabled = false;
        resetSubmit.classList.remove("loading");
    }
});
