import jwt from 'jsonwebtoken';
import axios from 'axios';

/**
 * Returns shared cookie configuration for setting/clearing cookies.
 * @param {number} maxAge - Cookie max-age in milliseconds
 */
export const getCookieConfig = (maxAge) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {})
});

/**
 * Fetch fresh user data from the centralised auth service.
 * @param {string} token - The access_token JWT string
 */
export const getUserFromAuthService = async (token) => {
    try {
        const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:8081';
        const response = await axios.get(`${authServiceUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000
        });
        return response.data?.user || response.data || null;
    } catch (error) {
        console.error('[SSO] getUserFromAuthService error:', error.message);
        return null;
    }
};

/**
 * SSO Authentication Middleware
 * Validates JWT tokens from HTTP-only cookies
 * Automatically refreshes expired access tokens using refresh tokens
 */
const ssoAuthMiddleware = async (req, res, next) => {
    // ── SKIP_LOGIN: bypass SSO for local development ──────────────
    if (process.env.SKIP_LOGIN === 'true') {
        req.user = {
            userId: process.env.SKIP_LOGIN_USER_ID || 'dev-user-001',
            email: process.env.SKIP_LOGIN_USER_EMAIL || 'dev@botamation.in',
            name: process.env.SKIP_LOGIN_USER_NAME || 'Dev User',
            googleEmail: process.env.SKIP_LOGIN_USER_GOOGLE_EMAIL || '',
            profileImage: process.env.SKIP_LOGIN_USER_PROFILE_IMAGE || '',
            role: 'admin',
            permissions: ['read', 'write', 'delete']
        };
        console.log('[SSO Middleware] ⚠️  SKIP_LOGIN=true — bypassing auth for dev user:', req.user.email);
        return next();
    }

    try {
        console.log('\n========================================');
        console.log('[SSO Middleware] 🔍 NEW REQUEST:', req.method, req.path);
        console.log('[SSO Middleware] Cookies present:', Object.keys(req.cookies || {}).join(', ') || 'none');

        // Extract tokens from cookies
        const accessToken = req.cookies?.access_token;
        const refreshToken = req.cookies?.refresh_token;

        console.log('[SSO Middleware] Access token:', accessToken ? '✓ present' : '❌ missing');
        console.log('[SSO Middleware] Refresh token:', refreshToken ? '✓ present' : '❌ missing');

        // Reduced logging - only log on auth failures or first request
        if (!accessToken && !refreshToken) {
            console.log('[SSO Middleware] ❌ No tokens found - authentication required');
        }

        if (!accessToken && !refreshToken) {
            const redirectUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            const authUrl = `${process.env.AUTH_SERVICE_URL || 'http://localhost:8081'}/login?redirect=${encodeURIComponent(redirectUrl)}`;

            return res.status(401).json({
                success: false,
                authenticated: false,
                message: 'Authentication required. Please log in.',
                authUrl: authUrl
            });
        }

        // Try to validate access token
        if (accessToken) {
            try {
                const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
                console.log('[SSO Middleware] ✅ Access token valid!');
                console.log('[SSO Middleware] User:', decoded.email);
                console.log('[SSO Middleware] → Proceeding to route handler');

                // Set user information in request
                req.user = {
                    userId: decoded.userId,
                    email: decoded.email,
                    acctId: decoded.acctId,
                    acctNo: decoded.acctNo,
                    role: decoded.role,
                    permissions: decoded.permissions || []
                };

                return next();
            } catch (error) {
                if (error.name === 'TokenExpiredError') {
                    console.log('[SSO Middleware] Access token expired, attempting refresh');
                    // Try to refresh token
                    return await tryRefreshToken(req, res, next, refreshToken);
                } else {
                    console.error('[SSO Middleware] Invalid access token:', error.message);
                    // Invalid token, try refresh if available
                    if (refreshToken) {
                        return await tryRefreshToken(req, res, next, refreshToken);
                    }
                }
            }
        }

        // If no access token but have refresh token, try to refresh
        if (refreshToken) {
            return await tryRefreshToken(req, res, next, refreshToken);
        }

        // No valid authentication
        const redirectUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const authUrl = `${process.env.AUTH_SERVICE_URL || 'http://localhost:8081'}/login?redirect=${encodeURIComponent(redirectUrl)}`;

        return res.status(401).json({
            success: false,
            authenticated: false,
            message: 'Invalid or expired authentication. Please log in again.',
            authUrl: authUrl
        });
    } catch (error) {
        console.error('[SSO Middleware] Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error',
            error: error.message
        });
    }
};

/**
 * Try to refresh the access token using refresh token
 */
async function tryRefreshToken(req, res, next, refreshToken) {
    console.log('[SSO Middleware] 🔄 Attempting to refresh token...');
    try {
        // Validate refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        console.log('[SSO Middleware] ✓ Refresh token valid, generating new access token');
        console.log('[SSO Middleware] User:', decoded.email);

        // Generate new access token (6 hours)
        const newAccessToken = jwt.sign(
            {
                userId: decoded.userId,
                email: decoded.email,
                acctId: decoded.acctId,
                acctNo: decoded.acctNo,
                role: decoded.role,
                permissions: decoded.permissions
            },
            process.env.JWT_SECRET,
            { expiresIn: '6h' }
        );

        // Generate new refresh token (15 days)
        const newRefreshToken = jwt.sign(
            {
                userId: decoded.userId,
                email: decoded.email,
                acctId: decoded.acctId,
                acctNo: decoded.acctNo,
                role: decoded.role,
                permissions: decoded.permissions
            },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '15d' }
        );

        // Set refreshed cookies
        res.cookie('access_token', newAccessToken, getCookieConfig(6 * 60 * 60 * 1000));   // 6 hours
        res.cookie('refresh_token', newRefreshToken, getCookieConfig(15 * 24 * 60 * 60 * 1000)); // 15 days

        console.log('[SSO Middleware] ✅ New access token generated and set');
        console.log('[SSO Middleware] → Proceeding to route handler with refreshed token');

        // Set user information in request
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            acctId: decoded.acctId,
            acctNo: decoded.acctNo,
            role: decoded.role,
            permissions: decoded.permissions || []
        };

        return next();
    } catch (error) {
        console.error('[SSO Middleware] Refresh token invalid:', error.message);

        // Refresh token also invalid, require re-login
        const redirectUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const authUrl = `${process.env.AUTH_SERVICE_URL || 'http://localhost:8081'}/login?redirect=${encodeURIComponent(redirectUrl)}`;

        return res.status(401).json({
            success: false,
            authenticated: false,
            message: 'Session expired. Please log in again.',
            authUrl: authUrl
        });
    }
}

/**
 * Optional: Account-level authorization middleware
 * Validates user has access to specific account
 */
export const requireAccount = async (req, res, next) => {
    try {
        const acctNo = req.params.acctNo || req.body.acctNo || req.headers['x-account-no'];

        if (!acctNo) {
            return res.status(400).json({
                success: false,
                message: 'Account number required'
            });
        }

        if (req.user.acctNo !== acctNo) {
            console.log(`[SSO] Access denied: User ${req.user.email} attempted to access account ${acctNo}`);
            return res.status(403).json({
                success: false,
                message: 'Access denied to this account'
            });
        }

        next();
    } catch (error) {
        console.error('[SSO] Account authorization error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authorization error'
        });
    }
};

/**
 * Hybrid Auth Middleware — supports both HTTP-only cookies AND Bearer token.
 * Useful for backward compatibility with clients that send Authorization headers.
 */
export const hybridAuthMiddleware = async (req, res, next) => {
    // First try Bearer token from Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                userId: decoded.userId,
                email: decoded.email,
                acctId: decoded.acctId,
                acctNo: decoded.acctNo,
                role: decoded.role,
                permissions: decoded.permissions || []
            };
            return next();
        } catch (err) {
            // Fall through to cookie-based auth
            console.log('[Hybrid Auth] Bearer token invalid, trying cookies:', err.message);
        }
    }
    // Fall back to cookie-based SSO auth
    return ssoAuthMiddleware(req, res, next);
};

export default ssoAuthMiddleware;
