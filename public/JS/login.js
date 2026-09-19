feather.replace();

const form = document.getElementById('loginForm');
const email = document.getElementById('email');
const password = document.getElementById('password');
const emailError = document.getElementById('emailError');
const passwordError = document.getElementById('passwordError');
const togglePass = document.getElementById('togglePass');
const submitBtn = document.getElementById('submitBtn');
const rememberMe = document.getElementById('remember');
const mfaForm = document.getElementById('mfaLoginForm');
const mfaCode = document.getElementById('mfaLoginCode');
const mfaError = document.getElementById('mfaLoginError');
let mfaChallengeToken = '';

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
                rememberMe: rememberMe?.checked === true,
            }),
        });

        const payload = await response.json();

        if (response.status === 202 && payload.mfaRequired) {
            mfaChallengeToken = payload.challengeToken;
            form.hidden = true;
            mfaForm.hidden = false;
            mfaCode.focus();
            return;
        }

        if (!response.ok) {
            const unverifiedBox = document.getElementById('unverifiedAlert');
            const unverifiedMsg = document.getElementById('unverifiedMsg');
            const goToVerifyBtn = document.getElementById('goToVerifyBtn');
            const loginResendBtn = document.getElementById('loginResendBtn');

            if (payload.emailUnverified) {
                if (unverifiedBox) {
                    unverifiedBox.style.display = 'block';
                    if (unverifiedMsg) unverifiedMsg.textContent = payload.message || 'بريدك الإلكتروني بحاجة إلى تفعيل قبل تسجيل الدخول.';
                    const targetEmail = payload.email || email.value.trim();
                    if (goToVerifyBtn) goToVerifyBtn.href = `/verify-email?email=${encodeURIComponent(targetEmail)}`;

                    if (loginResendBtn) {
                        loginResendBtn.onclick = async () => {
                            loginResendBtn.disabled = true;
                            loginResendBtn.textContent = 'جارٍ الإرسال...';
                            try {
                                const res = await fetch('/api/auth/resend-verification', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ email: targetEmail })
                                });
                                const resData = await res.json();
                                alert(resData.message || 'تم إرسال رمز التفعيل الجديد إلى بريدك.');
                            } catch {
                                alert('تعذر الاتصال بالخادم لإعادة الإرسال.');
                            } finally {
                                loginResendBtn.textContent = 'إعادة إرسال الرمز';
                                loginResendBtn.disabled = false;
                            }
                        };
                    }
                }
                return;
            }

            password.classList.add('error');
            passwordError.textContent = payload.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
            passwordError.classList.add('show');
            return;
        }

        localStorage.setItem('sanadUser', JSON.stringify(payload.user || { role: payload.role, email: email.value.trim() }));
        window.location.assign(payload.role === 'admin' ? '/admin-requests' : '/');
    } catch {
        password.classList.add('error');
        passwordError.textContent = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
        passwordError.classList.add('show');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

mfaForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    mfaError.textContent = '';
    mfaError.classList.remove('show');
    try {
        const response = await fetch('/api/auth/mfa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode.value.trim() }),
        });
        const payload = await response.json();
        if (!response.ok) {
            mfaError.textContent = payload.message || 'رمز المصادقة غير صحيح.';
            mfaError.classList.add('show');
            return;
        }
        localStorage.setItem('sanadUser', JSON.stringify(payload.user || { role: payload.role, email: email.value.trim() }));
        window.location.assign(payload.role === 'admin' ? '/admin-requests' : '/');
    } catch {
        mfaError.textContent = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';
        mfaError.classList.add('show');
    }
});
