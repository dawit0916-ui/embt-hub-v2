const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ System Live"));

const User = mongoose.model('User', new mongoose.Schema({
    user_id: Number,
    balance: { type: Number, default: 0 },
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    red_flag: { type: Boolean, default: false }
}));

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, name: String, url: String, reward: Number, type: String, completions: { type: Number, default: 0 }, max_users: Number
}));

// --- MAIN MENU ---
const mainMenu = Markup.keyboard([['📱 Open App', '💸 Earn More'], ['💰 Balance', '👤 Profile'], ['👥 Affiliate']]).resize();

// --- 1. VIEW TASK DETAILS ---
bot.action(/^view_task_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = await Task.findOne({ id: taskId });
    if (!task) return ctx.answerCbQuery("❌ Task not found.");

    const msg = `📝 *Task:* ${task.name}\n💰 *Reward:* ${task.reward} USDT\n\n` +
                `1️⃣ Click the button below to perform the task.\n` +
                `2️⃣ Return here and click "Verify".`;

    const buttons = [[Markup.button.url('🔗 Go to Task', task.url)]];
    
    if (task.type === 'telegram') {
        buttons.push([Markup.button.callback('✅ Verify Join', `verify_tg_${taskId}`)]);
    } else {
        buttons.push([Markup.button.callback('📸 Upload Screenshot', `upload_proof_${taskId}`)]);
    }
    
    ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// --- 2. TELEGRAM JOIN VERIFIER ---
bot.action(/^verify_tg_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = await Task.findOne({ id: taskId });
    const userId = ctx.from.id;

    // Extract channel username from URL (e.g., https://t.me/example -> @example)
    const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];

    try {
        const member = await ctx.telegram.getChatMember(channelId, userId);
        if (['member', 'administrator', 'creator'].includes(member.status)) {
            // Success! Credit the user
            await User.updateOne({ user_id: userId }, { 
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: { completed_tasks: taskId }
            });
            await Task.updateOne({ id: taskId }, { $inc: { completions: 1 } });
            
            ctx.editMessageText(`✅ *Success!* ${task.reward} USDT added to balance.`, { parse_mode: 'Markdown' });
        } else {
            ctx.answerCbQuery("❌ You haven't joined the channel yet!", { show_alert: true });
        }
    } catch (e) {
        ctx.answerCbQuery("⚠️ Error: Bot must be Admin in the target channel to verify.", { show_alert: true });
    }
});

// --- 3. SCREENSHOT PROOF HANDLER ---
bot.action(/^upload_proof_(.+)$/, async (ctx) => {
    await User.updateOne({ user_id: ctx.from.id }, { current_state: `upload_${ctx.match[1]}` });
    ctx.reply("📸 Please send the screenshot proof for this task:");
});

bot.on('photo', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (user.current_state && user.current_state.startsWith('upload_')) {
        const taskId = user.current_state.split('_')[1];
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

        for (const adminId of admins) {
            await ctx.telegram.sendPhoto(adminId, fileId, {
                caption: `📄 *New Proof*\nUser: \`${ctx.from.id}\`\nTask ID: ${taskId}`,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Approve', `admin_app_${taskId}_${ctx.from.id}`), 
                     Markup.button.callback('❌ Reject', `admin_rej_${ctx.from.id}`)]
                ])
            });
        }
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        ctx.reply("✅ Proof submitted! Wait for admin review.");
    }
});

// --- 4. ADMIN APPROVAL LOGIC ---
bot.action(/^admin_app_(.+)_(.+)$/, async (ctx) => {
    const [taskId, userId] = [ctx.match[1], ctx.match[2]];
    const task = await Task.findOne({ id: taskId });

    await User.updateOne({ user_id: userId }, { 
        $inc: { balance: task.reward, total_earned: task.reward },
        $push: { completed_tasks: taskId }
    });
    
    ctx.telegram.sendMessage(userId, `🎉 *Proof Approved!* You earned ${task.reward} USDT.`);
    ctx.editMessageCaption(`✅ *Approved*\nUser ${userId} credited.`);
});

app.listen(process.env.PORT || 3000);
bot.launch();
