const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

// --- 1. INITIALIZE EXPRESS & BOT ---
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

// --- 2. MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Cloud Brain Connected (MongoDB)"))
    .catch(err => console.error("❌ DB Connection Error:", err));

// --- 3. DATABASE SCHEMAS ---
const UserSchema = new mongoose.Schema({
    user_id: { type: Number, unique: true, required: true },
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    referredBy: Number,
    referralCount: { type: Number, default: 0 },
    completed_tasks: [String],
    history: [{
        type: String,
        amount: String,
        status: String,
        date: { type: Date, default: Date.now }
    }],
    red_flag: { type: Boolean, default: false },
    penalty_due: { type: Number, default: 0 },
    current_state: String
});

const TaskSchema = new mongoose.Schema({
    id: String,
    name: String,
    url: String,
    reward: Number,
    type: String, // 'telegram', 'youtube', 'twitter'
    max_users: Number,
    completions: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true }
});

const User = mongoose.model('User', UserSchema);
const Task = mongoose.model('Task', TaskSchema);

// --- 4. KEYBOARDS ---
const mainMenu = Markup.keyboard([
    ['📱 Open App', '💸 Earn More'],
    ['💰 Balance', '👤 Profile'],
    ['👥 Affiliate']
]).resize();

// --- 5. BOT LOGIC (START & REFERRAL) ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const referrerId = ctx.startPayload ? parseInt(ctx.startPayload) : null;
    const refBonus = 0.20;

    let user = await User.findOne({ user_id: userId });

    if (!user) {
        user = new User({ user_id: userId });
        await user.save();

        if (referrerId && referrerId !== userId) {
            await User.updateOne(
                { user_id: referrerId },
                { 
                    $inc: { balance: refBonus, referralCount: 1 },
                    $push: { history: { type: '👥 Referral', amount: `+${refBonus} USDT`, status: '✅ Completed' } }
                }
            );
            ctx.telegram.sendMessage(referrerId, `🎊 *New Referral!* You earned ${refBonus} USDT.`, { parse_mode: 'Markdown' });
        }
    }
    ctx.replyWithMarkdown("👋 *Welcome back to EMBT Center!*", mainMenu);
});

// --- 6. PENALTY SYSTEM ---
bot.action('pay_penalty', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const penaltyAmount = 0.10;

    if (user.balance < penaltyAmount) {
        return ctx.answerCbQuery("❌ Insufficient balance to pay 0.10 USDT penalty.", { show_alert: true });
    }

    await User.updateOne(
        { user_id: ctx.from.id },
        { 
            $inc: { balance: -penaltyAmount },
            $set: { red_flag: false },
            $push: { history: { type: '🚩 Penalty Paid', amount: `-${penaltyAmount} USDT`, status: '✅ Cleared' } }
        }
    );

    ctx.editMessageText("✅ *Penalty Paid!* Your account is now clear and withdrawals are unlocked.", { parse_mode: 'Markdown' });
});

// --- 7. WITHDRAWAL LOGIC ---
bot.hears('💰 Balance', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const msg = `💰 *Your Balance*\n\n` +
                `💲 Current Balance: \`${user.balance.toFixed(4)}\` *USDT*\n` +
                `💲 Total Earned: \`${user.total_earned.toFixed(4)}\` *USDT*\n\n` +
                `📈 Keep completing tasks to increase your earnings.`;

    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
        [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')],
        [Markup.button.callback('📜 History', 'view_history')]
    ]));
});

bot.action('view_withdraw', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });

    if (user.red_flag) {
        return ctx.replyWithMarkdown("🚩 *Withdrawal Locked!*\nYou left a channel. Pay 0.10 USDT penalty or rejoin to unlock.", 
            Markup.inlineKeyboard([[Markup.button.callback('💳 Pay Penalty (0.10 USDT)', 'pay_penalty')]]));
    }

    if (user.balance < 1.0) {
        return ctx.answerCbQuery("⚠️ Min withdrawal is 1.0 USDT.", { show_alert: true });
    }

    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_addr' });
    ctx.reply("🏦 *Withdrawal Request*\nSend your USDT (BEP20) address:");
});

// --- 8. ADMIN /add COMMAND ---
bot.command('add', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const input = ctx.message.text.split('/add ')[1];
    if (!input || input.split('|').length < 5) return ctx.reply("Format: Name | Link | Reward | Type | MaxUsers");

    const [name, url, reward, type, maxUsers] = input.split('|').map(i => i.trim());
    const newTask = new Task({ id: 'task_' + Date.now(), name, url, reward, type, max_users: maxUsers });
    await newTask.save();
    ctx.reply("✅ Task Added Successfully!");
});

// --- 9. RENDER ENGINE ---
app.get('/', (req, res) => res.send('EMBT Online'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

bot.launch();
