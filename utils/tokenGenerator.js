import crypto from 'crypto';

/**
 * Generate a secure random API token for an account.
 * Returns a 64-character hex string.
 */
export const generateAccountToken = () => {
    return crypto.randomBytes(32).toString('hex');
};
