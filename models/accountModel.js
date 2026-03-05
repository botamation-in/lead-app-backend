import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: () => new mongoose.Types.ObjectId().toHexString()
        },
        acctNo: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        accountName: {
            type: String,
            required: true,
            trim: true
        },
        profileImageUrl: {
            type: String,
            default: null
        },
        timezone: {
            type: String,
            default: 'Asia/Calcutta'
        }
    },
    { timestamps: true }
);

const acctDataModel = mongoose.model('Account', accountSchema);

export default acctDataModel;
