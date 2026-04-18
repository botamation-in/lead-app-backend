import mongoose from 'mongoose';

const accountApiKeySchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: () => new mongoose.Types.ObjectId().toHexString()
        },
        acctId: {
            type: String,
            ref: 'Account',
            required: true
        },
        apiKey: {
            type: String,
            required: true
        }
    },
    { timestamps: true, collection: 'accountApiKey' }
);

// Index for API key auth middleware — runs on every inbound API request
accountApiKeySchema.index({ apiKey: 1 });

// Index for token lookup by account
accountApiKeySchema.index({ acctId: 1 });

const accountApiKeyModel = mongoose.model('AccountApiKey', accountApiKeySchema);

export default accountApiKeyModel;
