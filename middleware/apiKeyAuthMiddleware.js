import accountApiKeyModel from '../models/accountApiKeyModel.js';
import { performAggregate } from '../config/mongoConnector.js';

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

        // 2️⃣ Extract acctNo from multiple sources
        const acctNoCandidates = [
            req.headers['x-page-id']
        ].filter(Boolean).map(String);

        // 3️⃣ Validate both apiKey and acctNo are present
        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'Missing apiKey' });
        }

        if (acctNoCandidates.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing acctNo' });
        }

        // 4️⃣ Ensure consistency if acctNo provided from multiple sources
        const uniqueAcctNos = new Set(acctNoCandidates);
        if (uniqueAcctNos.size > 1) {
            return res.status(400).json({
                success: false,
                message: 'multiple acctNo values provided across sources'
            });
        }
        const acctNo = acctNoCandidates[0];

        //TODO: Add caching layer here if needed to reduce DB load for repeated requests with the same apiKey + acctNo
        // 5️⃣ Single query: match apiKey + join Account to verify acctNo — replaces 2 separate queries
        const results = await performAggregate(accountApiKeyModel, [
            { $match: { apiKey } },
            {
                $lookup: {
                    from: 'accounts',
                    localField: 'acctId',
                    foreignField: '_id',
                    as: 'account'
                }
            },
            { $unwind: '$account' },
            { $match: { 'account.acctNo': acctNo } }
        ]);

        if (!results || results.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid api key or account' });
        }

        const tokenDoc = results[0];
        const acctId = String(tokenDoc.acctId);

        // 6️⃣ Attach validated account info for downstream handlers
        req.acctId = acctId;
        req.acctNo = acctNo;
        req.accountToken = tokenDoc.apiKey;

        return next();
    } catch (err) {
        console.error('apiKeyAuthMiddleware error', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
