import express from 'express';
import ssoAuthMiddleware from '../middleware/ssoAuthMiddleware.js';
import { verifyAccount, accountLinkToUser, accountName, getAccountToken, regenerateAccountToken, deleteAccount } from '../controllers/accountController.js';

const router = express.Router();

/**
 * POST /api/accounts/verify
 * Verify acctNo via Botamation platform API (GET /api/super/accounts/{acctNo}),
 * save account + generate API key, and optionally link to user.
 * @access  Public — userId is passed in the request body
 * @body    { acctNo: string, userId?: string, email?: string }
 */
router.post('/verify', verifyAccount);

/**
 * POST /api/accounts/link-user
 * Link an existing account to the authenticated user.
 * No external API call — uses provided data directly.
 * @access  Protected (SSO)
 * @body    flat: { acctNo, userId, name, email, role?, timezone?, profileImageUrl? }
 *          OR nested: { userId, userData: { acctNo, name, ... } }
 */
router.post('/link-user', ssoAuthMiddleware, accountLinkToUser);

/**
 * GET /api/accounts/user/:userId
 * @desc    Fetch all account names linked to a user
 * @access  Protected (SSO)
 */
router.get('/user/:userId', ssoAuthMiddleware, accountName);

/**
 * POST /api/accounts/token
 * Get the current API key for an account (masked by default).
 */
router.post('/token', ssoAuthMiddleware, getAccountToken);

/**
 * POST /api/accounts/token/regenerate
 * Regenerate the API key for an account.
 */
router.post('/token/regenerate', ssoAuthMiddleware, regenerateAccountToken);

/**
 * DELETE /api/accounts/:acctId/user/:userId
 * Delete an account and all associated data (AccountApiKey, UserAccount).
 * @access  Protected (SSO)
 */
router.delete('/:acctId/user/:userId', ssoAuthMiddleware, deleteAccount);

export default router;
