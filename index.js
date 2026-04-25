const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

// --- 1. CLOUD CONNECTION ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ Database Synced"));

const User = mongoose.model('User', new mongoose.Schema({
    user_id: Number,
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, name: String, url: String, reward: Number, type: String, completions: { type: Number, default: 0 }, max_users: Number
}));

const mainMenu = Markup.keyboard([['📱 Open App', '💸 Earn More'], ['💰 Balance', '👤 Profile'], ['👥 Affiliate']]).resize();

// --- 2. START & RECOVERY ---
bot.start(async (ctx) => {
    let user = await User.findOne({ user_id: ctx.from.id });
    if (!user) {
        user = new User({ user_id: ctx.from.id });
        await user.save();
    }
    ctx.replyWithMarkdown("🚀 *EMBT Center Launched!* \nReady to earn USDT?", mainMenu);
});

// --- 3. TASK LISTING WITH IDs ---
bot.action(/^cat_(.+)$/, async (ctx) => {
    const platform = ctx.match[1];
    const user = await User.findOne({ user_id: ctx.from.id });
    const tasks = await Task.find({ type: platform, id: { $nin: user.completed_tasks } });
    
    if (tasks.length === 0) return ctx.answerCbQuery("📌 No tasks available.", { show_alert: true });

    const buttons = tasks.map(t => [
        Markup.button.callback(`💰 ${t.name} | ID: ${t.id}`, `view_task_${t.id}`)
    ]);
    buttons.push([Markup.button.callback('⬅️ Back', 'earn_more_menu')]);
    
    ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, Markup.inlineKeyboard(buttons));
});

// --- 4. ADMIN: DELETE TASK ---
bot.command('del', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const taskId = ctx.message.text.split(' ')[1];
    if (!taskId) return ctx.reply("❌ Use: /del task_12345");

    const deleted = await Task.findOneAndDelete({ id: taskId });
    if (deleted) ctx.reply(`✅ Task ${taskId} has been deleted.`);
    else ctx.reply("❌ Task ID not found.");
});

// --- 5. ADMIN: ADD TASK ---
bot.command('add', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    const parts = ctx.message.text.split('/add ')[1]?.split('|').map(i => i.trim());
    if (!parts || parts.length < 5) return ctx.reply("Format: Name|Link|Reward|Type|MaxUsers");
    
    const taskId = 't' + Math.floor(Math.random() * 10000); // Shorter ID for easier deletion
    const newTask = new Task({ 
        id: taskId, 
        name: parts[0], 
        url: parts[1], 
        reward: parseFloat(parts[2]), 
        type: parts[3], 
        max_users: parseInt(parts[4]) 
    });
    await newTask.save();
    ctx.reply(`✅ *Task Added!*\nID: \`${taskId}\``, { parse_mode: 'Markdown' });
});

// --- 6. VIEW TASK DETAILS (REFIXED) ---
bot.action(/^view_task_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = await Task.findOne({ id: taskId });
    if (!task) return ctx.answerCbQuery("❌ Task expired.");

    const msg = `📝 *Task:* ${task.name}\n💰 *Reward:* ${task.reward} USDT\n🆔 *ID:* \`${task.id}\``;
    const buttons = [[Markup.button.url('🔗 Go to Task', task.url)]];
    
    if (task.type === 'telegram') buttons.push([Markup.button.callback('✅ Verify Join', `verify_tg_${taskId}`)]);
    else buttons.push([Markup.button.callback('📸 Upload Screenshot', `upload_proof_${taskId}`)]);
    
    ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Rest of your logic (Profile, Balance, Affiliate) follows...
bot.hears('👤 Profile', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    ctx.replyWithMarkdown(`👤 *Profile*\nID: \`${ctx.from.id}\`\nBalance: ${user.balance.toFixed(2)} USDT`);
});

bot.hears('💰 Balance', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    ctx.replyWithMarkdown(`💰 *Balance:* \`${user.balance.toFixed(4)}\` USDT`, Markup.inlineKeyboard([
        [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')]
    ]));
});

bot.hears('💸 Earn More', (ctx) => {
    ctx.reply("📂 *Select Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter')]
    ]));
});

app.get('/', (req, res) => res.send('EMBT Online'));
app.listen(process.env.PORT || 3000);
bot.launch();
