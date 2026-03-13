import mongoose from 'mongoose';

const accountAdminSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: () => new mongoose.Types.ObjectId().toHexString()
        },
        acctNo: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        adminId: {
            type: String,
            default: null
        },
        firstName: {
            type: String,
            default: null
        },
        lastName: {
            type: String,
            default: null
        },
        phone: {
            type: String,
            default: null
        },
        email: {
            type: String,
            default: null
        },
        profileImage: {
            type: String,
            default: null
        }
    },
    { timestamps: true, collection: 'accountAdmins' }
);

// Unique per admin within an account
accountAdminSchema.index({ acctNo: 1, adminId: 1 }, { unique: true, sparse: true });

const AccountAdmin = mongoose.model('AccountAdmin', accountAdminSchema);

export default AccountAdmin;
