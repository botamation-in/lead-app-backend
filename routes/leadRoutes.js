import express from 'express';
import leadController from '../controllers/leadController.js';

const router = express.Router();


router.get('/categories', leadController.getCategories.bind(leadController));

router.get('/fields', leadController.getFields.bind(leadController));

router.put('/categories/:categoryId/default', leadController.setDefaultCategory.bind(leadController));

router.post('/category/:category', leadController.createLead.bind(leadController));

router.post('/', leadController.createLead.bind(leadController));
router.post('/:category', leadController.createLead.bind(leadController));

/**
 * API 2: GET /api/leads
 * @desc    Get JSON data to fill frontend grid
 * @access  Protected (requires authentication)
 * @query   page, limit, sortBy, sortOrder, status, search
 */
router.get('/', leadController.getAllLeads.bind(leadController));

/**
 * API 3: PUT /api/leads/:id
 * @desc    Update a lead
 * @access  Protected (requires authentication)
 */
router.put('/:id', leadController.updateLead.bind(leadController));

/**
 * API 4: DELETE /api/leads/:id
 * @desc    Delete a lead
 * @access  Protected (requires authentication)
 */
router.delete('/:id', leadController.deleteLead.bind(leadController));

export default router;
