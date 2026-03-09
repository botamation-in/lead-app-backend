import { verifyAccountServices, getAdminsService } from '../services/accountService.js';
import acctDataModel from '../models/accountModel.js';
import accountApiKeyModel from '../models/accountApiKeyModel.js';
import UserAccount from '../models/userAccountModel.js';
import { performUpsert, performGet, perfomDataExistanceCheck } from '../utils/dbHelpers.js';
import { generateAccountToken } from '../utils/tokenGenerator.js';
import logger from '../utils/logger.js';

/**
 * POST /itinerary/verifyAccount
 * Verify an account number against the Botamation platform API,
 * persist it locally, generate an API key, and optionally link to a user.
 */
export const verifyAccount = async (req, res) => {
    try {
        // userId can come from the request body (public endpoint — no SSO required)
        const { acctNo, userId, email } = req.body;

        if (!acctNo) {
            return res.status(400).json({ success: false, message: 'Account Number is required' });
        }

        // Call the Botamation platform API
        const response = await verifyAccountServices(acctNo);

        // Normalise the active field — handle '1', 1, true, 'true', 'active'
        const isActive = response.active === '1'
            || response.active === 1
            || response.active === true
            || String(response.active).toLowerCase() === 'true'
            || String(response.active).toLowerCase() === 'active';

        console.log('[verifyAccount] raw active value:', response.active, '→ isActive:', isActive);

        if (isActive) {
            try {
                const accountData = {
                    acctNo,
                    accountName: response.name || 'Unknown Account',
                    timezone: response.timezone || 'Asia/Calcutta'
                };

                // Upsert account record
                const upsertResult = await performUpsert(acctDataModel, { acctNo }, accountData);
                logger.info('Account created or updated', { acctNo, operation: 'createOrUpdateAccount', user: userId || null });

                let acctId = null;
                if (upsertResult.upsertedId) {
                    acctId = upsertResult.upsertedId;
                } else {
                    const acctInfo = await performGet(acctDataModel, { acctNo });
                    if (acctInfo?.success && acctInfo.data?.length > 0) {
                        acctId = acctInfo.data[0]._id;
                    }
                }

                // Get or create API key
                let apiKey = null;
                if (acctId) {
                    const existingToken = await perfomDataExistanceCheck(accountApiKeyModel, { acctId });
                    if (!existingToken) {
                        apiKey = generateAccountToken();
                        await performUpsert(accountApiKeyModel, { acctId }, { acctId, apiKey, name: 'Default API Key' });
                        logger.info('New API key created for account', { acctId, operation: 'createApiKey', user: userId || null });
                    } else {
                        const tokenDoc = await performGet(accountApiKeyModel, { acctId });
                        apiKey = tokenDoc?.data?.[0]?.apiKey || null;
                    }
                }

                // Link account to user if userId provided
                let linkedUser = null;
                if (userId && acctId) {
                    const alreadyLinked = await perfomDataExistanceCheck(UserAccount, { userId, acctId });
                    if (!alreadyLinked) {
                        await performUpsert(UserAccount, {}, {
                            userId,
                            acctId,
                            calendarIds: [],
                            canCreateCalendar: true,
                            role: 0
                        });
                        logger.info('Account linked to user', { acctNo, acctId, userId, operation: 'accountLinkedToUser' });
                    }
                    linkedUser = { userId };
                }

                return res.status(200).json({
                    success: true,
                    message: linkedUser
                        ? 'Account verified, saved successfully and linked to user'
                        : 'Account verified and saved successfully',
                    account: {
                        acctId,
                        acctNo,
                        name: accountData.accountName,
                        timezone: accountData.timezone,
                        active: true,
                        apiKey
                    },
                    linkedUser
                });
            } catch (dbError) {
                console.error('Error processing account data:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Account verified but failed to save to database or link to user',
                    error: dbError.message,
                    account: {
                        acctNo,
                        name: response.name || 'Unknown Account',
                        timezone: response.timezone,
                        active: isActive
                    }
                });
            }
        } else {
            console.error('verifyAccount: Account not active or not found:', acctNo, response);
            return res.status(404).json({
                success: false,
                message: 'Account not found or inactive',
                account: {
                    acctNo,
                    name: response.name || 'Unknown Account',
                    active: false,
                    rawActiveValue: response.active
                }
            });
        }
    } catch (error) {
        console.error('Error verifying account:', error);

        if (error.response) {
            const { status } = error.response;

            if (status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Account not found — Botamation API returned 404.',
                    debug: {
                        calledUrl: `${process.env.BOTAMATION_API_BASE_URL || 'https://app.botamation.in'}/api/super/accounts/${req.body.acctNo}`,
                        apiKeyConfigured: !!process.env.CHATBOT_PLATFORM_API_KEY,
                        botamationApiResponse: error.response.data
                    },
                    account: { acctNo: req.body.acctNo, name: null, active: false }
                });
            } else if (status === 401 || status === 403) {
                return res.status(status).json({
                    success: false,
                    message: `Unauthorized — Botamation API rejected the request (${status}). Check CHATBOT_PLATFORM_API_KEY.`,
                    account: { acctNo: req.body.acctNo, name: null, active: false }
                });
            }
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to verify account',
            error: error.message,
            account: { acctNo: req.body.acctNo, name: null, active: false }
        });
    }
};

/**
 * GET /api/accounts/user/:userId
 * Fetch all account names linked to a user.
 */
export const accountName = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        // Find all userAccounts for this userId
        const userAccountsResult = await performGet(UserAccount, { userId });
        if (!userAccountsResult?.success || !userAccountsResult.data?.length) {
            return res.status(404).json({ success: false, message: 'No accounts found for user' });
        }

        // For each acctId, get the account details
        const acctIds = userAccountsResult.data.map(ua => ua.acctId);
        const accountsResult = await performGet(acctDataModel, { _id: { $in: acctIds } });
        if (!accountsResult?.success || !accountsResult.data?.length) {
            return res.status(404).json({ success: false, message: 'No account data found for user' });
        }

        const accounts = accountsResult.data.map(acc => ({
            acctId: acc._id,
            acctNo: acc.acctNo,
            accountName: acc.accountName || 'Account'
        }));

        return res.status(200).json({ success: true, accounts });
    } catch (error) {
        console.error('Error fetching account name by userId:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};

/**
 * POST /api/accounts/link-user
 * Link an account to a user without calling the external verification API.
 * Supports both flat and nested { userData: {...} } request body formats.
 */
export const accountLinkToUser = async (req, res) => {
    try {
        const requestData = req.body;

        // Normalise to nested format
        let userData;
        if (requestData.userData) {
            userData = requestData;
        } else {
            userData = {
                userData: {
                    name: requestData.name,
                    email: requestData.email,
                    phone: requestData.phone || requestData.phoneNo,
                    acctNo: requestData.acctNo,
                    accountName: requestData.accountName || requestData.name,
                    role: requestData.role,
                    timezone: requestData.timezone,
                    profileImageUrl: requestData.profileImageUrl
                }
            };
        }

        // Prefer SSO-authenticated user, fall back to body
        const userId = req.user?.userId || req.body.userId || userData.userData.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated. userId is required.'
            });
        }

        if (!userData.userData?.acctNo) {
            return res.status(400).json({
                success: false,
                message: 'Account number (acctNo) is required'
            });
        }

        const profileImageUrl = userData.userData?.profileImageUrl || '/profile.png';

        // 1. Upsert account in accounts collection
        const accountData = {
            acctNo: userData.userData.acctNo,
            accountName: userData.userData.accountName || userData.userData.name,
            profileImageUrl,
            timezone: userData.userData.timezone || 'Asia/Calcutta'
        };

        const accountResult = await performUpsert(
            acctDataModel,
            { acctNo: userData.userData.acctNo },
            accountData
        );
        let acctId = accountResult.upsertedId;

        if (!acctId) {
            const existingAcct = await performGet(acctDataModel, { acctNo: userData.userData.acctNo });
            if (existingAcct?.success && existingAcct.data?.length > 0) {
                acctId = existingAcct.data[0]._id;
            }
        }

        if (!acctId) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create or retrieve account'
            });
        }

        // 2. Upsert user ↔ account relationship
        // role: 0 = superadmin (default), 1 = admin
        const roleValue = userData.userData.role !== undefined
            ? (userData.userData.role === 'admin' || userData.userData.role === 1 ? 1 : 0)
            : 0;

        const filterCriteria = { userId, acctId };
        const existingLink = await perfomDataExistanceCheck(UserAccount, filterCriteria);

        if (existingLink) {
            const updateData = { canCreateCalendar: true };
            if (userData.userData.role !== undefined) {
                updateData.role = roleValue;
            }
            await performUpsert(UserAccount, filterCriteria, updateData);
        } else {
            await performUpsert(UserAccount, {}, {
                userId,
                acctId,
                calendarIds: [],
                canCreateCalendar: true,
                role: roleValue
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Account linked successfully',
            data: {
                name: userData.userData.name,
                email: userData.userData.email,
                profileImageUrl,
                acctNo: userData.userData.acctNo,
                acctId,
                userId
            }
        });
    } catch (error) {
        console.error('Error in accountLinkToUser:', error);
        return res.status(500).json({
            success: false,
            message: 'Error saving user data',
            error: error.message
        });
    }
};

/**
 * POST /api/accounts/token
 * Get the current API key for an account (masked by default).
 * @access  Protected (SSO)
 * @body    { acctId: string, masked?: boolean }
 * @query   ?masked=true|false
 */
export const getAccountToken = async (req, res) => {
    try {
        const { acctId } = req.body;
        if (!acctId) {
            return res.status(400).json({ success: false, message: 'acctId is required' });
        }

        // Verify the account exists
        const acctCheck = await perfomDataExistanceCheck(acctDataModel, { _id: acctId });
        if (!acctCheck) {
            return res.status(404).json({ success: false, message: 'Account not found' });
        }

        let result = await performGet(accountApiKeyModel, { acctId });
        let apiKey = result?.data?.[0]?.apiKey;

        // Auto-generate if missing — account exists but key was never created
        if (!apiKey || typeof apiKey !== 'string') {
            apiKey = generateAccountToken();
            await performUpsert(accountApiKeyModel, { acctId }, { acctId, apiKey });
            logger.info('API key auto-generated for existing account', { acctId, operation: 'autoGenerateApiKey' });
        }

        // Determine masking from query/body
        const masked = req.query.masked !== undefined
            ? req.query.masked === 'true' || req.query.masked === true
            : (req.body.masked === undefined ? true : req.body.masked === true || req.body.masked === 'true');

        let displayApiKey = apiKey;
        if (masked) {
            displayApiKey = apiKey.length > 4
                ? '*'.repeat(apiKey.length - 4) + apiKey.slice(-4)
                : '*'.repeat(apiKey.length);
        }
        return res.status(200).json({ success: true, apiKey: displayApiKey });
    } catch (error) {
        console.error('Error fetching account token:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

/**
 * POST /api/accounts/token/regenerate
 * Regenerate the API key for an account.
 * @access  Protected (SSO)
 * @body    { acctId: string }
 */
export const regenerateAccountToken = async (req, res) => {
    try {
        const { acctId } = req.body;
        if (!acctId) {
            return res.status(400).json({ success: false, message: 'acctId is required' });
        }
        // Generate new API key
        const newApiKey = generateAccountToken();
        // Upsert the apiKey for this acctId
        await performUpsert(
            accountApiKeyModel,
            { acctId },
            { acctId, apiKey: newApiKey }
        );
        logger.info('API key regenerated', { acctId, operation: 'regenerateApiKey' });
        // Mask all but last 4 characters
        let maskedApiKey = newApiKey;
        if (newApiKey.length > 4) {
            maskedApiKey = '*'.repeat(newApiKey.length - 4) + newApiKey.slice(-4);
        } else {
            maskedApiKey = '*'.repeat(newApiKey.length);
        }
        return res.status(200).json({ success: true, apiKey: maskedApiKey, realApiKey: newApiKey });
    } catch (error) {
        console.error('Error regenerating account token:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

/**
 * DELETE /api/accounts/:acctId/user/:userId
 * Delete a user's association with an account and clean up related data.
 * Deletes: UserAccount link, AccountApiKey, and the Account itself.
 * @access  Protected (SSO)
 */
export const deleteAccount = async (req, res) => {
    try {
        const { acctId, userId } = req.params;

        if (!acctId || !userId) {
            return res.status(400).json({ success: false, message: 'acctId and userId are required' });
        }

        // Verify the account exists
        const account = await acctDataModel.findById(acctId).lean();
        if (!account) {
            return res.status(404).json({ success: false, message: 'Account not found' });
        }

        // Verify the user is actually linked to this account
        const userLink = await UserAccount.findOne({ acctId, userId }).lean();
        if (!userLink) {
            return res.status(404).json({ success: false, message: 'User is not linked to this account' });
        }

        // Delete UserAccount link
        await UserAccount.deleteMany({ acctId, userId });
        logger.info('UserAccount link deleted', { acctId, userId, operation: 'deleteUserAccount' });

        // Delete API keys for this account
        await accountApiKeyModel.deleteMany({ acctId });
        logger.info('AccountApiKey deleted', { acctId, operation: 'deleteAccountApiKey' });

        // Delete the account itself
        await acctDataModel.findByIdAndDelete(acctId);
        logger.info('Account deleted', { acctId, userId, operation: 'deleteAccount' });

        return res.status(200).json({
            success: true,
            message: 'Account and all associated data deleted successfully',
            deleted: { acctId, userId }
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

/**
 * GET /api/accounts/admins?acctNo=<acctNo>
 * Fetch admin users for an account from the Botamation platform API.
 * Returns: [{ adminId, firstName, lastName, phone, profileImage }]
 * @access  Protected (SSO)
 */
// TODO: Remove mock data once Botamation /admins API is confirmed
const MOCK_ADMINS = [
    { adminId: 'adm001', firstName: 'Alice', lastName: 'Johnson', phone: '+1-555-0101', email: 'alice.johnson@example.com', profileImage: 'https://i.pravatar.cc/150?img=1' },
    { adminId: 'adm002', firstName: 'Bob', lastName: 'Martinez', phone: '+1-555-0102', email: 'bob.martinez@example.com', profileImage: 'https://i.pravatar.cc/150?img=2' },
    { adminId: 'adm003', firstName: 'Carol', lastName: 'Williams', phone: '+1-555-0103', email: 'carol.williams@example.com', profileImage: '' },
    { adminId: 'adm004', firstName: 'David', lastName: 'Lee', phone: '+1-555-0104', email: 'david.lee@example.com', profileImage: 'https://i.pravatar.cc/150?img=4' },
    { adminId: 'adm005', firstName: 'Evelyn', lastName: 'Brown', phone: '+1-555-0105', email: 'evelyn.brown@example.com', profileImage: '' },
];

export const getAdmins = async (req, res) => {
    try {
        const { acctNo } = req.query;

        if (!acctNo) {
            return res.status(400).json({ success: false, message: 'acctNo query parameter is required' });
        }

        // TODO: Replace mock with live API call once endpoint is confirmed
        // const admins = await getAdminsService(acctNo);
        const admins = MOCK_ADMINS;

        const normalised = (Array.isArray(admins) ? admins : [admins]).map((a) => ({
            adminId: a.adminId ?? a.id ?? a._id ?? null,
            firstName: a.firstName ?? a.first_name ?? null,
            lastName: a.lastName ?? a.last_name ?? null,
            phone: a.phone ?? a.mobile ?? null,
            email: a.email ?? null,
            profileImage: a.profileImage ?? a.profile_image ?? a.profileImageUrl ?? null
        }));

        return res.status(200).json({ success: true, admins: normalised });
    } catch (error) {
        logger.error('Failed to fetch admins', { error: error.message });
        const status = error.response?.status || 500;
        return res.status(status).json({ success: false, message: 'Failed to fetch admins', error: error.message });
    }
};
