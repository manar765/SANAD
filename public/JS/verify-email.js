document.addEventListener("DOMContentLoaded", () => {
  if (window.feather) {
    feather.replace();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token") || "";
  const emailParam = urlParams.get("email") || "";

  const tokenSection = document.getElementById("tokenSection");
  const otpSection = document.getElementById("otpSection");
  const tokenLoadingState = document.getElementById("tokenLoadingState");
  const tokenResultState = document.getElementById("tokenResultState");
  const tokenIcon = document.getElementById("tokenIcon");
  const tokenTitle = document.getElementById("tokenTitle");
  const tokenMessage = document.getElementById("tokenMessage");
  const tokenFallbackOtp = document.getElementById("tokenFallbackOtp");
  const switchToOtpBtn = document.getElementById("switchToOtpBtn");

  const verifyEmailInput = document.getElementById("verifyEmail");
  const otpBoxes = Array.from(document.querySelectorAll(".otp-box"));
  const otpForm = document.getElementById("otpForm");
  const verifyOtpBtn = document.getElementById("verifyOtpBtn");
  const otpAlert = document.getElementById("otpAlert");
  const resendBtn = document.getElementById("resendBtn");
  const countdownTimer = document.getElementById("countdownTimer");

  if (emailParam && verifyEmailInput) {
    verifyEmailInput.value = emailParam.trim();
  }

  function showAlert(message, type = "error") {
    if (!otpAlert) return;
    otpAlert.textContent = message;
    otpAlert.className = `alert-box show ${type}`;
  }

  function hideAlert() {
    if (!otpAlert) return;
    otpAlert.className = "alert-box";
  }

  // Handle token link verification if ?token=... is present
  if (token && /^[a-f0-9]{64}$/i.test(token)) {
    if (tokenSection) tokenSection.classList.remove("hidden");
    if (otpSection) otpSection.classList.add("hidden");

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (tokenLoadingState) tokenLoadingState.classList.add("hidden");
        if (tokenResultState) tokenResultState.classList.remove("hidden");

        if (ok) {
          if (tokenIcon) {
            tokenIcon.className = "state-icon success";
            tokenIcon.innerHTML = `<svg data-feather="check"></svg>`;
          }
          if (tokenTitle) tokenTitle.textContent = "تم تفعيل الحساب بنجاح!";
          if (tokenMessage) {
            tokenMessage.textContent =
              data.message || "تم التحقق من بريدك الإلكتروني. جاري نقلك إلى المنصة...";
          }
          setTimeout(() => {
            window.location.assign(data.redirectUrl || "/donations");
          }, 1500);
        } else {
          if (tokenIcon) {
            tokenIcon.className = "state-icon error";
            tokenIcon.innerHTML = `<svg data-feather="alert-circle"></svg>`;
          }
          if (tokenTitle) tokenTitle.textContent = "تعذر تفعيل الرابط";
          if (tokenMessage) {
            tokenMessage.textContent =
              data.message || "انتهت صلاحية هذا الرابط أو تم استخدامه مسبقًا.";
          }
          if (tokenFallbackOtp) tokenFallbackOtp.classList.remove("hidden");
        }
        if (window.feather) feather.replace();
      })
      .catch(() => {
        if (tokenLoadingState) tokenLoadingState.classList.add("hidden");
        if (tokenResultState) tokenResultState.classList.remove("hidden");
        if (tokenIcon) {
          tokenIcon.className = "state-icon error";
          tokenIcon.innerHTML = `<svg data-feather="wifi-off"></svg>`;
        }
        if (tokenTitle) tokenTitle.textContent = "خطأ في الاتصال";
        if (tokenMessage) {
          tokenMessage.textContent = "تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى لاحقًا.";
        }
        if (tokenFallbackOtp) tokenFallbackOtp.classList.remove("hidden");
        if (window.feather) feather.replace();
      });
  }

  // Development quick-testing banner
  const devOtp = sessionStorage.getItem("devOtpCode") || urlParams.get("otp") || "";
  if (devOtp && /^\d{6}$/.test(devOtp)) {
    const banner = document.getElementById("devOtpBanner");
    const valSpan = document.getElementById("devOtpValue");
    const fillBtn = document.getElementById("autoFillOtpBtn");
    if (banner && valSpan) {
      banner.style.display = "block";
      valSpan.textContent = devOtp;
      if (fillBtn) {
        fillBtn.onclick = () => {
          devOtp.split("").forEach((digit, i) => {
            if (otpBoxes[i]) {
              otpBoxes[i].value = digit;
              otpBoxes[i].classList.add("filled");
            }
          });
          otpBoxes[5]?.focus();
        };
      }
    }
  }

  switchToOtpBtn?.addEventListener("click", () => {
    if (tokenSection) tokenSection.classList.add("hidden");
    if (otpSection) otpSection.classList.remove("hidden");
    otpBoxes[0]?.focus();
  });

  // OTP Boxes logic: auto focus, typing, backspace, and paste
  otpBoxes.forEach((box, index) => {
    box.addEventListener("input", (e) => {
      const val = e.target.value.replace(/\D/g, "");
      box.value = val ? val[0] : "";
      box.classList.toggle("filled", Boolean(box.value));

      if (box.value && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
      }
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && index > 0) {
        otpBoxes[index - 1].focus();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData("text")
        .replace(/\D/g, "");
      if (!pasted) return;

      const digits = pasted.slice(0, 6).split("");
      digits.forEach((digit, i) => {
        if (otpBoxes[i]) {
          otpBoxes[i].value = digit;
          otpBoxes[i].classList.add("filled");
        }
      });

      const nextIndex = Math.min(digits.length, 5);
      otpBoxes[nextIndex]?.focus();
    });
  });

  function getOtpCode() {
    return otpBoxes.map((b) => b.value.trim()).join("");
  }

  // Submit OTP verification
  otpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const email = verifyEmailInput ? verifyEmailInput.value.trim() : "";
    const code = getOtpCode();

    if (!email) {
      showAlert("يرجى إدخال البريد الإلكتروني.");
      verifyEmailInput?.focus();
      return;
    }

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      showAlert("يرجى إدخال رمز التحقق المكون من 6 أرقام كاملاً.");
      const firstEmpty = otpBoxes.find((b) => !b.value.trim()) || otpBoxes[0];
      firstEmpty?.focus();
      return;
    }

    if (verifyOtpBtn) {
      verifyOtpBtn.classList.add("loading");
      verifyOtpBtn.disabled = true;
    }

    try {
      const response = await fetch("/api/auth/verify-email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });

      const payload = await response.json();

      if (response.ok) {
        showAlert("تم تفعيل بريدك الإلكتروني بنجاح! جاري نقلك إلى المنصة...", "success");
        sessionStorage.removeItem("devOtpCode");
        setTimeout(() => {
          window.location.assign(payload.redirectUrl || "/donations");
        }, 1200);
      } else {
        showAlert(payload.message || "رمز التحقق غير صحيح أو انتهت صلاحيته.", "error");
      }
    } catch {
      showAlert("تعذر الاتصال بالخادم. يرجى التأكد من اتصال الإنترنت والمحاولة ثانية.", "error");
    } finally {
      if (verifyOtpBtn) {
        verifyOtpBtn.classList.remove("loading");
        verifyOtpBtn.disabled = false;
      }
    }
  });

  // Resend OTP logic with cooldown
  let timerInterval = null;
  function startCooldown(seconds) {
    let remaining = seconds;
    if (resendBtn) resendBtn.disabled = true;
    if (countdownTimer) {
      countdownTimer.style.display = "inline";
      countdownTimer.textContent = `(متاح بعد ${remaining} ثانية)`;
    }

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (resendBtn) resendBtn.disabled = false;
        if (countdownTimer) countdownTimer.style.display = "none";
      } else if (countdownTimer) {
        countdownTimer.textContent = `(متاح بعد ${remaining} ثانية)`;
      }
    }, 1000);
  }

  resendBtn?.addEventListener("click", async () => {
    const email = verifyEmailInput ? verifyEmailInput.value.trim() : "";
    if (!email) {
      showAlert("يرجى إدخال البريد الإلكتروني لإعادة إرسال رمز التفعيل.");
      verifyEmailInput?.focus();
      return;
    }

    resendBtn.disabled = true;
    const originalText = resendBtn.textContent;
    resendBtn.textContent = "جارٍ الإرسال...";

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (res.ok) {
        showAlert("تم إرسال رمز ورابط تفعيل جديد إلى بريدك الإلكتروني.", "success");
        startCooldown(data.retryAfterSeconds || 60);
      } else if (res.status === 429) {
        showAlert(data.message || "يرجى الانتظار قبل محاولة إعادة الإرسال.", "error");
        startCooldown(data.retryAfterSeconds || 60);
      } else {
        showAlert(data.message || "تعذر إرسال رمز التفعيل.", "error");
        resendBtn.disabled = false;
      }
    } catch {
      showAlert("تعذر الاتصال بالخادم لإعادة الإرسال.", "error");
      resendBtn.disabled = false;
    } finally {
      resendBtn.textContent = originalText || "إعادة إرسال الرمز";
    }
  });
});
