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

// --- DATABASE SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
    user_id: Number,
    username: { type: String, default: null },
    balance: { type: Number, default: 0 },
    points: { type: Number, default: 0.00 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
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
    created_at: { type: Date, default: Date.now }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, 
    name: String, 
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

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
        index: true // Unique tracking reference code
    },
    user_id: {
        type: Number,
        required: true,
        index: true // Maps back to user_id in your User collection
    },
    type: {
        type: String,
        required: true,
        enum: ['withdrawal', 'transfer', 'game_spin', 'game_win'] // Standardized system typings
    },
    target_user_id: {
        type: Number,
        default: null // Only populated during internal P2P balance loops
    },
    amount: {
        type: Number,
        required: true // Raw amount requested or spent
    },
    fee: {
        type: Number,
        default: 0 // Calculated network percentage fee (applicable to withdrawals)
    },
    finalAmount: {
        type: Number,
        required: true // The precise net balance alteration (Amount - Fee)
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending' // Managed state lifecycle controlled by your Admin panels
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}));
// Secure Weighted Probability Matrix Matrix configuration
const PRIZES = [
    { index: 0, text: "10 Pts", type: "points", value: 10, weight: 50 },      // 40% Chance
    { index: 1, text: "20 Pts", type: "points", value: 20, weight: 24 },      // 30% Chance
    { index: 2, text: "50 Pts", type: "points", value: 50, weight: 5 },      // 15% Chance
    { index: 3, text: "TRY AGAIN", type: "none", value: 0, weight: 20 },      // 10% Chance
    { index: 4, text: "100 Pts", type: "points", value: 100, weight: 0.5 },   // 4.5% Chance
    { index: 5, text: "500 JACKPOT", type: "points", value: 500, weight: 0.5 } // 0.5% Chance
];
const mainMenu = Markup.keyboard([['📱 Open App', '💸 Earn More'], ['💰 Balance', '👤 Profile'], ['👥 Affiliate']]).resize();

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

// --- TELEGRAM AUTHENTICATION MIDDLEWARES ---
const validateInitData = (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: "No init data provided" });

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    urlParams.sort();

    const dataCheckString = decodeURIComponent(urlParams.toString().replace(/\&/g, '\n'));
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (hmac === hash) {
        req.tgUser = JSON.parse(urlParams.get('user'));
        next();
    } else {
        res.status(403).json({ error: "Invalid data signature" });
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
    next();
};

// --- GLOBAL BOT MIDDLEWARES ---
bot.use(async (ctx, next) => {
    const s = await getSettings();
    if (s && s.maintenance_mode && ctx.from && ctx.from.id !== ADMIN_ID) {
        if (ctx.message) {
            return ctx.reply("🛠 *Bot Under Maintenance*\n\nWe are currently updating our systems to handle the user load. We will be back online shortly!", { parse_mode: 'Markdown' });
        }
        return; 
    }
    return next();
});

const userCooldowns = new Map();
const COOLDOWN_MS = 1500; 

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const lastSeen = userCooldowns.get(userId) || 0;

    if (now - lastSeen < COOLDOWN_MS) return;

    userCooldowns.set(userId, now);
    return next();
});

setInterval(() => {
    const now = Date.now();
    for (const [userId, lastSeen] of userCooldowns.entries()) {
        if (now - lastSeen > 60000) userCooldowns.delete(userId);
    }
}, 60000);

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

    try {
        let user = await User.findOne({ user_id: userId });
        if (!user) {
            user = new User({
                user_id: userId,
                referred_by: referrerId ? parseInt(referrerId) : null,
            });
            await user.save();

            if (referrerId && !isNaN(parseInt(referrerId))) {
                await User.updateOne(
                    { user_id: parseInt(referrerId) },
                    { $inc: { referralCount: 1 } }
                );
            }
        }

        const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app'; 
        const sentMsg = await ctx.reply(
            `👋 *Welcome to EMBT!*\n\nYour profile is fully synced. Tap the button below to open the app and start earning!`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]])
            }
        );

        await User.updateOne(
            { user_id: userId }, 
            { $set: { current_state: `delete_welcome_${sentMsg.message_id}` } }
        );
    } catch (error) {
        console.error("Error in bot.start:", error);
        ctx.reply("⚠️ Error initializing your dashboard. Please try /start again.");
    }
});

bot.hears('👥 Affiliate', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        const botUsername = ctx.botInfo.username;
        const refLink = `https://t.me/${botUsername}?start=${ctx.from.id}`;
        const rewardPerRef = 0.20; 
        const totalEarnings = (user.referralCount || 0) * rewardPerRef;

        const msg = "👥 *Affiliate Program*🎁\n\n" +
            "🎁Invite your friends and earn rewards for every new user!🎁\n\n" +
            "📊 *Your Statistics:*\n" +
            `▪️ Total Referrals: \`${user.referralCount || 0}\` users\n` +
            `▪️ Referral Earnings: \`${totalEarnings.toFixed(2)}\` *USDT*\n\n` +
            "🔗 *Your Referral Link:*\n" + `\`${refLink}\``;

        const affiliateButtons = Markup.inlineKeyboard([
            [Markup.button.url('📢 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join EMBT and earn USDT by completing simple tasks! 💸')}`)]
        ]);
        ctx.replyWithMarkdown(msg, affiliateButtons);
    } catch (e) {
        ctx.reply("⚠️ Error loading affiliate data. Try /start");
    }
});

bot.hears('💸 Earn More', (ctx) => {
    ctx.replyWithMarkdown("📂 *Select a Task Category:*\n\nComplete tasks below to increase your balance.", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter'), Markup.button.callback('🌐 Others', 'cat_other')]
    ]));
});

bot.hears('💰 Balance', async (ctx) => {
    try {
        let user = await User.findOne({ user_id: ctx.from.id });
        if (!user) {
            user = await User.create({ user_id: ctx.from.id });
        }
        ctx.replyWithMarkdown(`💰 *Your Balance*\n\n💲 Current Balance: \`${user.balance.toFixed(4)}\` *USDT*\n💲 Total Earned: \`${(user.total_earned || 0).toFixed(4)}\` *USDT*\n\n📈 *Completing tasks to increase your Balance .*`, 
            Markup.inlineKeyboard([[Markup.button.callback('⚗️ Withdraw', 'view_withdraw'), Markup.button.callback('📜 History', 'view_history')]]));
    } catch (error) {
        ctx.reply("⚠️ Error fetching balance. Please type /start");
    }
});

bot.hears('👤 Profile', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        if (!user) return ctx.reply("❌ Profile not found. Please type /start to register.");

        const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "Verified User";
        const profileMsg = `👤 *USER DASHBOARD*\n━━━━━━━━━━━━━━━━\n\n🆔 *User ID:* \`${user.user_id}\`\n🛡 *Status:* ${user.red_flag ? "🚩 Flagged (Penalty Due)" : "✅ Active / Professional"}\n\n💰 *Current Balance:* \`${user.balance.toFixed(4)}\` USDT\n📈 *Total Earned:* \`${user.total_earned.toFixed(4)}\` USDT\n\n👥 *Referrals:* \`${user.referralCount || 0}\` users\n✅ *Tasks Completed:* \`${user.completed_tasks ? user.completed_tasks.length : 0}\` tasks\n\n📅 *Member Since:* _${joinDate}_`;

        ctx.replyWithMarkdown(profileMsg, Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh Data', 'refresh_profile'), Markup.button.callback('📜 Transaction History', 'view_history')]]));
    } catch (error) {
        ctx.reply("⚠️ Error loading profile.");
    }
});

// --- TELEGRAM INLINE INCOMING BUTTON ACTIONS ---

bot.action('admin_main', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: null } });
    ctx.editMessageText("🛠 *EMBT Admin Control Center*\nSelect a category to manage your bot:", { 
        parse_mode: 'Markdown', 
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')],
            [Markup.button.callback('📋 Task Management', 'admin_tasks'), Markup.button.callback('⚙️ Bot Settings', 'admin_settings')],
            [Markup.button.callback('🚩 Security', 'admin_security'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
        ])
    });
    ctx.answerCbQuery();
});

bot.action('refresh_profile', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "Verified User";
        await ctx.editMessageText(`👤 *USER DASHBOARD (Updated)*\n━━━━━━━━━━━━━━━━\n\n🆔 *User ID:* \`${user.user_id}\`\n🛡 *Status:* ${user.red_flag ? "🚩 Flagged" : "✅ Active"}\n\n💰 *Current Balance:* \`${user.balance.toFixed(4)}\` USDT\n📈 *Total Earned:* \`${user.total_earned.toFixed(4)}\` USDT\n\n👥 *Referrals:* \`${user.referralCount || 0}\` users\n✅ *Tasks Completed:* \`${user.completed_tasks?.length || 0}\` tasks\n\n📅 *Member Since:* _${joinDate}_`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh Data', 'refresh_profile'), Markup.button.callback('📜 Transaction History', 'view_history')]])
        });
        ctx.answerCbQuery("✨ Data Refreshed");
    } catch (e) {
        ctx.answerCbQuery("❌ Update failed.");
    }
});

bot.action(/^verify_tg_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = await Task.findOne({ id: taskId });
    const userId = ctx.from.id;
    if (!task) return ctx.answerCbQuery("❌ Task not found.");

    const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];
    try {
        const member = await ctx.telegram.getChatMember(channelId, userId);
        if (['member', 'administrator', 'creator'].includes(member.status)) {
            await User.updateOne({ user_id: userId }, { 
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: { completed_tasks: taskId }
            });
            ctx.editMessageText(`✅ *Joined!* ${task.reward} USDT added to your balance.`);
        } else {
            ctx.answerCbQuery("⚠️ You haven't joined yet! Please join then click verify.", { show_alert: true });
        }
    } catch (e) {
        ctx.answerCbQuery("❌ Error: Make sure the Bot is an Admin in the channel!", { show_alert: true });
    }
});

bot.action(/^cat_(.+)$/, async (ctx) => {
    try {
        const platform = ctx.match[1];
        const user = await User.findOne({ user_id: ctx.from.id });
        const tasks = await Task.find({ type: platform, id: { $nin: user.completed_tasks }, enabled: true }).limit(10);

        if (tasks.length === 0) return ctx.answerCbQuery(`📌 No new ${platform} tasks available right now.`, { show_alert: true });

        const buttons = tasks.map(t => [Markup.button.callback(`💰 ${t.name} (${t.reward} USDT)`, `view_task_${t.id}`)]);
        buttons.push([Markup.button.callback('⬅️ Back to Categories', 'back_to_earn')]);

        ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (e) {
        ctx.answerCbQuery("⚠️ Error loading tasks.");
    }
});

bot.action('back_to_earn', (ctx) => {
    ctx.editMessageText("📂 *Select a Task Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter'), Markup.button.callback('🌐 Others', 'cat_other')]
    ]));
});

bot.action(/^view_task_(.+)$/, async (ctx) => {
    try {
        const taskId = ctx.match[1];
        const task = await Task.findOne({ id: taskId });
        if (!task) return ctx.answerCbQuery("❌ Task expired or not found.");

        const msg = `📝 *Task:* ${task.name}\n💰 *Reward:* ${task.reward.toFixed(2)} USDT\n\n1️⃣ Click the button below to perform the task.\n2️⃣ Return here and click "Verify" or "Upload proof" to earn your reward.`;
        const buttons = [[Markup.button.url('🔗 Go to Task', task.url)]];
        
        if (task.type === 'telegram') {
            buttons.push([Markup.button.callback('✅ Verify Join', `verify_tg_${taskId}`)]);
        } else {
            buttons.push([Markup.button.callback('📸 Upload Screenshot', `upload_proof_${taskId}`)]);
        }
        buttons.push([Markup.button.callback('⬅️ Back to Tasks', `cat_${task.type}`)]);
        
        ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (error) {
        ctx.answerCbQuery("⚠️ Error loading task details.");
    }
});

bot.action(/^upload_proof_(.+)$/, async (ctx) => {
    try {
        await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: `uploading_${ctx.match[1]}` } });
        ctx.reply("📸 *Screenshot Proof Required*\n\nPlease send the screenshot showing you completed the task. \n\n_Note: Sending fake proofs will result in a 0.10 USDT penalty._", { parse_mode: 'Markdown' });
        ctx.answerCbQuery();
    } catch (e) {
        ctx.answerCbQuery("⚠️ Error starting upload.");
    }
});

bot.action('view_withdraw', async (ctx) => {
    try {
        const s = await getSettings(); 
        const user = await User.findOne({ user_id: ctx.from.id });
        const MIN_WITHDRAW = s?.min_withdraw || 0.2;

        if (!s || !s.withdrawals_enabled) return ctx.answerCbQuery("⚠️ Withdrawals are temporarily paused for maintenance. Check back later!", { show_alert: true });
        if (user.red_flag) {
            return ctx.editMessageText("🚩 *Withdrawal Locked!*\n\nYour account was flagged for leaving a channel. To unlock:\n1. Pay the penalty fee.\n2. Or rejoin all tasks.\n\nUse /fix to see your status.", {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('💳 Pay Penalty', 'pay_penalty')], [Markup.button.callback('⬅️ Back', 'back_to_earn')]])
            });
        }
        if (user.balance < MIN_WITHDRAW) return ctx.answerCbQuery(`⚠️ Minimum withdrawal is ${MIN_WITHDRAW} USDT.`, { show_alert: true });

        await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_wallet' });
        await ctx.editMessageText(`🏦 *Withdrawal Request*\n\nAvailable: \`${user.balance.toFixed(4)}\` USDT\nNetwork: *USDT (BEP20)*\n\n📥 *Send your wallet address now:*`, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel & Return', 'back_to_earn')]])
        });
    } catch (e) {
        ctx.answerCbQuery("❌ Error opening withdrawal menu.");
    }
});

bot.action('pay_penalty', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        const s = await getSettings();
        const FEE = s?.penalty_fee || 0.10;

        if (!user.red_flag) return ctx.answerCbQuery("✅ Your account is already clean!", { show_alert: true });
        if (user.balance < FEE) return ctx.answerCbQuery(`❌ Insufficient Balance. You need at least ${FEE} USDT.`, { show_alert: true });

        await User.updateOne({ user_id: ctx.from.id }, { 
            $inc: { balance: -FEE },
            $set: { red_flag: false },
            $push: { history: { type: '🚩 Penalty Paid', amount: `-${FEE} USDT', status: '✅ Cleared`, date: new Date() } }
        });
        ctx.editMessageText("✅ *Penalty Paid Successfully!*\n\nYour account has been cleared. You can now withdraw your earnings again.", { parse_mode: 'Markdown' });
    } catch (error) {
        ctx.answerCbQuery("⚠️ Error processing payment.");
    }
});

bot.action('view_history', (ctx) => ctx.answerCbQuery("📜 History logs are viewable via the web interface dashboard.", { show_alert: true }));

// --- ADMIN SPECIFIC ACTIONS ---

bot.action('admin_stats', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const totalUsers = await User.countDocuments();
    const flaggedUsers = await User.countDocuments({ red_flag: true });
    const activeTasks = await Task.countDocuments({ enabled: true });
    const totalBalance = await User.aggregate([{ $group: { _id: null, sum: { $sum: "$balance" } } }]);
    
    ctx.editMessageText(`📊 *Live Statistics*\n\n👥 *Total Users:* ${totalUsers}\n🚩 *Flagged:* ${flaggedUsers}\n📝 *Active Tasks:* ${activeTasks}\n💰 *User Liabilities:* ${totalBalance[0]?.sum.toFixed(2) || 0} USDT`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_main')]])
    });
});

bot.action('admin_tasks', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const tasks = await Task.find().limit(10);
    const buttons = tasks.map(t => [Markup.button.callback(`${t.enabled ? '🟢' : '🔴'} ${t.name}`, `toggle_task_${t.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Back', 'admin_main')]);
    ctx.editMessageText("📋 *Task Management*\n🟢 = Visible | 🔴 = Hidden\n\nClick a task to toggle its status:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^toggle_task_(.+)$/, async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const task = await Task.findOne({ id: ctx.match[1] });
    if (!task) return ctx.answerCbQuery("❌ Task not found.");

    await Task.updateOne({ id: task.id }, { $set: { enabled: !task.enabled } });
    ctx.answerCbQuery("Task Toggled successfully!");
    ctx.deleteMessage();
});

bot.action('admin_settings', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const s = await getSettings();
    ctx.editMessageText(`⚙️ *Bot Configuration*\n💰 *Min Withdraw:* \`${s.min_withdraw}\` USDT\n🎁 *Ref Bonus:* \`${s.ref_bonus}\` USDT\n🚫 *Penalty:* \`${s.penalty_fee}\` USDT\n🛠 *Maintenance:* ${s.maintenance_mode ? 'ON 🔴' : 'OFF 🟢'}`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💵 Min Withdraw', 'set_min_wd'), Markup.button.callback('🎁 Ref Bonus', 'set_ref')],
            [Markup.button.callback('🚫 Set Penalty', 'set_penalty')],
            [Markup.button.callback(s.maintenance_mode ? ' Disable Maint' : ' Enable Maint', 'toggle_maint')],
            [Markup.button.callback('⬅️ Back', 'admin_main')]
        ])
    });
});

bot.action(/^set_(min_wd|ref)$/, async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    await User.updateOne({ user_id: ctx.from.id }, { current_state: `awaiting_${ctx.match[1]}` });
    ctx.reply("🔢 Enter the new numeric value configuration standard:");
});

bot.action('set_penalty', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_penalty_val' });
    ctx.reply("🔢 Enter new Penalty Fee absolute standard:");
});

bot.action('toggle_maint', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const s = await getSettings();
    await Settings.updateOne({}, { $set: { maintenance_mode: !s.maintenance_mode } });
    ctx.answerCbQuery("Maintenance configuration updated!");
    ctx.deleteMessage();
});

bot.action('admin_security', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const s = await getSettings();
    ctx.editMessageText(`🚩 *Security Hub*\n🏦 *Withdrawals:* ${s.withdrawals_enabled ? 'ENABLED 🟢' : 'LOCKED 🔴'}`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback(s.withdrawals_enabled ? '🔒 Lock Withdrawals' : '🔓 Unlock Withdrawals', 'toggle_withdrawals')],
            [Markup.button.callback('🧹 Sweep Engine', 'run_sweep')],
            [Markup.button.callback('⬅️ Back', 'admin_main')]
        ])
    });
});

bot.action('toggle_withdrawals', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const s = await getSettings();
    await Settings.updateOne({}, { $set: { withdrawals_enabled: !s.withdrawals_enabled } });
    ctx.answerCbQuery("Payout gateway system status modified!");
    ctx.deleteMessage();
});

bot.action('run_sweep', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    ctx.answerCbQuery("🧹 Executing sweep sequence...");
    return runGhostValidator(ctx);
});

bot.action('admin_broadcast', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_broadcast' });
    ctx.editMessageText("📢 *Broadcast Distribution Engine:*\nType your text body message layout now to target users across the infrastructure system topology.", {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin_main')]])
    });
});

bot.action('admin_pending', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const pending = await Withdraw.find({ status: 'pending' }).limit(10);
    if (pending.length === 0) return ctx.editMessageText("✅ *No system pending payouts remaining.*", Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_main')]]));
    
    let text = "📂 *Pending BOT Payouts*\n\n";
    const buttons = pending.map(w => {
        text += `👤 \`${w.user_id}\` ➝ ${w.amount} USDT\n`;
        return [Markup.button.callback(`✅ Clear ${w.user_id}`, `admin_paid_${w.user_id}_${w._id.toString()}`)];
    });
    buttons.push([Markup.button.callback('⬅️ Back', 'admin_main')]);
    ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^admin_paid_(.+)_(.+)$/, async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const [userId, transId] = [ctx.match[1], ctx.match[2]];
    try {
        await Withdraw.updateOne({ _id: transId }, { $set: { status: 'approved' } });
        await User.updateOne({ user_id: userId, "history.id": transId }, { $set: { "history.$.status": "✅ Completed" } });
        await ctx.telegram.sendMessage(userId, "🎁 *Payout Confirmed!*\nYour funds are processed.", { parse_mode: 'Markdown' });
        ctx.editMessageText("✅ Marked database entity as successfully settled.");
    } catch (e) {
        ctx.answerCbQuery("Execution processing fault.");
    }
});

bot.action(/^admin_app_(.+)_(.+)$/, async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const [taskId, userId] = [ctx.match[1], ctx.match[2]];
    const task = await Task.findOne({ id: taskId });
    if (!task) return ctx.editMessageCaption("❌ Core database task object not found.");

    await User.updateOne({ user_id: userId }, { $inc: { balance: task.reward, total_earned: task.reward }, $push: { completed_tasks: taskId } });
    await ctx.telegram.sendMessage(userId, `🎉 *Proof Approved!*\nYou earned **${task.reward} USDT**.`);
    ctx.editMessageCaption("✅ Target user identity proof approved manually.");
});

bot.action(/^admin_rej_(.+)_(.+)$/, async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const [taskId, userId] = [ctx.match[1], ctx.match[2]];
    await ctx.telegram.sendMessage(userId, "❌ *Proof Rejected*\nYour proof submission layout was determined invalid by admins.");
    ctx.editMessageCaption("❌ Proof file structure rejected.");
});

// --- TEXT FLOW CONTROLLER ---
bot.on('text', async (ctx, next) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user || !user.current_state) return next();

    const state = user.current_state;

    if (state === 'awaiting_broadcast') {
        const allUsers = await User.find({}, 'user_id');
        ctx.reply(`🚀 Initiating transmission broadcast directly targeting ${allUsers.length} endpoints...`);
        let count = 0;
        for (const u of allUsers) {
            try {
                await ctx.telegram.sendMessage(u.user_id, ctx.message.text, { parse_mode: 'Markdown' });
                count++;
                if (count % 25 === 0) await new Promise(res => setTimeout(res, 1000));
            } catch (e) {}
        }
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply(`✅ System broadcast processing completed onto ${count} endpoints.`);
    }

    if (state.startsWith('awaiting_')) {
        const val = parseFloat(ctx.message.text);
        if (isNaN(val)) return ctx.reply("❌ Input processing numerical parse error.");
        if (state === 'awaiting_penalty_val') await Settings.updateOne({}, { penalty_fee: val });
        if (state === 'awaiting_min_wd') await Settings.updateOne({}, { min_withdraw: val });
        if (state === 'awaiting_ref') await Settings.updateOne({}, { ref_bonus: val });
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply(`✅ Parameter matrix updated structurally to: ${val}`);
    }

    if (state === 'awaiting_wallet') {
        const address = ctx.message.text.trim();
        if (!address.startsWith('0x') || address.length < 42) return ctx.reply("❌ Valid network deployment destination address expected.");

        const amount = user.balance;
        if (amount <= 0) return ctx.reply("❌ Balance processing constraints mismatch error.");

        const withdrawDoc = await Withdraw.create({ user_id: ctx.from.id, username: ctx.from.username || `User_${ctx.from.id}`, amount, address, method: "BEP20", status: "pending" });
        await User.updateOne({ user_id: ctx.from.id }, { $set: { balance: 0, current_state: null }, $push: { history: { type: '📤 Withdrawal', amount: `${amount.toFixed(2)} USDT`, status: '⏳ Pending', address, id: withdrawDoc._id.toString() } } });

        for (const adminId of admins) {
            try { await ctx.telegram.sendMessage(adminId, `💸 *NEW BOT WITHDRAWAL REQ*\n👤 User: \`${ctx.from.id}\`\n💰 Amount: \`${amount}\` USDT\n🆔 ID: \`${withdrawDoc._id}\``, { parse_mode: 'Markdown' }); } catch (err) {}
        }
        return ctx.replyWithMarkdown("✅ *Request pipeline transaction written successfully!*", mainMenu);
    }
});

bot.on('photo', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (user && user.current_state && user.current_state.startsWith('uploading_')) {
        const taskId = user.current_state.split('_')[1];
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        ctx.reply("✅ *Identity verification files loaded onto system processing pools.*");
        await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: null } });

        for (const adminId of admins) {
            await ctx.telegram.sendPhoto(adminId, fileId, {
                caption: `📄 *New Task Proof File Structure*\n👤 *User:* \`${ctx.from.id}\`\n🆔 *Task ID:* \`${taskId}\``,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('✅ Approve', `admin_app_${taskId}_${ctx.from.id}`), Markup.button.callback('❌ Reject', `admin_rej_${taskId}_${ctx.from.id}`)]])
            });
        }
    }
});

// --- COMMAND ACTIONS ROUTER ---
bot.command('sweep', async (ctx) => { if (admins.includes(ctx.from.id)) return runGhostValidator(ctx); });
bot.command('admin', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    ctx.reply("🛠 *EMBT Admin Control Center*", { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')], [Markup.button.callback('📋 Tasks', 'admin_tasks'), Markup.button.callback('⚙️ Settings', 'admin_settings')], [Markup.button.callback('🚩 Security', 'admin_security'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')]]) });
});

bot.command('add', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add ')[1]?.split('|').map(i => i.trim());
    if (!parts || parts.length < 5) return ctx.reply("Format: Name|Link|Reward|Type|MaxUsers");
    const taskId = 't' + Math.floor(Math.random() * 10000);
    await new Task({ id: taskId, name: parts[0], url: parts[1], reward: parseFloat(parts[2]), type: parts[3], max_users: parseInt(parts[4]) }).save();
    ctx.reply(`✅ *Task configured:* \`${taskId}\``, { parse_mode: 'Markdown' });
});

bot.command('delete', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const taskId = ctx.message.text.split(' ')[1];
    const result = await Task.deleteOne({ id: taskId });
    ctx.reply(result.deletedCount > 0 ? "✅ Entity purged." : "❌ ID context unresolvable.");
});

// --- EXPRESS APPLICATION WEB ROUTING ROUTE LAYOUT ---

app.get('/api/admin/stats', validateAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const pendingWithdrawals = await Withdraw.countDocuments({ status: 'pending' });
        const totalPaid = await Withdraw.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
        const settings = await getSettings();
        res.json({ users: totalUsers, pending: pendingWithdrawals, paid: totalPaid[0]?.total || 0, maintenance: settings.maintenance_mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/secure/profile', async (req, res) => {
    try {
        // 1. Extract the Telegram validation token string from your secureFetch headers
        const authHeader = req.headers['x-telegram-init-data'];
        if (!authHeader || !authHeader.startsWith('tma ')) {
            return res.status(401).json({ error: "Unauthorized: Missing authentication token context." });
        }

        // Remove the 'tma ' prefix to read the raw query sequence string
        const initDataRaw = authHeader.substring(4);
        
        // 2. Parse the webapp URL query string to isolate the serialized 'user' object data parameters
        const urlParams = new URLSearchParams(initDataRaw);
        const userParamString = urlParams.get('user');

        if (!userParamString) {
            return res.status(400).json({ error: "Bad Request: Malformed structural init data session profile payload." });
        }

        // 3. De-serialize the Telegram identity payload properties securely
        const telegramContextUser = JSON.parse(userParamString);
        const userId = Number(telegramContextUser.id);

        if (!userId) {
            return res.status(400).json({ error: "Invalid identity verification criteria parameter." });
        }

        // 4. Query your database collection directly using the verified Telegram account ID
        const user = await User.findOne({ user_id: userId });

        if (user) {
            // Build a fully mapped data profile configuration matrix block
            const accountMetricsPayload = {
                success: true,
                user_id: user.user_id,
                balance: user.balance || 0, // Yields your true chatbot value (e.g. 0.7805)
                points: user.points || 0.00,
                total_earned: user.total_earned || 0,
                referrals: user.referralCount || 0,
                tasksCompletedCount: user.completed_tasks ? user.completed_tasks.length : 0,
                is_banned: user.is_banned || false,
                red_flag: user.red_flag || false,
                tasks_added: user.tasks_added || 0,
                isAdmin: admins.includes(userId)
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
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🌍 PUBLIC ROUTE: Accessible by all users to load active tasks
app.get('/api/tasks', async (req, res) => {
    try {
        // Fetch all tasks from the database collection
        const tasks = await Task.find({}).lean();

        // Map the database keys securely to guarantee the frontend never reads 'undefined'
        const safeTasksPayload = tasks.map(task => ({
            id: task.id,
            title: task.title || 'Untitled Task',
            url: task.url || '#',
            description: task.description || '',
            // Fix Bug 1: Provide BOTH naming structures so old and new frontends work!
            image: task.image || '', 
            reward: task.reward || 0,
            rewardAmt: task.reward || 0, 
            // Fix Bug 2: Normalize the category names (maps 'Education' or 'Education' smoothly to 'edu')
            category: (task.category && task.category.toLowerCase().startsWith('edu')) ? 'edu' : (task.category || 'main'),
            type: task.type || 'social',
            taskType: task.type || 'social'
        }));

        return res.json({
            success: true,
            tasks: safeTasksPayload
        });

    } catch (err) {
        console.error("Public task catalog stream error:", err);
        return res.status(500).json({ success: false, error: "Task matrix stream offline." });
    }
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
            is_banned: user.is_banned || false
        }));

        return res.status(200).json(structuralPayload);
    } catch (error) {
        console.error("Error executing directory dataset dump query:", error);
        return res.status(500).json({ success: false, error: 'Database service query failure mapping user collections.' });
    }
});

app.get('/api/admin/payouts/pending', validateAdmin, async (req, res) => res.json(await Withdraw.find({ status: 'pending' })));

app.post('/api/admin/payouts/action', validateAdmin, async (req, res) => {
    const { requestId, status } = req.body;
    try {
        const request = await Withdraw.findById(requestId);
        if (!request) return res.status(404).json({ error: "Context entity identity resolution failure" });

        request.status = status;
        await request.save();

        if (status === 'rejected') {
            await User.updateOne({ user_id: request.user_id }, { $inc: { balance: request.amount } });
        }
        bot.telegram.sendMessage(request.user_id, status === 'approved' ? "✅ Your deployment withdrawal transaction cleared mapping successfully!" : "❌ Payout routing request declined.");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = Number(req.params.id); 
        const user = await User.findOne({ user_id: userId });
        
        if (user) {
            // 1. PRESERVED BOT LOGIC: Delete welcome message if marked for cleanup
            if (user.current_state && user.current_state.startsWith('delete_welcome_')) {
                const msgId = parseInt(user.current_state.split('_')[2]);
                bot.telegram.deleteMessage(userId, msgId).catch(() => {});
                await User.updateOne({ user_id: userId }, { $set: { current_state: null } });
            }

            // 2. UPGRADED RESPONSE: Return complete metrics profile matrix
            return res.json({
                success: true,
                user_id: user.user_id,
                balance: user.balance || 0,
                points: user.points || 0.00,
                total_earned: user.total_earned || 0,
                referrals: user.referralCount || 0,
                // Calculate total completed tasks by measuring the array length safely
                tasksCompletedCount: user.completed_tasks ? user.completed_tasks.length : 0,
                // Restriction markers
                is_banned: user.is_banned || false,
                red_flag: user.red_flag || false,
                // Community tasks counter tracking
                tasks_added: user.tasks_added || 0,
                isAdmin: admins.includes(userId)
            });
        } else { 
            // 3. FALLBACK STRUCTURE: Clean return defaults to prevent frontend errors if user isn't found
            return res.json({ 
                success: false,
                balance: 0, 
                points: 0,
                total_earned: 0,
                referrals: 0, 
                tasksCompletedCount: 0,
                tasks_added: 0,
                isAdmin: false,
                is_banned: false,
                red_flag: false
            }); 
        }
    } catch (err) { 
        console.error("Backend profile fetch fault:", err);
        res.status(500).json({ error: "Internal Context Fault" }); 
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
        const { target_user_id, balance, points, is_banned, red_flag, tasks_added } = req.body;

        if (!target_user_id) {
            return res.status(400).json({ error: "Target Identity Specification parameter is missing." });
        }

        // 1. Map incoming payload adjustments cleanly into an update object
        let dynamicUpdates = {};
        if (balance !== undefined) dynamicUpdates.balance = Number(balance);
        if (points !== undefined) dynamicUpdates.points = Number(points);
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

app.post('/api/support/create', async (req, res) => {
    await Ticket.create(req.body);
    res.json({ success: true });
});
app.get('/api/admin/tickets', validateAdmin, async (req, res) => res.json(await Ticket.find({ status: { $ne: 'resolved' } })));
app.post('/api/admin/reply-ticket', validateAdmin, async (req, res) => {
    const ticket = await Ticket.findByIdAndUpdate(req.body.ticketId, { admin_reply: req.body.reply, status: 'replied' });
    bot.telegram.sendMessage(ticket.user_id, `📩 *Support Message Update:*\n\n${req.body.reply}`, { parse_mode: 'Markdown' });
    res.json({ success: true });
});

app.post('/api/tasks/claim', async (req, res) => {
    const { user_id, task_id, reward } = req.body;
    const user = await User.findOne({ user_id: parseInt(user_id) });
    if (!user) return res.status(404).json({ error: "Profile missing" });
    if (user.completed_tasks.includes(task_id)) return res.status(400).json({ error: "Entity duplicate state allocation" });

    await User.updateOne({ user_id: user.user_id }, { $inc: { balance: parseFloat(reward) }, $push: { completed_tasks: task_id } });
    res.json({ success: true });
});

app.post('/api/withdraw/request', async (req, res) => {
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

app.get('/api/user/referrals/:id', async (req, res) => {
    const friends = await User.find({ referred_by: parseInt(req.params.id) }).select('username created_at balance');
    res.json({ count: friends.length, friends: friends.map(f => ({ name: f.username || "Anonymous", date: f.created_at, bonus: 0.1 })) });
});

app.post('/api/admin/notifications/send', validateAdmin, async (req, res) => {
    await new Notification({ ...req.body, targetUserId: req.body.targetUserId ? parseInt(req.body.targetUserId) : null }).save();
    res.json({ success: true });
});

app.get('/api/secure/notifications', validateInitData, async (req, res) => {
    const userId = req.tgUser.id; 
    res.json(await Notification.find({ $or: [{ targetType: 'all' }, { targetType: 'all_members' }, { targetType: 'specific_member', targetUserId: userId }] }).sort({ createdAt: -1 }));
});

app.get('/api/secure/available-tasks', validateInitData, async (req, res) => {
    const user = await User.findOne({ user_id: req.tgUser.id });
    res.json(await Task.find({ id: { $nin: user?.completed_tasks || [] }, enabled: true }));
});

app.post('/api/secure/claim-task', validateInitData, async (req, res) => {
    const { taskId } = req.body;
    const userId = req.tgUser.id;

    const user = await User.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ error: "User identity resolution failure" });
    if (user.completed_tasks.includes(taskId)) return res.status(400).json({ error: "Task already claimed" });

    const task = await Task.findOne({ id: taskId });
    if (!task) return res.status(404).json({ error: "Task entity resolution failure" });

    const settings = await getSettings(); 

    await User.updateOne({ user_id: userId }, { $inc: { balance: task.reward, referral_tasks_done: 1 }, $push: { completed_tasks: taskId } });

    if (user.referred_by) {
        const commission = task.reward * ((settings.ref_commission_percent || 10) / 100);
        await User.updateOne({ user_id: user.referred_by }, { $inc: { balance: commission } });
    }

    if (user.referred_by && !user.referral_paid && (user.referral_tasks_done + 1) >= 3) {
        await User.updateOne({ user_id: user.referred_by }, { $inc: { balance: settings.ref_bonus_amount } });
        await User.updateOne({ user_id: userId }, { $set: { referral_paid: true } });
        bot.telegram.sendMessage(user.referred_by, `🎊 *Milestone Bonus:* Friend finalized 3 operations. Awarded ${settings.ref_bonus_amount} USDT.`);
    }
    res.json({ success: true });
});

app.post('/api/admin/broadcast', validateAdmin, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Blank body payload allocation" });
    const users = await User.find({}, 'user_id');
    res.json({ success: true, total: users.length });

    (async () => {
        for (const user of users) {
            try { await bot.telegram.sendMessage(user.user_id, message, { parse_mode: 'HTML' }); } catch (err) {}
            await new Promise(resolve => setTimeout(resolve, 75));
        }
    })();
});




// Ensure your User model database schema is accessible inside this file execution context
// const User = require('./models/User'); 

app.post('/api/games/spin', async (req, res) => {
    try {
        const { telegramId } = req.body;

        // Validation Gate
        if (!telegramId) {
            return res.status(400).json({ 
                success: false, 
                error: "Authentication tracking failed: Missing user ID reference parameter." 
            });
        }

        // 1. Fetch matching user database tracking profile
        const userRecord = await User.findOne({ user_id: telegramId });

        if (!userRecord) {
            return res.status(404).json({ 
                success: false, 
                error: "Account profile ledger not found in database records." 
            });
        }

        // 2. Compute Probabilities & Adjust State Metrics
        const distributionPick = Math.random() * 100;
        let winningIndex = 3; // Default: "TRY AGAIN"

        if (distributionPick < 40.0) {
            winningIndex = 0; // 40% Odds: 10 Pts
            userRecord.points = (userRecord.points || 0) + 10;
        } else if (distributionPick < 70.0) {
            winningIndex = 1; // 30% Odds: 20 Pts
            userRecord.points = (userRecord.points || 0) + 20;
        } else if (distributionPick < 85.0) {
            winningIndex = 2; // 15% Odds: 50 Pts
            userRecord.points = (userRecord.points || 0) + 50;
        } else if (distributionPick < 95.0) {
            winningIndex = 3; // 10% Odds: "TRY AGAIN" (0 Pts)
        } else if (distributionPick < 99.5) {
            winningIndex = 4; // 4.5% Odds: 100 Pts
            userRecord.points = (userRecord.points || 0) + 100;
        } else {
            winningIndex = 5; // 0.5% Odds: 500 JACKPOT Pts
            userRecord.points = (userRecord.points || 0) + 500;
        }

        // 3. Save modified point document values back to database cluster
        await userRecord.save();

        // 4. Return data synchronization properties back to your front-end fetch
        return res.status(200).json({
            success: true,
            winningIndex: winningIndex,
            newCoinBalance: parseFloat(userRecord.balance || 0),
            newPointBalance: parseFloat(userRecord.points || 0)
        });

    } catch (networkExceptionTrace) {
        console.error("Fatal error inside app.post('/api/games/spin') execution node:", networkExceptionTrace);
        return res.status(500).json({ 
            success: false, 
            error: "Internal server error updating game balance matrices." 
        });
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
