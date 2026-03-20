import accountApiKeyModel from '../models/accountApiKeyModel.js';
import acctDataModel from '../models/accountModel.js';
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

        // 2️⃣ Extract acctNo from multiple sources
        const acctNoCandidates = [
            req.get && req.get('x-acct-no'),
            req.headers['x-acct-no'],
            req.headers['x-acctno'],
            req.query.acctNo,
            req.params?.acctNo,
            req.body?.acctNo,
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

        // 5️⃣ Resolve acctNo → acctId (_id) from Account collection
        const acctResult = await performGet(acctDataModel, { acctNo });
        if (!acctResult.success || !Array.isArray(acctResult.data) || acctResult.data.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid api key or account' });
        }
        const acctId = String(acctResult.data[0]._id);

        // 6️⃣ Lookup token in DB — query by both apiKey AND acctId to confirm this account owns this key
        const getResult = await performGet(accountApiKeyModel, { apiKey, acctId });
        if (!getResult.success || !Array.isArray(getResult.data) || getResult.data.length === 0) {
            // Generic message to prevent user enumeration / account probing
            return res.status(401).json({ success: false, message: 'Invalid api key or account' });
        }

        const tokenDoc = getResult.data[0];

        // 7️⃣ Attach validated account info for downstream handlers
        req.acctId = acctId;
        req.acctNo = acctNo;
        req.accountToken = tokenDoc.apiKey;

        return next();
    } catch (err) {
        console.error('apiKeyAuthMiddleware error', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
