import {
    consumeEmailVerificationToken,
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

export async function issueEmailVerificationToken(userId, tokenHash, expiresAt) {
    return createEmailVerificationToken(userId, tokenHash, expiresAt);
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
