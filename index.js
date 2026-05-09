const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const https = require('https');
const cors = require('cors');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = 7329000880; 
const admins = [ADMIN_ID]; // Add other IDs if needed from env

app.use(cors());
app.use(express.json());

// --- 📊 DATABASE MODELS (Consolidated & Complete) ---

const UserSchema = new mongoose.Schema({
    user_id: Number,
    username: String,
    first_name: String,
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    penalized_tasks: [String],
    current_state: String,
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 },
    referrer_id: Number,
    history: [{
        type: { type: String },
        amount: String,
        status: String,
        address: String,
        id: String,
        date: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const Settings = mongoose.model('Settings', new mongoose.Schema({
    min_withdraw: { type: Number, default: 0.2 },
    ref_bonus: { type: Number, default: 0.1 },
    penalty_fee: { type: Number, default: 0.1 },
    withdrawals_enabled: { type: Boolean, default: true },
    maintenance_mode: { type: Boolean, default: false }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String,
    name: String,
    url: String,
    reward: Number,
    type: String, // 'telegram', 'youtube', 'twitter', 'other'
    enabled: { type: Boolean, default: true },
    completions: { type: Number, default: 0 },
    max_users: Number
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    user_id: Number,
    username: String,
    amount: Number,
    address: String,
    method: { type: String, default: 'BEP20' },
    status: { type: String, default: 'pending' },
    created_at: { type: Date, default: Date.now }
}));

const Ticket = mongoose.model('Ticket', new mongoose.Schema({
    user_id: Number,
    username: String,
    message: String,
    admin_reply: String,
    status: { type: String, default: 'open' },
    created_at: { type: Date, default: Date.now }
}));

// --- 🛠 MIDDLEWARE & HELPERS ---

const mainMenu = Markup.keyboard([
    ['📱 Open App', '💸 Earn More'],
    ['💰 Balance', '👤 Profile'],
    ['👥 Affiliate']
]).resize();

async function getSettings() {
    let s = await Settings.findOne();
    if (!s) s = await Settings.create({});
    return s;
}

// Rate Limiter & Maintenance Shield
const userCooldowns = new Map();
bot.use(async (ctx, next) => {
    const s = await getSettings();
    const uid = ctx.from?.id;
    if (!uid) return next();

    // Maintenance Guard
    if (s.maintenance_mode && uid !== ADMIN_ID) {
        if (ctx.message) return ctx.reply("🛠 *Bot Under Maintenance*\nUpdating systems. Back shortly!");
        return;
    }

    // Anti-Spam (1.5s Cooldown)
    const now = Date.now();
    if (now - (userCooldowns.get(uid) || 0) < 1500) return; 
    userCooldowns.set(uid, now);
    return next();
});

// --- 👤 USER CORE COMMANDS ---

bot.start(async (ctx) => {
    let user = await User.findOne({ user_id: ctx.from.id });
    if (!user) {
        const referrerId = ctx.startPayload ? parseInt(ctx.startPayload) : null;
        user = await User.create({ 
            user_id: ctx.from.id, 
            username: ctx.from.username,
            first_name: ctx.from.first_name,
            referrer_id: referrerId 
        });

        if (referrerId && referrerId !== ctx.from.id) {
            const s = await getSettings();
            await User.updateOne({ user_id: referrerId }, { $inc: { balance: s.ref_bonus, referralCount: 1 } });
            try {
                bot.telegram.sendMessage(referrerId, `🎁 *Referral Bonus!* You earned ${s.ref_bonus} USDT from a new invite.`);
            } catch (e) {}
        }
    }
    ctx.replyWithMarkdown(`🚀 *Welcome to EMBT, ${ctx.from.first_name}!*\nStart completing tasks and earn USDT.`, mainMenu);
});

bot.hears('👤 Profile', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Verified User";
    
    const profileMsg = `👤 *USER DASHBOARD*\n━━━━━━━━━━━━━━━━\n` +
        `🆔 *ID:* \`${user.user_id}\`\n` +
        `🛡 *Status:* ${user.red_flag ? "🚩 Flagged" : "✅ Active"}\n` +
        `💰 *Balance:* \`${user.balance.toFixed(4)}\` USDT\n` +
        `👥 *Referrals:* \`${user.referralCount}\` users\n` +
        `📅 *Joined:* _${joinDate}_`;

    ctx.replyWithMarkdown(profileMsg, Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'refresh_profile')],
        [Markup.button.callback('📜 History', 'view_history')]
    ]));
});

bot.hears('💰 Balance', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const msg = `💰 *Your Balance*\n\n💲 Current: \`${user.balance.toFixed(4)}\` *USDT*\n💲 Total: \`${user.total_earned.toFixed(4)}\` *USDT*`;
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
        [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')],
        [Markup.button.callback('📜 History', 'view_history')]
    ]));
});

// --- 📋 TASK SYSTEM (Categorized) ---

bot.hears('💸 Earn More', (ctx) => {
    ctx.replyWithMarkdown("📂 *Select a Task Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter'), Markup.button.callback('🌐 Others', 'cat_other')]
    ]));
});

bot.action(/^cat_(.+)$/, async (ctx) => {
    const platform = ctx.match[1];
    const user = await User.findOne({ user_id: ctx.from.id });
    const tasks = await Task.find({ type: platform, enabled: true, id: { $nin: user.completed_tasks } }).limit(10);

    if (tasks.length === 0) return ctx.answerCbQuery("📌 No tasks available.", { show_alert: true });

    const buttons = tasks.map(t => [Markup.button.callback(`💰 ${t.name} (${t.reward} USDT)`, `view_task_${t.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Back', 'back_to_earn')]);
    
    ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^view_task_(.+)$/, async (ctx) => {
    const task = await Task.findOne({ id: ctx.match[1] });
    if (!task) return ctx.answerCbQuery("❌ Task expired.");

    const msg = `📝 *Task:* ${task.name}\n💰 *Reward:* ${task.reward.toFixed(2)} USDT\n\n1️⃣ Click the link below\n2️⃣ Complete the action\n3️⃣ Click Verify/Upload`;
    const buttons = [[Markup.button.url('🔗 Go to Task', task.url)]];
    
    if (task.type === 'telegram') {
        buttons.push([Markup.button.callback('✅ Verify Join', `verify_tg_${task.id}`)]);
    } else {
        buttons.push([Markup.button.callback('📸 Upload Screenshot', `upload_proof_${task.id}`)]);
    }
    buttons.push([Markup.button.callback('⬅️ Back', `cat_${task.type}`)]);
    ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// --- 🤖 GHOST VALIDATOR & SECURITY ---

async function runGhostValidator(ctx) {
    try {
        const users = await User.find({ red_flag: false });
        const tgTasks = await Task.find({ type: 'telegram' });
        const s = await getSettings();
        let count = 0;

        for (const user of users) {
            for (const taskId of user.completed_tasks) {
                const task = tgTasks.find(t => t.id === taskId);
                if (!task) continue;
                
                try {
                    const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];
                    const member = await bot.telegram.getChatMember(channelId, user.user_id);
                    if (['left', 'kicked'].includes(member.status)) {
                        count++;
                        await User.updateOne({ user_id: user.user_id }, { 
                            $set: { red_flag: true },
                            $inc: { balance: -s.penalty_fee },
                            $pull: { completed_tasks: taskId }
                        });
                        bot.telegram.sendMessage(user.user_id, `🚩 *Flagged!* You left a channel. ${s.penalty_fee} USDT penalty applied.`);
                    }
                } catch (e) { continue; }
            }
        }
        if (ctx) ctx.reply(`✨ Sweep Complete! Penalized ${count} users.`);
    } catch (e) { console.error(e); }
}

// --- 🛠 ADMIN PANEL ---

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const menu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')],
        [Markup.button.callback('📋 Tasks', 'admin_tasks'), Markup.button.callback('⚙️ Settings', 'admin_settings')],
        [Markup.button.callback('📢 Broadcast', 'admin_broadcast'), Markup.button.callback('🧹 Sweep', 'run_sweep')]
    ]);
    ctx.reply("🛠 *Admin Control*", { parse_mode: 'Markdown', ...menu });
});

// --- 📥 PROOF & TEXT HANDLER ---

bot.on('photo', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (user?.current_state?.startsWith('uploading_')) {
        const taskId = user.current_state.split('_')[1];
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        ctx.reply("✅ Proof sent to admins!");

        admins.forEach(adminId => {
            bot.telegram.sendPhoto(adminId, fileId, {
                caption: `📄 *Task Proof*\nUser: \`${ctx.from.id}\`\nTask: \`${taskId}\``,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Approve', `admin_app_${taskId}_${ctx.from.id}`), Markup.button.callback('❌ Reject', `admin_rej_${ctx.from.id}`)]
                ])
            });
        });
    }
});

bot.on('text', async (ctx, next) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user || !user.current_state) return next();

    // Withdrawal Logic
    if (user.current_state === 'awaiting_wallet') {
        const address = ctx.message.text.trim();
        if (!address.startsWith('0x') || address.length < 40) return ctx.reply("❌ Invalid BEP20 address.");

        const amount = user.balance;
        const transId = 'W' + Math.floor(Math.random() * 100000);

        await User.updateOne({ user_id: ctx.from.id }, { 
            $set: { balance: 0, current_state: null },
            $push: { history: { type: 'Withdraw', amount: `${amount} USDT`, status: 'Pending', address, id: transId } }
        });

        ctx.reply("✅ Withdrawal Request Sent!", mainMenu);
        bot.telegram.sendMessage(ADMIN_ID, `💸 *Withdrawal Req*\nUser: \`${ctx.from.id}\`\nAmt: ${amount} USDT\nAddr: \`${address}\``);
        return;
    }

    // Broadcast Logic
    if (user.current_state === 'awaiting_broadcast' && ctx.from.id === ADMIN_ID) {
        const users = await User.find({});
        ctx.reply(`🚀 Broadcasting to ${users.length} users...`);
        for (const u of users) {
            try { bot.telegram.sendMessage(u.user_id, ctx.message.text); } catch (e) {}
        }
        await User.updateOne({ user_id: ADMIN_ID }, { current_state: null });
        return ctx.reply("✅ Broadcast done.");
    }
});

// --- 🌐 EXPRESS API (For Vercel Web App) ---

app.get('/api/user/:id', async (req, res) => {
    const user = await User.findOne({ user_id: parseInt(req.params.id) });
    res.json(user || { error: "User not found" });
});

app.post('/api/tasks/claim', async (req, res) => {
    const { user_id, task_id, reward } = req.body;
    const user = await User.findOne({ user_id });
    if (user.completed_tasks.includes(task_id)) return res.json({ error: "Already claimed" });
    
    await User.updateOne({ user_id }, { 
        $inc: { balance: reward, total_earned: reward },
        $push: { completed_tasks: task_id }
    });
    res.json({ success: true });
});

// --- 🚀 LAUNCH & KEEP-ALIVE ---

setInterval(() => {
    https.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}.onrender.com/`, (res) => {
        console.log("🛰 Ping Sent");
    }).on('error', (e) => console.log("Ping Error"));
}, 10 * 60 * 1000);

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("✅ DB Synced");
    app.listen(process.env.PORT || 3000, () => console.log("API Online"));
    bot.launch();
});
