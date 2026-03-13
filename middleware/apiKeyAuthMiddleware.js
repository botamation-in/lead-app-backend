import accountApiKeyModel from '../models/accountApiKeyModel.js';
import { performGet } from '../config/mongoConnector.js';

/**
 * Middleware to validate x-api-key and acctId against the accountApiKey collection.
 * - Requires both apiKey and acctId to be present
 * - Accepts apiKey from: x-api-key header, query param, or body
 * - Accepts acctId from: x-acct-id header, query param, path param, or body
 * - Validates that the apiKey belongs to the provided acctId
 * - Uses efficient token lookup with indexed query
 */
export const apiKeyAuthMiddleware = async (req, res, next) => {
    try {
        // 1️⃣ Extract API key from multiple sources
        const apiKey =
            (req.get && req.get('x-api-key')) ||
            req.headers['x-api-key'] ||
            req.query.apiKey ||
            req.body?.apiKey;

        // 2️⃣ Extract acctId from multiple sources
        const acctIdCandidates = [
            req.get && req.get('x-acct-id'),
            req.headers['x-acct-id'],
            req.headers['x-acctno'],
            req.query.acctId,
            req.params?.acctId,
            req.body?.acctId,
        ].filter(Boolean).map(String);

        // 3️⃣ Validate both apiKey and acctId are present
        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'Missing apiKey' });
        }

        if (acctIdCandidates.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing acctId' });
        }

        // 4️⃣ Ensure consistency if acctId provided from multiple sources
        const uniqueAcctIds = new Set(acctIdCandidates);
        if (uniqueAcctIds.size > 1) {
            return res.status(400).json({
                success: false,
                message: 'multiple acctId values provided across sources'
            });
        }
        const acctId = acctIdCandidates[0];

        // 5️⃣ Lookup token in DB (indexed query for performance)
        const getResult = await performGet(accountApiKeyModel, { apiKey }, ['acctId', 'apiKey']);
        if (!getResult.success || !Array.isArray(getResult.data) || getResult.data.length === 0) {
            // Generic message to prevent user enumeration
            return res.status(401).json({ success: false, message: 'Invalid api key' });
        }

        const tokenDoc = getResult.data[0];

        // 6️⃣ Verify that the token belongs to the provided acctId
        // 6️⃣ Verify that the apiKey belongs to the provided acctId
        if (String(tokenDoc.acctId) !== acctId) {
            return res.status(403).json({ success: false, message: 'API key does not belong to the provided account.' });
        }

        // 7️⃣ Attach validated account info for downstream handlers
        req.acctId = acctId;
        req.accountToken = tokenDoc.apiKey;

        return next();
    } catch (err) {
        console.error('apiKeyAuthMiddleware error', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
