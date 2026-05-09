const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const https = require('https');
const cors = require('cors');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = 7329000880; 
const admins = [ADMIN_ID]; // Add other IDs if needed

app.use(cors());
app.use(express.json());

// --- 📊 DATABASE MODELS ---

const User = mongoose.model('User', new mongoose.Schema({
    user_id: Number,
    username: String,
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 },
    referrer_id: Number,
    history: [{ type: Object }],
    createdAt: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    min_withdraw: { type: Number, default: 0.2 },
    ref_bonus: { type: Number, default: 0.1 },
    penalty_fee: { type: Number, default: 0.1 },
    withdrawals_enabled: { type: Boolean, default: true },
    maintenance_mode: { type: Boolean, default: false }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, name: String, url: String, reward: Number, 
    type: String, enabled: { type: Boolean, default: true },
    completions: { type: Number, default: 0 }, max_users: Number
}));

const Withdraw = mongoose.model('Withdraw', new mongoose.Schema({
    user_id: Number, username: String, amount: Number,
    address: String, method: String, status: { type: String, default: 'pending' },
    created_at: { type: Date, default: Date.now }
}));

const Ticket = mongoose.model('Ticket', new mongoose.Schema({
    user_id: Number, username: String, message: String,
    admin_reply: String, status: { type: String, default: 'open' },
    created_at: { type: Date, default: Date.now }
}));

// --- 🛠 MIDDLEWARE & HELPERS ---

const mainMenu = Markup.keyboard([
    [Markup.button.webApp('📱 Open EMBT App', 'https://embt-gateway.vercel.app')], 
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

    if (s.maintenance_mode && uid !== ADMIN_ID) {
        if (ctx.message) return ctx.reply("🛠 *Maintenance Mode Active*");
        return;
    }

    const now = Date.now();
    if (now - (userCooldowns.get(uid) || 0) < 1500) return; 
    userCooldowns.set(uid, now);
    return next();
});

// --- 👤 USER COMMANDS ---

bot.start(async (ctx) => {
    let user = await User.findOne({ user_id: ctx.from.id });
    if (!user) {
        const referrerId = ctx.startPayload ? parseInt(ctx.startPayload) : null;
        user = await User.create({ 
            user_id: ctx.from.id, 
            username: ctx.from.username,
            referrer_id: referrerId 
        });

        if (referrerId && referrerId !== ctx.from.id) {
            const s = await getSettings();
            await User.updateOne({ user_id: referrerId }, { $inc: { balance: s.ref_bonus, referralCount: 1 } });
            bot.telegram.sendMessage(referrerId, `🎁 *Referral Bonus!* You earned ${s.ref_bonus} USDT.`);
        }
    }
    ctx.replyWithMarkdown(`🚀 *Welcome to EMBT, ${ctx.from.first_name}!*\nUse the App to start earning.`, mainMenu);
});

bot.hears('👥 Affiliate', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const s = await getSettings();
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    
    const msg = `👥 *Affiliate Program*\n\n📊 *Stats:*\n▪️ Total Referrals: \`${user.referralCount || 0}\`\n▪️ Earnings: \`${(user.referralCount * s.ref_bonus).toFixed(2)}\` USDT\n\n🔗 *Link:*\n\`${refLink}\``;
    
    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([[Markup.button.url('📢 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}`)]]));
});

// --- 🛠 ADMIN PANEL & BROADCAST ---

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const menu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')],
        [Markup.button.callback('⚙️ Settings', 'admin_settings'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')],
        [Markup.button.callback('🧹 Run Sweep', 'run_sweep')]
    ]);
    ctx.reply("🛠 *Admin Control Center*", { parse_mode: 'Markdown', ...menu });
});

bot.action('admin_broadcast', async (ctx) => {
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_broadcast' });
    ctx.reply("📢 *Send the message you want to broadcast:*");
});

bot.on('text', async (ctx, next) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user || !user.current_state) return next();

    if (user.current_state === 'awaiting_broadcast' && ctx.from.id === ADMIN_ID) {
        const users = await User.find({}, 'user_id');
        ctx.reply(`🚀 Broadcasting to ${users.length} users...`);
        for (const u of users) {
            try { await bot.telegram.sendMessage(u.user_id, ctx.message.text); } catch (e) {}
        }
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply("✅ Broadcast Complete.");
    }
    
    // Numeric Settings Handler
    if (user.current_state.startsWith('awaiting_')) {
        const val = parseFloat(ctx.message.text);
        if (isNaN(val)) return ctx.reply("❌ Send a number.");
        const field = user.current_state.replace('awaiting_', '');
        const update = {}; update[field] = val;
        await Settings.updateOne({}, update);
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply(`✅ Updated ${field} to ${val}`);
    }
});

// --- 🌐 API FOR WEB APP ---

app.get('/api/user/:id', async (req, res) => {
    const user = await User.findOne({ user_id: parseInt(req.params.id) });
    res.json(user || { error: "Not found" });
});

app.post('/api/withdraw/request', async (req, res) => {
    const { user_id, amount, address } = req.body;
    const user = await User.findOne({ user_id });
    const s = await getSettings();

    if (user.balance < amount || amount < s.min_withdraw) return res.json({ success: false });

    await User.updateOne({ user_id }, { $inc: { balance: -amount } });
    await Withdraw.create({ user_id, amount, address, status: 'pending' });
    bot.telegram.sendMessage(ADMIN_ID, `⚠️ *Withdrawal Request*\nUser: ${user_id}\nAmount: ${amount} USDT`);
    res.json({ success: true });
});

// --- 🚀 LAUNCH ---
const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("✅ DB Connected");
    app.listen(PORT, () => console.log(`Server on ${PORT}`));
    bot.launch();
});
