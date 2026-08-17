feather.replace();

const form = document.getElementById('loginForm');
const email = document.getElementById('email');
const password = document.getElementById('password');
const emailError = document.getElementById('emailError');
const passwordError = document.getElementById('passwordError');
const togglePass = document.getElementById('togglePass');
const submitBtn = document.getElementById('submitBtn');

togglePass.addEventListener('click', () => {
    const isHidden = password.type === 'password';
    password.type = isHidden ? 'text' : 'password';
    togglePass.innerHTML = isHidden
        ? '<svg data-feather="eye-off"></svg>'
        : '<svg data-feather="eye"></svg>';
    feather.replace();
});

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validate() {
    let valid = true;

    if (!isValidEmail(email.value.trim())) {
        email.classList.add('error');
        emailError.classList.add('show');
        valid = false;
    } else {
        email.classList.remove('error');
        emailError.classList.remove('show');
    }

    if (password.value.length === 0) {
        password.classList.add('error');
        passwordError.classList.add('show');
        valid = false;
    } else {
        password.classList.remove('error');
        passwordError.classList.remove('show');
    }

    return valid;
}

[email, password].forEach(input => {
    input.addEventListener('input', () => {
        if (input.classList.contains('error')) validate();
    });
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email.value.trim(),
                password: password.value,
            }),
        });

        if (!response.ok) {
            password.classList.add('error');
            passwordError.textContent = 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
            passwordError.classList.add('show');
            return;
        }

        window.location.assign('/admin-requests');
    } catch {
        password.classList.add('error');
        passwordError.textContent = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
        passwordError.classList.add('show');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});
