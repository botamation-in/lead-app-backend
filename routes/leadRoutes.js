import express from 'express';
import leadController from '../controllers/leadController.js';

const router = express.Router();

/**
 * GET /api/leads/categories
 * @desc    Get all lead categories for the account
 * @access  Protected (requires authentication)
 */
router.get('/categories', leadController.getCategories.bind(leadController));

/**
 * GET /api/leads/fields
 * @desc    Get all unique field names per category
 * @access  Protected (requires authentication)
 */
router.get('/fields', leadController.getFields.bind(leadController));

/**
 * PUT /api/leads/categories/:categoryId/default
 * @desc    Set a category as the default
 * @access  Protected (requires authentication)
 */
router.put('/categories/:categoryId/default', leadController.setDefaultCategory.bind(leadController));

/**
 * DELETE /api/leads/categories/:categoryId
 * @desc    Delete a category and all its associated leads
 * @access  Protected (requires authentication)
 */
router.delete('/categories/:categoryId', leadController.deleteCategory.bind(leadController));

/**
 * POST /api/leads          — create lead(s) with no category (uses default)
 * POST /api/leads/:category — create lead(s) under a named category
 * @desc    Create one or more leads; queued for API-key callers, synchronous for SSO callers
 * @access  Protected (requires authentication)
 */
router.post('/', leadController.createLead.bind(leadController));
router.post('/:category', leadController.createLead.bind(leadController));

/**
 * GET /api/leads
 * @desc    Get paginated leads with optional filtering and sorting
 * @access  Protected (requires authentication)
 * @query   page, limit, sortBy, sortOrder, search, acctId
 */
router.get('/', leadController.getAllLeads.bind(leadController));

/**
 * PUT /api/leads/:id
 * @desc    Update a lead
 * @access  Protected (requires authentication)
 */
router.put('/:id', leadController.updateLead.bind(leadController));

/**
 * DELETE /api/leads/:id
 * @desc    Delete a lead
 * @access  Protected (requires authentication)
 */
router.delete('/:id', leadController.deleteLead.bind(leadController));

export default router;
