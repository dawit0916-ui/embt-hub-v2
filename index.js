const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

// --- MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Cloud Brain Connected"))
    .catch(err => console.error("❌ DB Error:", err));

const UserSchema = new mongoose.Schema({
    user_id: { type: Number, unique: true, required: true },
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    referredBy: Number,
    referralCount: { type: Number, default: 0 },
    completed_tasks: [String],
    history: [{ type: Object, date: { type: Date, default: Date.now } }],
    red_flag: { type: Boolean, default: false },
    current_state: String
});

const TaskSchema = new mongoose.Schema({
    id: String,
    name: String,
    url: String,
    reward: Number,
    type: String, 
    max_users: Number,
    completions: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true }
});

const User = mongoose.model('User', UserSchema);
const Task = mongoose.model('Task', TaskSchema);

// --- KEYBOARD ---
const mainMenu = Markup.keyboard([
    ['📱 Open App', '💸 Earn More'],
    ['💰 Balance', '👤 Profile'],
    ['👥 Affiliate']
]).resize();

// --- START ---
bot.start(async (ctx) => {
    let user = await User.findOne({ user_id: ctx.from.id });
    if (!user) {
        user = new User({ user_id: ctx.from.id, referredBy: ctx.startPayload || null });
        await user.save();
        if (user.referredBy) {
            await User.updateOne({ user_id: user.referredBy }, { $inc: { balance: 0.20, referralCount: 1 } });
        }
    }
    ctx.replyWithMarkdown("👋 *Welcome back to EMBT Center!*", mainMenu);
});

// --- PROFILE ---
bot.hears('👤 Profile', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const msg = `👤 *Profile Details*\n\n` +
                `🆔 ID: \`${ctx.from.id}\`\n` +
                `🛡 Status: ${user.red_flag ? "🚩 Flagged" : "✅ Verified"}\n` +
                `💰 Balance: \`${user.balance.toFixed(2)}\` USDT`;
    ctx.replyWithMarkdown(msg);
});

// --- AFFILIATE WITH SHARE BUTTON ---
bot.hears('👥 Affiliate', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    
    const msg = "👥 *Affiliate Program*\n\n" +
                "Invite your friends and earn rewards for every active user you bring!\n\n" +
                "📊 *Your Stats:*\n" +
                "▪️ Total Referrals: " + (user.referralCount || 0) + " users\n" +
                "▪️ Referral Earnings: " + ((user.referralCount || 0) * 0.20).toFixed(2) + " *USDT*\n\n" +
                "🔗 *Your Referral Link:*\n`" + refLink + "`";

    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
        [Markup.button.url('📢 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join EMBT and earn USDT!')}`)]
    ]));
});

// --- IMPROVED BALANCE VISUAL ---
bot.hears('💰 Balance', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const balanceMessage =
        "💰 *Your Balance*\n\n" +
        "💲 Current Balance: `" + user.balance.toFixed(4) + "` *$USDT*\n" +
        "💲 Total Earned : `" + (user.total_earned || user.balance).toFixed(4) + "` *$USDT*\n\n" +
        "📈 *Keep completing tasks to increase your earnings.*";

    ctx.replyWithMarkdown(balanceMessage, Markup.inlineKeyboard([
        [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')],
        [Markup.button.callback('📜 History', 'view_history')]
    ]));
});

// --- EARN MORE ---
bot.hears('💸 Earn More', (ctx) => {
    ctx.reply("📂 *Select Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter')]
    ]));
});

// --- TASK LIST HANDLER ---
bot.action(/^cat_(.+)$/, async (ctx) => {
    const platform = ctx.match[1];
    const user = await User.findOne({ user_id: ctx.from.id });
    const tasks = await Task.find({ 
        type: platform, 
        enabled: true, 
        id: { $nin: user.completed_tasks } 
    });
    
    if (tasks.length === 0) return ctx.answerCbQuery("📌 No tasks available in " + platform.toUpperCase(), { show_alert: true });

    const buttons = tasks.map(t => [
        Markup.button.callback(`💰 ${t.name} (${t.reward} USDT)`, `view_task_${t.id}`)
    ]);
    
    buttons.push([Markup.button.callback('⬅️ Back', 'earn_more_menu')]);

    ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, Markup.inlineKeyboard(buttons));
});

app.get('/', (req, res) => res.send('EMBT Online'));
app.listen(process.env.PORT || 3000);
bot.launch();
