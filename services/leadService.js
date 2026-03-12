import Lead from '../models/leadModel.js';
import {
  performUpsert,
  performGet,
  performDelete,
  performCount
} from '../config/mongoConnector.js';

class LeadService {
  /**
   * Create new lead(s)
   */
  async createLead(leadData, acctId) {
    try {
      if (Array.isArray(leadData)) {
        const results = await Promise.all(
          leadData.map(item => performUpsert(Lead, {}, { ...item, acctId }))
        );
        return results.map(r => r.doc);
      } else {
        const result = await performUpsert(Lead, {}, { ...leadData, acctId });
        return result.doc;
      }
    } catch (error) {
      console.error('Error creating lead:', error);
      throw new Error(`Failed to create lead: ${error.message}`);
    }
  }

  /**
   * Get all leads with pagination and filtering
   */
  async getAllLeads(filters = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = -1,
        status,
        search,
        acctId,
        trainerName,
        memberName,
        email
      } = filters;

      const query = { acctId };

      if (status) query.status = status;

      if (trainerName) query.trainerName = { $regex: trainerName, $options: 'i' };
      if (memberName) query.memberName = { $regex: memberName, $options: 'i' };
      if (email) query.email = { $regex: email, $options: 'i' };

      if (search) {
        query.$or = [
          { trainerName: { $regex: search, $options: 'i' } },
          { memberName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder };

      const [getResult, total] = await Promise.all([
        performGet(Lead, query, [], { sort, skip, limit }),
        performCount(Lead, query)
      ]);

      return {
        data: getResult.data,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting leads:', error);
      throw new Error(`Failed to get leads: ${error.message}`);
    }
  }

  /**
   * Update lead
   */
  async updateLead(id, updateData) {
    try {
      const result = await performUpsert(Lead, { _id: id }, updateData);
      return result.doc || null;
    } catch (error) {
      console.error('Error updating lead:', error);
      throw new Error(`Failed to update lead: ${error.message}`);
    }
  }

  /**
   * Delete lead
   */
  async deleteLead(id) {
    try {
      await performDelete(Lead, { _id: id });
      return true;
    } catch (error) {
      console.error('Error deleting lead:', error);
      throw new Error(`Failed to delete lead: ${error.message}`);
    }
  }
}

export default new LeadService();
