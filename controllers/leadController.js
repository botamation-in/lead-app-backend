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

      const acctNo = req.headers['x-acctno'] || req.query.acctNo;
      if (!acctNo) {
        return res.status(400).json({
          success: false,
          message: 'acctNo is required (header: x-acctNo or query param: acctNo)'
        });
      }

      const result = await leadService.createLead(leadData, acctNo);

      return res.status(201).json({
        success: true,
        message: Array.isArray(leadData)
          ? `${result.length} leads created successfully`
          : 'Lead created successfully',
        data: result
      });
    } catch (error) {
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

      const acctId = req.headers['x-acctno'] || acctIdQuery;
      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'acctId is required (header: x-acctNo or query param: acctId)'
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
}

export default new LeadController();
