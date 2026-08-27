import {
    createUserWithProfile,
    findPasswordHashById,
    findUserByEmail,
    findUserIdByEmail,
    findUserProfileById,
    updateUserPassword,
    updateUserProfile,
} from "./user-repository.js";

export async function registerUser(input) {
    return createUserWithProfile(input);
}

export async function authenticateUser(email) {
    return findUserByEmail(email);
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
