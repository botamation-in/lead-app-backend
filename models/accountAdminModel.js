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
            trim: true
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

// Compound index for admin upsert filter and admin list queries (acctNo prefix covers single-field acctNo queries too)
accountAdminSchema.index({ acctNo: 1, adminId: 1 });

// Index for lead enrichment — find admins by adminId $in after every paginated lead list
accountAdminSchema.index({ adminId: 1 });

const AccountAdmin = mongoose.model('AccountAdmin', accountAdminSchema);

export default AccountAdmin;
