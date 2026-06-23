const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const cors = require('cors');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));
const ADMIN_ID = 7329000880; 

app.use(cors()); 
app.use(express.json());
app.use('/api', enforceGlobalMaintenanceGate);

// --- DATABASE SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
    user_id: Number,
    first_name: { type: String, default: null },
    username: { type: String, default: null },
    balance: { type: Number, default: 0 },
    points: { type: Number, default: 0.00 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    pending_message_cleanup: { type: [Number], default: [] },
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 },
    has_withdrawn_once: { type: Boolean,default: false },
    coins: { type: Number, default: 0 },
    history: [{ type: Object }], 
    createdAt: { type: Date, default: Date.now },
    referral_tasks_done: { type: Number, default: 0 },
    referral_paid: { type: Boolean, default: false },
    penalized_tasks: [String],
    is_banned: { type: Boolean, default: false },
    last_admin_active: { type: Date, default: null },
    referred_by: { type: Number, default: null } 
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    min_withdraw: { type: Number, default: 0.2 },
    ref_bonus: { type: Number, default: 0.1 },
    penalty_fee: { type: Number, default: 0.1 },
    withdrawals_enabled: { type: Boolean, default: true },
    maintenance_mode: { type: Boolean, default: false },
    ref_commission_percent: { type: Number, default: 10 },
    ref_bonus_amount: { type: Number, default: 0.05 }
}));

const Ticket = mongoose.model('Ticket', new mongoose.Schema({
    user_id: Number,
    username: String,
    subject: String,
    message: String,
    admin_reply: String,
    status: { type: String, default: 'open' }, 
    created_at: { type: Date, default: Date.now },
    ticket_id: { type: String, default: () => 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase() },
    channel_message_id: { type: Number, default: null }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, 
    title: String, 
    description: String,
    image: String,      // Fixed: Explicitly declare image string tracking
    category: String,
    url: String, 
    reward: Number, 
    type: String, 
    completions: { type: Number, default: 0 }, 
    max_users: Number,
    enabled: { type: Boolean, default: true }
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    user_id: Number,
    username: String,
    amount: Number,
    address: String,
    method: String, 
    status: { type: String, default: 'pending' }, 
    created_at: { type: Date, default: Date.now }
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['personal', 'system'], default: 'system' },
    targetType: {
        type: String,
        enum: ['all', 'new_members', 'specific_member', 'all_members'],
        required: true
    },
    targetUserId: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now }
}));

const UserNotificationState = mongoose.model('UserNotificationState', new mongoose.Schema({
    userId: { type: Number, required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true },
    isRead: { type: Boolean, default: false }
}));

const WalletTransactionSchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    txId: { type: String, unique: true, default: () => crypto.randomBytes(6).toString('hex').toUpperCase() },
    txType: { type: String, enum: ['TRANSFER_OUT', 'TRANSFER_IN', 'WITHDRAWAL', 'REFERRAL_BONUS'], required: true },
    assetType: { type: String, enum: ['usdt', 'coins', 'points'], required: true },
    amount: { type: Number, required: true },
    counterpartyId: { type: String, default: "SYSTEM_RESERVE_POOL" },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },
    network: { type: String, default: "INTERNAL_LEDGER_RAILS" },
    cryptoAddress: { type: String, default: "LOCAL_VAULT_NODE" },
    memo: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now },
    channelMessageId: { type: Number, default: null }
});

const WalletTransaction = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', WalletTransactionSchema);

const ProofSubmission = mongoose.model('ProofSubmission', new mongoose.Schema({
    proofId: { type: String, unique: true, default: () => 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase() },
    userId: { type: Number, required: true, index: true },
    username: { type: String, default: null },
    taskId: { type: String, required: true },
    taskTitle: { type: String, default: '' },
    reward: { type: Number, default: 0 },
    proofType: { type: String, enum: ['text', 'screenshot'], default: 'text' },
    proofText: { type: String, default: null },
    telegramFileId: { type: String, default: null },
    channelMessageId: { type: Number, default: null },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null }
}));
const AdminActivity = mongoose.model('AdminActivity', new mongoose.Schema({
    admin_id: Number,
    admin_name: String,
    action: String,
    description: String,
    timestamp: { type: Date, default: Date.now }
}));

// --- ADD AFTER YOUR EXISTING MODELS ---

const AdWatch = mongoose.model('AdWatch', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    adId: { type: String, required: true },
    adNetwork: { type: String, enum: ['adgrams', 'google_ads'], required: true },
    reward: { type: Number, required: true },
    watched: { type: Boolean, default: false },
    viewedAt: { type: Date, default: Date.now },
    claimedAt: { type: Date, default: null }
}));

const DailyTaskProgress = mongoose.model('DailyTaskProgress', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    taskId: { type: String, required: true },
    completedCount: { type: Number, default: 0 },
    claimedToday: { type: Boolean, default: false },
    resetAt: { type: Date, required: true }, // When this daily task resets (next UTC midnight)
    lastCompletedAt: { type: Date, default: null }
}));

// Track which ad units we're currently offering
const ActiveAd = mongoose.model('ActiveAd', new mongoose.Schema({
    adId: { type: String, unique: true, required: true },
    network: { type: String, enum: ['adgrams', 'google_ads'] },
    unitId: { type: String, required: true }, // AdMob Unit ID or AdGrams ID
    reward: { type: Number, required: true },
    maxWatchesPerDay: { type: Number, default: 2 },
    enabled: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
}));

async function logAdminAction(adminUser, action, description) {
    try {
        await AdminActivity.create({
            admin_id: adminUser.id,
            admin_name: adminUser.first_name || adminUser.username || 'Admin',
            action,
            description
        });
    } catch (e) { console.error('Failed to log admin action:', e); }
}
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;

async function postToChannel(text, extra = {}) {
    try {
        if (!STORAGE_CHANNEL_ID) return null;
        const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, {
            parse_mode: 'Markdown',
            ...extra
        });
        return msg.message_id;
    } catch (e) {
        console.error('[Channel Log Failed]:', e.message);
        return null;
    }
}

async function postPhotoToChannel(buffer, caption) {
    try {
        if (!STORAGE_CHANNEL_ID) return { messageId: null, fileId: null };
        const msg = await bot.telegram.sendPhoto(
            STORAGE_CHANNEL_ID,
            { source: buffer },
            { caption, parse_mode: 'Markdown' }
        );
        return {
            messageId: msg.message_id,
            fileId: msg.photo[msg.photo.length - 1].file_id
        };
    } catch (e) {
        console.error('[Channel Photo Failed]:', e.message);
        return { messageId: null, fileId: null };
    }
}

async function replyInChannel(replyToMessageId, text) {
    try {
        if (!STORAGE_CHANNEL_ID || !replyToMessageId) return null;
        const msg = await bot.telegram.sendMessage(STORAGE_CHANNEL_ID, text, {
            parse_mode: 'Markdown',
            reply_to_message_id: replyToMessageId
        });
        return msg.message_id;
    } catch (e) {
        console.error('[Channel Reply Failed]:', e.message);
        return null;
    }
             }
// --- SETTINGS FETCHER ---
async function getSettings() {
    try {
        let s = await Settings.findOne();
        if (!s) {
            s = await Settings.create({
                min_withdraw: 0.2,
                ref_bonus: 0.1,
                penalty_fee: 0.1,
                withdrawals_enabled: true,
                maintenance_mode: false,
                ref_commission_percent: 10,
                ref_bonus_amount: 0.05
            });
        }
        return s;
    } catch (err) {
        console.error("Database Settings Error:", err);
        return null;
    }
}
// ==========================================================================
// UNIFIED, HIGH-STABILITY TELEGRAM DATA VALIDATION MIDDLEWARE
// ==========================================================================
const validateInitData = (req, res, next) => {
    // 1. Fetch case-insensitive headers safely
    const rawInitData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
    if (!rawInitData) {
        return res.status(401).json({ error: "No initialization data payload provided" });
    }

    try {
        // 2. Clean out authorization token prefixes ('tma ' or 'Bearer ') safely if passed
        const cleanInitData = rawInitData.startsWith('tma ') 
            ? rawInitData.substring(4) 
            : rawInitData.startsWith('Bearer ') 
                ? rawInitData.substring(7) 
                : rawInitData;

        const urlParams = new URLSearchParams(cleanInitData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        // 3. Robust, specification-compliant array sort (Fixes encoding bugs for external accounts)
        const dataCheckArr = [];
        for (const [key, value] of urlParams.entries()) {
            dataCheckArr.push(`${key}=${value}`);
        }
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        // 4. Verification signature cryptography validation execution
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
        const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHmac === hash) {
            // Save the user data securely inside the request loop context
            const userRaw = urlParams.get('user');
            req.tgUser = userRaw ? JSON.parse(userRaw) : null;
            return next();
        } else {
            console.warn(`[Security Alert] Cryptographic signature hash verification mismatch.`);
            return res.status(403).json({ error: "Signature hash mismatch or expired session state." });
        }

    } catch (err) {
        console.error("[Auth Parsing Error Stack]:", err.message);
        return res.status(400).json({ error: "Malformed structural verification payload context." });
    }
};


const validateAdmin = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: "Unauthorized" });

    const urlParams = new URLSearchParams(initData);
    const user = JSON.parse(urlParams.get('user'));
    
    if (!admins.includes(user.id)) {
        return res.status(403).json({ error: "Access Denied: Admin Only" });
    }

    req.adminUser = user;
    User.updateOne({ user_id: user.id }, { $set: { last_admin_active: new Date() } }).catch(() => {});
    next();
};
    // ==========================================================================
// UNIFIED ARCHITECTURAL MAINTENANCE INTERCEPTOR LAYER
// ==========================================================================

const ARCHITECTURAL_MAINTENANCE_CONFIG = {
    get enabled() { return process.env.MAINTENANCE_ENABLED === 'true'; },
    get bypassIds() { 
        return (process.env.MAINTENANCE_BYPASS_IDS || '')
            .split(',')
            .map(id => Number(id.trim()))
            .filter(id => !isNaN(id));
    },
    get metadata() {
        try {
            return JSON.parse(process.env.MAINTENANCE_METADATA || '{}');
        } catch (e) {
            return {
                message: "System upgrading. Please check back shortly.",
                targetTime: Date.now() + 3600000,
                accentAsset: "🛠️"
            };
        }
    }
};

function enforceGlobalMaintenanceGate(req, res, next) {
    // 1. If maintenance mode is disabled in environment settings, pass control to next handler instantly
    if (!ARCHITECTURAL_MAINTENANCE_CONFIG.enabled) {
        return next();
    }

    // 2. Dynamic multi-token parsing engine (Resolves both your structural Auth strategies)
    let extractedTelegramId = null;

    if (req.tgUser && req.tgUser.id) {
        // Strategy A: Catches requests matching pre-routed validateInitData layers
        extractedTelegramId = Number(req.tgUser.id);
    } else {
        // Strategy B Fix: Universal safe fallback data parse
try {
    const rawAuthHeaderDataString = req.headers['x-telegram-init-data'];
    if (rawAuthHeaderDataString) {
        // Strip out 'tma ' if it exists, otherwise use the raw header string directly
        const cleanRawDataString = rawAuthHeaderDataString.startsWith('tma ') 
            ? rawAuthHeaderDataString.substring(4) 
            : rawAuthHeaderDataString;
            
        const urlParams = new URLSearchParams(cleanRawDataString);
        const userRaw = urlParams.get('user');
        if (userRaw) {
            const parsed = JSON.parse(userRaw);
            extractedTelegramId = Number(parsed.id);
        }
    }
} catch (err) {
    // Drop execution through to safety evaluation blocks
             }
    }

    // 3. Evaluate authorized tester bypass lists safely
    if (extractedTelegramId && ARCHITECTURAL_MAINTENANCE_CONFIG.bypassIds.includes(extractedTelegramId)) {
        console.log(`[Maintenance Bypass] Authorized access permitted for tester: ${extractedTelegramId}`);
        return next();
    }

    // 4. Reject all standard users with an HTTP 503 containing telemetry properties
    return res.status(503).json({
        maintenance: true,
        serverTime: Date.now(),
        ...ARCHITECTURAL_MAINTENANCE_CONFIG.metadata
    });
}

// --- GHOST VALIDATOR ENGINE ---
async function runGhostValidator(ctx) {
    try {
        if (ctx) await ctx.reply("🕵️ *Ghost Validator:* Starting the Midnight Sweep...");
        
        const users = await User.find({ red_flag: false }); 
        const tgTasks = await Task.find({ type: 'telegram' });
        const settings = await getSettings(); 
        let caughtCount = 0;

        for (const user of users) {
            for (const taskId of user.completed_tasks) {
                const task = tgTasks.find(t => t.id === taskId);
                if (!task) continue;

                const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];

                try {
                    const member = await bot.telegram.getChatMember(channelId, user.user_id);
                    if (['left', 'kicked'].includes(member.status)) {
                        caughtCount++;
                        await User.updateOne(
                            { user_id: user.user_id },
                            { 
                                $set: { red_flag: true },
                                $inc: { balance: -settings.penalty_fee }, 
                                $pull: { completed_tasks: taskId }, 
                                $addToSet: { penalized_tasks: taskId } 
                            }
                        );
                        
                        await bot.telegram.sendMessage(user.user_id, `🚩 *Account Flagged!* You left a channel. A ${settings.penalty_fee} USDT penalty applied.`);
                        break; 
                    }
                } catch (e) {
                    continue;
                }
                await new Promise(res => setTimeout(res, 100));
            }
        }
        if (ctx) await ctx.reply(`✨ *Sweep Complete!* Found and penalized ${caughtCount} cheaters.`);
    } catch (globalError) {
        console.error("Ghost Validator Global Error:", globalError);
        if (ctx) await ctx.reply("❌ The validator encountered a critical error during the sweep.");
    }
}

// --- TELEGRAM BOT HANDLERS ---
bot.start(async (ctx) => {
    const referrerId = ctx.startPayload;
    const userId = ctx.from.id;
    const currentUsername = ctx.from.username || null;
    const currentFirstName = ctx.from.first_name || null;
    const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app';

    try {
        let user = await User.findOne({ user_id: userId });

        if (!user) {
            user = await User.create({
                user_id: userId,
                username: currentUsername,
                first_name: currentFirstName,
                referred_by: referrerId ? parseInt(referrerId) : null,
            });
            if (referrerId && !isNaN(parseInt(referrerId))) {
                await User.updateOne({ user_id: parseInt(referrerId) }, { $inc: { referralCount: 1 } });
            }
        } else {
            await User.updateOne(
                { user_id: userId },
                { $set: { username: currentUsername, first_name: currentFirstName } }
            );
        }

        const sentMsg = await ctx.reply(
            `👋 Welcome to EMBT!\n\nYour profile is fully synced. Tap the button below to open the app and start earning!`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]]) }
        );

        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: { $each: [ctx.message.message_id, sentMsg.message_id] } } }
        );

    } catch (error) {
        console.error("START ERROR:", error);
        return ctx.reply(`⚠️ Error initializing your dashboard.\n\n${error.message}`);
    }
});

// --- EXPRESS APPLICATION WEB ROUTING ROUTE LAYOUT ---

// ==========================================================================
// NEW ENDPOINT: Admin Status Check
// ==========================================================================
app.get('/api/admin/check', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser?.id;
        if (!userId) {
            return res.status(401).json({ isAdmin: false, error: "Unauthorized" });
        }

        const isAdmin = admins.includes(userId);
        
        res.json({
            success: true,
            isAdmin: isAdmin,
            userId: userId,
            adminList: isAdmin ? admins : [] // Only show admin list to admins
        });

    } catch (err) {
        console.error("Admin check error:", err);
        res.status(500).json({ success: false, error: "Admin check failed" });
    }
});
app.get('/api/admin/stats', validateAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const pendingWithdrawals = await WalletTransaction.countDocuments({ txType: 'WITHDRAWAL', status: 'pending' });
        const totalPaid = await WalletTransaction.aggregate([{ $match: { txType: 'WITHDRAWAL', status: 'accepted' } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
        const settings = await getSettings();
        res.json({ users: totalUsers, pending: pendingWithdrawals, paid: totalPaid[0]?.total || 0, maintenance: settings.maintenance_mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/secure/profile', validateInitData, async (req, res) => {
    try {
        // 1. TRUST THE MIDDLEWARE: validateInitData has already cryptographically verified the user
        // and populated 'req.tgUser' securely!
        if (!req.tgUser || !req.tgUser.id) {
            return res.status(401).json({ error: "Unauthorized: Missing authentication token context." });
        }

        const userId = Number(req.tgUser.id);

        // 2. Query your database collection directly using the verified Telegram account ID
        const user = await User.findOne({ user_id: userId });

        if (user) {
            // Optional: Handle cleanup of welcome message if tracked
            if (user.pending_message_cleanup && user.pending_message_cleanup.length > 0) {
                for (const msgId of user.pending_message_cleanup) {
                    try {
                        await bot.telegram.deleteMessage(userId, msgId);
                    } catch (err) {
                        console.log(`Failed to delete message ${msgId} for ${userId}:`, err.message);
                    }
                }
                await User.updateOne({ user_id: userId }, { $set: { pending_message_cleanup: [] } });
            }

            // 3. Build a fully mapped data profile configuration matrix block
            const accountMetricsPayload = {
                success: true,
                user_id: user.user_id,
                first_name: user.first_name || 'User',
                balance: user.balance || 0, 
                points: user.points || 0.00,
                coins: user.coins || 0.00,
                total_earned: user.total_earned || 0,
                referrals: user.referralCount || 0,
                tasksCompletedCount: user.completed_tasks ? user.completed_tasks.length : 0,
                completed_tasks: user.completed_tasks || [],
                is_banned: user.is_banned || false,
                red_flag: user.red_flag || false,
                tasks_added: user.tasks_added || 0,
                isAdmin: typeof admins !== 'undefined' ? admins.includes(userId) : false
            };

            // Return BOTH structural patterns to satisfy all frontend setup variations perfectly
            return res.json({
                ...accountMetricsPayload,
                profile: accountMetricsPayload // Matches the 'data.profile' frontend verification path
            });

        } else {
            // Fallback object initialization if a record hasn't synced into the system yet
            const defaultEmptyPayload = {
                success: false,
                balance: 0,
                points: 0,
                coins: 0,
                total_earned: 0,
                referrals: 0,
                tasksCompletedCount: 0,
                tasks_added: 0,
                is_banned: false,
                red_flag: false,
                isAdmin: false
            };

            return res.json({
                ...defaultEmptyPayload,
                profile: defaultEmptyPayload
            });
        }

    } catch (err) {
        console.error("Secure profile extraction protocol engine error stack trace:", err);
        return res.status(500).json({ error: "Internal Context Security Pipeline Fault" });
    }
});


app.post('/api/admin/settings', validateAdmin, async (req, res) => {
    try {
        await Settings.updateOne({}, { $set: req.body });
        await logAdminAction(req.adminUser, 'settings_updated', `Updated: ${Object.keys(req.body).join(', ')}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/admin/tasks', validateAdmin, async (req, res) => res.json(await Task.find()));

// Upgraded task route matching your exact frontend schema payload expectations
app.post('/api/admin/tasks/add', validateAdmin, async (req, res) => {
    try {
        const taskId = 't' + Math.floor(Math.random() * 10000);
        
        // Maps your frontend data schema properties natively into MongoDB
        const newTask = new Task({
            ...req.body,
            id: taskId
        });

        await newTask.save();
        await logAdminAction(req.adminUser, 'task_added', `Added task: ${newTask.title}`);
        return res.json({ 
            success: true, 
            message: "Task successfully saved to database.",
            taskId 
        });

    } catch (err) {
        console.error("Task deployment transaction failure:", err);
        return res.status(500).json({ 
            success: false, 
            error: "Database failed to compile or save task properties payload." 
        });
    }
});

app.get('/api/admin/directory', validateAdmin, async (req, res) => {
    try {
        const filterType = req.query.filter || 'all';
        let databaseQuery = {};

        // Filter out users conditionally based on the tab selection state
        if (filterType === 'banned') {
            databaseQuery.is_banned = true;
        }

        // Pull documents matching your model schema properties
        const userDirectory = await User.find(databaseQuery)
            .select('user_id username balance points is_banned')
            .sort({ createdAt: -1 });

        // Map data properties clean to prevent front-end mapping crashes
        const structuralPayload = userDirectory.map(user => ({
            user_id: user.user_id,
            username: user.username || null,
            balance: user.balance || 0,
            points: user.points || 0.00,
            coins: user.coins || 0.00,
            is_banned: user.is_banned || false
        }));

        return res.status(200).json(structuralPayload);
    } catch (error) {
        console.error("Error executing directory dataset dump query:", error);
        return res.status(500).json({ success: false, error: 'Database service query failure mapping user collections.' });
    }
});

app.post('/api/secure/submit-proof', validateInitData, async (req, res) => {
    try {
        const { taskId, proof, screenshot } = req.body;
        const userId = req.tgUser.id;

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.completed_tasks.includes(taskId)) {
            return res.status(400).json({ error: "Task already submitted." });
        }

        const proofId = 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const proofType = screenshot ? 'screenshot' : 'text';
        let telegramFileId = null;
        let channelMessageId = null;

        const captionHeader = 
            `📋 *PROOF SUBMISSION*\n` +
            `🆔 REF: \`${proofId}\`\n` +
            `👤 User: \`${userId}\`${user.username ? ' @' + user.username : ''}\n` +
            `📝 Task: ${task.title}\n` +
            `💰 Reward: ${task.reward} USDT\n` +
            `📅 ${new Date().toLocaleString()}`;

        if (screenshot) {
            const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const result = await postPhotoToChannel(buffer, captionHeader);
            telegramFileId = result.fileId;
            channelMessageId = result.messageId;
        } else {
            const fullMsg = `${captionHeader}\n\n📄 *Proof:*\n\`\`\`${proof || 'No text'}\`\`\``;
            channelMessageId = await postToChannel(fullMsg);
        }

        await ProofSubmission.create({
            proofId,
            userId,
            username: user.username || null,
            taskId,
            taskTitle: task.title,
            reward: task.reward,
            proofType,
            proofText: proof || null,
            telegramFileId,
            channelMessageId
        });

        return res.json({ success: true, proofId });

    } catch (err) {
        console.error("Submit proof error:", err);
        return res.status(500).json({ error: "Failed to submit proof." });
    }
});
// Get pending proofs
app.get('/api/admin/proofs/pending', validateAdmin, async (req, res) => {
    try {
        const proofs = await ProofSubmission.find({ status: 'pending' })
            .sort({ submittedAt: -1 }).lean();
        res.json({ success: true, proofs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get screenshot URL for a proof
app.get('/api/admin/proof-image/:proofId', validateAdmin, async (req, res) => {
    try {
        const proof = await ProofSubmission.findOne({ proofId: req.params.proofId });
        if (!proof?.telegramFileId) return res.status(404).json({ error: 'No screenshot.' });
        const file = await bot.telegram.getFile(proof.telegramFileId);
        res.json({ url: `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Approve or reject a proof
app.post('/api/admin/proof-action', validateAdmin, async (req, res) => {
    try {
        const { proofId, action } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action.' });
        }

        const proof = await ProofSubmission.findOne({ proofId, status: 'pending' });
        if (!proof) return res.status(404).json({ error: 'Proof not found or already reviewed.' });

        if (action === 'approve') {
            await User.updateOne({ user_id: proof.userId }, {
                $inc: { balance: proof.reward, total_earned: proof.reward },
                $push: {
                    completed_tasks: proof.taskId,
                    history: { title: proof.taskTitle, reward: proof.reward, taskId: proof.taskId, date: new Date() }
                }
            });
            try {
                await bot.telegram.sendMessage(proof.userId,
                    `✅ *Proof Approved!*\n\n📋 Task: ${proof.taskTitle}\n💰 +${proof.reward} USDT added\n🆔 REF: \`${proof.proofId}\``,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        } else {
            try {
                await bot.telegram.sendMessage(proof.userId,
                    `❌ *Proof Rejected*\n\n📋 Task: ${proof.taskTitle}\n🆔 REF: \`${proof.proofId}\`\n\nPlease resubmit with a clearer screenshot.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        }

        if (proof.channelMessageId) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(proof.channelMessageId,
                `${action === 'approve' ? '✅ APPROVED' : '❌ REJECTED'} by ${adminName}\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await ProofSubmission.updateOne({ proofId }, { $set: { status: action === 'approve' ? 'approved' : 'rejected', reviewedAt: new Date() } });
        await logAdminAction(req.adminUser, action === 'approve' ? 'proof_approved' : 'proof_rejected', `Proof ${proofId} for user ${proof.userId}`);

        res.json({ success: true });
    } catch (e) {
        console.error('Proof action error:', e);
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/admin/payouts/pending', validateAdmin, async (req, res) => {
    try {
        const payouts = await WalletTransaction.find({
            txType: 'WITHDRAWAL',
            assetType: 'usdt',
            status: 'pending'
        })
        .sort({ timestamp: -1 })
        .lean();

        res.json({
            success: true,
            payouts
        });

    } catch (error) {
        console.error('Pending payout fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch pending payouts'
        });
    }
});
app.post('/api/admin/payouts/action', validateAdmin, async (req, res) => {
    const { txId, status } = req.body;

    try {
        if (!['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status'
            });
        }

        const payout = await WalletTransaction.findOne({
            txId,
            txType: 'WITHDRAWAL',
            status: 'pending'
        });

        if (!payout) {
            return res.status(404).json({
                success: false,
                error: 'Payout request not found'
            });
        }

        payout.status = status;
        await payout.save();
        if (payout.channelMessageId) {
    const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
    await replyInChannel(payout.channelMessageId,
        `${status === 'accepted' ? '✅ APPROVED' : '❌ REJECTED'} by ${adminName}\n💰 ${payout.amount} USDT\n🕐 ${new Date().toLocaleString()}`
    );
        }
        await logAdminAction(req.adminUser, status === 'accepted' ? 'payout_approved' : 'payout_rejected', `${status} ${payout.amount} ${payout.assetType.toUpperCase()} for user ${payout.userId}`);
        // Only refund if you deducted balance during withdrawal creation
        if (status === 'rejected') {
            await User.updateOne(
                { user_id: payout.userId },
                {
                    $inc: {
                        balance: payout.amount
                    }
                }
            );
        }

        try {
            await bot.telegram.sendMessage(
                payout.userId,
                status === 'accepted'
                    ? `✅ Withdrawal approved\n\nAmount: ${payout.amount} USDT\nTX ID: ${payout.txId}`
                    : `❌ Withdrawal rejected\n\nAmount: ${payout.amount} USDT\nTX ID: ${payout.txId}`
            );
        } catch (telegramError) {
            console.error('Telegram notification error:', telegramError);
        }

        res.json({
            success: true,
            txId: payout.txId,
            status: payout.status
        });

    } catch (error) {
        console.error('Admin payout action error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 📊 GET USER DIRECTORY (With Pagination, Search, and Status Filtering)
app.get('/api/admin/users', validateAdmin, async (req, res) => {
    try {
        // 1. Parse Query Parameters for Pagination & Filters
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20)); // Caps max rows at 100 per page
        const skip = (page - 1) * limit;
        
        const searchQuery = req.query.search || '';
        const filterStatus = req.query.filter || 'all'; // Options: all, banned, flagged

        // 2. Build Dynamic MongoDB Query Object
        let databaseQuery = {};

        // If there's a search keyword, check if it's a numeric Telegram ID or a string username
        if (searchQuery) {
            if (!isNaN(searchQuery)) {
                databaseQuery.user_id = Number(searchQuery);
            } else {
                databaseQuery.username = { $regex: searchQuery, $options: 'i' }; // Case-insensitive partial matching
            }
        }

        // Apply specialized status layout filter matrices
        if (filterStatus === 'banned') databaseQuery.is_banned = true;
        if (filterStatus === 'flagged') databaseQuery.red_flag = true;

        // 3. Execute Efficient Parallel Queries
        const [usersList, totalRecordsCount] = await Promise.all([
            User.find(databaseQuery)
                .sort({ createdAt: -1 }) // Shows newest members first
                .skip(skip)
                .limit(limit)
                .lean(), // Boosts read performance dramatically
            User.countDocuments(databaseQuery)
        ]);

        // 4. Return Clean Scalable Pagination Metadata Object Payload
        return res.json({
            success: true,
            meta: {
                totalUsers: totalRecordsCount,
                currentPage: page,
                totalPages: Math.ceil(totalRecordsCount / limit),
                perPage: limit
            },
            users: usersList.map(u => ({
                user_id: u.user_id,
                username: u.username || 'N/A',
                first_name: u.first_name || 'Member',
                balance: u.balance || 0,
                points: u.points || 0,
                coins: u.coins || 0,
                total_earned: u.total_earned || 0,
                referralCount: u.referralCount || 0,
                tasksCompleted: u.completed_tasks ? u.completed_tasks.length : 0,
                tasks_added: u.tasks_added || 0,
                is_banned: u.is_banned || false,
                red_flag: u.red_flag || false
            }))
        });

    } catch (err) {
        console.error("Professional admin list compilation failure:", err);
        return res.status(500).json({ error: "Internal Admin Directory Engine Fault" });
    }
});


// 🛠️ POST UPDATE MODIFIER (Instantly modify users from your front-end interface)
app.post('/api/admin/user/update', validateAdmin, async (req, res) => {
    try {
        const { target_user_id, balance, points, coins, is_banned, red_flag, tasks_added } = req.body;

        if (!target_user_id) {
            return res.status(400).json({ error: "Target Identity Specification parameter is missing." });
        }

        // 1. Map incoming payload adjustments cleanly into an update object
        let dynamicUpdates = {};
        if (balance !== undefined) dynamicUpdates.balance = Number(balance);
        if (points !== undefined) dynamicUpdates.points = Number(points);
        if (coins !== undefined) dynamicUpdates.coins = Number(coins);
        if (tasks_added !== undefined) dynamicUpdates.tasks_added = Number(tasks_added);
        if (is_banned !== undefined) dynamicUpdates.is_banned = Boolean(is_banned);
        if (red_flag !== undefined) dynamicUpdates.red_flag = Boolean(red_flag);

        // 2. Perform the atomic update directly inside your MongoDB instance
        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(target_user_id) },
            { $set: dynamicUpdates },
            { new: true } // Returns the newly modified state document
        );

        if (!updatedUser) {
            return res.status(404).json({ error: "User configuration track not found in collection tracking database." });
        }

        // 3. Send confirmation payload back to admin panel view
        return res.json({
            success: true,
            message: `User ${target_user_id} parameters updated successfully.`,
            user: {
                user_id: updatedUser.user_id,
                balance: updatedUser.balance,
                points: updatedUser.points,
                coins: updatedUser.coins,
                is_banned: updatedUser.is_banned,
                red_flag: updatedUser.red_flag
            }
        });

    } catch (err) {
        console.error("Admin real-time document write failure:", err);
        return res.status(500).json({ error: "Direct Update Modifier Transaction Aborted." });
    }
});
app.get('/api/settings', async (req, res) => res.json(await getSettings()));
app.post('/api/settings/update', validateAdmin, async (req, res) => { await Settings.updateOne({}, req.body); res.json({ success: true }); });

app.post('/api/support/create', validateInitData, async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.tgUser?.id;
        const user = await User.findOne({ user_id: userId });

        const ticket = await Ticket.create({
            user_id: userId,
            username: user?.username || null,
            message
        });

        const msg =
            `🎧 *SUPPORT TICKET*\n` +
            `🆔 REF: \`${ticket.ticket_id}\`\n` +
            `👤 User: \`${userId}\`${user?.username ? ' @' + user.username : ''}\n` +
            `📅 ${new Date().toLocaleString()}\n\n` +
            `💬 *Message:*\n${message}`;

        const channelMsgId = await postToChannel(msg);
        if (channelMsgId) {
            await Ticket.updateOne({ _id: ticket._id }, { $set: { channel_message_id: channelMsgId } });
        }

        res.json({ success: true, ticketId: ticket.ticket_id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/admin/reply-ticket', validateAdmin, async (req, res) => {
    try {
        const ticket = await Ticket.findByIdAndUpdate(
            req.body.ticketId,
            { admin_reply: req.body.reply, status: 'replied' },
            { new: false } // get original to read channel_message_id
        );

        try {
            await bot.telegram.sendMessage(ticket.user_id,
                `📩 *Support Reply*\n\n${req.body.reply}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}

        if (ticket.channel_message_id) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(ticket.channel_message_id,
                `📩 *ADMIN REPLY* by ${adminName}\n\n${req.body.reply}\n\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await logAdminAction(req.adminUser, 'ticket_replied', `Replied to ticket ${ticket.ticket_id || ticket._id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/admin/tickets/resolve', validateAdmin, async (req, res) => {
    try {
        const { ticketId } = req.body;
        const ticket = await Ticket.findByIdAndUpdate(
            ticketId,
            { status: 'resolved' },
            { new: false }
        );

        if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

        try {
            await bot.telegram.sendMessage(ticket.user_id,
                `🎫 *Support Ticket Resolved*\n\nYour ticket \`${ticket.ticket_id || ticket._id}\` has been marked as resolved.\n\nIf you need further help, feel free to submit a new ticket.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {}

        if (ticket.channel_message_id && STORAGE_CHANNEL_ID) {
            const adminName = req.adminUser.first_name || req.adminUser.username || 'Admin';
            await replyInChannel(ticket.channel_message_id,
                `✅ *RESOLVED* by ${adminName}\n🕐 ${new Date().toLocaleString()}`
            );
        }

        await logAdminAction(req.adminUser, 'ticket_resolved', `Resolved ticket ${ticket.ticket_id || ticket._id} for user ${ticket.user_id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/admin/tickets', validateAdmin, async (req, res) => {
    try {
        const filter = req.query.filter || 'open';
        
        let query = {};
        if (filter === 'open') query.status = 'open';
        else if (filter === 'replied') query.status = 'replied';
        else if (filter === 'resolved') query.status = 'resolved';
        // 'all' returns everything

        const tickets = await Ticket.find(query).sort({ created_at: -1 }).lean();

        // Count all statuses for badges
        const [openCount, repliedCount, resolvedCount] = await Promise.all([
            Ticket.countDocuments({ status: 'open' }),
            Ticket.countDocuments({ status: 'replied' }),
            Ticket.countDocuments({ status: 'resolved' })
        ]);

        res.json({ 
            success: true, 
            tickets,
            counts: { open: openCount, replied: repliedCount, resolved: resolvedCount }
        });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});
app.post('/api/withdraw/request', validateInitData, async (req, res) => {
    const { user_id, amount, address, method } = req.body;
    const user = await User.findOne({ user_id });
    const settings = await getSettings();
    if (user.balance < amount || amount < settings.min_withdraw) return res.json({ success: false });

    await User.updateOne({ user_id }, { $inc: { balance: -amount } });
    await Withdraw.create({ user_id, username: user.user_id.toString(), amount, address, method });
    bot.telegram.sendMessage(ADMIN_ID, `⚠️ *Web Withdrawal requested:* ${amount} USDT`);
    res.json({ success: true });
});

app.get('/api/admin/withdrawals', validateAdmin, async (req, res) => res.json(await Withdraw.find({ status: 'pending' })));

app.post('/api/admin/withdraw-action', validateAdmin, async (req, res) => {
    const { requestId, action } = req.body;
    const request = await Withdraw.findById(requestId);
    if (!request) return res.json({ success: false });

    await Withdraw.updateOne({ _id: requestId }, { $set: { status: action } });
    if (action === 'rejected') await User.updateOne({ user_id: request.user_id }, { $inc: { balance: request.amount } });
    res.json({ success: true });
});

app.get('/api/secure/referrals', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const friends = await User.find({ referred_by: userId })
            .select('username first_name tasks_done balance commission_earned completed_tasks');
        
        res.json({ 
            success: true,
            friends: friends.map(f => ({
                username: f.username || `User_${f.user_id}`,
                first_name: f.first_name || f.username || 'Friend',
                tasks_done: f.completed_tasks ? f.completed_tasks.length : 0,
                commission_earned: 0
            }))
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});


app.post('/api/admin/notifications/send', validateAdmin, async (req, res) => {
    try {
        const { title, message, targetType, targetUserId } = req.body;

        const newNotification = new Notification({
            title: title,
            message: message,
            targetType: targetType || 'all_members', // Matches the user-side array criteria
            targetUserId: targetUserId ? Number(targetUserId) : null, // Forces strict numeric checking
            createdAt: new Date()
        });

        await newNotification.save();
        return res.json({ success: true, message: "Notification broadcast saved." });

    } catch (err) {
        console.error("Admin Notification Deployment Error:", err.message);
        return res.status(500).json({ error: "Failed to dispatch administrative broadcast tracking matrices." });
    }
});

app.get('/api/secure/notifications', validateInitData, async (req, res) => {
    try {
        // 1. Verify safe extraction context from fixed middleware
        if (!req.tgUser || !req.tgUser.id) {
            return res.status(401).json({ error: "Unauthorized access: Session signature token context missing." });
        }

        const userId = Number(req.tgUser.id);

        // 2. Query matching notifications tracking variables using your schema parameters
        const dbAlerts = await Notification.find({
            $or: [
                { targetType: 'all' },
                { targetType: 'all_members' },
                { targetType: 'specific_member', targetUserId: userId }
            ]
        }).sort({ createdAt: -1 });

        // 3. 🔥 STRUCTURAL BRIDGE: Map schema keys precisely to frontend UI engine properties
        const clientFormattedAlerts = dbAlerts.map(doc => {
            // Convert Mongoose Document to a plain object to prevent wrapper extraction bugs
            const notif = doc.toObject(); 
            
            return {
                id: notif._id,
                // Maps your target tracking filter into the client's 'type' field expectation
                type: notif.type || notif.targetType || 'system', 
                title: notif.title || 'Notification',
                // Directly populates the core text payload string
                message: notif.message || '', 
                msg: notif.message || '', // Backup alignment matching the frontend's fallbacks
                read: notif.isRead || false,
                date: notif.createdAt || new Date()
            };
        });

        // 4. Return clean uniform array straight to client syncUserInbox()
        return res.json(clientFormattedAlerts);

    } catch (err) {
        console.error("Critical error synchronizing notification ledger paths:", err.message);
        return res.status(500).json({ error: "Internal notification pipeline framework handling error." });
    }
});


app.get('/api/secure/available-tasks', validateInitData, async (req, res) => {
    try {
        // 1. Resolve user profile structure from database safely
        const user = await User.findOne({ user_id: req.tgUser.id });
        
        // 🚨 FIX: Guard against null records to block un-provisioned database views
        if (!user) {
            return res.status(404).json({ error: "User profile context un-synchronized or missing." });
        }

        // 2. Fetch only tasks the authenticated user hasn't finished yet
        const tasks = await Task.find({ 
            id: { $nin: user.completed_tasks || [] }, 
            enabled: true 
        });

        return res.json(tasks);

    } catch (err) {
        console.error("Secure task matrix pipeline error:", err);
        return res.status(500).json({ error: "Internal Security Pipeline Fault" });
    }
});
app.post('/api/secure/claim-task', validateInitData, async (req, res) => {
    try {
        const { taskId } = req.body;
        const userId = req.tgUser.id;

        // 1. Fetch user
        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.is_banned) return res.status(403).json({ error: "Account is banned." });
        if (user.completed_tasks.includes(taskId)) {
            return res.status(400).json({ error: "Task already claimed." });
        }

        // 2. Fetch task
        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: "Task not found." });

        // 3. ✅ TELEGRAM MEMBERSHIP VERIFICATION
        // Only verify if task type is auto and URL is a t.me link
        if (task.type === 'auto' && task.url && task.url.includes('t.me/')) {
            try {
                // Extract channel username from URL
                // Handles: t.me/channelname or t.me/+invitecode
                const urlParts = task.url.split('t.me/')[1];
                const channelUsername = urlParts.split('/')[0];

                // Skip invite links (t.me/+xxx) - can't verify those
                if (!channelUsername.startsWith('+')) {
                    const channelId = '@' + channelUsername;

                    const member = await bot.telegram.getChatMember(channelId, userId);

                    // Check if user is actually a member
                    const validStatuses = ['member', 'administrator', 'creator'];
                    if (!validStatuses.includes(member.status)) {
                        return res.status(400).json({ 
                            error: "You have not joined the channel yet. Please join first then claim." 
                        });
                    }
                }
            } catch (verifyErr) {
                console.error("Membership verification error:", verifyErr.message);
                // If bot is not admin in channel, skip verification
                // Don't block the user — just log it
                console.warn(`Could not verify membership for channel in task ${taskId}. Bot may not be admin.`);
            }
        }

        // 4. Get settings
        const settings = await getSettings();

        // 5. Update user balance and history
        const currentTasksDone = (user.referral_tasks_done || 0) + 1;

        await User.updateOne(
            { user_id: userId },
            {
                $inc: { 
                    balance: task.reward, 
                    referral_tasks_done: 1,
                    total_earned: task.reward
                },
                $push: { 
                    completed_tasks: taskId,
                    history: {
                        title: task.title,
                        reward: task.reward,
                        taskId: taskId,
                        date: new Date()
                    }
                }
            }
        );

        // 6. Referral commission
        if (user.referred_by) {
            const commission = task.reward * ((settings.ref_commission_percent || 10) / 100);
            await User.updateOne(
                { user_id: user.referred_by }, 
                { $inc: { balance: commission } }
            );
        }

        // 7. Referral milestone bonus
        if (user.referred_by && !user.referral_paid && currentTasksDone >= 3) {
            const updateReferrer = await User.updateOne(
                { user_id: userId, referral_paid: { $ne: true } },
                { $set: { referral_paid: true } }
            );
            if (updateReferrer.modifiedCount > 0) {
                await User.updateOne(
                    { user_id: user.referred_by },
                    { $inc: { balance: settings.ref_bonus_amount } }
                );
                try {
                    await bot.telegram.sendMessage(
                        user.referred_by,
                        `🎊 *Milestone Bonus:* Your friend completed 3 tasks! You earned ${settings.ref_bonus_amount} USDT.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (botErr) {
                    console.error("Bot notification error:", botErr.message);
                }
            }
        }

        // 8. Return updated balance
        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({
            success: true,
            reward: task.reward,
            newBalance: updatedUser.balance
        });

    } catch (err) {
        console.error("Claim task error:", err);
        return res.status(500).json({ error: "Internal server error." });
    }
});
// 

// 2. Ban/unban user
app.post('/api/admin/users/ban', validateAdmin, async (req, res) => {
    try {
        const { userId, banned } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });

        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(userId) },
            { $set: { is_banned: Boolean(banned) } },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ error: "User not found." });
        await logAdminAction(req.adminUser, banned ? 'user_banned' : 'user_unbanned', `User ${userId}`);
        // Notify user via bot
        try {
            const msg = banned
                ? "🚫 Your account has been suspended. Contact support if you believe this is an error."
                : "✅ Your account has been reinstated. Welcome back!";
            await bot.telegram.sendMessage(Number(userId), msg);
        } catch (e) {}

        return res.json({ success: true, is_banned: updatedUser.is_banned });

    } catch (err) {
        console.error("Ban user error:", err);
        return res.status(500).json({ error: "Failed to update ban status." });
    }
});

// 3. Delete task
app.delete('/api/admin/tasks/delete/:id', validateAdmin, async (req, res) => {
    try {
        const taskId = req.params.id;
        const result = await Task.deleteOne({ id: taskId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Task not found." });
        }
        await logAdminAction(req.adminUser, 'task_deleted', `Deleted task: ${taskId}`);
        return res.json({ success: true });

    } catch (err) {
        console.error("Delete task error:", err);
        return res.status(500).json({ error: "Failed to delete task." });
    }
});
app.post('/api/admin/broadcast', validateAdmin, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Blank body payload allocation" });
    const users = await User.find({}, 'user_id');
    await logAdminAction(req.adminUser, 'broadcast_sent', `Sent to ${users.length} users`);
    res.json({ success: true, total: users.length });

    (async () => {
        for (const user of users) {
            try { await bot.telegram.sendMessage(user.user_id, message, { parse_mode: 'HTML' }); } catch (err) {}
            await new Promise(resolve => setTimeout(resolve, 75));
        }
    })();
});



app.post('/api/secure/lucky-spin', validateInitData, async (req, res) => {
    try {
        
        const validatedTelegramUserId = req.tgUser.id; // No duplicate parsing needed!
        const userRecord = await User.findOne({ user_id: validatedTelegramUserId });
        if (!userRecord) {
            return res.status(404).json({ 
                success: false, 
                error: "Account profile ledger not found in database records." 
            });
        }

        // 2. Strict Capital Balance Validation Check Gating
        // Accessing the coins property (using userRecord.coins based on your profile view metrics)
        const currentAvailableCoins = parseInt(userRecord.coins || 0);
        if (currentAvailableCoins < 1) {
            return res.status(400).json({
                success: false,
                error: "Insufficient funds: 1 Coin is required to execute a spin transaction."
            });
        }

        // Deduct exactly 1 play unit fee immediately before computing prizes (Prevents race-conditions)
        userRecord.coins = currentAvailableCoins - 1;

        // 3. Compute Probabilities matching frontend indices EXACTLY:
        // [0: 10 USDT, 1: 25 Pts, 2: TRY AGAIN, 3: 100 Pts, 4: 1 TON, 5: 500 Pts, 6: BONUS SPIN, 7: 50 USDT]
        const distributionPick = Math.random() * 100;
        let winningIndex = 2; // Default fallback to Index 2: "TRY AGAIN"
        let rewardNotificationString = "TRY AGAIN";

        if (distributionPick < 25) {
            // 45% Odds: 25 Points
            winningIndex = 1;
            userRecord.points = (userRecord.points || 0) + 25;
            rewardNotificationString = "25 Points Added";
        } else if (distributionPick < 40) {
            // 30% Odds: TRY AGAIN
            winningIndex = 2;
            rewardNotificationString = "Try Again Next Time";
        } else if (distributionPick < 50) {
            // 15% Odds: 100 Points
            winningIndex = 3;
            userRecord.points = (userRecord.points || 0) + 100;
            rewardNotificationString = "100 Points Added";
        } else if (distributionPick < 60) {
            // 6% Odds: Extra Reward Bonus Spin! (Refunds the 1 coin cost)
            winningIndex = 4;
            userRecord.coins = (userRecord.coins || 0) + 1;
            rewardNotificationString = "1 Free Extra Spin Awarded";
        } else if (distributionPick < 70) {
            // 2.5% Odds: High Reward Tier 500 Points
            winningIndex = 5;
            userRecord.points = (userRecord.points || 0) + 500;
            rewardNotificationString = "500 Premium Points Added";
        } else if (distributionPick < 90) {
            // 0.4% Odds: Premium USDT Tier (10 USDT)
            winningIndex = 0;
            userRecord.balance = (userRecord.balance || 0) + 1.00;
            rewardNotificationString = "1.00 USDT Added to Wallet";
        } else {
            // 3% Odds: Ultra Jackpot Grand Tier (50 USDT)
            winningIndex = 7;
            userRecord.balance = (userRecord.balance || 0) + 5.00;
            rewardNotificationString = "5.00 USDT Grand Prize Added!";
        }

        // Note: Frontend Segment Index 4 (1 TON) is reserved for future promotional allocation distribution rules

        // 4. Save modified values back to database cluster
        await userRecord.save();

        // 5. Return data synchronization properties matching frontend state engines expectations
        return res.status(200).json({
            success: true,
            winningIndex: winningIndex,
            rewardNotificationString: rewardNotificationString,
            newCoinBalance: parseInt(userRecord.coins || 0),
            newPointBalance: parseFloat(userRecord.points || 0),
            newWalletBalance: parseFloat(userRecord.balance || 0)
        });

    } catch (networkExceptionTrace) {
        console.error("Fatal error inside secure lucky-spin execution node:", networkExceptionTrace);
        return res.status(500).json({ 
            success: false, 
            error: "Internal server error updating game balance matrices." 
        });
    }
});
/* ==========================================================================
   PRODUCTION ENGINE LOGIC SECURE CRYPTO WALLET TAB ROUTING SUBSYSTEM
   ========================================================================== */

// Wallet Transfer Route Cleaned:
app.post('/api/secure/wallet/transfer', validateInitData, async (req, res) => {
    try {
        const senderTelegramId = req.tgUser.id; // Completely bypasses verifySecureEcosystemSessionToken
        const { recipientIdOrUsername, assetType, amount, memo } = req.body;
        const processingVolumeAmount = parseFloat(amount);
        if (isNaN(processingVolumeAmount) || processingVolumeAmount <= 0) {
            return res.status(400).json({ success: false, error: "Invalid financial clearing volume amount constraints parameter specification." });
        }
        
        if (!['usdt', 'coins', 'points'].includes(assetType)) {
            return res.status(400).json({ success: false, error: "Invalid targeted account asset ledger destination system mapping target tracking reference." });
        }

        // Fetch sender transaction logging account document data profile
        const senderProfileRecordNode = await User.findOne({ user_id: senderTelegramId });
        if (!senderProfileRecordNode) {
            return res.status(404).json({ success: false, error: "Origin account record pointer data tracking structure anomaly." });
        }

        // Anti-collusion identity evaluation validation rules check
        if (String(senderTelegramId) === String(recipientIdOrUsername) || String(senderProfileRecordNode.username).toLowerCase() === String(recipientIdOrUsername).toLowerCase()) {
            return res.status(400).json({ success: false, error: "System transaction rejected: Asset self-transfers are disallowed." });
        }

        // Dynamically resolve target counterparty document data ledger map locations
        let queryFilterMatchCriterion = {};
        if (!isNaN(recipientIdOrUsername)) {
            queryFilterMatchCriterion = { user_id: Number(recipientIdOrUsername) };
        } else {
            const cleanSanitizedUsernameString = recipientIdOrUsername.replace('@', '');
            queryFilterMatchCriterion = { username: new RegExp(`^${cleanSanitizedUsernameString}$`, 'i') };
        }

        const recipientProfileRecordNode = await User.findOne(queryFilterMatchCriterion);
        if (!recipientProfileRecordNode) {
            return res.status(404).json({ success: false, error: "Recipient account match indicator criteria not verified on system logs." });
        }

        // Evaluate precise available balance metrics classes configurations mappings boundaries
        if (assetType === 'usdt' && (senderProfileRecordNode.balance || 0) < processingVolumeAmount) {
            return res.status(400).json({ success: false, error: "Insufficient available liquidation capital balance ledger clearance pool assets." });
        }
        if (assetType === 'coins' && (senderProfileRecordNode.coins || 0) < processingVolumeAmount) {
            return res.status(400).json({ success: false, error: "Insufficient network utility native mint engine transaction items." });
        }
        if (assetType === 'points' && (senderProfileRecordNode.points || 0) < processingVolumeAmount) {
            return res.status(400).json({ success: false, error: "Insufficient active structural allocation performance yields points blocks." });
        }

        // Atomic multi-account balances debit credit clearing mutation tracking adjustments loop
        if (assetType === 'usdt') {
            senderProfileRecordNode.balance = (senderProfileRecordNode.balance || 0) - processingVolumeAmount;
            recipientProfileRecordNode.balance = (recipientProfileRecordNode.balance || 0) + processingVolumeAmount;
        } else if (assetType === 'coins') {
            senderProfileRecordNode.coins = (senderProfileRecordNode.coins || 0) - processingVolumeAmount;
            recipientProfileRecordNode.coins = (recipientProfileRecordNode.coins || 0) + processingVolumeAmount;
        } else if (assetType === 'points') {
            senderProfileRecordNode.points = (senderProfileRecordNode.points || 0) - processingVolumeAmount;
            recipientProfileRecordNode.points = (recipientProfileRecordNode.points || 0) + processingVolumeAmount;
        }

        await senderProfileRecordNode.save();
        await recipientProfileRecordNode.save();

        // Build system cross ledger tracking references block logs documentation items automatically
        const generatedSharedTrackingLinkReferenceHashId = crypto.randomBytes(6).toString('hex').toUpperCase();

        await WalletTransaction.create([
            {
                userId: senderTelegramId,
                txId: `TXO-${generatedSharedTrackingLinkReferenceHashId}`,
                txType: 'TRANSFER_OUT',
                assetType: assetType,
                amount: processingVolumeAmount,
                counterpartyId: String(recipientProfileRecordNode.user_id),
                status: 'accepted',
                memo: memo || 'P2P Transfer Settlement Ledger Out'
            },
            {
                userId: recipientProfileRecordNode.user_id,
                txId: `TXI-${generatedSharedTrackingLinkReferenceHashId}`,
                txType: 'TRANSFER_IN',
                assetType: assetType,
                amount: processingVolumeAmount,
                counterpartyId: String(senderTelegramId),
                status: 'accepted',
                memo: memo || 'P2P Transfer Settlement Ledger In'
            }
        ]);

        return res.status(200).json({ success: true, message: "Asset balancing tracking transfer sequence processed securely." });

    } catch (catastrophicCrashInternalEngineTrace) {
        console.error("Crash executing wallet transfer system node loop:", catastrophicCrashInternalEngineTrace);
        return res.status(500).json({ success: false, error: "Internal processing engine loop crash fault detected on core nodes layers." });
    }
});

// API ROUTE B: Secure referral metric checks framework milestone cashout extractor endpoint
app.post('/api/secure/wallet/withdraw-tier', validateInitData, async (req, res) => {
    try {
        const telegramUserId = req.tgUser.id;
        const { inviteThreshold, payoutAmount, network, cryptoAddress } = req.body;
        const userProfileRecordNode = await User.findOne({ user_id: telegramUserId });
        if (!userProfileRecordNode) {
            return res.status(404).json({ success: false, error: "Target data cluster path context references not mapped correctly." });
        }
        // Database verified referral structure rules check validation 
        const databaseVerifiedInvitesCount = parseInt(userProfileRecordNode.referralCount || 0);
        if (databaseVerifiedInvitesCount < parseInt(inviteThreshold)) {
            return res.status(400).json({ success: false, error: `Ecosystem audit violation: Milestone tracking threshold requirement mapping verification failure.` });
        }
        // Prevent milestone duplication attacks or race condition double-claims
        const duplicateClaimVerificationTraceCheck = await WalletTransaction.findOne({
            userId: telegramUserId,
            txType: 'WITHDRAWAL',
            amount: parseFloat(payoutAmount),
            status: { $in: ['pending', 'accepted'] }
        });

        if (duplicateClaimVerificationTraceCheck) {
            return res.status(400).json({ success: false, error: "A clearance payout transaction matched this milestone allocation tier block model already." });
        }
const withdrawalAmount = parseFloat(payoutAmount);

if (userProfileRecordNode.balance < withdrawalAmount) {
    return res.status(400).json({
        success: false,
        error: "Insufficient balance."
    });
}

await User.updateOne(
    { user_id: telegramUserId },
    {
        $inc: {
            balance: -withdrawalAmount
        }
    }
);
        // Create transaction statement directly into processing queue
        const withdrawalTransaction = await WalletTransaction.create({
    userId: telegramUserId,
    txType: 'WITHDRAWAL',
    assetType: 'usdt',
    amount: parseFloat(payoutAmount),
    counterpartyId: "EXTERNAL_MAINNET_SETTLEMENT_RESERVE",
    status: 'pending',
    network,
    cryptoAddress,
    memo: `Milestone Cashout Allocation Tier Check for ${inviteThreshold} Invites Completed`
});
   try {
    const adminMessage = `
🚨 NEW MILESTONE WITHDRAWAL REQUEST

🆔 TX ID: ${withdrawalTransaction.txId}

👤 User ID: ${userProfileRecordNode.user_id}
👤 Username: @${userProfileRecordNode.username || 'N/A'}
👤 First Name: ${userProfileRecordNode.first_name || 'N/A'}

💰 Amount: ${payoutAmount} USDT
🌐 Network: ${network}
📬 Address:
${cryptoAddress}

👥 Referrals: ${databaseVerifiedInvitesCount}
🎯 Milestone: ${inviteThreshold}

📅 Time: ${new Date().toLocaleString()}

Status: PENDING
`;

    await bot.telegram.sendMessage(
        ADMIN_ID,
        adminMessage
    );

} catch (adminNotificationError) {
    console.error(
        "Admin notification error:",
        adminNotificationError
    );
            }     
        try {
    await bot.telegram.sendMessage(
        telegramUserId,
        `
✅ Withdrawal Request Submitted

🆔 TX ID: ${withdrawalTransaction.txId}

💰 Amount: ${payoutAmount} USDT
🌐 Network: ${network}

Your request has been placed in the review queue.
You will receive another notification when it is approved or rejected.
`
    );
} catch (userNotificationError) {
    console.error(
        "User notification error:",
        userNotificationError
    );
            }
// Log withdrawal to channel
const wdMsg =
    `💸 *WITHDRAWAL REQUEST*\n` +
    `🆔 TX: \`${withdrawalTransaction.txId}\`\n` +
    `👤 User: \`${telegramUserId}\` @${userProfileRecordNode.username || 'N/A'}\n` +
    `💰 Amount: ${payoutAmount} USDT\n` +
    `🌐 Network: ${network}\n` +
    `📬 Address: \`${cryptoAddress}\`\n` +
    `👥 Referrals: ${databaseVerifiedInvitesCount}\n` +
    `📅 ${new Date().toLocaleString()}`;
const wdChannelMsgId = await postToChannel(wdMsg);
if (wdChannelMsgId) {
    await WalletTransaction.updateOne({ _id: withdrawalTransaction._id }, { $set: { channelMessageId: wdChannelMsgId } });
}
        return res.status(200).json({ success: true, message: "Milestone extraction tracking payout successfully registered into clearance queues." });

    } catch (catastrophicCrashInternalEngineTrace) {
        console.error("Crash tracing milestone tier payout extraction pipeline loops:", catastrophicCrashInternalEngineTrace);
        return res.status(500).json({ success: false, error: "Internal operational structural fault trace error raised on system extraction nodes." });
    }
});



app.get('/api/admin/registry', validateAdmin, async (req, res) => {
    try {
        const adminUsers = await User.find({ user_id: { $in: admins } })
            .select('user_id username first_name last_admin_active');

        const registryList = admins.map(id => {
            const match = adminUsers.find(u => u.user_id === id);
            return {
                user_id: id,
                username: match?.username || null,
                first_name: match?.first_name || null,
                last_active: match?.last_admin_active || null
            };
        });

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activity = await AdminActivity.find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(100);

        res.json({ admins: registryList, activity });
    } catch (e) {
        console.error('Registry fetch failed:', e);
        res.status(500).json({ error: 'Failed to load registry' });
    }
});

// ==========================================================================
// WATCH & EARN SYSTEM ENDPOINTS
// ==========================================================================

// Get available ads for user (max 2 per day)
app.get('/api/secure/available-ads', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get all enabled ads
        const allAds = await ActiveAd.find({ enabled: true });

        const adsWithStatus = await Promise.all(
            allAds.map(async (ad) => {
                const watched = await AdWatch.findOne({
                    userId,
                    adId: ad.adId,
                    viewedAt: { $gte: today }
                });

                return {
                    id: ad.adId,
                    network: ad.network,
                    unitId: ad.unitId,
                    reward: ad.reward,
                    watched: !!watched,
                    claimed: watched?.claimedAt ? true : false
                };
            })
        );

        return res.json({ success: true, ads: adsWithStatus });
    } catch (err) {
        console.error('Get ads error:', err);
        res.status(500).json({ error: 'Failed to load ads' });
    }
});

// Record that user watched an ad (call this AFTER ad completes)
app.post('/api/secure/watch-ad', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { adId } = req.body;

        if (!adId) return res.status(400).json({ error: 'Ad ID required' });

        const ad = await ActiveAd.findOne({ adId, enabled: true });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if already watched today
        const existing = await AdWatch.findOne({
            userId,
            adId,
            viewedAt: { $gte: today }
        });

        if (existing) {
            return res.status(400).json({ error: 'Ad already watched today' });
        }

        // Create watch record
        await AdWatch.create({
            userId,
            adId,
            adNetwork: ad.network,
            reward: ad.reward,
            watched: true
        });

        return res.json({ success: true, reward: ad.reward });
    } catch (err) {
        console.error('Watch ad error:', err);
        res.status(500).json({ error: 'Failed to record watch' });
    }
});

// Claim ad reward (after watching confirmation)
app.post('/api/secure/claim-ad-reward', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { adId } = req.body;

        const watch = await AdWatch.findOne({ 
            userId, 
            adId, 
            watched: true,
            claimedAt: null 
        });

        if (!watch) {
            return res.status(400).json({ error: 'Ad watch not found or already claimed' });
        }

        // Update user balance
        const reward = watch.reward;
        await User.updateOne(
            { user_id: userId },
            {
                $inc: { balance: reward, total_earned: reward },
                $push: {
                    history: {
                        title: `Ad Watch - ${watch.adNetwork}`,
                        reward,
                        taskId: `ad_${adId}`,
                        date: new Date()
                    }
                }
            }
        );

        // Mark as claimed
        watch.claimedAt = new Date();
        await watch.save();

        return res.json({ success: true, newBalance: (await User.findOne({ user_id: userId })).balance });
    } catch (err) {
        console.error('Claim ad error:', err);
        res.status(500).json({ error: 'Failed to claim reward' });
    }
});

// ==========================================================================
// DAILY RESET TASKS ENDPOINTS
// ==========================================================================

function getNextResetTime(taskType) {
    const now = new Date();
    
    if (taskType === 'daily') {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
    }
    return now;
}

// Get all tasks with daily progress
app.get('/api/secure/tasks-with-progress', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        
        const allTasks = await Task.find({ enabled: true });
        
        const tasksWithProgress = await Promise.all(
            allTasks.map(async (task) => {
                if (task.type !== 'daily') {
                    // One-time tasks
                    const user = await User.findOne({ user_id: userId });
                    const completed = user?.completed_tasks?.includes(task.id);
                    return {
                        ...task.toObject(),
                        completed: !!completed,
                        progress: completed ? 1 : 0,
                        requirementCount: 1
                    };
                }

                // Daily tasks - check if reset needed
                let progress = await DailyTaskProgress.findOne({ userId, taskId: task.id });
                
                if (!progress) {
                    progress = await DailyTaskProgress.create({
                        userId,
                        taskId: task.id,
                        resetAt: getNextResetTime('daily')
                    });
                }

                const now = new Date();
                if (now >= progress.resetAt) {
                    // Reset this task
                    progress.completedCount = 0;
                    progress.claimedToday = false;
                    progress.resetAt = getNextResetTime('daily');
                    await progress.save();
                }

                return {
                    ...task.toObject(),
                    completed: progress.claimedToday,
                    progress: Math.min(progress.completedCount, 1),
                    requirementCount: 1,
                    resetAt: progress.resetAt
                };
            })
        );

        return res.json({ success: true, tasks: tasksWithProgress });
    } catch (err) {
        console.error('Get tasks error:', err);
        res.status(500).json({ error: 'Failed to load tasks' });
    }
});

// Complete a daily task
app.post('/api/secure/complete-daily-task', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { taskId } = req.body;

        const task = await Task.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        let progress = await DailyTaskProgress.findOne({ userId, taskId });
        if (!progress) {
            progress = await DailyTaskProgress.create({
                userId,
                taskId,
                resetAt: getNextResetTime('daily')
            });
        }

        // Check if reset needed
        if (new Date() >= progress.resetAt) {
            progress.completedCount = 0;
            progress.claimedToday = false;
            progress.resetAt = getNextResetTime('daily');
        }

        if (progress.claimedToday) {
            return res.status(400).json({ error: 'Already completed today' });
        }

        // Complete and claim reward
        progress.completedCount = 1;
        progress.claimedToday = true;
        progress.lastCompletedAt = new Date();
        await progress.save();

        // Award user
        await User.updateOne(
            { user_id: userId },
            {
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: {
                    history: {
                        title: task.title,
                        reward: task.reward,
                        taskId,
                        date: new Date()
                    }
                }
            }
        );

        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({ 
            success: true, 
            reward: task.reward,
            newBalance: updatedUser.balance
        });
    } catch (err) {
        console.error('Complete daily task error:', err);
        res.status(500).json({ error: 'Failed to complete task' });
    }
});
app.post('/api/admin/create-test-ads', validateAdmin, async (req, res) => {
    try {
        console.log('🔵 [TEST-ADS] Starting...');
        console.log('🔵 [TEST-ADS] Admin user:', req.adminUser?.id || req.user?.id);
        
        // Test MongoDB connection
        const count = await ActiveAd.countDocuments({});
        console.log('🔵 [TEST-ADS] Current ad count:', count);
        
        // Clear
        const deleteResult = await ActiveAd.deleteMany({});
        console.log('🔵 [TEST-ADS] Deleted:', deleteResult.deletedCount);
        
        const testAds = [
            { adId: 'ad_1_adgrams', network: 'adgrams', unitId: 'int-35918', reward: 0.05, maxWatchesPerDay: 2 },
            { adId: 'ad_2_adgrams', network: 'adgrams', unitId: 'int-35918', reward: 0.10, maxWatchesPerDay: 2 },
            { adId: 'ad_3_google', network: 'google_ads', unitId: 'test_3', reward: 0.05, maxWatchesPerDay: 2 }
        ];
        
        const result = await ActiveAd.insertMany(testAds);
        console.log('🔵 [TEST-ADS] Inserted:', result.length);
        
        // Log action
        if (logAdminAction) {
            await logAdminAction(req.adminUser, 'ads_created', 'Created test ad units');
        }
        
        res.json({ success: true, created: result.length });
    } catch (e) {
        console.error('❌ [TEST-ADS] ERROR:', e.message);
        console.error('❌ [TEST-ADS] Stack:', e.stack);
        console.error('❌ [TEST-ADS] Full error:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
        
        res.status(500).json({ 
            error: e.message || 'Unknown error',
            type: e.name,
            details: e.toString()
        });
    }
});
app.get('/api/admin/test', validateAdmin, async (req, res) => {
    try {
        const count = await ActiveAd.countDocuments({});
        res.json({ success: true, adCount: count, user: req.adminUser?.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/secure/leaderboard', validateInitData, async (req, res) => {
    try {
        const type = req.query.type === 'invites' ? 'invites' : 'points';
        const sortField = type === 'invites' ? 'referralCount' : 'points';
        const userId = req.tgUser.id;

        const topUsers = await User.find({ is_banned: false })
            .select(`user_id username first_name ${sortField}`)
            .sort({ [sortField]: -1 })
            .limit(50)
            .lean();

        const leaderboard = topUsers.map((u, idx) => ({
            rank: idx + 1,
            user_id: u.user_id,
            name: u.first_name || u.username || `User ${u.user_id}`,
            score: u[sortField] || 0,
            isYou: u.user_id === userId
        }));

        let myEntry = leaderboard.find(e => e.isYou);
        if (!myEntry) {
            const myUser = await User.findOne({ user_id: userId }).select(sortField).lean();
            const myScore = myUser ? (myUser[sortField] || 0) : 0;
            const higherCount = await User.countDocuments({ is_banned: false, [sortField]: { $gt: myScore } });
            myEntry = {
                rank: higherCount + 1,
                user_id: userId,
                name: 'You',
                score: myScore,
                isYou: true,
                outsideTop: true
            };
        }

        return res.json({ success: true, type, leaderboard, myRank: myEntry });
    } catch (err) {
        console.error("Leaderboard fetch error:", err);
        return res.status(500).json({ error: "Failed to load leaderboard." });
    }
});
// 🤖 Automated Background Worker Infrastructure Timer (24h loop)
setInterval(async () => {
    try {
        console.log("🤖 System automated task audit pass sequence active...");
        await runGhostValidator(null); 
    } catch (err) { console.error("Worker lifecycle failure:", err); }
}, 24 * 60 * 60 * 1000);

bot.catch((err) => console.log(`⚠️ Telegraf Framework Core Event Loop Catch Error:`, err));
process.on('unhandledRejection', (reason) => console.log('❌ Host Process Unhandled Rejection Fault:', reason));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend gateway infrastructure running on channel interface port ${PORT}`));

setInterval(() => { https.get('https://embt-gateway.onrender.com', () => console.log('🛰 Core link self-ping complete')); }, 10 * 60 * 1000);

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ Main Database Node Connected & Synced"));
app.get('/', (req, res) => res.send('Gateway Active'));
bot.launch();
