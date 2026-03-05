import axios from 'axios';

/**
 * Calls the Botamation platform API to verify an account number.
 *
 * Endpoint: GET https://app.botamation.in/api/super/accounts/{acctNo}
 * Auth:     Header  x-api-key: <CHATBOT_PLATFORM_API_KEY>
 *
 * Expected successful response shape:
 * {
 *   active: '1',
 *   name: 'Account Name',
 *   timezone: 'Asia/Calcutta',
 *   ...
 * }
 */
export const verifyAccountServices = async (acctNo) => {
    const apiKey = process.env.CHATBOT_PLATFORM_API_KEY;
    const baseUrl = process.env.BOTAMATION_API_BASE_URL || 'https://app.botamation.in';
    const fullUrl = `${baseUrl}/api/super/accounts/${acctNo}`;

    console.log('\n[AccountService] ══════════════════════════════════');
    console.log('[AccountService] Calling Botamation Platform API');
    console.log('[AccountService] URL    :', fullUrl);
    console.log('[AccountService] API Key:', apiKey ? `${apiKey.slice(0, 6)}…` : '❌ NOT SET (CHATBOT_PLATFORM_API_KEY missing)');
    console.log('[AccountService] ══════════════════════════════════');

    if (!apiKey) {
        throw new Error('CHATBOT_PLATFORM_API_KEY is not configured in environment variables');
    }

    try {
        const response = await axios.get(fullUrl, {
            headers: {
                'X-ACCESS-TOKEN': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        console.log('[AccountService] ✅ Response status:', response.status);
        console.log('[AccountService] ✅ Response data  :', JSON.stringify(response.data));

        return response.data;
    } catch (err) {
        console.error('[AccountService] ❌ API call failed');
        console.error('[AccountService] Status :', err.response?.status);
        console.error('[AccountService] Body   :', JSON.stringify(err.response?.data));
        throw err;
    }
};
