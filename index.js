const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const cors = require('cors');
const util = require('util');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));
const ADMIN_ID = 7329000880; 

app.use(cors()); 
app.use(express.json());
app.get('/api/adsgram/reward-callback', async (req, res) => {
    try {
        const { userId, sessionId } = req.query;

        // Verify the secret token AdsGram sends
        const secret = req.query.secret || req.headers['x-adsgram-secret'];
        if (secret !== process.env.ADSGRAM_SECRET) {
            console.warn('[AdsGram S2S] Bad secret from IP:', req.ip);
            return res.status(403).send('Forbidden');
        }

        if (!userId || !sessionId) {
            return res.status(400).send('Missing params');
        }

        // In the S2S callback, find by userId + adId instead of sessionId
const session = await AdWatch.findOne({
    userId: Number(userId),
    serverConfirmed: false,
    claimed: false
}).sort({ createdAt: -1 }); // most recent pending session
        if (!session) {
            // Already confirmed or session expired — return 200 so AdsGram doesn't retry
            return res.status(200).send('ok');
        }

        session.serverConfirmed = true;
        await session.save();

        console.log(`[AdsGram S2S] Confirmed session ${sessionId} for user ${userId}`);
        return res.status(200).send('ok');

    } catch (err) {
        console.error('[AdsGram S2S] Callback error:', err);
        return res.status(500).send('error');
    }
});
app.use('/api', enforceGlobalMaintenanceGate);

// --- DATABASE SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
    user_id: { type: Number, index: true },
    first_name: { type: String, default: null },
    username: { type: String, default: null },
    balance: { type: Number, default: 0 },
    
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    pending_message_cleanup: { type: [Number], default: [] },
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 },
    
    history: [{ type: Object }], 
    createdAt: { type: Date, default: Date.now },
    referral_tasks_done: { type: Number, default: 0 },
    referral_paid: { type: Boolean, default: false },
    penalized_tasks: [String],
    is_banned: { type: Boolean, default: false },
    last_admin_active: { type: Date, default: null },
    
    whitelisted: { type: Boolean, default: false },
    
    referred_by: { type: Number, default: null } 
}));

const ReferralEarningSchema = new mongoose.Schema({
    referrerId: { type: Number, required: true, index: true },
    friendId: { type: Number, required: true, index: true },
    totalEarned: { type: Number, default: 0 },
    lastEarnedAt: { type: Date, default: Date.now }
});
ReferralEarningSchema.index({ referrerId: 1, friendId: 1 }, { unique: true });
const ReferralEarning = mongoose.models.ReferralEarning || mongoose.model('ReferralEarning', ReferralEarningSchema);
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
    sessionId:       { type: String, unique: true, required: true },
    userId:          { type: Number, required: true, index: true },
    adId:            { type: String, required: true },
    adNetwork:       { type: String, default: 'adgrams' },
    reward:          { type: Number, required: true },
    serverConfirmed: { type: Boolean, default: false }, // set by S2S postback
    clientDone:      { type: Boolean, default: false }, // set by browser
    claimed:         { type: Boolean, default: false },
    blurDetected: { type: Boolean, default: false }, // audit only
    createdAt:       { type: Date, default: Date.now, expires: 600 } // auto-delete after 10 min
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
    adId:               { type: String, unique: true, required: true },
    network:            { type: String, enum: ['adgrams', 'google_ads'] },
    unitId:             { type: String, required: true },
    reward:             { type: Number, required: true },        // DASH per view
    resetIntervalHours: { type: Number, default: 24 },          // reset every N hours
    watchesPerReset:    { type: Number, default: 2 },           // watches allowed per reset period
    enabled:            { type: Boolean, default: true },
    createdAt:          { type: Date, default: Date.now }
}));

const YoutubeTask = mongoose.model('YoutubeTask', new mongoose.Schema({
    id: { type: String, default: () => 'yt' + Math.floor(Math.random() * 1000000) },
    title: { type: String, required: true },
    instructions: { type: String, default: '' },     // shown to user before they watch
    youtubeUrl: { type: String, required: true },
    thumbnail: { type: String, default: '' },         // optional image/base64, same pattern as Task.image
    code: { type: String, required: true },            // hidden code, never sent to non-admin clients
    reward: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    claimedBy: [{ type: Number }],                      // array of user_id who already redeemed
    createdAt: { type: Date, default: Date.now }
}));

const TelegramVerification = mongoose.model('TelegramVerification', new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    inChannel: { type: Boolean, default: false },
    inGroup: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    lastChecked: { type: Date, default: Date.now }
}));


const ReminderConfig = mongoose.model('ReminderConfig', new mongoose.Schema({
    reminder_enabled: { type: Boolean, default: true },
    reminder_image_message_id: { type: Number, default: null },
    reminder_image_file_id: { type: String, default: null },
    last_updated: { type: Date, default: Date.now }
}));

const UserReminder = mongoose.model('UserReminder', new mongoose.Schema({
    user_id: { type: Number, required: true, index: true },
    last_reminder_sent: { type: Date, default: null },
    welcome_message_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
    reminder_count: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));const FastTaskConfigSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'global' },
    blockId: { type: String, default: '' },
    minReward: { type: Number, default: 50 },
    maxReward: { type: Number, default: 150 },
    dailyLimit: { type: Number, default: 10 },
    enabled: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now }
});
const FastTaskConfig = mongoose.models.FastTaskConfig || mongoose.model('FastTaskConfig', FastTaskConfigSchema);

const FastTaskClaimSchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    reward: { type: Number, required: true },
    source: { type: String, enum: ['reward_callback', 'client_event'], default: 'reward_callback' },
    timestamp: { type: Date, default: Date.now }
});
const FastTaskClaim = mongoose.models.FastTaskClaim || mongoose.model('FastTaskClaim', FastTaskClaimSchema);


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



1
function getUTCDayStart(date = new Date()) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}
// ==========================================================================
// SHARED TELEGRAM INIT DATA VERIFICATION
// ==========================================================================
function verifyTelegramInitData(rawInitData) {
    if (!rawInitData) return null;

    try {
        const cleanInitData = rawInitData.startsWith('tma ')
            ? rawInitData.substring(4)
            : rawInitData.startsWith('Bearer ')
                ? rawInitData.substring(7)
                : rawInitData;

        const urlParams = new URLSearchParams(cleanInitData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const dataCheckArr = [];
        for (const [key, value] of urlParams.entries()) {
            dataCheckArr.push(`${key}=${value}`);
        }
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
        const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHmac !== hash) return null;

        const userRaw = urlParams.get('user');
        return userRaw ? JSON.parse(userRaw) : null;
    } catch (err) {
        console.error("[Auth Parsing Error Stack]:", err.message);
        return null;
    }
}

const validateInitData = (req, res, next) => {
    const rawInitData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
    const user = verifyTelegramInitData(rawInitData);

    if (!user) {
        console.warn(`[Security Alert] Signature verification failed or payload missing.`);
        return res.status(403).json({ error: "Signature hash mismatch or expired session state." });
    }

    // REPLACE WITH:
    req.tgUser = user;
    return ipGuardMiddleware(req, res, next);
};

const validateAdmin = async (req, res, next) => {
    const rawInitData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
    const user = verifyTelegramInitData(rawInitData);

    if (!user) {
        return res.status(403).json({ error: "Signature hash mismatch or expired session state." });
    }
    if (!admins.includes(user.id)) {
        return res.status(403).json({ error: "Access Denied: Admin Only" });
    }

    req.adminUser = user;
    req.tgUser = user;
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

async function enforceGlobalMaintenanceGate(req, res, next) {
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
     // Inside enforceGlobalMaintenanceGate, after the tester bypass check, add:
if (extractedTelegramId) {
    const userDoc = await User.findOne({ user_id: extractedTelegramId }).select('whitelisted').lean();
    if (userDoc?.whitelisted) {
        console.log(`[Maintenance Bypass] Whitelisted user permitted: ${extractedTelegramId}`);
        return next();
    }
}
    // 4. Reject all standard users with an HTTP 503 containing telemetry properties
    return res.status(503).json({
        maintenance: true,
        serverTime: Date.now(),
        ...ARCHITECTURAL_MAINTENANCE_CONFIG.metadata
    });
}
// ── IP GUARD: Strike system ─────────────────────────────────────────────────
const ipUserMap = {};      // { ip: Set<userId> }
const inviterStrikes = {}; // { inviterId: strikeCount }
const STRIKE_LIMIT = 5;

function getClientIP(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

function ipGuardMiddleware(req, res, next) {
    if (!req.tgUser) return next();

    const ip = getClientIP(req);
    const userId = req.tgUser.id;

    if (!ipUserMap[ip]) ipUserMap[ip] = new Set();
    const knownUsers = ipUserMap[ip];

    if (knownUsers.has(userId)) return next();

    if (knownUsers.size >= 1) {
        const existingUserId = [...knownUsers][0];

        // ── WHITELIST BYPASS ──
        (async () => {
            try {
                const [newUserDoc, existingUserDoc] = await Promise.all([
                    User.findOne({ user_id: userId }).select('whitelisted referred_by').lean(),
                    User.findOne({ user_id: existingUserId }).select('whitelisted').lean()
                ]);

                if (newUserDoc?.whitelisted || existingUserDoc?.whitelisted) {
                    console.log(`[IP Guard] Bypassed — whitelisted user involved (${userId} or ${existingUserId})`);
                    knownUsers.add(userId);
                    return next();
                }

                // Not whitelisted — proceed with normal ban flow
                await User.updateOne({ user_id: userId }, { $set: { is_banned: true } });

                const inviterId = newUserDoc?.referred_by;
                if (inviterId) {
                    const inviterDoc = await User.findOne({ user_id: inviterId }).select('whitelisted').lean();
                    if (inviterDoc?.whitelisted) {
                        console.log(`[IP Guard] Inviter ${inviterId} is whitelisted — no strike issued`);
                    } else {
                        if (!inviterStrikes[inviterId]) inviterStrikes[inviterId] = 0;
                        inviterStrikes[inviterId]++;
                        const strikes = inviterStrikes[inviterId];

                        if (strikes >= STRIKE_LIMIT) {
                            await User.updateOne({ user_id: inviterId }, { $set: { is_banned: true } });
                            await AdminActivity.create({
                                admin_id: 0, admin_name: 'IP Guard (Auto)',
                                action: 'inviter_banned',
                                description: `Inviter ${inviterId} banned after ${strikes} self-referral strikes. Last IP: ${ip}`
                            });
                        } else {
                            await AdminActivity.create({
                                admin_id: 0, admin_name: 'IP Guard (Auto)',
                                action: 'inviter_strike',
                                description: `Inviter ${inviterId} received strike ${strikes}/${STRIKE_LIMIT}. Banned account: ${userId} on IP: ${ip}`
                            });
                        }
                    }
                }

                await AdminActivity.create({
                    admin_id: 0, admin_name: 'IP Guard (Auto)',
                    action: 'invited_account_banned',
                    description: `Banned duplicate account ${userId} on IP ${ip}. Original user: ${existingUserId}`
                });
            } catch (e) {
                console.error('[IP Guard] DB error:', e.message);
            }
        })();

        return res.status(403).json({
            error: 'multi_account_detected',
            banned: true,
            message: `Self referral detected: IP matches with ${existingUserId}`
        });
    }

    knownUsers.add(userId);
    next();
}
async function getFastTaskConfig() {
    let cfg = await FastTaskConfig.findOne({ key: 'global' });
    if (!cfg) cfg = await FastTaskConfig.create({ key: 'global' });
    return cfg;
}

function rollRandomReward(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function getUTCDayStartFastTask(date = new Date()) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

async function creditFastTaskReward(userId, source) {
    const cfg = await getFastTaskConfig();
    if (!cfg.enabled) return { success: false, error: 'Fast Tasks are currently disabled.' };

    const dayStart = getUTCDayStartFastTask();
    const claimsToday = await FastTaskClaim.countDocuments({ userId, timestamp: { $gte: dayStart } });

    if (cfg.dailyLimit && claimsToday >= cfg.dailyLimit) {
        return { success: false, error: 'Daily Fast Task limit reached.', dailyLimitReached: true };
    }

    const user = await User.findOne({ user_id: userId }).select('is_banned').lean();
    if (!user) return { success: false, error: 'User not found.' };
    if (user.is_banned) return { success: false, error: 'Account is banned.' };

    const rewardAmount = rollRandomReward(cfg.minReward, cfg.maxReward);

    await User.updateOne(
        { user_id: userId },
        {
            $inc: { balance: rewardAmount, total_earned: rewardAmount },
            $push: {
                history: {
                    title: 'Fast Task (Adsgram)',
                    reward: rewardAmount,
                    taskId: 'fasttask_adsgram',
                    date: new Date()
                }
            }
        }
    );

    await FastTaskClaim.create({ userId, reward: rewardAmount, source });

    return {
        success: true,
reward: rewardAmount,
        claimsRemainingToday: cfg.dailyLimit ? Math.max(0, cfg.dailyLimit - claimsToday - 1) : null
    };
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
async function getReminderConfig() {
    let config = await ReminderConfig.findOne();
    if (!config) {
        config = await ReminderConfig.create({
            reminder_enabled: true,
            reminder_image_message_id: null,
            reminder_image_file_id: null
        });
    }
    return config;
}

async function sendReminderMessage(userId) {
    try {
        const config = await getReminderConfig();
        if (!config.reminder_enabled || !config.reminder_image_file_id) {
            console.warn(`[Reminder] Config missing for user ${userId}`);
            return false;
        }

        const reminderText = `🔔 *You're Missing Out!*\n\nHey! Get back to earning with Dash Earn. Tap the button below to continue 🚀`;

     const senMsg = await bot.telegram.sendPhoto(
            userId,
            config.reminder_image_file_id,
            {
                caption: reminderText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '▶️ Start Earning',
                            callback_data: 'start_bot_reminder'
                        }
                    ]]
                }
            }
        );
await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: { $each: [ctx.message.message_id, senMsg.message_id] } } }
        );
        await UserReminder.updateOne(
            { user_id: userId },
            {
                $set: { 
                    last_reminder_sent: new Date(),
                    welcome_message_deleted: false 
                },
                $inc: { reminder_count: 1 }
            },
            { upsert: true }
        );

        return true;
    } catch (err) {
        console.error(`[Reminder Send Error] User ${userId}:`, err.message);
        return false;
    }
}
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
async function checkAndSendReminders() {
    try {
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

        // Find users with deleted welcome messages who haven't gotten a reminder in 6 hours
        const usersNeedingReminder = await UserReminder.find({
            welcome_message_deleted: true,
            $or: [
                { last_reminder_sent: null },
                { last_reminder_sent: { $lt: sixHoursAgo } }
            ]
        });

        console.log(`[Reminder Check] Found ${usersNeedingReminder.length} users needing reminders`);

        for (const reminder of usersNeedingReminder) {
            const sent = await sendReminderMessage(reminder.user_id);
            if (sent) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
            }
        }

    } catch (err) {
        console.error('[Reminder Check Error]:', err.message);
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
            `👋 Welcome to Dash Earn!\n\nYour profile is fully synced. Tap the button below to open the app and start earning!`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]]) }
        );

        // Track both message IDs for cleanup
        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: { $each: [ctx.message.message_id, sentMsg.message_id] } } }
        );

        

    } catch (error) {
        console.error("START ERROR:", error);
        return ctx.reply(`⚠️ Error initializing your dashboard.\n\n${error.message}`);
    }
});

// Inline button handler for reminder start button
bot.action('start_bot_reminder', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app';

        await ctx.answerCbQuery('Opening app... 🚀', { show_alert: false });
        
        // Update reminder - they clicked so they're re-engaged
        await UserReminder.updateOne(
            { user_id: userId },
            { $set: { welcome_message_deleted: false } }
        );

       const openedMsg = await ctx.reply(
            `👋 Welcome back to Dash Earn!\n\nTap below to continue earning:`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]])
            }
        );
        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: { $each: [ctx.message.message_id, openedMsg.message_id] } } }
        );
    } catch (err) {
        console.error('[Reminder Button Error]:', err.message);
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
app.post('/api/verify-membership', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const CHANNEL_ID = process.env.CHANNEL_ID; // e.g. "@FlamesChannel"
        const GROUP_ID   = process.env.GROUP_ID;   // e.g. "@FlamesCommunity"

        async function checkMember(chatId) {
            try {
                const m = await bot.telegram.getChatMember(chatId, userId);
                return ['creator','administrator','member','restricted'].includes(m.status);
            } catch(e) {
                console.warn(`getChatMember failed for ${chatId}:`, e.message);
                return false;
            }
        }

        const [inChannel, inGroup] = await Promise.all([
            checkMember(CHANNEL_ID),
            checkMember(GROUP_ID)
        ]);

        const verified = inChannel && inGroup;

        // Cache result
        await TelegramVerification.updateOne(
            { userId },
            { $set: { inChannel, inGroup, verified, lastChecked: new Date() } },
            { upsert: true }
        );

        return res.json({ verified, inChannel, inGroup });

    } catch (err) {
        console.error('Verify membership error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});
app.get('/api/admin/stats', validateAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalTasks = await Task.countDocuments();
        const settings = await getSettings();

        // points field = USDT in our currency system
        const totalUsdtInSystem = await User.aggregate([
            { $group: { _id: null, total: { $sum: "$points" } } }
        ]);

        res.json({ 
            users: totalUsers, 
            tasks: totalTasks,
            totalUsdt: totalUsdtInSystem[0]?.total || 0,
            maintenance: settings.maintenance_mode,
            ref_bonus: settings.ref_bonus_amount,
            ref_percent: settings.ref_commission_percent
        });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});
app.get('/api/admin/user-strikes/:userId', validateAdmin, async (req, res) => {
    const uid = parseInt(req.params.userId);
    res.json({ userId: uid, strikes: inviterStrikes[uid] || 0 });
});
// Toggle whitelist status for a user
app.post('/api/admin/user/whitelist', validateAdmin, async (req, res) => {
    try {
        const { userId, whitelisted } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required." });

        const updatedUser = await User.findOneAndUpdate(
            { user_id: Number(userId) },
            { $set: { whitelisted: Boolean(whitelisted) } },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ error: "User not found." });
        await logAdminAction(req.adminUser, whitelisted ? 'user_whitelisted' : 'user_unwhitelisted', `User ${userId}`);

        return res.json({ success: true, whitelisted: updatedUser.whitelisted });
    } catch (err) {
        res.status(500).json({ error: "Failed to update whitelist status." });
    }
});
// Upload reminder image to private channel and save file_id
app.post('/api/admin/reminder-config', validateAdmin, async (req, res) => {
    try {
        if (!STORAGE_CHANNEL_ID) {
            return res.status(400).json({ error: "STORAGE_CHANNEL_ID not configured" });
        }

        const caption = `🔔 REMINDER IMAGE - Do not delete`;
        
        // If body has base64 image
        if (req.body.imageBase64) {
            const base64Data = req.body.imageBase64.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            const msg = await bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, { source: buffer }, { caption });
            
            await ReminderConfig.updateOne(
                {},
                {
                    $set: {
                        reminder_image_message_id: msg.message_id,
                        reminder_image_file_id: msg.photo[msg.photo.length - 1].file_id,
                        last_updated: new Date()
                    }
                },
                { upsert: true }
            );

            await logAdminAction(req.adminUser, 'reminder_image_updated', 'Updated reminder image');

            return res.json({
                success: true,
                message: "Reminder image uploaded successfully",
                messageId: msg.message_id,
                fileId: msg.photo[msg.photo.length - 1].file_id
            });
        }

        return res.status(400).json({ error: "No image provided" });

    } catch (err) {
        console.error('[Reminder Config Error]:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Get reminder config status
app.get('/api/admin/reminder-config', validateAdmin, async (req, res) => {
    try {
        const config = await getReminderConfig();
        res.json({
            success: true,
            enabled: config.reminder_enabled,
            has_image: !!config.reminder_image_file_id,
            message_id: config.reminder_image_message_id,
            last_updated: config.last_updated
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Toggle reminders on/off
app.post('/api/admin/reminder-config/toggle', validateAdmin, async (req, res) => {
    try {
        const { enabled } = req.body;
        await ReminderConfig.updateOne(
            {},
            { $set: { reminder_enabled: Boolean(enabled) } },
            { upsert: true }
        );
        await logAdminAction(req.adminUser, 'reminders_toggled', `Reminders ${enabled ? 'enabled' : 'disabled'}`);
        res.json({ success: true, enabled: Boolean(enabled) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get reminder statistics
app.get('/api/admin/reminder-stats', validateAdmin, async (req, res) => {
    try {
        const totalUsersWithDeletedWelcome = await UserReminder.countDocuments({ welcome_message_deleted: true });
        const recentReminders = await UserReminder.find({ last_reminder_sent: { $exists: true, $ne: null } })
            .sort({ last_reminder_sent: -1 })
            .limit(10)
            .lean();

        res.json({
            success: true,
            usersAwaitingReminder: totalUsersWithDeletedWelcome,
            recentReminders: recentReminders.map(r => ({
                user_id: r.user_id,
                last_sent: r.last_reminder_sent,
                count: r.reminder_count
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// List all whitelisted users
app.get('/api/admin/whitelist', validateAdmin, async (req, res) => {
    try {
        const users = await User.find({ whitelisted: true })
            .select('user_id username first_name')
            .lean();
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
const sseClients = [];

// Patch server-side console once at startup to broadcast to connected panels
(function patchServerConsole() {
    ['log', 'warn', 'error'].forEach(level => {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            orig(...args);
            const line = args.map(a => typeof a === 'object' ? util.inspect(a) : String(a)).join(' ');
            const payload = JSON.stringify({ level, message: line, time: new Date().toISOString() });
            sseClients.forEach(client => {
                try { client.write(`data: ${payload}\n\n`); } catch (e) {}
            });
        };
    });
})();

app.get('/api/admin/console/stream', validateAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    req.on('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
    });
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
                
                total_earned: user.total_earned || 0,
                referrals: user.referralCount || 0,
                tasksCompletedCount: user.completed_tasks ? user.completed_tasks.length : 0,
                completed_tasks: user.completed_tasks || [],
                is_banned: user.is_banned || false,
                red_flag: user.red_flag || false,
                tasks_added: user.tasks_added || 0,
                createdAt: user.createdAt,
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
        

// ADMIN ROUTES
app.get('/api/admin/fast-task/config', validateAdmin, async (req, res) => {
    try {
        const cfg = await getFastTaskConfig();
        res.json({ success: true, config: cfg });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/fast-task/config', validateAdmin, async (req, res) => {
    try {
        const { blockId, minReward, maxReward, dailyLimit, enabled } = req.body;
        const updates = { updatedAt: new Date() };

        if (blockId !== undefined) updates.blockId = String(blockId).trim();
        if (minReward !== undefined) updates.minReward = Number(minReward);
        if (maxReward !== undefined) updates.maxReward = Number(maxReward);
        if (dailyLimit !== undefined) updates.dailyLimit = Number(dailyLimit);
        if (enabled !== undefined) updates.enabled = Boolean(enabled);

        if (updates.minReward !== undefined && updates.maxReward !== undefined && updates.minReward > updates.maxReward) {
            return res.status(400).json({ success: false, error: 'Min reward cannot exceed max reward.' });
        }

        await FastTaskConfig.updateOne({ key: 'global' }, { $set: updates }, { upsert: true });
        await logAdminAction(req.adminUser, 'fast_task_config_updated', `Updated: ${Object.keys(updates).join(', ')}`);

        const cfg = await getFastTaskConfig();
        res.json({ success: true, config: cfg });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/fast-task/recent-claims', validateAdmin, async (req, res) => {
    try {
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        const claims = await FastTaskClaim.find().sort({ timestamp: -1 }).limit(limit).lean();

        const userIds = [...new Set(claims.map(c => c.userId))];
        const users = await User.find({ user_id: { $in: userIds } }).select('user_id username first_name').lean();
        const userMap = {};
        users.forEach(u => { userMap[u.user_id] = u.username || u.first_name || `User_${u.user_id}`; });

        const enriched = claims.map(c => ({ ...c, displayName: userMap[c.userId] || `User_${c.userId}` }));
        res.json({ success: true, claims: enriched });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// USER ROUTES
app.get('/api/secure/fast-task-config', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const cfg = await getFastTaskConfig();

        const dayStart = getUTCDayStartFastTask();
        const claimsToday = await FastTaskClaim.countDocuments({ userId, timestamp: { $gte: dayStart } });

        res.json({
            success: true,
            blockId: cfg.blockId,
            enabled: cfg.enabled,
            dailyLimit: cfg.dailyLimit,
            claimsToday,
            claimsRemainingToday: cfg.dailyLimit ? Math.max(0, cfg.dailyLimit - claimsToday) : null
        });
    } catch (err) {
        console.error('Fast task config fetch error:', err);
        res.status(500).json({ success: false, error: 'Failed to load Fast Task config.' });
    }
});

app.post('/api/secure/fast-task-claim', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const result = await creditFastTaskReward(userId, 'client_event');
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
    } catch (err) {
        console.error('Fast task claim error:', err);
        res.status(500).json({ success: false, error: 'Failed to process reward.' });
    }
});

// PUBLIC REWARD CALLBACK (Adsgram server hits this)
// Set in Adsgram dashboard as:
// https://embt-gateway.onrender.com/api/fast-task/reward-callback?userid=[userId]
app.get('/api/fast-task/reward-callback', async (req, res) => {
    try {
        const userId = Number(req.query.userid);
        if (!userId || isNaN(userId)) return res.status(400).send('Missing userid');

        const result = await creditFastTaskReward(userId, 'reward_callback');
        if (!result.success) {
            console.warn(`[FastTask Callback] Rejected user ${userId}: ${result.error}`);
        } else {
            console.log(`[FastTask Callback] Credited ${result.reward} DASH to user ${userId}`);
        }
        return res.status(200).send('ok');
    } catch (err) {
        console.error('Fast task reward callback error:', err);
        return res.status(200).send('ok');
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

app.post('/api/secure/ads/start-session', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { adId } = req.body;
        if (!adId) return res.status(400).json({ error: 'adId required' });

        const ad = await ActiveAd.findOne({ adId, enabled: true });
        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        // Use dynamic reset interval
        const periodStart    = getResetPeriodStart(ad.resetIntervalHours || 24);
        const watchesPerReset = ad.watchesPerReset || 2;

        const watchedThisPeriod = await AdWatch.countDocuments({
            userId,
            adId,
            claimed: true,
            createdAt: { $gte: periodStart }
        });

        if (watchedThisPeriod >= watchesPerReset) {
            const nextReset = new Date(periodStart);
            nextReset.setUTCHours(nextReset.getUTCHours() + (ad.resetIntervalHours || 24));
            return res.status(400).json({
                error: 'Limit reached for this period.',
                nextReset: nextReset.toISOString()
            });
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        await AdWatch.create({
            sessionId,
            userId,
            adId,
            adNetwork: ad.network,
            reward: ad.reward
        });

        return res.json({ success: true, sessionId });
    } catch (err) {
        console.error('Start ad session error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/api/secure/ads/claim', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { sessionId } = req.body;

        if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

        const session = await AdWatch.findOne({
            sessionId,
            userId,
            claimed: false
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found or already claimed' });
        }

        if (!session.serverConfirmed) {
            // S2S ping hasn't arrived yet — tell frontend to retry
            return res.status(202).json({
                success: false,
                pending: true,
                error: 'Ad reward not yet confirmed by server. Please wait a moment.'
            });
        }

        // All checks passed — credit reward
        session.claimed = true;
        await session.save();

        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: session.reward, total_earned: session.reward },
                $push: {
                    history: {
                        title: `Ad Watch Reward`,
                        reward: session.reward,
                        taskId: `ad_${session.adId}`,
                        date: new Date()
                    }
                }
            },
            { new: true }
        );

        return res.json({
            success: true,
            reward: session.reward,
            newBalance: updatedUser.balance
            
        });

    } catch (err) {
        console.error('Claim ad error:', err);
        res.status(500).json({ error: 'Server error' });
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
                
                whitelisted: u.whitelisted || false,
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

app.get('/api/secure/referrals', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const friends = await User.find({ referred_by: userId })
            .select('user_id username first_name completed_tasks');

        const friendIds = friends.map(f => f.user_id);
        const earnings = await ReferralEarning.find({
            referrerId: userId,
            friendId: { $in: friendIds }
        }).lean();

        const earningsMap = {};
        earnings.forEach(e => { earningsMap[e.friendId] = e.totalEarned; });

        res.json({
            success: true,
            friends: friends.map(f => ({
                username: f.username || `User_${f.user_id}`,
                first_name: f.first_name || f.username || 'Friend',
                tasks_done: f.completed_tasks ? f.completed_tasks.length : 0,
                commission_earned: earningsMap[f.user_id] || 0
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        if (task.type === 'auto' && task.url && task.url.includes('t.me/')) {
    try {
        const urlParts = task.url.split('t.me/')[1];
        const channelUsername = urlParts.split('/')[0];

        if (!channelUsername.startsWith('+')) {
            const channelId = '@' + channelUsername;
            const member = await bot.telegram.getChatMember(channelId, userId);
            const validStatuses = ['member', 'administrator', 'creator'];
            if (!validStatuses.includes(member.status)) {
                return res.status(400).json({ 
                    error: "You have not joined the channel yet. Please join first then claim." 
                });
            }
        }
    } catch (verifyErr) {
        console.error("Membership verification error:", verifyErr.message);
        // FAIL CLOSED — block the claim instead of letting it through
        return res.status(400).json({ 
            error: "Could not verify channel membership. Please make sure you've joined and try again." 
        });
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
    await User.updateOne({ user_id: user.referred_by }, { $inc: { balance: commission } });
    await ReferralEarning.updateOne(
        { referrerId: user.referred_by, friendId: userId },
        { $inc: { totalEarned: commission }, $set: { lastEarnedAt: new Date() } },
        { upsert: true }
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
                        `🎊 *Invite Bonus:* Your friend completed 3 tasks! You earned ${settings.ref_bonus_amount} DASH.\n Also your Commission Unlocked with this friend. \n you Earn percent set from this user earnings now.`,
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
app.post('/api/admin/console/eval', validateAdmin, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const capture = (tag) => (...args) => {
    logs.push(`[${tag}] ` + args.map(a => typeof a === 'object' ? util.inspect(a) : String(a)).join(' '));
  };

  console.log = capture('log');
  console.error = capture('error');
  console.warn = capture('warn');

  let result, error;
  try {
    const fn = new Function('require', 'module', 'exports', `
      return (async () => { ${code} })();
    `);
    result = await fn(require, module, exports);
  } catch (err) {
    error = err.stack || err.message;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  await logAdminAction(req.adminUser, 'console_eval', { code });

  res.json({
    result: result !== undefined ? util.inspect(result) : undefined,
    logs,
    error
  });
});
// ==========================================================================
// WATCH & EARN SYSTEM ENDPOINTS
// ==========================================================================
// GET all ads for admin panel
app.get('/api/admin/ads', validateAdmin, async (req, res) => {
    try {
        const ads = await ActiveAd.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, ads });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// UPDATE ad settings dynamically
app.post('/api/admin/ads/update', validateAdmin, async (req, res) => {
    try {
        const { adId, reward, resetIntervalHours, watchesPerReset, enabled } = req.body;
        if (!adId) return res.status(400).json({ error: 'adId required' });

        const updates = {};
        if (reward             !== undefined) updates.reward             = parseFloat(reward);
        if (resetIntervalHours !== undefined) updates.resetIntervalHours = parseInt(resetIntervalHours);
        if (watchesPerReset    !== undefined) updates.watchesPerReset    = parseInt(watchesPerReset);
        if (enabled            !== undefined) updates.enabled            = Boolean(enabled);

        const ad = await ActiveAd.findOneAndUpdate(
            { adId },
            { $set: updates },
            { new: true }
        );

        if (!ad) return res.status(404).json({ error: 'Ad not found' });

        await logAdminAction(req.adminUser, 'ad_updated',
            `Updated ad ${adId}: ${JSON.stringify(updates)}`
        );

        res.json({ success: true, ad });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Get available ads for user (max 2 per day)
app.get('/api/secure/available-ads', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const allAds = await ActiveAd.find({ enabled: true });

        const adsWithStatus = await Promise.all(
            allAds.map(async (ad) => {
                const resetIntervalHours = ad.resetIntervalHours || 24;
                const watchesPerReset    = ad.watchesPerReset    || 2;

                const periodStart = getResetPeriodStart(resetIntervalHours);

                // Next reset timestamp
                const nextReset = new Date(periodStart);
                nextReset.setUTCHours(nextReset.getUTCHours() + resetIntervalHours);

                const watchedThisPeriod = await AdWatch.countDocuments({
                    userId,
                    adId: ad.adId,
                    claimed: true,
                    createdAt: { $gte: periodStart }
                });

                return {
                    id:                 ad.adId,
                    network:            ad.network,
                    unitId:             ad.unitId,
                    reward:             ad.reward,
                    watchesPerReset,
                    resetIntervalHours,
                    watchedThisPeriod,
                    nextReset:          nextReset.toISOString(),
                    locked:             watchedThisPeriod >= watchesPerReset
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

        const dailyLimit = ad.maxWatchesPerDay || 1;
        const watchedToday = await AdWatch.countDocuments({
            userId,
            adId,
            viewedAt: { $gte: today }
        });

        if (watchedToday >= dailyLimit) {
            return res.status(400).json({ error: 'Daily watch limit reached for this ad' });
        }

        await AdWatch.create({
            userId,
            adId,
            adNetwork: ad.network,
            reward: ad.reward,
            watched: true
        });

        return res.json({ success: true, reward: ad.reward, watchedToday: watchedToday + 1, dailyLimit });
    } catch (err) {
        console.error('Watch ad error:', err);
        res.status(500).json({ error: 'Failed to record watch' });
    }
});
app.post('/api/admin/ads/setup', validateAdmin, async (req, res) => {
    try {
        await ActiveAd.deleteMany({});

        const realAds = [{
            adId:               'ad_1_adsgram',
            network:            'adgrams',
            unitId:             '36270',
            reward:             500,       // 500 DASH per view (edit in panel)
            resetIntervalHours: 24,        // resets once per day (edit in panel)
            watchesPerReset:    3          // 3 watches per reset (edit in panel)
        }];

        const result = await ActiveAd.insertMany(realAds);
        await logAdminAction(req.adminUser, 'ads_created', 'Created real ad units');
        res.json({ success: true, created: result.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


function getResetPeriodStart(resetIntervalHours) {
    const now = new Date();
    const periodStartHour = Math.floor(now.getUTCHours() / resetIntervalHours) * resetIntervalHours;
    const start = new Date(now);
    start.setUTCHours(periodStartHour, 0, 0, 0);
    return start;
}

// ==========================================================================
// DAILY RESET TASKS ENDPOINTS
// ==========================================================================


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
        const sortField = type === 'invites' ? 'referralCount' : 'balance';
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



// List all YouTube tasks (admin sees the code too, for editing/reference)
app.get('/api/admin/youtube-tasks', validateAdmin, async (req, res) => {
    try {
        const tasks = await YoutubeTask.find().sort({ createdAt: -1 }).lean();
        res.json({ success: true, tasks });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Create a new YouTube task
app.post('/api/admin/youtube-tasks/add', validateAdmin, async (req, res) => {
    try {
        const { title, instructions, youtubeUrl, thumbnail, code, reward } = req.body;

        if (!title || !youtubeUrl || !code || reward === undefined || reward === null) {
            return res.status(400).json({ success: false, error: "Title, YouTube URL, Code, and Reward are required." });
        }

        const rewardNum = parseFloat(reward);
        if (isNaN(rewardNum) || rewardNum <= 0) {
            return res.status(400).json({ success: false, error: "Reward must be a positive number." });
        }

        const newTask = await YoutubeTask.create({
            title: String(title).trim(),
            instructions: instructions ? String(instructions).trim() : '',
            youtubeUrl: String(youtubeUrl).trim(),
            thumbnail: thumbnail || '',
            code: String(code).trim(),
            reward: rewardNum
        });

        await logAdminAction(req.adminUser, 'youtube_task_added', `Added YouTube task: ${newTask.title}`);

        return res.json({ success: true, taskId: newTask.id });
    } catch (err) {
        console.error("YouTube task create error:", err);
        return res.status(500).json({ success: false, error: "Failed to create YouTube task." });
    }
});

// Delete a YouTube task
app.delete('/api/admin/youtube-tasks/delete/:id', validateAdmin, async (req, res) => {
    try {
        const result = await YoutubeTask.deleteOne({ id: req.params.id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: "Task not found." });
        }
        await logAdminAction(req.adminUser, 'youtube_task_deleted', `Deleted YouTube task: ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        console.error("YouTube task delete error:", err);
        return res.status(500).json({ success: false, error: "Failed to delete task." });
    }
});

// Toggle enabled/disabled
app.post('/api/admin/youtube-tasks/toggle', validateAdmin, async (req, res) => {
    try {
        const { id, enabled } = req.body;
        const task = await YoutubeTask.findOneAndUpdate(
            { id },
            { $set: { enabled: Boolean(enabled) } },
            { new: true }
        );
        if (!task) return res.status(404).json({ success: false, error: "Task not found." });
        return res.json({ success: true, enabled: task.enabled });
    } catch (err) {
        return res.status(500).json({ success: false, error: "Failed to update task." });
    }
});

app.get('/api/secure/youtube-tasks', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const tasks = await YoutubeTask.find({ enabled: true }).sort({ createdAt: -1 }).lean();

        const safeTasks = tasks.map(t => ({
            id: t.id,
            title: t.title,
            instructions: t.instructions,
            youtubeUrl: t.youtubeUrl,
            thumbnail: t.thumbnail,
            reward: t.reward,
            claimed: (t.claimedBy || []).includes(userId)
            // NOTE: t.code is intentionally never sent to the client
        }));

        return res.json({ success: true, tasks: safeTasks });
    } catch (err) {
        console.error("List YouTube tasks error:", err);
        return res.status(500).json({ success: false, error: "Failed to load tasks." });
    }
});

// Claim a YouTube task by submitting the hidden code
app.post('/api/secure/youtube-tasks/claim', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { taskId, code } = req.body;

        if (!taskId || !code || !String(code).trim()) {
            return res.status(400).json({ success: false, error: "Please enter the code from the video." });
        }

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ success: false, error: "User not found." });
        if (user.is_banned) return res.status(403).json({ success: false, error: "Account is banned." });

        const task = await YoutubeTask.findOne({ id: taskId, enabled: true });
        if (!task) return res.status(404).json({ success: false, error: "Task not found." });

        if ((task.claimedBy || []).includes(userId)) {
            return res.status(400).json({ success: false, error: "You already claimed this task." });
        }

        // Case-insensitive, trimmed compare so small typos in case don't block legit users
        const submitted = String(code).trim();
        const actual = String(task.code).trim();
        if (submitted !== actual) {
            return res.status(400).json({ success: false, error: "Incorrect code. Re-watch the video and try again." });
        }

        // Mark claimed + credit reward atomically-ish (two writes, but task claim check above guards re-entry)
        await YoutubeTask.updateOne({ id: taskId }, { $addToSet: { claimedBy: userId } });

        await User.updateOne(
            { user_id: userId },
            {
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: {
                    history: {
                        title: `YouTube: ${task.title}`,
                        reward: task.reward,
                        taskId: task.id,
                        date: new Date()
                    }
                }
            }
        );

        // Log to Telegram storage channel, same pattern as your proof submissions
        const logMsg =
            `📺 *YOUTUBE TASK CLAIMED*\n` +
            `🆔 Task: \`${task.id}\`\n` +
            `📝 Title: ${task.title}\n` +
            `👤 User: \`${userId}\`${user.username ? ' @' + user.username : ''}\n` +
            `💰 Reward: ${task.reward} USDT\n` +
            `📅 ${new Date().toLocaleString()}`;
        await postToChannel(logMsg);

        const updatedUser = await User.findOne({ user_id: userId });
        return res.json({
            success: true,
            reward: task.reward,
            newBalance: updatedUser.balance
        });

    } catch (err) {
        console.error("YouTube task claim error:", err);
        return res.status(500).json({ success: false, error: "Internal server error." });
    }
});


app.get('/api/secure/history', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const user = await User.findOne({ user_id: userId }).lean();
        if (!user) return res.status(404).json({ error: "User not found." });

        const history = (user.history || [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 50);

        return res.json({ success: true, history });
    } catch (err) {
        console.error("History fetch error:", err);
        return res.status(500).json({ error: "Failed to load history." });
    }
});  

// 🔔 Reminder System Workers
setInterval(async () => {
    try {
        console.log("📢 Reminder system check cycle...");
        await checkAndSendReminders();
    } catch (err) {
        console.error('[Reminder Worker Error]:', err.message);
    }
}, 2 * 60 * 60 * 1000); // Every 2 hours

// 🔄 Check for deleted welcome messages
setInterval(async () => {
    try {
        console.log("🔄 [Reminder Check] Checking for deleted welcome messages...");

        // Case 1: users still holding message IDs to check — verify if deleted
        const usersWithPending = await User.find({ 
            pending_message_cleanup: { $exists: true, $ne: [] },
            is_banned: false
        }).lean();

        for (const user of usersWithPending) {
            for (const msgId of user.pending_message_cleanup) {
                try {
                    await bot.telegram.getMessage(user.user_id, msgId);
                } catch (err) {
                    if (err.message.includes('not found')) {
                        console.log(`[Reminder] Welcome message deleted for user ${user.user_id}`);
                        await UserReminder.updateOne(
                            { user_id: user.user_id },
                            { $set: { welcome_message_deleted: true, deleted_at: new Date(), last_reminder_sent: null } },
                            { upsert: true }
                        );
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Case 2: cleanup array already empty (cleared by /api/secure/profile)
        // but reminder flag never got flipped — these were falling through before
        const usersAlreadyCleared = await User.find({
            pending_message_cleanup: { $size: 0 },
            is_banned: false
        }).select('user_id').lean();

        const clearedIds = usersAlreadyCleared.map(u => u.user_id);

        if (clearedIds.length > 0) {
            const existingRecords = await UserReminder.find({ user_id: { $in: clearedIds } }).lean();
            const existingMap = new Map(existingRecords.map(r => [r.user_id, r]));

            for (const uid of clearedIds) {
                const rec = existingMap.get(uid);
                if (!rec) {
                    console.log(`[Reminder] Creating record for already-cleared user ${uid}`);
                    await UserReminder.create({
                        user_id: uid,
                        welcome_message_deleted: true,
                        deleted_at: new Date(),
                        last_reminder_sent: null
                    });
                } else if (!rec.welcome_message_deleted) {
                    console.log(`[Reminder] Flagging already-cleared user ${uid} as eligible`);
                    await UserReminder.updateOne(
                        { user_id: uid },
                        { $set: { welcome_message_deleted: true, deleted_at: new Date(), last_reminder_sent: null } }
                    );
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        console.log("[Reminder Check] Deletion check complete");
    } catch (err) {
        console.error('[Welcome Message Checker Error]:', err.message);
    }
}, 30 * 60 * 1000); // Check every 30 minutes
// 🤖 Automated Background Validation (Keep your existing one)
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
