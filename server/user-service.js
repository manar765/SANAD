import {
    consumeEmailVerificationToken,
    consumeEmailVerificationOtp,
    cleanupExpiredVerificationTokens,
    cleanupUnverifiedAccounts,
    consumeRecoveryCode,
    createMfaChallenge,
    deleteMfaChallenge,
    disableUserMfa,
    createEmailVerificationToken,
    createUserWithProfile,
    findPasswordHashById,
    findUserByEmail,
    findUserById,
    findUserIdByEmail,
    findUserProfileById,
    getMfaChallenge,
    getUserMfa,
    saveUserMfa,
    updateUserPassword,
    incrementMfaChallengeAttempts,
    markEmailVerified,
    updateUserProfile,
    listAllUsers,
    updateUserRole,
    updateAdminDatabasePermission,
} from "./user-repository.js";

export async function registerUser(input) {
    return createUserWithProfile(input);
}

export async function authenticateUser(email) {
    return findUserByEmail(email);
}

export async function authenticateUserById(userId) {
    return findUserById(userId);
}

export async function getUserIdByEmail(email) {
    return findUserIdByEmail(email);
}

export async function getUserProfile(userId) {
    return findUserProfileById(userId);
}

export async function editUserProfile(input) {
    return updateUserProfile(input);
}

export async function getUserPasswordRecord(userId) {
    return findPasswordHashById(userId);
}

export async function changeUserPassword(userId, passwordHash) {
    return updateUserPassword(userId, passwordHash);
}

export async function issueEmailVerificationToken(userId, tokenHash, expiresAt, otpHash = null) {
    return createEmailVerificationToken(userId, tokenHash, expiresAt, otpHash);
}

export async function getMfaSettings(userId) {
    return getUserMfa(userId);
}

export async function saveMfaSettings(userId, secretCiphertext, recoveryCodeHashes, enabledAt = null) {
    return saveUserMfa(userId, secretCiphertext, recoveryCodeHashes, enabledAt);
}

export async function removeMfaSettings(userId) {
    return disableUserMfa(userId);
}

export async function useRecoveryCode(userId, codeHash) {
    return consumeRecoveryCode(userId, codeHash);
}

export async function startMfaChallenge(challengeHash, userId, rememberMe, expiresAt) {
    return createMfaChallenge(challengeHash, userId, rememberMe, expiresAt);
}

export async function getChallenge(challengeHash) {
    return getMfaChallenge(challengeHash);
}

export async function countChallengeAttempt(challengeHash) {
    return incrementMfaChallengeAttempts(challengeHash);
}

export async function finishMfaChallenge(challengeHash) {
    return deleteMfaChallenge(challengeHash);
}

export async function verifyEmailToken(tokenHash) {
    const userId = await consumeEmailVerificationToken(tokenHash);
    if (!userId) return null;
    return markEmailVerified(userId);
}

export async function verifyEmailOtp(email, otpHash) {
    const record = await consumeEmailVerificationOtp(email, otpHash);
    if (!record?.user_id) return null;
    return markEmailVerified(record.user_id);
}

export async function cleanupUnverifiedData(olderThanHours = 48) {
    const deletedTokens = await cleanupExpiredVerificationTokens();
    const deletedUsers = await cleanupUnverifiedAccounts(olderThanHours);
    return { deletedTokens, deletedUsers };
}

export async function getAllUsers(filters) {
    return listAllUsers(filters);
}

export async function changeUserRole(targetUserId, newRole, adminUserId, adminUserEmail = "") {
    if (!["donor", "beneficiary", "admin"].includes(newRole)) {
        const error = new Error("INVALID_ROLE");
        error.code = "INVALID_ROLE";
        throw error;
    }
    const targetUser = await findUserById(targetUserId);
    if (!targetUser) {
        const error = new Error("USER_NOT_FOUND");
        error.code = "USER_NOT_FOUND";
        throw error;
    }
    if (newRole !== "admin") {
        if (adminUserId && Number(targetUserId) === Number(adminUserId)) {
            const error = new Error("CANNOT_DEMOTE_SELF");
            error.code = "CANNOT_DEMOTE_SELF";
            throw error;
        }
        if (adminUserEmail && String(targetUser.email).toLowerCase() === String(adminUserEmail).toLowerCase()) {
            const error = new Error("CANNOT_DEMOTE_SELF");
            error.code = "CANNOT_DEMOTE_SELF";
            throw error;
        }
    }
    const updated = await updateUserRole(targetUserId, newRole);
    return updated;
}

export async function changeAdminDatabasePermission(targetUserId, canClearDatabase, requesterUserId, requesterEmail = "", isRequesterSuperAdmin = false) {
    const defaultAdminEmail = (process.env.ADMIN_EMAIL || "admin@sanad.com").trim().toLowerCase();
    const isSuper = Boolean(isRequesterSuperAdmin || (requesterEmail && String(requesterEmail).trim().toLowerCase() === defaultAdminEmail));
    if (!isSuper) {
        const error = new Error("SUPER_ADMIN_REQUIRED");
        error.code = "SUPER_ADMIN_REQUIRED";
        throw error;
    }

    const targetUser = await findUserById(targetUserId);
    if (!targetUser) {
        const error = new Error("USER_NOT_FOUND");
        error.code = "USER_NOT_FOUND";
        throw error;
    }

    if (targetUser.role !== "admin") {
        const error = new Error("USER_NOT_ADMIN");
        error.code = "USER_NOT_ADMIN";
        throw error;
    }

    if (targetUser.is_super_admin || String(targetUser.email).trim().toLowerCase() === defaultAdminEmail) {
        const error = new Error("CANNOT_MODIFY_SUPER_ADMIN");
        error.code = "CANNOT_MODIFY_SUPER_ADMIN";
        throw error;
    }

    const updated = await updateAdminDatabasePermission(targetUserId, canClearDatabase);
    return updated;
}

export { markEmailVerified };


