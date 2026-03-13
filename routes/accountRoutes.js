import express from 'express';
import { verifyAccount, accountLinkToUser, accountName, getAccountToken, regenerateAccountToken, deleteAccount } from '../controllers/accountController.js';

const router = express.Router();

/**
 * POST /verify — public, mounted separately in server.js without middleware
 */
router.post('/verify', verifyAccount);

/**
 * POST /link-user
 */
router.post('/link-user', accountLinkToUser);

/**
 * GET /user/:userId
 */
router.get('/user/:userId', accountName);

/**
 * POST /token
 */
router.post('/token', getAccountToken);

/**
 * POST /token/regenerate
 */
router.post('/token/regenerate', regenerateAccountToken);

/**
 * DELETE /:acctId/user/:userId
 */
router.delete('/:acctId/user/:userId', deleteAccount);

export default router;
