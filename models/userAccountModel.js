import mongoose from 'mongoose';

/**
 * User ↔ Account relationship
 * role: 0 = superadmin (default), 1 = admin
 */
const userAccountSchema = new mongoose.Schema(
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
            ref: 'Account',
            required: true
        },
        calendarIds: {
            type: [String],
            default: []
        },
        canCreateCalendar: {
            type: Boolean,
            default: true
        },
        role: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true, collection: 'user_account_rel' }
);

// Index for fetching all accounts belonging to a user (accountController — every page load)
userAccountSchema.index({ userId: 1 });

// Unique compound index for user-account link checks and account link/unlink flows
userAccountSchema.index({ userId: 1, acctId: 1 }, { unique: true });

const UserAccount = mongoose.model('UserAccount', userAccountSchema);

export default UserAccount;
