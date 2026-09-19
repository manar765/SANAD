const form = document.getElementById("signupForm");
const roleStep = document.getElementById("roleStep");
const formStep = document.getElementById("formStep");
const roleInput = document.getElementById("role");
const donorFields = document.getElementById("donorFields");
const beneficiaryFields = document.getElementById("beneficiaryFields");
const nationalId = document.getElementById("nationalId");
const organizationField = document.getElementById("organizationField");
const organizationName = document.getElementById("organizationName");
const submitBtn = document.getElementById("submitBtn");
const formError = document.getElementById("formError");
let selectedRole = "";

const DISPOSABLE_CLIENT_DOMAINS = new Set([
  "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
  "guerrillamail.com", "sharklasers.com", "yopmail.com", "throwawaymail.com",
  "fakeinbox.com", "getairmail.com", "dispostable.com", "mohmal.com",
  "dropmail.me", "maildrop.cc", "trashmail.com"
]);

function isClientValidEmail(value) {
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!regex.test(trimmed)) return false;
  const domain = trimmed.split("@")[1]?.toLowerCase();
  return !DISPOSABLE_CLIENT_DOMAINS.has(domain);
}

const fieldRules = [
  { input: document.getElementById("firstName"), error: document.getElementById("firstNameError"), valid: value => value.trim().length >= 2 },
  { input: document.getElementById("lastName"), error: document.getElementById("lastNameError"), valid: value => value.trim().length >= 2 },
  {
    input: document.getElementById("email"),
    error: document.getElementById("emailError"),
    valid: value => {
      const emailErr = document.getElementById("emailError");
      const trimmed = value.trim();
      const domain = trimmed.split("@")[1]?.toLowerCase();
      if (DISPOSABLE_CLIENT_DOMAINS.has(domain)) {
        emailErr.textContent = "عناوين البريد المؤقتة غير مسموحة.";
        return false;
      }
      emailErr.textContent = "أدخل بريدًا إلكترونيًا صحيحًا.";
      return isClientValidEmail(value);
    }
  },
  { input: document.getElementById("phone"), error: document.getElementById("phoneError"), valid: value => /^[+\d][\d\s()-]{7,19}$/.test(value.trim()) },
  { input: document.getElementById("password"), error: document.getElementById("passwordError"), valid: value => value.length >= 8 },
  { input: document.getElementById("confirmPassword"), error: document.getElementById("confirmPasswordError"), valid: value => value === document.getElementById("password").value && value.length > 0 },
  { input: document.getElementById("nationalId"), error: document.getElementById("nationalIdError"), valid: value => /^\d{14}$/.test(value.trim()) },
];

function setFieldState(rule) {
  const valid = rule.valid(rule.input.value);
  rule.input.classList.toggle("error", !valid);
  rule.error.classList.toggle("show", !valid);
  return valid;
}

function validate() {
  const rules = selectedRole === "beneficiary"
    ? fieldRules
    : fieldRules.filter(rule => rule.input.id !== "nationalId");
  const valid = rules.map(setFieldState).every(Boolean);
  const isOrganization = selectedRole === "donor" && document.querySelector('input[name="donorType"]:checked')?.value === "organization";
  const organizationValid = !isOrganization || organizationName.value.trim().length >= 2;
  organizationName.classList.toggle("error", !organizationValid);
  document.getElementById("organizationNameError").classList.toggle("show", !organizationValid);
  return valid && organizationValid;
}

function chooseRole(role) {
  selectedRole = role;
  roleInput.value = role;
  document.querySelectorAll(".role-card").forEach(card => {
    const active = card.dataset.role === role;
    card.classList.toggle("selected", active);
    card.setAttribute("aria-pressed", String(active));
  });
  document.getElementById("roleError").classList.remove("show");
  roleStep.classList.add("hidden");
  roleStep.setAttribute("aria-hidden", "true");
  formStep.classList.remove("hidden");
  formStep.setAttribute("aria-hidden", "false");
  const donor = role === "donor";
  document.getElementById("badgeText").textContent = donor ? "انضم كمتبرع" : "انضم كمستفيد";
  document.getElementById("formTitle").textContent = donor ? "إنشاء حساب متبرع" : "إنشاء حساب مستفيد";
  document.getElementById("formSubtitle").textContent = donor ? "أدخل بياناتك للبدء في تقديم الدعم." : "أدخل بياناتك للبدء في الاستفادة من الدعم.";
  document.querySelector(".btn-text").textContent = donor ? "إنشاء حساب متبرع" : "إنشاء حساب مستفيد";
  donorFields.classList.toggle("hidden", !donor);
  beneficiaryFields.classList.toggle("hidden", donor);
  nationalId.required = !donor;
  if (donor) {
    nationalId.value = "";
    nationalId.classList.remove("error");
    document.getElementById("nationalIdError").classList.remove("show");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".role-card").forEach(card => card.addEventListener("click", () => chooseRole(card.dataset.role)));
document.getElementById("backToRoles").addEventListener("click", () => {
  formStep.classList.add("hidden");
  formStep.setAttribute("aria-hidden", "true");
  roleStep.classList.remove("hidden");
  roleStep.setAttribute("aria-hidden", "false");
});

document.querySelectorAll('input[name="donorType"]').forEach(input => input.addEventListener("change", () => {
  const isOrganization = input.value === "organization" && input.checked;
  organizationField.classList.toggle("hidden", !isOrganization);
  organizationName.required = isOrganization;
  if (!isOrganization) {
    organizationName.value = "";
    organizationName.classList.remove("error");
    document.getElementById("organizationNameError").classList.remove("show");
  }
}));

document.querySelectorAll("[data-toggle-password]").forEach(button => button.addEventListener("click", () => {
  const input = document.getElementById(button.dataset.togglePassword);
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  button.innerHTML = `<svg data-feather="${isHidden ? "eye-off" : "eye"}"></svg>`;
  feather.replace();
}));

fieldRules.forEach(rule => rule.input.addEventListener("input", () => {
  if (rule.input.classList.contains("error")) setFieldState(rule);
  if (rule.input.id === "password" && document.getElementById("confirmPassword").value) setFieldState(fieldRules[5]);
}));

form.addEventListener("submit", async event => {
  event.preventDefault();
  formError.classList.remove("show");
  if (!selectedRole || !validate()) return;
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;
  const donorType = document.querySelector('input[name="donorType"]:checked')?.value;
  try {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: selectedRole,
        firstName: document.getElementById("firstName").value.trim(),
        lastName: document.getElementById("lastName").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        password: document.getElementById("password").value,
        nationalId: selectedRole === "beneficiary" ? nationalId.value.trim() : undefined,
        donorType: selectedRole === "donor" ? donorType : undefined,
        organizationName: selectedRole === "donor" && donorType === "organization" ? organizationName.value.trim() : undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      formError.textContent = payload.message || "تعذر إنشاء الحساب.";
      formError.classList.add("show");
      return;
    }
    const userEmail = document.getElementById("email").value.trim();
    if (payload.verificationRequired) {
      if (payload.otpCode) {
        sessionStorage.setItem("devOtpCode", payload.otpCode);
      }
      window.location.assign(`/verify-email?email=${encodeURIComponent(userEmail)}`);
    } else {
      window.location.assign("/donations");
    }
  } catch {
    formError.textContent = "تعذر الاتصال بالخادم. حاول مرة أخرى.";
    formError.classList.add("show");
  } finally {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }
});
