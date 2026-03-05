/**
 * Generic Mongoose DB Helpers
 */

/**
 * Upsert a document.
 * - Empty filter {} → always inserts a new document.
 * - Non-empty filter → findOneAndUpdate with upsert: true.
 * Returns { upsertedId, doc }
 *   upsertedId — ObjectId when a NEW doc was created; null when updated.
 */
export const performUpsert = async (model, filter, data) => {
    if (!filter || Object.keys(filter).length === 0) {
        const doc = await model.create(data);
        return { upsertedId: doc._id, doc };
    }

    const result = await model.findOneAndUpdate(
        filter,
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
    );

    return {
        upsertedId: result.lastErrorObject?.upserted || null,
        doc: result.value
    };
};

/**
 * Fetch documents matching a filter.
 * Always returns { success, data }.
 */
export const performGet = async (model, filter = {}) => {
    try {
        const data = await model.find(filter).lean();
        return { success: true, data };
    } catch (error) {
        console.error('[DB] performGet error:', error.message);
        return { success: false, data: [], error: error.message };
    }
};

/**
 * Check whether at least one matching document exists.
 * Returns true / false.
 */
export const perfomDataExistanceCheck = async (model, filter = {}) => {
    const doc = await model.findOne(filter).lean();
    return !!doc;
};
