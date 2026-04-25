const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));
// --- KEEP-ALIVE SYSTEM ---
const https = require('https');

setInterval(() => {
    // Replace 'your-app-name' with your actual Render URL
    https.get('https://embt-gateway.onrender.com', (res) => {
        console.log('🛰 Keep-alive ping sent');
    }).on('error', (err) => {
        console.log('🛰 Keep-alive error: ' + err.message);
    });
}, 10 * 60 * 1000); // Pings every 10 minutes
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
// --- 1. AFFILIATE SYSTEM ---
bot.hears('👥 Affiliate', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        const botUsername = ctx.botInfo.username;
        const refLink = `https://t.me/${botUsername}?start=${ctx.from.id}`;
        
        // Referral Reward Configuration
        const rewardPerRef = 0.20; 
        const totalEarnings = (user.referralCount || 0) * rewardPerRef;

        const msg = 
            "👥 *Affiliate Program*\n\n" +
            "Invite your friends and earn rewards for every new user!\n\n" +
            "📊 *Your Statistics:*\n" +
            `▪️ Total Referrals: \`${user.referralCount || 0}\` users\n` +
            `▪️ Referral Earnings: \`${totalEarnings.toFixed(2)}\` *USDT*\n\n` +
            "🔗 *Your Referral Link:*\n" +
            `\`${refLink}\``;

        // Share button opens the Telegram share interface automatically
        const affiliateButtons = Markup.inlineKeyboard([
            [Markup.button.url('📢 Share Link', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join EMBT and earn USDT by completing simple tasks! 💸')}`)]
        ]);

        ctx.replyWithMarkdown(msg, affiliateButtons);
    } catch (e) {
        console.error("Affiliate Error:", e);
        ctx.reply("⚠️ Error loading affiliate data. Try /start");
    }
});
bot.action(/^verify_tg_(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const task = await Task.findOne({ id: taskId });
    const userId = ctx.from.id;

    // 1. Get the Channel Username from the Link
    // Example: https://t.me/ExampleChannel -> @ExampleChannel
    const channelId = "@" + task.url.split('t.me/')[1].split('/')[0];

    try {
        // 2. Ask Telegram: "Is this user in this channel?"
        const member = await ctx.telegram.getChatMember(channelId, userId);
        
        // 3. Check if they are a member, admin, or creator
        if (['member', 'administrator', 'creator'].includes(member.status)) {
            
            // 💰 CREDIT THE USER
            await User.updateOne({ user_id: userId }, { 
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: { completed_tasks: taskId }
            });

            ctx.editMessageText(`✅ *Joined!* ${task.reward} USDT added to your balance.`);
        } else {
            // ❌ USER HAS NOT JOINED
            ctx.answerCbQuery("⚠️ You haven't joined yet! Please join then click verify.", { show_alert: true });
        }
    } catch (e) {
        // 🛑 BOT PERMISSION ERROR
        ctx.answerCbQuery("❌ Error: Make sure the Bot is an Admin in the channel!", { show_alert: true });
    }
});
// --- 2. EARN MORE (CATEGORY MENU) ---
bot.hears('💸 Earn More', (ctx) => {
    const msg = "📂 *Select a Task Category:*\n\nComplete tasks below to increase your balance.";
    
    const categoryButtons = Markup.inlineKeyboard([
        [
            Markup.button.callback('📺 YouTube', 'cat_youtube'),
            Markup.button.callback('📢 Telegram', 'cat_telegram')
        ],
        [
            Markup.button.callback('🐦 Twitter (X)', 'cat_twitter'),
            Markup.button.callback('🌐 Others', 'cat_other')
        ]
    ]);

    ctx.replyWithMarkdown(msg, categoryButtons);
});

// --- 3. DYNAMIC TASK LOADER ---
bot.action(/^cat_(.+)$/, async (ctx) => {
    try {
        const platform = ctx.match[1];
        const user = await User.findOne({ user_id: ctx.from.id });
        
        // Find tasks for this platform that the user HAS NOT completed yet
        const tasks = await Task.find({ 
            type: platform, 
            id: { $nin: user.completed_tasks } 
        }).limit(10); // Limit to 10 at a time to keep it fast

        if (tasks.length === 0) {
            return ctx.answerCbQuery(`📌 No new ${platform} tasks available right now.`, { show_alert: true });
        }

        const buttons = tasks.map(t => [
            Markup.button.callback(`💰 ${t.name} (${t.reward} USDT)`, `view_task_${t.id}`)
        ]);
        
        buttons.push([Markup.button.callback('⬅️ Back to Categories', 'back_to_earn')]);

        ctx.editMessageText(`📌 *Available ${platform.toUpperCase()} Tasks*`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (e) {
        console.error("Task Loading Error:", e);
        ctx.answerCbQuery("⚠️ Error loading tasks.");
    }
});

// Back to Category Menu Handler
bot.action('back_to_earn', (ctx) => {
    ctx.editMessageText("📂 *Select a Task Category:*", Markup.inlineKeyboard([
        [Markup.button.callback('📺 YouTube', 'cat_youtube'), Markup.button.callback('📢 Telegram', 'cat_telegram')],
        [Markup.button.callback('🐦 Twitter (X)', 'cat_twitter'), Markup.button.callback('🌐 Others', 'cat_other')]
    ]));
});
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
bot.command('delete', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    
    const taskId = ctx.message.text.split(' ')[1];
    if (!taskId) return ctx.reply("❌ Usage: /delete [task_id]");

    const result = await Task.deleteOne({ id: taskId });
    
    if (result.deletedCount > 0) {
        ctx.reply(`✅ Task ${taskId} has been removed from the database.`);
    } else {
        ctx.reply("❌ Task not found. Check the ID.");
    }
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
    try {
        const user = await User.findOne({ user_id: ctx.from.id });

        // If for some reason the user isn't in DB yet, create them
        if (!user) {
            const newUser = new User({ user_id: ctx.from.id });
            await newUser.save();
            return ctx.replyWithMarkdown("💰 *Your Balance*\n\n💲 Current Balance: `0.0000` *USDT*\n💲 Total Earned: `0.0000` *USDT*");
        }

        // Professional Balance Display
        const balanceMessage = 
            "💰 *Your Balance*\n\n" +
            `💲 Current Balance: \`${user.balance.toFixed(4)}\` *USDT*\n` +
            `💲 Total Earned: \`${(user.total_earned || 0).toFixed(4)}\` *USDT*\n\n` +
            "📈 *Completing tasks to increase your Balance .*";

        const balanceButtons = Markup.inlineKeyboard([
            [Markup.button.callback('⚗️ Withdraw', 'view_withdraw')],
            [Markup.button.callback('📜 History', 'view_history')]
        ]);

        ctx.replyWithMarkdown(balanceMessage, balanceButtons);

    } catch (error) {
        console.error("Balance Error:", error);
        ctx.reply("⚠️ Error fetching balance. Please type /fix");
    }
});

bot.action('view_withdraw', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const MIN_WITHDRAW = 1.0; // Set your minimum here

    // 🚩 CHECK FOR RED FLAGS
    if (user.red_flag) {
        return ctx.replyWithMarkdown(
            "🚩 *Withdrawal Locked!*\n\n" +
            "Your account was flagged for leaving a channel. To unlock:\n" +
            "1. Pay the **0.10 USDT** penalty.\n" +
            "2. Or rejoin all tasks.\n\n" +
            "Use /fix to see your status.",
            Markup.inlineKeyboard([[Markup.button.callback('💳 Pay Penalty', 'pay_penalty')]])
        );
    }

    // 💰 CHECK MINIMUM BALANCE
    if (user.balance < MIN_WITHDRAW) {
        return ctx.answerCbQuery(`⚠️ Minimum withdrawal is ${MIN_WITHDRAW} USDT.`, { show_alert: true });
    }

    // SET STATE TO WAIT FOR WALLET
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_wallet' });
    
    ctx.editMessageText(
        `🏦 *Withdrawal Request*\n\n` +
        `Available: \`${user.balance.toFixed(4)}\` USDT\n` +
        `Network: *USDT (BEP20)*\n\n` +
        `📥 *Send your wallet address now:*`,
        { parse_mode: 'Markdown' }
    );
});
bot.command('paid', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    
    const parts = ctx.message.text.split(' ');
    const targetUser = parts[1];
    const amount = parts[2];

    if (!targetUser || !amount) return ctx.reply("Usage: /paid [UserID] [Amount]");

    try {
        ctx.telegram.sendMessage(targetUser, `🎁 *Payout Confirmed!*\n\nYour withdrawal of ${amount} USDT has been sent to your wallet.\n\nThank you for using EMBT!`, { parse_mode: 'Markdown' });
        ctx.reply(`✅ Marked user ${targetUser} as paid.`);
    } catch (e) {
        ctx.reply("❌ Could not send message to user.");
    }
});
bot.on('text', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user) return;

    // Handle Wallet Submission
    if (user.current_state === 'awaiting_wallet') {
        const address = ctx.message.text.trim();
        
        // Basic Validation (BEP20 addresses usually start with 0x)
        if (!address.startsWith('0x') || address.length < 40) {
            return ctx.reply("❌ Invalid Address! Please send a valid USDT (BEP20) wallet.");
        }

        const amount = user.balance;
        const transId = 'W' + Math.floor(Math.random() * 100000);

        // 1. UPDATE USER (Atomic Update)
        await User.updateOne({ user_id: ctx.from.id }, { 
            $set: { balance: 0, current_state: null },
            $push: { 
                history: { 
                    type: '📤 Withdrawal', 
                    amount: `${amount.toFixed(2)} USDT`, 
                    status: '⏳ Pending',
                    address: address,
                    id: transId 
                } 
            }
        });

        // 2. NOTIFY ADMINS
        for (const adminId of admins) {
            ctx.telegram.sendMessage(adminId, 
                `💸 *NEW WITHDRAWAL REQ*\n\n` +
                `👤 User: \`${ctx.from.id}\`\n` +
                `💰 Amount: \`${amount.toFixed(4)}\` USDT\n` +
                `🏦 Addr: \`${address}\`\n` +
                `🆔 ID: \`${transId}\`\n\n` +
                `To mark as paid:\n\`/paid ${ctx.from.id} ${amount}\``, 
                { parse_mode: 'Markdown' }
            );
        }

        ctx.replyWithMarkdown(`✅ *Request Sent!*\n\nAmount: \`${amount.toFixed(2)}\` USDT\nStatus: *⏳ Pending*\n\nYou can track this in 📜 History.`, mainMenu);
    }
});

bot.action('view_history', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user.history || user.history.length === 0) {
        return ctx.answerCbQuery("📜 No transaction history yet.", { show_alert: true });
    }
    // Logic to show history goes here
    ctx.answerCbQuery("Coming soon!"); 
});
// --- PENALTY PAYMENT HANDLER ---
bot.action('pay_penalty', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const user = await User.findOne({ user_id: userId });
        const PENALTY_FEE = 0.10;

        // 1. Check if user is actually flagged
        if (!user.red_flag) {
            return ctx.answerCbQuery("✅ Your account is already clean!", { show_alert: true });
        }

        // 2. Check if they have enough balance
        if (user.balance < PENALTY_FEE) {
            return ctx.answerCbQuery(
                `❌ Insufficient Balance. You need at least ${PENALTY_FEE} USDT to pay the penalty.`, 
                { show_alert: true }
            );
        }

        // 3. Deduct balance and clear flag (Atomic Update)
        await User.updateOne(
            { user_id: userId },
            { 
                $inc: { balance: -PENALTY_FEE },
                $set: { red_flag: false },
                $push: { 
                    history: { 
                        type: '🚩 Penalty Paid', 
                        amount: `-${PENALTY_FEE} USDT`, 
                        status: '✅ Cleared',
                        date: new Date()
                    } 
                }
            }
        );

        // 4. Notify User
        await ctx.editMessageText(
            "✅ *Penalty Paid Successfully!*\n\n" +
            "Your account has been cleared. You can now withdraw your earnings again.",
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error("Penalty Error:", error);
        ctx.answerCbQuery("⚠️ Error processing payment. Try /fix");
    }
});
// --- PREVENT CRASHES UNDER HEAVY LOAD ---
bot.catch((err, ctx) => {
    console.log(`⚠️ Error for ${ctx.updateType}:`, err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

app.get('/', (req, res) => res.send('EMBT Online'));
app.listen(process.env.PORT || 3000);
bot.launch();
