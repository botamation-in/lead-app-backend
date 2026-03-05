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
        },
        name: {
            type: String,
            default: 'Default API Key'
        }
    },
    { timestamps: true }
);

const accountApiKeyModel = mongoose.model('AccountApiKey', accountApiKeySchema);

export default accountApiKeyModel;
