import mongoose from 'mongoose';

class MongoConnector {
  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/leadapp';
      
      await mongoose.connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });

      console.log('MongoDB connected successfully');
      return true;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log('MongoDB disconnected');
      return true;
    } catch (error) {
      console.error('MongoDB disconnection error:', error);
      throw error;
    }
  }
}

export default new MongoConnector();

/**
 * Perform an upsert operation on a MongoDB collection.
 * - Empty filterCriteria {} → always inserts a new document.
 * - Non-empty filterCriteria → updateOne with $set and upsert: true.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter to find the document
 * @param {Object} updateData - Fields to set / insert
 * @param {boolean} isFlattenedUpdate - Flatten nested objects to dot-notation before $set
 * @returns {Promise<Object>} - { success, upsertedCount, modifiedCount, upsertedId }
 */
export const performUpsert = async (collection, filterCriteria, updateData, isFlattenedUpdate) => {
  try {
    if (Object.keys(filterCriteria).length === 0) {
      const newDoc = new collection(updateData);
      const result = await newDoc.save();
      return {
        success: true,
        upsertedCount: 1,
        modifiedCount: 0,
        upsertedId: result._id
      };
    }

    let flattenedUpdate = updateData;
    if (isFlattenedUpdate) {
      flattenedUpdate = {};
      const flatten = (obj, prefix = '') => {
        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            flatten(obj[key], `${prefix}${key}.`);
          } else {
            flattenedUpdate[`${prefix}${key}`] = obj[key];
          }
        }
      };
      flatten(updateData);
    }

    const result = await collection.updateOne(
      filterCriteria,
      { $set: flattenedUpdate },
      { upsert: true }
    );

    return {
      success: result.upsertedCount > 0 || result.modifiedCount > 0 || result.matchedCount > 0,
      ...result
    };
  } catch (error) {
    console.error('Error performing upsert:', error);
    throw error;
  }
};

/**
 * Fetch documents from a MongoDB collection.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter criteria
 * @param {Array}  fields - Field paths to project (e.g. ["name", "settings.email"])
 * @param {Object} options - { sort, skip, limit } for sorting/pagination
 * @returns {Promise<Object>} - { success, count, data }
 */
export const performGet = async (collection, filterCriteria, fields = [], options = {}) => {
  try {
    const projection = fields.reduce((acc, field) => {
      acc[field] = 1;
      return acc;
    }, {});

    let query = collection.find(filterCriteria, projection);

    if (options.sort && Object.keys(options.sort).length > 0) {
      query = query.sort(options.sort);
    }
    if (options.skip) query = query.skip(options.skip);
    if (options.limit) query = query.limit(options.limit);

    const results = await query.lean();

    if (!results || results.length === 0) {
      return { success: false, message: 'No documents found', data: [] };
    }

    return { success: true, count: results.length, data: results };
  } catch (error) {
    console.error('Error performing get:', error);
    throw error;
  }
};

/**
 * Check whether at least one document matching the filter exists.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter criteria
 * @returns {Promise<Object|null>} - Mongoose exists() result (truthy) or null
 */
export const perfomDataExistanceCheck = async (collection, filterCriteria) => {
  try {
    return await collection.exists(filterCriteria);
  } catch (error) {
    console.error('Error checking document existence:', error);
    throw error;
  }
};

/**
 * Delete all documents matching the filter.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter criteria
 * @returns {Promise<Object>} - { success, deletedCount }
 */
export const performDelete = async (collection, filterCriteria) => {
  try {
    const result = await collection.deleteMany(filterCriteria);
    return {
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount
    };
  } catch (error) {
    console.error('Error performing delete:', error);
    throw error;
  }
};

/**
 * Remove specific properties from matching documents using $unset.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter criteria
 * @param {Array}  properties - Property paths to remove (e.g. ["settings.token"])
 * @returns {Promise<Object>} - { success, modifiedCount, matchedCount }
 */
export const performRemoveProperties = async (collection, filterCriteria, properties = []) => {
  try {
    const unsetObject = properties.reduce((acc, prop) => {
      acc[prop] = 1;
      return acc;
    }, {});

    const result = await collection.updateOne(
      filterCriteria,
      { $unset: unsetObject }
    );

    return {
      success: result.modifiedCount > 0,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
    };
  } catch (error) {
    console.error('Error removing properties:', error);
    throw error;
  }
};

/**
 * Count documents matching a filter.
 * @param {Object} collection - Mongoose model
 * @param {Object} filterCriteria - Filter criteria
 * @returns {Promise<number>} - Count of matching documents
 */
export const performCount = async (collection, filterCriteria = {}) => {
  try {
    return await collection.countDocuments(filterCriteria);
  } catch (error) {
    console.error('Error performing count:', error);
    throw error;
  }
};

/**
 * Run an aggregation pipeline on a collection.
 * @param {Object} collection - Mongoose model
 * @param {Array}  pipeline - Mongoose aggregation pipeline stages
 * @returns {Promise<Array>} - Aggregation results
 */
export const performAggregate = async (collection, pipeline) => {
  try {
    return await collection.aggregate(pipeline);
  } catch (error) {
    console.error('Error performing aggregate:', error);
    throw error;
  }
};
