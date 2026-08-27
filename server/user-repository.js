import pool from "./database/index.js";

const userColumns = `
  id, name, first_name, last_name, full_name, email, phone, role
`;

export async function createUserWithProfile({
    firstName,
    lastName,
    fullName,
    email,
    passwordHash,
    phone,
    role,
    donorType = "individual",
    organizationName = "",
}) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO users (name, first_name, last_name, full_name, email, password, password_hash, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${userColumns}`,
            [fullName, firstName, lastName, fullName, email, passwordHash, passwordHash, phone, role],
        );
        const user = result.rows[0];

        if (role === "donor") {
            await client.query(
                `INSERT INTO donor_profiles (user_id, donor_type, organization_name)
         VALUES ($1, $2, NULLIF($3, ''))`,
                [user.id, donorType, donorType === "organization" ? organizationName : ""],
            );
        } else {
            await client.query("INSERT INTO beneficiary_profiles (user_id) VALUES ($1)", [user.id]);
        }

        await client.query("COMMIT");
        return user;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
    }
}

export async function findUserByEmail(email) {
    const result = await pool.query(
        `SELECT id, name, first_name, last_name, full_name, email, password_hash, role,
            email_verified_at
     FROM users WHERE email = $1`,
        [email],
    );
    return result.rows[0] || null;
}

export async function findUserById(userId) {
    const result = await pool.query(
        `SELECT id, name, first_name, last_name, full_name, email, password_hash, role, email_verified_at
     FROM users WHERE id = $1`,
        [userId],
    );
    return result.rows[0] || null;
}

export async function findUserIdByEmail(email) {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    return result.rows[0]?.id || null;
}

export async function findUserProfileById(userId) {
    const result = await pool.query(
        `SELECT id, first_name, last_name, full_name, email, phone, role, email_verified_at
     FROM users WHERE id = $1`,
        [userId],
    );
    return result.rows[0] || null;
}

export async function updateUserProfile({ userId, firstName, lastName, fullName, phone }) {
    const result = await pool.query(
        `UPDATE users
     SET first_name = $1, last_name = $2, full_name = $3, name = $3, phone = $4
     WHERE id = $5
     RETURNING id, first_name, last_name, full_name, email, phone, role`,
        [firstName, lastName, fullName, phone || null, userId],
    );
    return result.rows[0] || null;
}

export async function findPasswordHashById(userId) {
    const result = await pool.query("SELECT password_hash, password FROM users WHERE id = $1", [userId]);
    return result.rows[0] || null;
}

export async function updateUserPassword(userId, passwordHash) {
    const result = await pool.query(
        "UPDATE users SET password_hash = $1, password = $1 WHERE id = $2 RETURNING id",
        [passwordHash, userId],
    );
    return result.rows[0] || null;
}

export async function createEmailVerificationToken(userId, tokenHash, expiresAt) {
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt],
    );
}

export async function consumeEmailVerificationToken(tokenHash) {
    const result = await pool.query(
        `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
        [tokenHash],
    );
    return result.rows[0]?.user_id || null;
}

export async function getUserMfa(userId) {
    const result = await pool.query(
        "SELECT user_id, secret_ciphertext, recovery_code_hashes, enabled_at FROM user_mfa WHERE user_id = $1",
        [userId],
    );
    return result.rows[0] || null;
}

export async function saveUserMfa(userId, secretCiphertext, recoveryCodeHashes, enabledAt = null) {
    const result = await pool.query(
        `INSERT INTO user_mfa (user_id, secret_ciphertext, recovery_code_hashes, enabled_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext,
       recovery_code_hashes = EXCLUDED.recovery_code_hashes, enabled_at = EXCLUDED.enabled_at, updated_at = NOW()
     RETURNING user_id, enabled_at`,
        [userId, secretCiphertext, recoveryCodeHashes, enabledAt],
    );
    return result.rows[0];
}

export async function disableUserMfa(userId) {
    const result = await pool.query("DELETE FROM user_mfa WHERE user_id = $1 RETURNING user_id", [userId]);
    return Boolean(result.rows[0]);
}

export async function consumeRecoveryCode(userId, codeHash) {
    const result = await pool.query(
        `UPDATE user_mfa
     SET recovery_code_hashes = array_remove(recovery_code_hashes, $2), updated_at = NOW()
     WHERE user_id = $1 AND $2 = ANY(recovery_code_hashes)
     RETURNING user_id`,
        [userId, codeHash],
    );
    return Boolean(result.rows[0]);
}

export async function createMfaChallenge(challengeHash, userId, rememberMe, expiresAt) {
    await pool.query("DELETE FROM mfa_challenges WHERE user_id = $1 OR expires_at <= NOW()", [userId]);
    await pool.query(
        `INSERT INTO mfa_challenges (challenge_hash, user_id, remember_me, expires_at)
     VALUES ($1, $2, $3, $4)`,
        [challengeHash, userId, rememberMe, expiresAt],
    );
}

export async function getMfaChallenge(challengeHash) {
    const result = await pool.query(
        "SELECT challenge_hash, user_id, remember_me, expires_at, attempts FROM mfa_challenges WHERE challenge_hash = $1",
        [challengeHash],
    );
    return result.rows[0] || null;
}

export async function incrementMfaChallengeAttempts(challengeHash) {
    const result = await pool.query(
        "UPDATE mfa_challenges SET attempts = attempts + 1 WHERE challenge_hash = $1 RETURNING attempts",
        [challengeHash],
    );
    return result.rows[0]?.attempts || 0;
}

export async function deleteMfaChallenge(challengeHash) {
    await pool.query("DELETE FROM mfa_challenges WHERE challenge_hash = $1", [challengeHash]);
}

export async function markEmailVerified(userId) {
    const result = await pool.query(
        `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW())
     WHERE id = $1
     RETURNING id, email_verified_at`,
        [userId],
    );
    return result.rows[0] || null;
}
