const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const admins = process.env.ADMINS.split(',').map(id => parseInt(id));
// --- KEEP-ALIVE SYSTEM ---
const https = require('https');

const cors = require('cors'); // npm install cors

app.use(cors()); // Allows your Vercel site to talk to Render
app.use(express.json());

// API to get User Info for the Mini App
app.get('/api/user/:id', async (req, res) => {
    const userId = req.params.id;
    const user = await User.findOne({ user_id: parseInt(userId) });
    
    if (user) {
        res.json({
            balance: user.balance,
            referrals: user.referrals,
            isAdmin: userId === "7329000880" // Your ID
        });
    } else {
        res.status(404).send("User not found");
    }
});

// Start the server (Render usually gives you a PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
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
    referralCount: { type: Number, default: 0 },
    history: [{ type: Object }], // 👈 Added this
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
    id: String, name: String, url: String, reward: Number, type: String, completions: { type: Number, default: 0 }, max_users: Number
}));

const mainMenu = Markup.keyboard([['📱 Open App', '💸 Earn More'], ['💰 Balance', '👤 Profile'], ['👥 Affiliate']]).resize();
// --- ROBUST SETTINGS FETCHER ---
async function getSettings() {
    try {
        let s = await Settings.findOne();
        if (!s) {
            // Create default settings if the collection is empty
            s = await Settings.create({
                min_withdraw: 0.2,
                ref_bonus: 0.1,
                penalty_fee: 0.1,
                withdrawals_enabled: true,
                maintenance_mode: false
            });
        }
        return s;
    } catch (err) {
        console.error("Database Settings Error:", err);
        return null;
    }
}
bot.use(async (ctx, next) => {
    const s = await getSettings();
    const ADMIN_ID = 7329000880; // 👈 REPLACE with your real Telegram ID

    // If Maintenance is ON and the user is NOT the admin
    if (s.maintenance_mode && ctx.from.id !== ADMIN_ID) {
        // Only respond to messages, ignore button clicks to save server resources
        if (ctx.message) {
            return ctx.reply("🛠 *Bot Under Maintenance*\n\nWe are currently updating our systems to handle the user load. We will be back online shortly!", { parse_mode: 'Markdown' });
        }
        return; // Silently ignore other interactions
    }

    return next(); // If off, or if you are admin, continue as normal
});

// --- UPDATED SETTINGS HANDLER ---

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
            "👥 *Affiliate Program*🎁\n\n" +
            "🎁Invite your friends and earn rewards for every new user!🎁\n\n" +
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
bot.action('admin_main', async (ctx) => {
    try {
        // 1. CLEAR THE STATE (This is the "Cancel" magic)
        await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: null } });

        const adminMenu = Markup.inlineKeyboard([
            [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')],
            [Markup.button.callback('📋 Task Management', 'admin_tasks'), Markup.button.callback('⚙️ Bot Settings', 'admin_settings')],
            [Markup.button.callback('🚩 Security', 'admin_security'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
        ]);

        await ctx.editMessageText("🛠 *EMBT Admin Control Center*\nSelect a category to manage your bot:", { 
            parse_mode: 'Markdown', 
            ...adminMenu 
        });
        
        ctx.answerCbQuery("❌ Action Cancelled");
    } catch (error) {
        console.error("Admin Main Error:", error);
        ctx.answerCbQuery("❌ Error.");
    }
});
// --- THE SPAM SHIELD (RATE LIMITER) ---
const userCooldowns = new Map();
const COOLDOWN_MS = 1500; // 1.5 seconds between clicks

bot.use(async (ctx, next) => {
    // We only care about messages or button clicks (callback_query)
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const lastSeen = userCooldowns.get(userId) || 0;

    if (now - lastSeen < COOLDOWN_MS) {
        // Option 1: Silent Ignore (Best for 10k+ users to save resources)
        return; 
        
        /* Option 2: Send a warning (Use carefully, can increase server load)
        if (now - lastSeen < 500) { // Only warn if they are really spamming
             return ctx.answerCbQuery("⚠️ Slow down! Wait a second.", { show_alert: true });
        }
        */
    }

    // Update the timestamp and let the message through
    userCooldowns.set(userId, now);
    return next();
});

// Clear the Map occasionally to keep RAM low (for 10k users)
setInterval(() => {
    const now = Date.now();
    for (const [userId, lastSeen] of userCooldowns.entries()) {
        if (now - lastSeen > 60000) userCooldowns.delete(userId); // Remove users inactive for 1 minute
    }
}, 60000); // Run cleanup every minute
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
bot.action('toggle_maint', async (ctx) => {
    try {
        const s = await getSettings();
        if (!s) return ctx.answerCbQuery("❌ Settings database not found.");

        const newState = !s.maintenance_mode;
        
        // 1. Update the database
        await Settings.updateOne({}, { $set: { maintenance_mode: newState } });
        
        ctx.answerCbQuery(`🛠 Maintenance Mode: ${newState ? 'ENABLED 🔴' : 'DISABLED 🟢'}`);
        
        // 2. REBUILD THE UI (This makes the change visible immediately)
        const settingsMsg = 
            `⚙️ *Bot Configuration*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💰 *Min Withdraw:* ${s.min_withdraw} USDT\n` +
            `🎁 *Ref Bonus:* ${s.ref_bonus} USDT\n` +
            `🚫 *Penalty Fee:* ${s.penalty_fee} USDT\n\n` +
            `🛠 *Maintenance:* ${newState ? 'ON 🔴' : 'OFF 🟢'}`;

        const buttons = [
            [Markup.button.callback('💵 Min Withdraw', 'set_min_wd'), Markup.button.callback('🎁 Ref Bonus', 'set_ref')],
            [Markup.button.callback('🚫 Set Penalty', 'set_penalty')],
            [Markup.button.callback(newState ? '🟢 Disable Maintenance' : '🔴 Enable Maintenance', 'toggle_maint')],
            [Markup.button.callback('⬅️ Back', 'admin_main')]
        ];

        // 3. Edit the current message with the new status
        await ctx.editMessageText(settingsMsg, { 
            parse_mode: 'Markdown', 
            ...Markup.inlineKeyboard(buttons) 
        });

    } catch (e) {
        console.error("Maintenance Toggle Error:", e);
        ctx.answerCbQuery("❌ Failed to toggle maintenance.");
    }
});

bot.action(/^toggle_task_(.+)$/, async (ctx) => {
    try {
        const taskId = ctx.match[1];
        const task = await Task.findOne({ id: taskId });

        if (!task) return ctx.answerCbQuery("❌ Task not found.");

        const newState = !task.enabled;
        
        // 1. Update the database
        await Task.updateOne({ id: taskId }, { $set: { enabled: newState } });

        // 2. Alert the Admin
        ctx.answerCbQuery(`Task is now ${newState ? 'ENABLED 🟢' : 'DISABLED 🔴'}`);

        // 3. UI REFRESH: Re-fetch tasks and update the buttons
        const tasks = await Task.find().limit(10);
        const buttons = tasks.map(t => [
            Markup.button.callback(`${t.enabled ? '🟢' : '🔴'} ${t.name}`, `toggle_task_${t.id}`)
        ]);
        
        buttons.push([Markup.button.callback('➕ Add New Task', 'admin_add_task')]);
        buttons.push([Markup.button.callback('⬅️ Back', 'admin_main')]);

        await ctx.editMessageText("📋 *Task Management*\n🟢 = Visible to users\n🔴 = Hidden from users\n\nClick a task to toggle its status:", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        });

    } catch (error) {
        console.error("Toggle Task Error:", error);
        ctx.answerCbQuery("❌ Error updating task.");
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
// --- 1. THE GHOST VALIDATOR FUNCTION ---
// --- THE CORRECTED GHOST VALIDATOR ---
async function runGhostValidator(ctx) {
    try {
        await ctx.reply("🕵️ *Ghost Validator:* Starting the Midnight Sweep...");
        
        const users = await User.find({ red_flag: false }); 
        const tgTasks = await Task.find({ type: 'telegram' });
        const settings = await getSettings(); // Get your dynamic penalty fee
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
                                $pull: { completed_tasks: taskId }, // Pull back the task
                                $addToSet: { penalized_tasks: taskId } // Lock it
                            }
                        );
                        
                        await bot.telegram.sendMessage(user.user_id, `🚩 *Account Flagged!* You left a channel. A ${settings.penalty_fee} USDT penalty applied.`);
                        break; 
                    }
                } catch (e) {
                    // This catch handles if the bot is kicked from a channel it's trying to check
                    continue;
                }
                // Anti-spam delay for Telegram API
                await new Promise(res => setTimeout(res, 100));
            }
        }
        
        await ctx.reply(`✨ *Sweep Complete!* Found and penalized ${caughtCount} cheaters.`);

    } catch (globalError) {
        // 🚨 THIS IS THE MISSING CATCH THAT CAUSED YOUR RENDER ERROR 🚨
        console.error("Ghost Validator Global Error:", globalError);
        if (ctx) await ctx.reply("❌ The validator encountered a critical error during the sweep.");
    }
                                                                    }
// --- 2. THE ADMIN TRIGGER ---
bot.command('sweep', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return;
    runGhostValidator(ctx);
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

// Listener for changing values
bot.action(/^set_(min_wd|ref)$/, async (ctx) => {
    const type = ctx.match[1];
    await User.updateOne({ user_id: ctx.from.id }, { current_state: `awaiting_${type}` });
    ctx.reply(`🔢 Enter the new value for ${type === 'ref' ? 'Referral Bonus' : 'Minimum Withdrawal'}:`);
});
bot.action('admin_security', async (ctx) => {
    const s = await getSettings();
    
    const securityMsg = 
        `🚩 *Security & Enforcement*\n\n` +
        `🏦 *Withdrawals:* ${s.withdrawals_enabled ? 'ENABLED 🟢' : 'LOCKED 🔴'}\n` +
        `🕵️ *Validator:* Ready for sweep`;

    const buttons = [
        [Markup.button.callback(s.withdrawals_enabled ? '🔒 Lock Withdrawals' : '🔓 Unlock Withdrawals', 'toggle_withdrawals')],
        [Markup.button.callback('🧹 Run /sweep (Ghost Validator)', 'run_sweep')],
        [Markup.button.callback('⬅️ Back', 'admin_main')]
    ];

    ctx.editMessageText(securityMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});
// --- HELPER: FUNCTION TO SHOW CANCEL BUTTON ---
const showCancelBtn = async (ctx, text) => {
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel & Return', 'admin_main')]
        ])
    });
};


// --- UPDATE BROADCAST ACTION ---
bot.action('admin_broadcast', async (ctx) => {
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_broadcast' });
    await showCancelBtn(ctx, "📢 *Send your broadcast message:*\n\nType your message now. Every user will receive this.\n\n_Click below to cancel._");
});

// Toggle Withdrawal Logic
bot.action('toggle_withdrawals', async (ctx) => {
    try {
        const s = await getSettings();
        if (!s) return ctx.answerCbQuery("❌ Settings not found.");

        const newState = !s.withdrawals_enabled;

        // 1. Update the database
        await Settings.updateOne({}, { $set: { withdrawals_enabled: newState } });

        // 2. Alert the Admin (Using the NEW state)
        ctx.answerCbQuery(`Withdrawals are now ${newState ? 'UNLOCKED 🔓' : 'LOCKED 🔒'}`);

        // 3. REBUILD THE SECURITY UI
        const securityMsg = 
            `🚩 *Security & Enforcement*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🏦 *Withdrawals:* ${newState ? 'ENABLED 🟢' : 'LOCKED 🔴'}\n` +
            `🕵️ *Validator:* System Ready`;

        const buttons = [
            [Markup.button.callback(newState ? '🔒 Lock Withdrawals' : '🔓 Unlock Withdrawals', 'toggle_withdrawals')],
            [Markup.button.callback('🧹 Run /sweep (Ghost)', 'run_sweep')],
            [Markup.button.callback('⬅️ Back', 'admin_main')]
        ];

        // 4. Update the menu message
        await ctx.editMessageText(securityMsg, { 
            parse_mode: 'Markdown', 
            ...Markup.inlineKeyboard(buttons) 
        });

    } catch (e) {
        console.error("Toggle Withdrawals Error:", e);
        ctx.answerCbQuery("❌ Error toggling withdrawals.");
    }
});

bot.on('text', async (ctx, next) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user || !user.current_state) return next();

    const state = user.current_state;

    // 📢 BROADCAST
    if (state === 'awaiting_broadcast') {
        const allUsers = await User.find({}, 'user_id');
        ctx.reply(`🚀 Sending to ${allUsers.length} users...`);
        let success = 0;
        for (const u of allUsers) {
            try {
                await ctx.telegram.sendMessage(u.user_id, ctx.message.text, { parse_mode: 'Markdown' });
                success++;
                if (success % 25 === 0) await new Promise(res => setTimeout(res, 1000));
            } catch (e) {}
        }
        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply(`✅ Broadcast sent to ${success} users.`);
    }

    // 🔢 NUMERIC SETTINGS
    const val = parseFloat(ctx.message.text);
    if (state.startsWith('awaiting_')) {
        if (isNaN(val)) return ctx.reply("❌ Please enter a valid number.");
        
        if (state === 'awaiting_penalty_val') await Settings.updateOne({}, { penalty_fee: val });
        if (state === 'awaiting_min_wd') await Settings.updateOne({}, { min_withdraw: val });
        if (state === 'awaiting_ref') await Settings.updateOne({}, { ref_bonus: val });

        await User.updateOne({ user_id: ctx.from.id }, { current_state: null });
        return ctx.reply(`✅ Updated to ${val}`);
    }

    // 🏦 WALLET
    if (state === 'awaiting_wallet') {
       if (!address.startsWith('0x') || address.length < 40) {
           const address = ctx.message.text.trim();
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
// Trigger the input state
bot.action('set_penalty', async (ctx) => {
    await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_penalty_val' });
    ctx.reply("🔢 *Enter new Penalty Fee:* (e.g., 0.15)");
});

// Process the number entered

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
    try {
        const taskId = ctx.match[1];
        const task = await Task.findOne({ id: taskId });
        
        if (!task) return ctx.answerCbQuery("❌ Task expired or not found.");

        // Clean message layout for the user
        const msg = 
            `📝 *Task:* ${task.name}\n` +
            `💰 *Reward:* ${task.reward.toFixed(2)} USDT\n\n` +
            `1️⃣ Click the button below to perform the task.\n` +
            `2️⃣ Return here and click "Verify"or"Upload proof" to earn your reward.`;

        const buttons = [[Markup.button.url('🔗 Go to Task', task.url)]];
        
        // Logic for verification type
        if (task.type === 'telegram') {
            buttons.push([Markup.button.callback('✅ Verify Join', `verify_tg_${taskId}`)]);
        } else {
            buttons.push([Markup.button.callback('📸 Upload Screenshot', `upload_proof_${taskId}`)]);
        }
        
        // Added a back button so users can return to the list
        buttons.push([Markup.button.callback('⬅️ Back to Tasks', `cat_${task.type}`)]);
        
        ctx.editMessageText(msg, { 
            parse_mode: 'Markdown', 
            ...Markup.inlineKeyboard(buttons) 
        });

    } catch (error) {
        console.error("View Task Error:", error);
        ctx.answerCbQuery("⚠️ Error loading task details.");
    }
});

bot.action('clear_flag_pay', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    const FEE = 0.15; // Cost to remove the red flag

    if (user.balance < FEE) {
        return ctx.answerCbQuery(`❌ You need ${FEE} USDT to clear your flag.`);
    }

    await User.updateOne(
        { user_id: ctx.from.id },
        { 
            $inc: { balance: -FEE },
            $set: { red_flag: false }
        }
    );

    ctx.editMessageText("✅ *Account Restored!*\nYour flag has been removed. Please follow the rules to avoid future penalties.");
});

// Rest of your logic (Profile, Balance, Affiliate) follows...
bot.hears('👤 Profile', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });

        if (!user) {
            return ctx.reply("❌ Profile not found. Please type /start to register.");
        }

        // 📅 DATE LOGIC: Check if createdAt exists, otherwise show "Verified User"
        const joinDate = user.createdAt 
            ? new Date(user.createdAt).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              }) 
            : "Verified User";

        // Determine Account Status
        const status = user.red_flag ? "🚩 Flagged (Penalty Due)" : "✅ Active / Professional";
        
        // Calculate Task Completion count
        const tasksDone = user.completed_tasks ? user.completed_tasks.length : 0;

        const profileMsg = 
            `👤 *USER DASHBOARD*\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `🆔 *User ID:* \`${user.user_id}\`\n` +
            `🛡 *Status:* ${status}\n\n` +
            `💰 *Current Balance:* \`${user.balance.toFixed(4)}\` USDT\n` +
            `📈 *Total Earned:* \`${user.total_earned.toFixed(4)}\` USDT\n\n` +
            `👥 *Referrals:* \`${user.referralCount || 0}\` users\n` +
            `✅ *Tasks Completed:* \`${tasksDone}\` tasks\n\n` +
            `📅 *Member Since:* _${joinDate}_`; // 👈 Dynamic Join Date

        const profileButtons = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh Data', 'refresh_profile')],
            [Markup.button.callback('📜 Transaction History', 'view_history')]
        ]);

        ctx.replyWithMarkdown(profileMsg, profileButtons);

    } catch (error) {
        console.error("Profile Error:", error);
        ctx.reply("⚠️ Error loading profile. Try /fix");
    }
});

// --- REFRESH BUTTON HANDLER ---
bot.action('refresh_profile', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });
        
        const joinDate = user.createdAt 
            ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) 
            : "Verified User";

        const updatedMsg = 
            `👤 *USER DASHBOARD (Updated)*\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `🆔 *User ID:* \`${user.user_id}\`\n` +
            `🛡 *Status:* ${user.red_flag ? "🚩 Flagged" : "✅ Active"}\n\n` +
            `💰 *Current Balance:* \`${user.balance.toFixed(4)}\` USDT\n` +
            `📈 *Total Earned:* \`${user.total_earned.toFixed(4)}\` USDT\n\n` +
            `👥 *Referrals:* \`${user.referralCount || 0}\` users\n` +
            `✅ *Tasks Completed:* \`${user.completed_tasks?.length || 0}\` tasks\n\n` +
            `📅 *Member Since:* _${joinDate}_`;

        await ctx.editMessageText(updatedMsg, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Refresh Data', 'refresh_profile')],
                [Markup.button.callback('📜 Transaction History', 'view_history')]
            ])
        });
        ctx.answerCbQuery("✨ Data Refreshed");
    } catch (e) {
        ctx.answerCbQuery("❌ Update failed.");
    }
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


bot.command('admin', async (ctx) => {
    if (!admins.includes(ctx.from.id)) return; // Hidden from regular users

    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Stats', 'admin_stats'), Markup.button.callback('💸 Payouts', 'admin_pending')],
        [Markup.button.callback('📋 Task Management', 'admin_tasks'), Markup.button.callback('⚙️ Bot Settings', 'admin_settings')],
        [Markup.button.callback('🚩 Security', 'admin_security'), Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
    ]);

    ctx.reply("🛠 *EMBT Admin Control Center*\nSelect a category to manage your bot:", { 
        parse_mode: 'Markdown', 
        ...adminMenu 
    });
});

bot.action('admin_stats', async (ctx) => {
    const totalUsers = await User.countDocuments();
    const flaggedUsers = await User.countDocuments({ red_flag: true });
    const activeTasks = await Task.countDocuments({ enabled: true });
    
    // Calculate total liability (money users have earned but not withdrawn)
    const totalBalance = await User.aggregate([
        { $group: { _id: null, sum: { $sum: "$balance" } } }
    ]);

    const statsMsg = 
        `📊 *Live Statistics*\n\n` +
        `👥 *Total Users:* ${totalUsers}\n` +
        `🚩 *Flagged:* ${flaggedUsers}\n` +
        `📝 *Active Tasks:* ${activeTasks}\n` +
        `💰 *User Liabilities:* ${totalBalance[0]?.sum.toFixed(2) || 0} USDT\n\n` +
        `_Last updated: ${new Date().toLocaleTimeString()}_`;

    ctx.editMessageText(statsMsg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_main')]])
    });
});
bot.action('admin_tasks', async (ctx) => {
    const tasks = await Task.find().limit(10);
    const buttons = tasks.map(t => [
        Markup.button.callback(`${t.enabled ? '🟢' : '🔴'} ${t.name}`, `toggle_task_${t.id}`)
    ]);
    
    buttons.push([Markup.button.callback('➕ Add New Task', 'admin_add_task')]);
    buttons.push([Markup.button.callback('⬅️ Back', 'admin_main')]);

    ctx.editMessageText("📋 *Task Management*\n🟢 = Visible to users\n🔴 = Hidden from users\n\nClick a task to toggle its status:", {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action('run_sweep', async (ctx) => {
    ctx.answerCbQuery("🧹 Starting Ghost Validator...");
    return runGhostValidator(ctx);
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


bot.action('view_history', async (ctx) => {
    const user = await User.findOne({ user_id: ctx.from.id });
    if (!user.history || user.history.length === 0) {
        return ctx.answerCbQuery("📜 No transaction history yet.", { show_alert: true });
    }
    // Logic to show history goes here
    ctx.answerCbQuery("Coming soon!"); 
});
bot.action(/^upload_proof_(.+)$/, async (ctx) => {
    try {
        const taskId = ctx.match[1];
        
        // Update user state to 'uploading_proof' and store the Task ID
        await User.updateOne(
            { user_id: ctx.from.id }, 
            { $set: { current_state: `uploading_${taskId}` } }
        );

        ctx.reply("📸 *Screenshot Proof Required*\n\nPlease send the screenshot showing you completed the task. \n\n_Note: Sending fake proofs will result in a 0.10 USDT penalty._", { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.answerCbQuery("⚠️ Error starting upload.");
    }
});
bot.on('photo', async (ctx) => {
    try {
        const user = await User.findOne({ user_id: ctx.from.id });

        // Check if the user was actually supposed to send a proof
        if (user && user.current_state && user.current_state.startsWith('uploading_')) {
            const taskId = user.current_state.split('_')[1];
            const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

            // 1. Notify the User
            ctx.reply("✅ *Proof Received!*\nYour screenshot has been sent to the admins for review. You will be notified once it is approved.", { parse_mode: 'Markdown' });

            // 2. Clear user state so they don't accidentally send more photos
            await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: null } });

            // 3. Send to ALL Admins
            for (const adminId of admins) {
                await ctx.telegram.sendPhoto(adminId, fileId, {
                    caption: `📄 *New Task Proof*\n\n👤 *User:* \`${ctx.from.id}\`\n🆔 *Task ID:* \`${taskId}\`\n\nReview this screenshot and select an action:`,
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('✅ Approve', `admin_app_${taskId}_${ctx.from.id}`),
                            Markup.button.callback('❌ Reject', `admin_rej_${ctx.from.id}`)
                        ]
                    ])
                });
            }
        }
    } catch (e) {
        console.error("Photo Handling Error:", e);
    }
});

bot.action('admin_settings', async (ctx) => {
    try {
        // 1. IMPORTANT: Clear any pending input states so the menu works fresh
        await User.updateOne({ user_id: ctx.from.id }, { $set: { current_state: null } });

        const s = await getSettings();
        
        // 2. Safety check: If DB fails, try to alert the admin
        if (!s) {
            return ctx.answerCbQuery("❌ Database Error: Could not load settings.");
        }

        const settingsMsg = 
            `⚙️ *Bot Configuration*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💰 *Min Withdraw:* \`${s.min_withdraw}\` USDT\n` +
            `🎁 *Ref Bonus:* \`${s.ref_bonus}\` USDT\n` +
            `🚫 *Penalty Fee:* \`${s.penalty_fee}\` USDT\n\n` +
            `🛠 *Maintenance:* ${s.maintenance_mode ? 'ON 🔴' : 'OFF 🟢'}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `_Click a button below to update values._`;

        const buttons = [
            [
                Markup.button.callback('💵 Min Withdraw', 'set_min_wd'), 
                Markup.button.callback('🎁 Ref Bonus', 'set_ref')
            ],
            [Markup.button.callback('🚫 Set Penalty', 'set_penalty')],
            [Markup.button.callback(s.maintenance_mode ? '🟢 Disable Maintenance' : '🔴 Enable Maintenance', 'toggle_maint')],
            [Markup.button.callback('⬅️ Back to Admin', 'admin_main')]
        ];

        await ctx.editMessageText(settingsMsg, { 
            parse_mode: 'Markdown', 
            ...Markup.inlineKeyboard(buttons) 
        });

    } catch (e) {
        console.error("Settings Menu Error:", e);
        ctx.answerCbQuery("❌ UI Error. Check logs.");
    }
});

bot.action('view_withdraw', async (ctx) => {
    try {
        const s = await getSettings(); // Fetch global settings first
        const user = await User.findOne({ user_id: ctx.from.id });
        const MIN_WITHDRAW = s?.min_withdraw || 1.0;

        // 1️⃣ GLOBAL CHECK: Are withdrawals even on?
        if (!s || !s.withdrawals_enabled) {
            return ctx.answerCbQuery("⚠️ Withdrawals are temporarily paused for maintenance. Check back later!", { show_alert: true });
        }

        // 2️⃣ SECURITY CHECK: Is the user flagged?
        if (user.red_flag) {
            return ctx.editMessageText(
                "🚩 *Withdrawal Locked!*\n\n" +
                "Your account was flagged for leaving a channel. To unlock:\n" +
                "1. Pay the penalty fee.\n" +
                "2. Or rejoin all tasks.\n\n" +
                "Use /fix to see your status.",
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('💳 Pay Penalty', 'pay_penalty')],
                        [Markup.button.callback('⬅️ Back', 'earn_more_menu')] // Using admin_main as a reset
                    ])
                }
            );
        }

        // 3️⃣ BALANCE CHECK: Do they have enough?
        if (user.balance < MIN_WITHDRAW) {
            return ctx.answerCbQuery(`⚠️ Minimum withdrawal is ${MIN_WITHDRAW} USDT.`, { show_alert: true });
        }

        // 4️⃣ STATE UPDATE: Start waiting for wallet
        await User.updateOne({ user_id: ctx.from.id }, { current_state: 'awaiting_wallet' });

        // 5️⃣ UI: Ask for address and provide a CANCEL button
        await ctx.editMessageText(
            `🏦 *Withdrawal Request*\n\n` +
            `Available: \`${user.balance.toFixed(4)}\` USDT\n` +
            `Network: *USDT (BEP20)*\n\n` +
            `📥 *Send your wallet address now:*`,
            { 
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Cancel & Return', 'earn_more_menu')]
                ])
            }
        );

    } catch (e) {
        console.error("Withdraw Menu Error:", e);
        ctx.answerCbQuery("❌ Error: Could not open withdrawal menu.");
    }
});

bot.action('admin_pending', async (ctx) => {
    try {
        // This pulls the same logic we built for the /pending command
        const pendingUsers = await User.find({ "history.status": "⏳ Pending" }).limit(10);

        if (pendingUsers.length === 0) {
            return ctx.editMessageText("✅ *No pending withdrawals!*", {
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'admin_main')]])
            });
        }

        let report = "📂 *Pending Payouts*\n\n";
        const buttons = [];

        pendingUsers.forEach(user => {
            const request = user.history.find(h => h.status === "⏳ Pending");
            if (request) {
                report += `👤 \`${user.user_id}\` ➝ ${request.amount} USDT\n`;
                buttons.push([Markup.button.callback(`✅ Pay ${user.user_id}`, `admin_paid_${user.user_id}_${request.id}`)]);
            }
        });

        buttons.push([Markup.button.callback('⬅️ Back', 'admin_main')]);
        
        await ctx.editMessageText(report, { 
            parse_mode: 'Markdown', 
            ...Markup.inlineKeyboard(buttons) 
        });
    } catch (e) {
        ctx.answerCbQuery("❌ Payout list error");
    }
});
bot.action(/^admin_paid_(.+)_(.+)$/, async (ctx) => {
    const [userId, transId] = [ctx.match[1], ctx.match[2]];

    try {
        // 1. Update the user's history item status to '✅ Completed'
        await User.updateOne(
            { user_id: userId, "history.id": transId },
            { $set: { "history.$.status": "✅ Completed" } }
        );

        // 2. Notify the user
        await ctx.telegram.sendMessage(userId, "🎁 *Payout Confirmed!*\n\nYour withdrawal has been processed. Check your wallet!", { parse_mode: 'Markdown' });

        // 3. Update the admin dashboard message
        ctx.editMessageText(`✅ *Success!*\nUser \`${userId}\` has been marked as paid. Type /pending to see the next one.`);

    } catch (e) {
        ctx.answerCbQuery("❌ Error processing payout.");
    }
});

bot.action(/^admin_app_(.+)_(.+)$/, async (ctx) => {
    const [taskId, userId] = [ctx.match[1], ctx.match[2]];
    
    try {
        const task = await Task.findOne({ id: taskId });
        if (!task) return ctx.editMessageCaption("❌ Error: Task no longer exists.");

        // Update User Balance & Mark Task as Completed
        await User.updateOne(
            { user_id: userId },
            { 
                $inc: { balance: task.reward, total_earned: task.reward },
                $push: { completed_tasks: taskId }
            }
        );

        // Notify the User
        await ctx.telegram.sendMessage(userId, `🎉 *Proof Approved!*\nYou earned **${task.reward.toFixed(2)} USDT** for completing: _${task.name}_`, { parse_mode: 'Markdown' });

        // Update the Admin Message so you don't approve it twice
        ctx.editMessageCaption(`✅ *Approved & Paid*\nUser: \`${userId}\` received ${task.reward} USDT.`);
        
    } catch (e) {
        ctx.reply("❌ Error processing approval.");
    }
});
// --- ADMIN REJECTION LOGIC ---
bot.action(/^admin_rej_(.+)_(.+)$/, async (ctx) => {
    const [taskId, userId] = [ctx.match[1], ctx.match[2]];
    
    try {
        const task = await Task.findOne({ id: taskId });
        const taskName = task ? task.name : "Task";

        // 1. Notify the User
        await ctx.telegram.sendMessage(userId, 
            `❌ *Proof Rejected*\n\n` +
            `Your proof for the task *${taskName}* was rejected by the admin.\n\n` +
            `💡 *Possible reasons:*\n` +
            `• Low quality screenshot\n` +
            `• Proof does not show completion\n` +
            `• Already submitted this proof before\n\n` +
            `Please try again with a valid screenshot!`, 
            { parse_mode: 'Markdown' }
        );

        // 2. Update the Admin Chat Visuals
        ctx.editMessageCaption(`❌ *Rejected*\n\nUser \`${userId}\` has been notified that their proof was invalid.`, { parse_mode: 'Markdown' });

    } catch (e) {
        console.error("Rejection Error:", e);
        ctx.answerCbQuery("⚠️ Error notifying user.");
    }
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
// 🤖 Auto-Sweep Timer (Corrected)
setInterval(async () => {
    try {
        console.log("🤖 Auto-Sweep started");
        // We use 'async' above so 'await' works here
        await runGhostValidator(null); 
    } catch (err) {
        console.error("Timer Error:", err);
    }
}, 24 * 60 * 60 * 1000); // Runs every 24 hours

app.get('/', (req, res) => res.send('EMBT Online'));
app.listen(process.env.PORT || 3000);
bot.launch();
