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

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    // placeholder for real auth request
    setTimeout(() => {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
        alert('تم تسجيل الدخول بنجاح ');
    }, 1200);
});