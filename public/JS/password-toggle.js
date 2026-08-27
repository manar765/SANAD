document.querySelectorAll("[data-password-toggle]").forEach(button => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;

    button.addEventListener("click", () => {
        const showPassword = input.type === "password";
        input.type = showPassword ? "text" : "password";
        const label = showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        const icon = button.querySelector("i");
        if (icon) icon.className = showPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    });
});
