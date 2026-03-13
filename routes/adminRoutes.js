import express from 'express';
import { getAdmins, getAdminsFromDb } from '../controllers/adminController.js';

const router = express.Router();

/**
 * GET /list — fetch admins from local DB
 */
router.get('/list', getAdminsFromDb);

/**
 * GET / — fetch admins from Botamation platform API and sync to DB
 */
router.get('/', getAdmins);

export default router;
