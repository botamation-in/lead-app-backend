import mongoose from 'mongoose';

const analyticsSchemaModel = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: () => new mongoose.Types.ObjectId().toHexString()
        },
        userId: {
            type: String,
            required: true
        },
        acctId: {
            type: String,
            required: true
        },
        adminId: {
            type: String,
            required: false
        },
        schema: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true, collection: 'analytics' }
);

const AnalyticsSchema = mongoose.model('AnalyticsSchema', analyticsSchemaModel);

export default AnalyticsSchema;
