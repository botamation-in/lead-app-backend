import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toHexString()
    },
    trainerName: {
      type: String
    },
    memberName: {
      type: String
    },
    email: {
      type: String
    },
    phone: {
      type: String
    },
    status: {
      type: String,
      default: 'new'
    },
    source: {
      type: String
    },
    notes: {
      type: String
    },
    adminId: {
      type: String,
      default: null,
      index: true
    },
    acctId: {
      type: String,
      ref: 'Account',
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
