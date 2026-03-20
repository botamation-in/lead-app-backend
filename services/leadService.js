import Lead from '../models/leadModel.js';
import LeadCategory from '../models/leadCategoryModel.js';
import Account from '../models/accountModel.js';
import AccountAdmin from '../models/accountAdminModel.js';
import mongoose from 'mongoose';
import {
  performUpsert,
  performGet,
  performDelete,
  performCount,
  perfomDataExistanceCheck
} from '../config/mongoConnector.js';

class LeadService {
  /**
   * Create new lead(s)
   * Resolves acctNo → acctId via Account collection before saving
   */
  async createLead(leadData, acctNo, category = null) {
    try {
      // Resolve acctId from acctNo
      const account = await perfomDataExistanceCheck(Account, { acctNo });
      if (!account) {
        const err = new Error(`Account not found for acctNo: ${acctNo}`);
        err.statusCode = 404;
        throw err;
      }
      const acctId = account._id;

      // Resolve category name — use provided value or fall back to "default"
      const categoryName = category || 'default';
      const isDefaultCategory = !category;

      // Create category if it doesn't already exist
      let categoryResult = null;
      const existing = await perfomDataExistanceCheck(LeadCategory, { acctId, categoryName });
      if (existing) {
        if (isDefaultCategory) {
          // No category provided: check if other categories exist for the account
          const count = await performCount(LeadCategory, { acctId });
          // If "default" is the only category → it should be default:true; otherwise default:false
          const shouldBeDefault = count <= 1;
          if (existing.default !== shouldBeDefault) {
            const updated = await LeadCategory.findByIdAndUpdate(existing._id, { $set: { default: shouldBeDefault } }, { new: true });
            categoryResult = { created: false, data: updated };
          } else {
            categoryResult = { created: false, data: existing };
          }
        } else {
          categoryResult = { created: false, data: existing };
        }
      } else {
        const count = await performCount(LeadCategory, { acctId });
        // No category sent: default:true only if no other categories exist; explicit name: default:true only if first ever
        const isDefault = isDefaultCategory ? count === 0 : count === 0;
        const cat = await LeadCategory.create({ acctId, categoryName, default: isDefault });
        categoryResult = { created: true, data: cat };
      }

      // Attach categoryId to lead if category was resolved
      const categoryId = categoryResult ? categoryResult.data._id : undefined;
      const addCategoryId = (item) => categoryId ? { ...item, categoryId } : item;

      // Create lead(s)
      let leadResult;
      if (Array.isArray(leadData)) {
        const results = await Promise.all(
          leadData.map(item => performUpsert(Lead, {}, addCategoryId({ ...item, acctId })))
        );
        leadResult = results.map(r => r.doc);
      } else {
        const result = await performUpsert(Lead, {}, addCategoryId({ ...leadData, acctId }));
        leadResult = result.doc;
      }

      return { lead: leadResult, category: categoryResult };
    } catch (error) {
      console.error('Error creating lead:', error);
      throw error.statusCode ? error : new Error(`Failed to create lead: ${error.message}`);
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
        search,
        acctId,
        categoryId,
        ...rest
      } = filters;

      // acctId is already validated by JWT middleware — no extra DB lookup needed
      const query = { acctId };

      // Exact match for categoryId
      if (categoryId) {
        query.categoryId = categoryId;
      }

      // Apply any extra field filters dynamically as case-insensitive regex
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined && value !== null && value !== '') {
          query[key] = { $regex: value, $options: 'i' };
        }
      }

      if (search) {
        const searchableFields = Object.keys(Lead.schema.paths).filter(
          k => Lead.schema.paths[k].instance === 'String' && !['_id', 'acctId', 'adminId'].includes(k)
        );
        const searchConditions = searchableFields.map(field => ({ [field]: { $regex: search, $options: 'i' } }));
        // Keep acctId + categoryId scope, add search as $or across text fields
        query.$and = [{ acctId }, { $or: searchConditions }];
        delete query.acctId;
      }

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder };

      const [getResult, total] = await Promise.all([
        performGet(Lead, query, [], { sort, skip, limit }),
        performCount(Lead, query)
      ]);

      // Enrich leads with admin name and profileImage
      const leads = getResult.data || [];
      const adminIds = [...new Set(leads.map(l => l.adminId).filter(Boolean))];
      let adminMap = {};
      if (adminIds.length > 0) {
        const adminResult = await performGet(AccountAdmin, { adminId: { $in: adminIds } });
        (adminResult.data || []).forEach(a => {
          adminMap[a.adminId] = {
            adminName: [a.firstName, a.lastName].filter(Boolean).join(' ') || null,
            adminProfileImage: a.profileImage || null
          };
        });
      }
      const enrichedLeads = leads.map(lead => {
        const info = lead.adminId ? (adminMap[lead.adminId] || {}) : {};
        return { ...(lead.toObject?.() ?? lead), ...info };
      });

      return {
        data: enrichedLeads,
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

  /**
   * Create a lead category if it doesn't already exist
   * Sets default:true only when it is the first category for the account
   */
  async createCategory(acctNo, categoryName) {
    try {
      // Resolve acctNo → acctId
      const account = await perfomDataExistanceCheck(Account, { acctNo });
      if (!account) {
        const err = new Error(`Account not found for acctNo: ${acctNo}`);
        err.statusCode = 404;
        throw err;
      }
      const acctId = account._id;

      // Return existing category without creating a duplicate
      const existing = await perfomDataExistanceCheck(LeadCategory, { acctId, categoryName });
      if (existing) {
        return { created: false, data: existing };
      }

      // Determine whether this is the first category for the account
      const count = await performCount(LeadCategory, { acctId });
      const isDefault = count === 0;

      const category = await LeadCategory.create({ acctId, categoryName, default: isDefault });
      return { created: true, data: category };
    } catch (error) {
      console.error('Error creating lead category:', error);
      throw new Error(`Failed to create lead category: ${error.message}`);
    }
  }

  /**
   * Get all categories for an account
   */
  async getCategories(acctId) {
    try {
      const result = await performGet(LeadCategory, { acctId }, [], { sort: { createdAt: 1 } });
      return (result.data || []).map(c => ({ _id: c._id, categoryName: c.categoryName, default: c.default }));
    } catch (error) {
      console.error('Error getting lead categories:', error);
      throw new Error(`Failed to get lead categories: ${error.message}`);
    }
  }

  /**
   * Set a category as default — unsets all others for the account
   */
  async setDefaultCategory(acctId, categoryId) {
    try {
      const category = await perfomDataExistanceCheck(LeadCategory, { _id: categoryId, acctId });
      if (!category) {
        const err = new Error('Category not found');
        err.statusCode = 404;
        throw err;
      }
      // Unset default on all categories for this account
      await LeadCategory.updateMany({ acctId }, { $set: { default: false } });
      // Set default on the target category
      const updated = await LeadCategory.findByIdAndUpdate(categoryId, { $set: { default: true } }, { new: true });
      return updated;
    } catch (error) {
      console.error('Error setting default category:', error);
      throw error.statusCode ? error : new Error(`Failed to set default category: ${error.message}`);
    }
  }
}

export default new LeadService();
