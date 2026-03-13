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

// Index for scoped lead queries (grid find + countDocuments)
leadSchema.index({ acctId: 1 });

// Compound index for scoped lead queries with default createdAt sort and analytics date range
leadSchema.index({ acctId: 1, createdAt: -1 });

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
