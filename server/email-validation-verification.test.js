import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  validateEmailFormat,
  isDisposableEmail,
  checkDomainMx,
  validateEmail,
} from "./email-validator.js";
import pool from "./database/index.js";
import { migrate } from "./database/schema.js";
import {
  issueEmailVerificationToken,
  verifyEmailOtp,
  verifyEmailToken,
  registerUser,
  cleanupUnverifiedData,
} from "./user-service.js";
import { createHash } from "node:crypto";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

test("Email Validator — RFC format validation", () => {
  // Valid emails
  assert.equal(validateEmailFormat("user@example.com").valid, true);
  assert.equal(validateEmailFormat("ahmed.karam@domain.org").valid, true);
  assert.equal(validateEmailFormat("support+tag123@sanad.org").valid, true);
  assert.equal(validateEmailFormat("donor_2026@sub.domain.co").valid, true);

  // Invalid emails
  assert.equal(validateEmailFormat("").valid, false);
  assert.equal(validateEmailFormat("invalid-plain-text").valid, false);
  assert.equal(validateEmailFormat("user@").valid, false);
  assert.equal(validateEmailFormat("@domain.com").valid, false);
  assert.equal(validateEmailFormat("user@domain").valid, false);
  assert.equal(validateEmailFormat("user..name@domain.com").valid, false);
  assert.equal(validateEmailFormat(".user@domain.com").valid, false);
  assert.equal(validateEmailFormat("user.@domain.com").valid, false);
  assert.equal(validateEmailFormat("a".repeat(65) + "@domain.com").valid, false);
});

test("Email Validator — Disposable email detection", () => {
  // Disposable domains
  assert.equal(isDisposableEmail("fake123@mailinator.com"), true);
  assert.equal(isDisposableEmail("temp.user@tempmail.com"), true);
  assert.equal(isDisposableEmail("test@10minutemail.com"), true);
  assert.equal(isDisposableEmail("user@mohmal.com"), true);
  assert.equal(isDisposableEmail("anon@sharklasers.com"), true);
  assert.equal(isDisposableEmail("spam@guerrillamail.com"), true);
  assert.equal(isDisposableEmail("temp@yopmail.com"), true);

  // Legitimate domains
  assert.equal(isDisposableEmail("user@gmail.com"), false);
  assert.equal(isDisposableEmail("donor@sanad.org"), false);
  assert.equal(isDisposableEmail("admin@company.com.eg"), false);
  assert.equal(isDisposableEmail("test@example.com"), false);
});

test("Email Validator — DNS MX check", async () => {
  // Bypassed test domains should be valid
  const testDomainCheck = await checkDomainMx("example.com");
  assert.equal(testDomainCheck.valid, true);

  // Non-existent domains should fail
  const nonExistentCheck = await checkDomainMx("sanad-random-non-existent-domain-999xyz.org");
  assert.equal(nonExistentCheck.valid, false);
  assert.ok(["DOMAIN_NOT_FOUND", "NO_MX_RECORDS", "MX_LOOKUP_FAILED"].includes(nonExistentCheck.reason));
});

test("Email Validator — Full validation pipeline", async () => {
  // Disposable rejection
  const disposableRes = await validateEmail("bad@tempmail.com");
  assert.equal(disposableRes.valid, false);
  assert.equal(disposableRes.reason, "DISPOSABLE_EMAIL");

  // Invalid format rejection
  const badFormatRes = await validateEmail("not-an-email");
  assert.equal(badFormatRes.valid, false);

  // Valid email on test domain
  const validRes = await validateEmail("legit.donor@example.com");
  assert.equal(validRes.valid, true);
  assert.equal(validRes.domain, "example.com");
});

test("Email Verification — Dual verification (Token Link & 6-digit OTP)", async () => {
  const testSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testEmail = `verify.test.${testSuffix}@example.com`;

  // Register a test user
  const user = await registerUser({
    firstName: "تأكيد",
    lastName: "اختبار",
    fullName: "تأكيد اختبار",
    email: testEmail,
    passwordHash: "dummy-hash:dummy-salt",
    phone: "01099887766",
    role: "donor",
    donorType: "individual",
  });

  assert.ok(user.id, "User should be registered");

  // Generate token and OTP
  const token = "a1b2c3d4e5f6".repeat(5) + "1234";
  const otpCode = "789123";
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await issueEmailVerificationToken(
    user.id,
    hashToken(token),
    expiresAt,
    hashToken(otpCode)
  );

  // Verify with wrong OTP
  const wrongOtpResult = await verifyEmailOtp(testEmail, hashToken("000000"));
  assert.equal(wrongOtpResult, null, "Wrong OTP must fail");

  // Verify with correct OTP
  const validOtpResult = await verifyEmailOtp(testEmail, hashToken(otpCode));
  assert.ok(validOtpResult, "Correct OTP must succeed");
  assert.ok(validOtpResult.email_verified_at, "Email verified timestamp must be set");

  // Re-verifying used OTP must fail (single-use)
  const reusedOtpResult = await verifyEmailOtp(testEmail, hashToken(otpCode));
  assert.equal(reusedOtpResult, null, "Used OTP cannot be re-used");

  // Cleanup
  await pool.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => { });
});

test("Database Cleanup — Expired tokens and unverified accounts cleanup", async () => {
  const result = await cleanupUnverifiedData(48);
  assert.equal(typeof result.deletedTokens, "number");
  assert.equal(typeof result.deletedUsers, "number");
});

after(async () => {
  await pool.end();
});
