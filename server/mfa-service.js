import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;

function encryptionKey() {
    const raw = process.env.MFA_ENCRYPTION_KEY;
    if (!raw) throw new Error("MFA_ENCRYPTION_KEY is not configured.");
    return createHash("sha256").update(raw).digest();
}

function base32Encode(buffer) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let buffer = 0;
    const bytes = [];
    for (const character of String(value).toUpperCase().replace(/=+$/, "")) {
        const index = alphabet.indexOf(character);
        if (index < 0) throw new Error("Invalid TOTP secret.");
        buffer = (buffer << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((buffer >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

export function createTotpSecret() {
    return base32Encode(randomBytes(20));
}

export function createOtpAuthUri(secret, email) {
    const issuer = "SANAD";
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function encryptSecret(secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload) {
    const [ivEncoded, tagEncoded, encryptedEncoded] = String(payload).split(".");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function createTotpCode(secret, timestamp = Date.now()) {
    const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
    return String(binary).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(secret, code, timestamp = Date.now()) {
    const normalized = String(code || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(normalized)) return false;
    for (const drift of [-1, 0, 1]) {
        const expected = createTotpCode(secret, timestamp + drift * TOTP_STEP_SECONDS * 1000);
        const expectedBuffer = Buffer.from(expected);
        const actualBuffer = Buffer.from(normalized);
        if (timingSafeEqual(expectedBuffer, actualBuffer)) return true;
    }
    return false;
}

export function createRecoveryCodes(count = 8) {
    return Array.from({ length: count }, () => randomBytes(6).toString("hex").toUpperCase());
}

export function hashRecoveryCode(code) {
    return createHash("sha256").update(String(code).replace(/\s/g, "").toUpperCase()).digest("hex");
}

export function createChallenge() {
    const token = randomBytes(32).toString("hex");
    return { token, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS) };
}

export { MFA_MAX_ATTEMPTS };
