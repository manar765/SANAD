import dns from "node:dns/promises";

// Common disposable email domains list
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "yopmail.com",
  "yopmail.net",
  "cool.fr.nf",
  "jetable.fr.nf",
  "throwawaymail.com",
  "fakeinbox.com",
  "getairmail.com",
  "dispostable.com",
  "mohmal.com",
  "mohmal.in",
  "dropmail.me",
  "maildrop.cc",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "crazymailing.com",
  "tempr.email",
  "discard.email",
  "discardmail.com",
  "generator.email",
  "emailondeck.com",
  "inboxkitten.com",
  "mytemp.email",
  "fakemailgenerator.com",
  "burnermail.io",
  "tempinbox.com",
  "throwawayemailaddress.com",
  "trash-mail.at",
  "trash-mail.com",
  "wegwerfmail.de",
  "wegwerfmail.net",
]);

export const BYPASS_MX_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
  "invalid",
  "test",
]);

/**
 * Checks if an email address or domain is a reserved test domain (e.g. RFC 2606 example.com).
 */
export function isTestDomain(domainOrEmail) {
  if (!domainOrEmail || typeof domainOrEmail !== "string") return false;
  const domain = domainOrEmail.includes("@")
    ? domainOrEmail.split("@").pop().toLowerCase()
    : domainOrEmail.toLowerCase();
  return BYPASS_MX_DOMAINS.has(domain) || domain.endsWith(".example.com") || domain.endsWith(".test");
}

/**
 * Validates email format according to RFC 5322 rules and length boundaries.
 */
export function validateEmailFormat(email) {
  if (!email || typeof email !== "string") {
    return { valid: false, reason: "INVALID_FORMAT", message: "يرجى إدخال البريد الإلكتروني." };
  }

  const trimmed = email.trim();

  // Total email length must not exceed 254 chars (RFC 5321)
  if (trimmed.length === 0 || trimmed.length > 254) {
    return { valid: false, reason: "INVALID_LENGTH", message: "يجب ألا يتجاوز طول البريد الإلكتروني 254 حرفًا." };
  }

  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return { valid: false, reason: "INVALID_FORMAT", message: "صيغة البريد الإلكتروني غير صحيحة (يجب أن يحتوي على @)." };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  // Local part max 64 characters
  if (localPart.length > 64) {
    return { valid: false, reason: "LOCAL_PART_TOO_LONG", message: "اسم المستخدم في البريد الإلكتروني طويل جدًا (الحد الأقصى 64 حرفًا)." };
  }

  // Local part: no leading or trailing dots, no consecutive dots
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return { valid: false, reason: "INVALID_LOCAL_PART", message: "صيغة البريد الإلكتروني غير صحيحة (تحتوي على نقاط غير صالحة)." };
  }

  // RFC compliant standard pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, reason: "INVALID_FORMAT", message: "صيغة البريد الإلكتروني غير صحيحة." };
  }

  // Domain checks: must have at least one dot, TLD at least 2 chars
  const domainParts = domainPart.split(".");
  if (domainParts.length < 2) {
    return { valid: false, reason: "INVALID_DOMAIN", message: "نطاق البريد الإلكتروني غير مكتمل." };
  }

  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || !/^[a-zA-Z]{2,63}$/.test(tld)) {
    return { valid: false, reason: "INVALID_TLD", message: "امتداد نطاق البريد الإلكتروني غير صالح." };
  }

  return { valid: true, localPart, domainPart: domainPart.toLowerCase() };
}

/**
 * Checks whether an email belongs to a known temporary/disposable email service.
 */
export function isDisposableEmail(email) {
  if (!email || typeof email !== "string") return false;
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = email.slice(atIndex + 1).toLowerCase().trim();
  return DISPOSABLE_DOMAINS.has(domain);
}

// Well-known trusted mail providers (zero-latency instant verification)
export const KNOWN_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "aol.com",
]);

/**
 * Checks DNS MX records for the domain to ensure it is configured to receive emails.
 */
export async function checkDomainMx(domain, timeoutMs = 3500) {
  const normalizedDomain = String(domain || "").toLowerCase().trim();
  if (!normalizedDomain) {
    return { valid: false, reason: "EMPTY_DOMAIN", message: "نطاق البريد غير محدد." };
  }

  // Bypass checks for local and test domains
  if (
    BYPASS_MX_DOMAINS.has(normalizedDomain) ||
    normalizedDomain.endsWith(".test") ||
    normalizedDomain.endsWith(".example") ||
    normalizedDomain.endsWith(".local") ||
    normalizedDomain === "localhost"
  ) {
    return { valid: true, mxRecords: [{ exchange: "test-mx", priority: 10 }] };
  }

  // Instant validation for major recognized global mail providers
  if (KNOWN_EMAIL_DOMAINS.has(normalizedDomain)) {
    return { valid: true, mxRecords: [{ exchange: `mx.${normalizedDomain}`, priority: 10 }] };
  }

  async function resolveWithFallback(resolverInstance) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs);
    });
    const lookupPromise = resolverInstance.resolveMx(normalizedDomain);
    return Promise.race([lookupPromise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  try {
    let records;
    try {
      records = await resolveWithFallback(dns);
    } catch (primaryErr) {
      // If primary DNS refused connection (e.g. local 127.0.0.1 without DNS server), fallback to public resolvers (Google / Cloudflare)
      if (primaryErr.code === "ECONNREFUSED" || primaryErr.code === "ESERVFAIL" || primaryErr.message === "DNS_TIMEOUT") {
        const { Resolver } = await import("node:dns/promises");
        const fallbackResolver = new Resolver();
        fallbackResolver.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
        records = await resolveWithFallback(fallbackResolver);
      } else {
        throw primaryErr;
      }
    }

    // Filter valid MX (RFC 7505 Null MX uses exchange ".")
    const validRecords = Array.isArray(records)
      ? records.filter((r) => r && r.exchange && r.exchange !== "." && r.exchange.trim().length > 0)
      : [];

    if (validRecords.length === 0) {
      return {
        valid: false,
        reason: "NO_MX_RECORDS",
        message: "نطاق البريد الإلكتروني غير مهيأ لاستقبال الرسائل (لا توجد سجلات MX).",
      };
    }

    return { valid: true, mxRecords: validRecords };
  } catch (error) {
    if (error.code === "ENOTFOUND" || error.code === "ENODATA") {
      return {
        valid: false,
        reason: "DOMAIN_NOT_FOUND",
        message: "نطاق البريد الإلكتروني غير موجود أو لا يستقبل رسائل بريدية.",
      };
    }

    // If local network or DNS resolver has an infrastructure issue (e.g. offline, port 53 blocked, timeout)
    // We do NOT block legitimate registrations; we gracefully allow it and rely on the verification email / OTP.
    console.warn(`[email-validator] DNS MX lookup warning for domain ${normalizedDomain} (${error.code || error.message}) — proceeding gracefully.`);
    return {
      valid: true,
      warning: error.code || error.message,
    };
  }
}

/**
 * Complete email validation pipeline combining format, disposable checks, and MX lookup.
 */
export async function validateEmail(email, { checkMx = true, checkDisposable = true } = {}) {
  const formatCheck = validateEmailFormat(email);
  if (!formatCheck.valid) {
    return formatCheck;
  }

  if (checkDisposable && isDisposableEmail(email)) {
    return {
      valid: false,
      reason: "DISPOSABLE_EMAIL",
      message: "عناوين البريد الإلكتروني المؤقتة غير مسموحة. يرجى استخدام بريد إلكتروني حقيقي.",
    };
  }

  if (checkMx) {
    const mxCheck = await checkDomainMx(formatCheck.domainPart);
    if (!mxCheck.valid) {
      return mxCheck;
    }
  }

  return { valid: true, email: email.trim().toLowerCase(), domain: formatCheck.domainPart };
}
