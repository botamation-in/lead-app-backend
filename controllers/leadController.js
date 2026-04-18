import leadService from '../services/leadService.js';
import { addToQueue } from '../queue/leadQueue.js';
import UserAccount from '../models/userAccountModel.js';
import { perfomDataExistanceCheck } from '../config/mongoConnector.js';

const QUEUE_ENQUEUE_TIMEOUT_MS = parseInt(process.env.LEAD_QUEUE_ENQUEUE_TIMEOUT_MS ?? '3000', 10);
const withTimeout = (promise, timeoutMs, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
]);

class LeadController {
  /**
   * Create new lead(s)
   * POST /api/leads        — API key path  → queued  (202 Accepted)
   * POST /api/ui/leads     — SSO path      → synchronous (201 Created + data)
   */
  async createLead(req, res) {
    try {
      const body = req.body;

      // Expect { config?, data } envelope — data is mandatory
      const data = body?.data;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'data is required'
        });
      }

      const mergeProperties = body?.config?.merge?.properties ?? null;

      // acctId is set on req by both apiKey and SSO middlewares — no DB lookup needed.
      // JWT may not carry acctId (multi-tenant). Fall back to query param or body,
      // then verify the user belongs to that account.
      let acctId = req.user?.acctId || req.acctId;
      if (!acctId) {
        const candidateAcctId = req.query.acctId || req.body?.acctId;
        if (candidateAcctId && req.user?.userId) {
          const linked = await perfomDataExistanceCheck(UserAccount, { userId: req.user.userId, acctId: candidateAcctId });
          if (!linked) {
            return res.status(403).json({ success: false, message: 'Access denied: you do not belong to the specified account' });
          }
          acctId = candidateAcctId;
        }
      }
      if (!acctId) {
        return res.status(400).json({
          success: false,
          message: 'Authenticated account context is required'
        });
      }

      const category = req.params.category || req.params.id || (Array.isArray(data) ? null : data.category) || req.query.category || null;
      // Strip category field from lead payload so it's not stored on the lead
      const leadPayload = Array.isArray(data)
        ? data.map(({ category: _, ...rest }) => rest)
        : (({ category: _, ...rest }) => rest)(data);

      // ── Path split ──────────────────────────────────────────────────────────
      // req.user is only set by ssoAuthMiddleware.
      // req.acctId (without req.user) is set only by apiKeyAuthMiddleware.
      // API key callers get async queue processing; SSO/UI callers stay synchronous.
      const isApiKeyRequest = !req.user && !!req.acctId;

      if (isApiKeyRequest) {
        // ── Async path (API key) ─────────────────────────────────────────────
        // Enqueue and return 202 immediately — the worker handles the DB write.
        // If queueing is unavailable, fall back to synchronous create to avoid hanging requests.
        try {
          const job = await withTimeout(
            addToQueue({ acctId, leadPayload, category, mergeProperties }),
            QUEUE_ENQUEUE_TIMEOUT_MS,
            `Queue enqueue timed out after ${QUEUE_ENQUEUE_TIMEOUT_MS}ms`
          );

          return res.status(202).json({
            success: true,
            message: Array.isArray(leadPayload)
              ? `${leadPayload.length} lead(s) queued for processing`
              : 'Lead queued for processing',
            jobId: job.id
          });
        } catch (queueError) {
          console.warn('Queue unavailable, processing lead synchronously:', queueError.message);

          const result = await leadService.createLead(leadPayload, acctId, category, mergeProperties);
          return res.status(201).json({
            success: true,
            message: Array.isArray(leadPayload)
              ? `${result.lead.length} leads created successfully (queue unavailable, processed synchronously)`
              : 'Lead created successfully (queue unavailable, processed synchronously)',
            data: result.lead,
            ...(result.category && { category: result.category.data }),
            queueFallback: true
          });
        }
      }

      // ── Synchronous path (SSO / UI) ──────────────────────────────────────
      const result = await leadService.createLead(leadPayload, acctId, category, mergeProperties);

      return res.status(201).json({
        success: true,
        message: Array.isArray(leadPayload)
          ? `${result.lead.length} leads created successfully`
          : 'Lead created successfully',
        data: result.lead,
        ...(result.category && { category: result.category.data })
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
        sortBy: sortBy || 'updatedAt',
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
   * PUT /api/leads/:id — identical behaviour to POST; :id segment is treated as the category
   */
  async updateLead(req, res) {
    try {
      const { id } = req.params;

      // JWT may not carry acctId (multi-tenant).
      // Fall back to query param or body, then verify the user belongs to that account.
      let callerAcctId = req.user?.acctId || req.acctId;
      if (!callerAcctId) {
        const candidateAcctId = req.query.acctId || req.body?.acctId;
        if (candidateAcctId && req.user?.userId) {
          const linked = await perfomDataExistanceCheck(UserAccount, { userId: req.user.userId, acctId: candidateAcctId });
          if (!linked) {
            return res.status(403).json({ success: false, message: 'Access denied: you do not belong to the specified account' });
          }
          callerAcctId = candidateAcctId;
        }
      }
      if (!callerAcctId) {
        return res.status(400).json({ success: false, message: 'Authenticated account context is required' });
      }

      // Accept either { data: {...} } envelope or a flat body; strip routing-only fields from payload
      const rawBody = req.body?.data ?? req.body;
      const { acctId: _a, acctNo: _n, ...updateData } = rawBody || {};
      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({ success: false, message: 'No update data provided' });
      }

      const existing = await leadService.getLeadById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Lead not found' });
      }
      if (existing.acctId !== callerAcctId) {
        return res.status(403).json({ success: false, message: 'Access denied: lead does not belong to your account' });
      }

      const updated = await leadService.updateLead(id, updateData);

      return res.status(200).json({
        success: true,
        message: 'Lead updated successfully',
        data: updated
      });
    } catch (error) {
      console.error('Error in updateLead:', error);
      return res.status(error.statusCode || 400).json({
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

      // Require acctId from query params or body
      const bodyAcctId = req.query?.acctId || req.body?.acctId;
      if (!bodyAcctId) {
        return res.status(400).json({ success: false, message: 'acctId is required' });
      }

      // Resolve the caller's acctId — JWT, API key, body
      let callerAcctId = req.user?.acctId || req.acctId;
      if (!callerAcctId) {
        if (bodyAcctId && req.user?.userId) {
          const linked = await perfomDataExistanceCheck(UserAccount, { userId: req.user.userId, acctId: bodyAcctId });
          if (!linked) {
            return res.status(403).json({ success: false, message: 'Access denied: you do not belong to the specified account' });
          }
          callerAcctId = bodyAcctId;
        }
      }
      if (!callerAcctId) {
        callerAcctId = bodyAcctId;
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
   * Get all unique field names per category
   * GET /api/ui/leads/fields?acctId=
   */
  async getFields(req, res) {
    try {
      const acctId = req.user?.acctId || req.acctId || req.query.acctId || req.headers['x-acctno'];
      if (!acctId) {
        return res.status(400).json({ success: false, message: 'acctId is required' });
      }

      const data = await leadService.getFieldsByCategory(acctId);
      return res.status(200).json({ success: true, categories: data });
    } catch (error) {
      console.error('Error in getFields:', error);
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
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
