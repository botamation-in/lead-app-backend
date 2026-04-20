/**
 * seedLeads_1cr.js
 *
 * Inserts 1 crore (1,00,00,000) lead records into MongoDB.
 *
 * Structure:
 *   - 10 accounts  (acctNo 1717193 & 1503145 mandatory; 8 more auto-picked or dummy-created)
 *   - 10 categories per account  (Cat1 – Cat10, created if missing)
 *   - 1,00,000 leads per category
 *   - Total: 10 × 10 × 1,00,000 = 1,00,00,000
 *
 * Run:
 *   $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config .\scripts\seedLeads_1cr.js
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ── env ──────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGO_DB_NAME || 'leadapp';

// ── schemas ──────────────────────────────────────────────────────────────────
const accountSchema = new mongoose.Schema({ _id: String, acctNo: String }, { strict: false });
const Account = mongoose.model('Account', accountSchema);

const categorySchema = new mongoose.Schema(
    { _id: String, acctId: String, categoryName: String, default: Boolean, fields: [String] },
    { strict: false, timestamps: true }
);
const Category = mongoose.model('Category', categorySchema, 'leadcategories');

const leadSchema = new mongoose.Schema(
    { _id: String, acctId: String, categoryId: String },
    { strict: false, timestamps: true }
);
const Lead = mongoose.model('Lead', leadSchema);

// ── config ────────────────────────────────────────────────────────────────────
const MANDATORY_ACCT_NOS = ['1717193', '1503145'];
const TOTAL_ACCOUNTS = 10;
const CATEGORIES_PER_ACCT = 10;
const LEADS_PER_CATEGORY = 100_000;
const BATCH_SIZE = 10_000;
const LOG_EVERY = 100_000;

// Fields tracked on leadcategories.fields (mirrors what createLead() does)
const TRACKED_LEAD_FIELDS = [
    'memberName', 'age', 'phone', 'email', 'status',
    'source', 'trainerName', 'dueDate', 'notes'
];

// ── static data pools ─────────────────────────────────────────────────────────
const STATUSES = ['new', 'contacted', 'qualified', 'lost', 'won'];
const SOURCES = ['instagram', 'facebook', 'website', 'referral', 'walk-in'];
const TRAINERS = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram'];
const now = Date.now();
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

// ── helpers ───────────────────────────────────────────────────────────────────
function newId() {
    return new mongoose.Types.ObjectId().toHexString();
}

async function ensureCategory(acctId, categoryName, isDefault) {
    let cat = await Category.findOne({ acctId, categoryName }).lean();
    if (!cat) {
        cat = await Category.create({
            _id: newId(),
            acctId,
            categoryName,
            default: isDefault,
            fields: TRACKED_LEAD_FIELDS
        });
        console.log(`  ✚ Created category "${categoryName}" for acctId ${acctId}`);
    } else {
        // Ensure fields array is populated even if category already existed
        await Category.updateOne(
            { _id: cat._id },
            { $addToSet: { fields: { $each: TRACKED_LEAD_FIELDS } } }
        );
    }
    return cat._id;
}

function buildLead(globalIndex, acctId, categoryId) {
    const date = new Date(now - Math.random() * ONE_YEAR);
    return {
        _id: newId(),
        acctId,
        categoryId,
        memberName: `User_${globalIndex}`,
        age: 18 + (globalIndex % 45),
        phone: '9' + String(globalIndex % 1_000_000_000).padStart(9, '0'),
        email: `user${globalIndex}@example.com`,
        status: STATUSES[globalIndex % STATUSES.length],
        source: SOURCES[globalIndex % SOURCES.length],
        trainerName: TRAINERS[globalIndex % TRAINERS.length],
        dueDate: new Date(now + (globalIndex % 30) * 86_400_000).toISOString().split('T')[0],
        notes: 'Auto-generated bulk lead',
        createdAt: date,
        updatedAt: date
    };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function run() {
    console.log(`\n🔌 Connecting to ${mongoUri} (db: ${dbName}) ...`);
    await mongoose.connect(mongoUri, { dbName });
    console.log('✅ Connected.\n');

    // ── 1. Resolve / create accounts ──────────────────────────────────────────
    console.log('🔍 Resolving accounts...');
    const allDesiredAcctNos = [...MANDATORY_ACCT_NOS];
    for (let i = 3; i <= TOTAL_ACCOUNTS; i++) {
        allDesiredAcctNos.push(`DUMMY_ACCT_${String(i).padStart(3, '0')}`);
    }

    const accounts = [];
    for (const acctNo of allDesiredAcctNos) {
        let acct = await Account.findOne({ acctNo }).lean();
        if (!acct) {
            acct = await Account.create({
                _id: newId(),
                acctNo,
                accountName: `Account ${acctNo}`,
                timezone: 'Asia/Calcutta'
            });
            console.log(`  ✚ Created account acctNo=${acctNo}  _id=${acct._id}`);
        } else {
            console.log(`  ✔ Found  account acctNo=${acct.acctNo}  _id=${acct._id}`);
        }
        accounts.push(acct);
    }

    console.log(`\n📋 Accounts (${accounts.length}):`);
    accounts.forEach((a, i) => console.log(`   ${i + 1}. acctNo=${a.acctNo}  _id=${a._id}`));

    // ── 2. Resolve / create categories ────────────────────────────────────────
    console.log('\n🗂️  Resolving categories...');
    const categoryMap = {};
    for (const acct of accounts) {
        categoryMap[acct._id] = [];
        for (let c = 1; c <= CATEGORIES_PER_ACCT; c++) {
            const catId = await ensureCategory(acct._id, `Cat${c}`, c === 1);
            categoryMap[acct._id].push(catId);
        }
    }

    // ── 3. Insert leads ────────────────────────────────────────────────────────
    const totalRecords = accounts.length * CATEGORIES_PER_ACCT * LEADS_PER_CATEGORY;
    console.log(`\n🚀 Starting insertion of ${totalRecords.toLocaleString('en-IN')} records`);
    console.log(`   ${accounts.length} accounts × ${CATEGORIES_PER_ACCT} categories × ${LEADS_PER_CATEGORY.toLocaleString('en-IN')} leads`);
    console.log(`   Batch size: ${BATCH_SIZE.toLocaleString('en-IN')}\n`);

    let globalInserted = 0;
    let globalIndex = 0;
    console.time('Total Insertion Time');

    for (const acct of accounts) {
        console.log(`\n── Account: ${acct.acctNo}  (_id=${acct._id})`);

        for (const catId of categoryMap[acct._id]) {
            let catInserted = 0;

            while (catInserted < LEADS_PER_CATEGORY) {
                const thisBatch = Math.min(BATCH_SIZE, LEADS_PER_CATEGORY - catInserted);
                const batch = [];

                for (let k = 0; k < thisBatch; k++) {
                    batch.push(buildLead(globalIndex++, acct._id, catId));
                }

                await Lead.insertMany(batch, { ordered: false });
                catInserted += thisBatch;
                globalInserted += thisBatch;

                if (globalInserted % LOG_EVERY === 0) {
                    const pct = ((globalInserted / totalRecords) * 100).toFixed(1);
                    console.log(`📊 Progress: ${globalInserted.toLocaleString('en-IN')} / ${totalRecords.toLocaleString('en-IN')} (${pct}%)`);
                }
            }

            console.log(`   ✅ catId=${catId} — ${catInserted.toLocaleString('en-IN')} leads inserted`);
        }
    }

    console.log('\n✅ All done!');
    console.log(`   Total inserted: ${globalInserted.toLocaleString('en-IN')}`);
    console.timeEnd('Total Insertion Time');

    await mongoose.disconnect();
    console.log('🔌 MongoDB disconnected.');
}

run().catch(err => {
    console.error('\n❌ Fatal error:', err);
    mongoose.disconnect().finally(() => process.exit(1));
});
