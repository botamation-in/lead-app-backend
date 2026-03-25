import leadService from '../services/leadService.js';

class LeadController {
  /**
   * Create new lead(s)
   * POST /api/leads
   */
  async createLead(req, res) {
    try {
      const leadData = req.body;

      if (!leadData || (Array.isArray(leadData) && leadData.length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'Lead data is required'
        });
      }

      // Use acctNo from the authenticated context — SSO or API key middleware
      const acctNo = req.user?.acctNo || req.acctNo || req.headers['x-acctno'] || req.query.acctNo;
      if (!acctNo) {
        return res.status(400).json({
          success: false,
          message: 'acctNo is required (header: x-acctNo or query param: acctNo)'
        });
      }

      const category = req.params.category || req.body.category || req.query.category || null;
      // Strip category field from lead payload so it's not stored on the lead
      const leadPayload = Array.isArray(leadData)
        ? leadData.map(({ category: _, ...rest }) => rest)
        : (({ category: _, ...rest }) => rest)(leadData);

      const result = await leadService.createLead(leadPayload, acctNo, category);

      return res.status(201).json({
        success: true,
        message: Array.isArray(leadPayload)
          ? `${result.lead.length} leads created successfully`
          : 'Lead created successfully',
        data: result.lead,
        ...(result.category && { category: result.category.data })
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          message: 'Account Not found'
        });
      }
      console.error('Error in createLead:', error);
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get all leads
   * GET /api/leads
   */
  async getAllLeads(req, res) {
    try {
      const { page, limit, sortBy, sortOrder, search, acctId: acctIdQuery, ...rest } = req.query;

      // Use acctId from the authenticated context — SSO or API key middleware
      const acctId = req.user?.acctId || req.acctId || req.headers['x-acctno'] || acctIdQuery;
      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'acctId is required'
        });
      }

      const sortOrderVal = sortOrder === 'asc' ? 1 : sortOrder === 'desc' ? -1 : (sortOrder ? parseInt(sortOrder) : -1);

      const filters = {
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 10,
        sortBy: sortBy || 'createdAt',
        sortOrder: sortOrderVal,
        search,
        acctId,
        ...rest
      };

      const result = await leadService.getAllLeads(filters);

      return res.status(200).json({
        success: true,
        message: 'Leads retrieved successfully',
        ...result
      });
    } catch (error) {
      console.error('Error in getAllLeads:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Update lead
   * PUT /api/leads/:id
   */
  async updateLead(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Resolve the caller's acctId from the authenticated context
      const callerAcctId = req.user?.acctId || req.acctId;
      if (!callerAcctId) {
        return res.status(403).json({ success: false, message: 'Access denied: no authenticated account' });
      }

      // Verify the lead belongs to the caller's account before updating
      const existing = await leadService.getLeadById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      if (existing.acctId !== callerAcctId) {
        return res.status(403).json({ success: false, message: 'Access denied: lead does not belong to your account' });
      }

      const result = await leadService.updateLead(id, updateData);

      return res.status(200).json({
        success: true,
        message: 'Lead updated successfully',
        data: result
      });
    } catch (error) {
      console.error('Error in updateLead:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Delete lead
   * DELETE /api/leads/:id
   */
  async deleteLead(req, res) {
    try {
      const { id } = req.params;

      // Resolve the caller's acctId from the authenticated context
      const callerAcctId = req.user?.acctId || req.acctId;
      if (!callerAcctId) {
        return res.status(403).json({ success: false, message: 'Access denied: no authenticated account' });
      }

      // Verify the lead belongs to the caller's account before deleting
      const existing = await leadService.getLeadById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      if (existing.acctId !== callerAcctId) {
        return res.status(403).json({ success: false, message: 'Access denied: lead does not belong to your account' });
      }

      await leadService.deleteLead(id);

      return res.status(200).json({
        success: true,
        message: 'Lead deleted successfully'
      });
    } catch (error) {
      console.error('Error in deleteLead:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Create a lead category from the route path parameter
   * POST /api/leads/category/:categoryName
   */
  async createCategory(req, res) {
    try {
      const { category: categoryName } = req.params;

      // Use acctNo from the authenticated context — SSO or API key middleware
      const acctNo = req.user?.acctNo || req.acctNo || req.headers['x-acctno'] || req.query.acctNo;
      if (!acctNo) {
        return res.status(400).json({
          success: false,
          message: 'acctNo is required (header: x-acctNo or query param: acctNo)'
        });
      }

      const result = await leadService.createCategory(acctNo, categoryName);

      if (!result.created) {
        return res.status(200).json({
          success: true,
          message: 'Category already exists',
          data: result.data
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: result.data
      });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          message: 'Account Not found'
        });
      }
      console.error('Error in createCategory:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Get categories for an account
   * GET /api/ui/leads/categories?acctId=
   */
  async getCategories(req, res) {
    try {
      // Use acctId from the authenticated context — SSO or API key middleware
      const acctId = req.user?.acctId || req.acctId || req.query.acctId || req.headers['x-acctno'];
      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'acctId is required'
        });
      }

      const data = await leadService.getCategories(acctId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Error in getCategories:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Set a category as default
   * PUT /api/ui/leads/categories/:categoryId/default
   */
  async setDefaultCategory(req, res) {
    try {
      const { categoryId } = req.params;
      // Use acctId from the authenticated context — SSO or API key middleware
      const acctId = req.user?.acctId || req.acctId || req.body.acctId || req.query.acctId;
      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'acctId is required'
        });
      }

      const data = await leadService.setDefaultCategory(acctId, categoryId);
      return res.status(200).json({ success: true, message: 'Default category updated', data });
    } catch (error) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      console.error('Error in setDefaultCategory:', error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }
}

export default new LeadController();
