import mongoose from 'mongoose';

const leadCategorySchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: () => new mongoose.Types.ObjectId().toHexString()
        },
        acctId: {
            type: String,
            required: true
        },
        categoryName: {
            type: String,
            required: true
        },
        default: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

leadCategorySchema.index({ acctId: 1 });
leadCategorySchema.index({ acctId: 1, categoryName: 1 }, { unique: true });

const LeadCategory = mongoose.model('LeadCategory', leadCategorySchema);

export default LeadCategory;
