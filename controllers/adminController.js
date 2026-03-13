import { syncAdminsFromPlatform, getAdminsFromDb as getAdminsFromDbService } from '../services/adminService.js';
import logger from '../utils/logger.js';

/**
 * GET /api/ui/admins/list?acctId=<acctId>
 * Return admins for an account from the local database.
 * @access  Protected (SSO)
 */
export const getAdminsFromDb = async (req, res) => {
    try {
        const { acctId, ...filters } = req.query;

        if (!acctId) {
            return res.status(400).json({ success: false, message: 'acctId query parameter is required' });
        }

        const result = await getAdminsFromDbService(acctId, filters);

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        logger.error('Failed to fetch admins from database', { error: error.message });
        const status = error.statusCode || 500;
        return res.status(status).json({ success: false, message: error.message || 'Failed to fetch admins from database' });
    }
};

/**
 * GET /api/ui/admins?acctId=<acctId>
 * Fetch admins from the Botamation platform API and sync to local DB.
 * @access  Protected (SSO)
 */
export const getAdmins = async (req, res) => {
    try {
        const { acctId } = req.query;

        if (!acctId) {
            return res.status(400).json({ success: false, message: 'acctId query parameter is required' });
        }

        const admins = await syncAdminsFromPlatform(acctId);

        return res.status(200).json({ success: true, admins });
    } catch (error) {
        logger.error('Failed to fetch admins', { error: error.message });
        const status = error.statusCode || error.response?.status || 500;
        return res.status(status).json({ success: false, message: error.message || 'Failed to fetch admins' });
    }
};
