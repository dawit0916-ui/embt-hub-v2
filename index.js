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
    history: [{ type: {type: String}, amount: String, status: String, date: { type: Date, default: Date.now } }],
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
    ctx.replyWithMarkdown("👋 *Welcome to EMBT Center!*", mainMenu);
});

// --- PROFILE BUTTON FIX ---
bot.hears('👤 Profile', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const msg = `👤 *Your Profile*\n\n` +
                `🆔 ID: \`${ctx.from.id}\`\n` +
                `🛡 Status: ${user.red_flag ? "🚩 Flagged" : "✅ Normal"}\n` +
                `💰 Balance: ${user.balance.toFixed(2)} USDT`;
    ctx.replyWithMarkdown(msg);
});

// --- AFFILIATE BUTTON FIX ---
bot.hears('👥 Affiliate', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    const msg = `👥 *Affiliate Program*\n\n` +
                `Earn 0.20 USDT for every friend invited!\n\n` +
                `📊 *Stats:*\n` +
                `▪️ Total Invites: ${user.referralCount || 0}\n` +
                `🔗 *Your Link:* \`${refLink}\``;
    ctx.replyWithMarkdown(msg);
});

// --- EARN MORE BUTTON FIX ---
bot.hears('💸 Earn More', (ctx) => {
    ctx.reply("📂 *Select Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter')]
    ]));
});

// --- TASK LOADING LOGIC ---
bot.action(/^cat_(.+)$/, async (ctx) => {
    const platform = ctx.match[1];
    const user = await User.findOne({ user_id: ctx.from.id });
    const tasks = await Task.find({ type: platform, enabled: true, id: { $nin: user.completed_tasks } });
    
    if (tasks.length === 0) return ctx.answerCbQuery("📌 No tasks available right now.", { show_alert: true });

    const buttons = tasks.map(t => [Markup.button.callback(`💰 ${t.name} (${t.reward} USDT)`, `view_task_${t.id}`)]);
    ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, Markup.inlineKeyboard(buttons));
});

// --- BALANCE BUTTON (KEEPING IT WORKING) ---
bot.hears('💰 Balance', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    ctx.replyWithMarkdown(`💰 *Balance:* \`${user.balance.toFixed(4)}\` USDT`, Markup.inlineKeyboard([
        [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')]
    ]));
});

// --- ADMIN /add COMMAND ---
bot.command('add', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add ')[1]?.split('|').map(i => i.trim());
    if (!parts || parts.length < 5) return ctx.reply("Format: Name|Link|Reward|Type|MaxUsers");
    
    const newTask = new Task({ id: 't' + Date.now(), name: parts[0], url: parts[1], reward: parseFloat(parts[2]), type: parts[3], max_users: parseInt(parts[4]) });
    await newTask.save();
    ctx.reply("✅ Task Added!");
});

app.get('/', (req, res) => res.send('EMBT Online'));
app.listen(process.env.PORT || 3000);
bot.launch();
