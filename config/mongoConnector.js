import mongoose from 'mongoose';

class MongoConnector {
  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      const dbName = process.env.MONGO_DB_NAME || 'leadapp';

      await mongoose.connect(mongoUri, {
        dbName,
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

export async function performUpsert(Model, filter, data) {
  if (Object.keys(filter).length === 0) {
    const doc = await Model.create(data);
    return { doc };
  }
  const doc = await Model.findOneAndUpdate(filter, { $set: data }, { new: true, upsert: true });
  return { doc };
}

export async function performGet(Model, query, populate = [], options = {}) {
  const { sort, skip, limit } = options;
  let q = Model.find(query);
  if (populate && populate.length) q = q.populate(populate);
  if (sort) q = q.sort(sort);
  if (skip != null) q = q.skip(skip);
  if (limit != null) q = q.limit(limit);
  const data = await q;
  return { success: true, data };
}

export async function performCount(Model, query) {
  return Model.countDocuments(query);
}

export async function perfomDataExistanceCheck(Model, filter) {
  return Model.findOne(filter).lean();
}

export async function performDelete(Model, filter) {
  return Model.deleteOne(filter);
}

export async function performAggregate(Model, pipeline, options = {}) {
  return Model.aggregate(pipeline).option({ allowDiskUse: true, ...options });
}
