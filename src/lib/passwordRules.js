/**
 * What a new password must be. Kept apart from password.js, which uses the
 * server's crypto, so the sign-in screens can check it before sending.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Why `password` cannot be used as a new password, or null if it can. */
export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
