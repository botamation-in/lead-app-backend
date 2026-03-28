import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toHexString()
    },
    acctId: {
      type: String
    }
  },
  {
    strict: false,
    timestamps: true
  }
);

// Compound index: category-scoped queries sorted by updatedAt (covers find + sort + countDocuments)
leadSchema.index({ acctId: 1, categoryId: 1, updatedAt: -1 });

// Fallback index: account-scoped queries without categoryId
leadSchema.index({ acctId: 1, updatedAt: -1 });

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
