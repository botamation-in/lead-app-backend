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
  async createLead(leadData, acctId, category = null, mergeProperties = null) {
    try {
      const categoryName = category || 'default';

      const EXCLUDED_FIELDS = new Set(['_id', 'acctId', 'categoryId', '__v', 'createdAt', 'updatedAt', 'category']);
      const extractFields = (item) => Object.keys(item).filter(k => !EXCLUDED_FIELDS.has(k));

      // Compute new fields from payload upfront — required before the category query so we can
      // merge the $addToSet into the same round-trip as find-or-create (saves 1–2 DB calls).
      const newFields = Array.isArray(leadData)
        ? [...new Set(leadData.flatMap(extractFields))]
        : extractFields(leadData);

      // Query 1 of 2 (was 3 of 4):
      // Find-or-create category AND track field names — single round-trip.
      // $setOnInsert fires only on new docs; $addToSet is a safe no-op if fields already exist.
      const rawCatResult = await LeadCategory.findOneAndUpdate(
        { acctId, categoryName },
        {
          $setOnInsert: { acctId, categoryName, default: false },
          ...(newFields.length > 0 && { $addToSet: { fields: { $each: newFields } } })
        },
        { upsert: true, new: true, rawResult: true }
      );

      const categoryDoc = rawCatResult.value;
      const categoryId = categoryDoc._id;

      // If this was a brand-new category, async-check if it's the first for the account
      // and mark it as default. Non-blocking — does not delay the lead insert response.
      if (!rawCatResult.lastErrorObject?.updatedExisting) {
        LeadCategory.countDocuments({ acctId })
          .then(count => {
            if (count === 1) {
              return LeadCategory.updateOne({ _id: categoryId }, { $set: { default: true } });
            }
          })
          .catch(err => console.error('[LeadService] Failed to set default category:', err));
      }

      const addCategoryId = (item) => ({ ...item, categoryId });

      // Build filter for merge-based upsert: scoped to acctId + specified merge fields
      const buildMergeFilter = (item) => {
        if (!mergeProperties?.length) return {};
        const filter = { acctId };
        for (const prop of mergeProperties) {
          if (prop in item) filter[prop] = item[prop];
        }
        return filter;
      };

      // Query 2 of 2 (was 4 of 4): Insert lead(s)
      let leadResult;
      if (Array.isArray(leadData)) {
        if (mergeProperties?.length) {
          // Single bulkWrite round-trip for array + merge: one network call for all writes
          const ops = leadData.map(item => {
            const enriched = addCategoryId({ ...item, acctId });
            return { updateOne: { filter: buildMergeFilter(item), update: { $set: enriched }, upsert: true } };
          });
          await Lead.bulkWrite(ops, { ordered: false });
          // Re-fetch the upserted/updated docs via the same merge conditions
          const mergeFilters = leadData.map(item => buildMergeFilter(item));
          leadResult = await Lead.find({ $or: mergeFilters }).lean();
        } else {
          const results = await Promise.all(
            leadData.map(item => performUpsert(Lead, {}, addCategoryId({ ...item, acctId })))
          );
          leadResult = results.map(r => r.doc);
        }
      } else {
        const result = await performUpsert(Lead, buildMergeFilter(leadData), addCategoryId({ ...leadData, acctId }));
        leadResult = result.doc;
      }

      return { lead: leadResult, category: { data: categoryDoc } };
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
        sortBy = 'updatedAt',
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

      // Apply any extra field filters dynamically.
      // Numeric values use exact match; strings use case-insensitive regex.
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined && value !== null && value !== '') {
          const numeric = Number(value);
          query[key] = !isNaN(numeric) && value !== ''
            ? numeric
            : { $regex: value, $options: 'i' };
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

      // Fetch leads, total count, and category fields in one parallel round-trip
      const [getResult, total, categoryDoc] = await Promise.all([
        performGet(Lead, query, [], { sort, skip, limit }),
        performCount(Lead, query),
        categoryId
          ? LeadCategory.findOne({ _id: categoryId }, { fields: 1 }).lean()
          : Promise.resolve(null)
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
        categoryFields: categoryDoc?.fields ?? [],
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
   * Get a single lead by ID
   */
  async getLeadById(id) {
    try {
      const result = await performGet(Lead, { _id: id });
      return result?.data?.[0] || null;
    } catch (error) {
      console.error('Error getting lead by id:', error);
      throw new Error(`Failed to get lead: ${error.message}`);
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
   * Get all unique field names per category — reads directly from LeadCategory.fields.
   * Fields are populated by: backfillFields.js script (one-time) + $addToSet on createLead (ongoing).
   */
  async getFieldsByCategory(acctId) {
    try {
      const categories = await LeadCategory.find({ acctId }).lean();
      return categories.map(cat => ({
        categoryId: cat._id,
        categoryName: cat.categoryName,
        default: cat.default,
        fields: [...(cat.fields || []), 'createdAt', 'updatedAt']
      }));
    } catch (error) {
      console.error('Error getting fields by category:', error);
      throw new Error(`Failed to get fields: ${error.message}`);
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
