const { Markup } = require('telegraf');
const bot = require('./bot');
const taskState = require('./config');
const { admins, PUBLIC_GROUP_ID, STORAGE_CHANNEL_ID } = require('../config/constants');
const { User, CompletedTask, UserReminder, ShopProduct, CourseLesson } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

// Track admin sessions for multi-step video/APK upload workflow
const adminVideoSessions = new Map();

async function askForCourse(ctx) {
    const courses = await ShopProduct.find({ type: 'course', active: true }).select('_id title').limit(20);
    const session = adminVideoSessions.get(ctx.from.id);

    if (!courses.length) {
        adminVideoSessions.delete(ctx.from.id);
        await ctx.reply('❌ No courses found. Create a course first via the admin panel, then upload the video again.');
        return;
    }

    session.courseOptions = courses.map(c => c._id.toString());

    const list = courses.map((c, i) => `${i + 1}. ${c.title}`).join('\n');

    await ctx.reply(
        `🎬 *VIDEO CAPTURED*\n\n📝 Filename: \`${session.fileName}\`\n⏱️ Duration: ${session.duration}\n\n*Step 1/4 — Which course does this lesson belong to?*\nReply with the number:\n\n${list}\n\nOr /cancel to stop.`,
        { parse_mode: 'Markdown' }
    );
}

// --- TELEGRAM BOT HANDLERS ---
bot.start(async (ctx) => {
    const referrerId = ctx.startPayload;
    const userId = ctx.from.id;
    const currentUsername = ctx.from.username || null;
    const currentFirstName = ctx.from.first_name || null;
    const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app';

    try {
        let user = await User.findOne({ user_id: userId });

        if (!user) {
            user = await User.create({
                user_id: userId,
                username: currentUsername,
                first_name: currentFirstName,
                referred_by: referrerId ? parseInt(referrerId) : null,
            });
            if (referrerId && !isNaN(parseInt(referrerId))) {
                await User.updateOne({ user_id: parseInt(referrerId) }, { $inc: { referralCount: 1 } });
            }
        } else {
            await User.updateOne(
                { user_id: userId },
                { $set: { username: currentUsername, first_name: currentFirstName } }
            );
        }

        const sentMsg = await ctx.reply(
            `👋 Welcome to Dash Earn!\n\nYour profile is fully synced. Tap the button below to open the app and start earning!`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]]) }
        );

        // Track both message IDs for cleanup
        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: { $each: [ctx.message.message_id, sentMsg.message_id] } } }
        );



    } catch (error) {
        console.error("START ERROR:", error);
        return ctx.reply(`⚠️ Error initializing your dashboard.\n\n${error.message}`);
    }
});


bot.on('message', async (ctx, next) => {
  try {
    if (taskState.activeTask.type !== 'comment') return next();
    if (ctx.chat.id !== PUBLIC_GROUP_ID) return next();
    if (!ctx.message.text) return next();

    const text = ctx.message.text.trim().toUpperCase();
    if (text !== taskState.activeTask.word) return next();

    const userId = ctx.from.id;
    const todayKey = new Date().toISOString().slice(0, 10);

    const already = await CompletedTask.findOne({ userId, taskType: 'comment', taskKey: todayKey });
    if (already) return; // duplicate — stop here, no need to pass through

    let user = await User.findOne({ user_id: userId });
    if (!user) {
      user = await User.create({ user_id: userId, username: ctx.from.username || null, balance: 0 });
    }

    const level = user.level || 1;
    const reward = 50 * level;

    await CompletedTask.create({ userId, taskType: 'comment', taskKey: todayKey });

    user.balance += reward;
    user.total_earned = (user.total_earned || 0) + reward;
    await user.save();

    await bot.telegram.sendMessage(
      userId,
      `✅ Task verified!\n🎉 +${reward} DASH\n💰 Balance: ${user.balance} DASH`
    );

  } catch (err) {
    console.error('Error in comment task handler:', err);
    return next();
  }
});


// Inline button handler for reminder start button
bot.action('start_bot_reminder', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app';

        await ctx.answerCbQuery('Opening app... 🚀', { show_alert: false });

        await UserReminder.updateOne(
            { user_id: userId },
            { $set: { welcome_message_deleted: false } }
        );

       const openedMsg = await ctx.reply(
            `👋 Welcome back to Dash Earn!\n\nTap below to continue earning:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Open Mini App', MINI_APP_URL)]])
            }
        );

        // ⚠️ Safer: Only push the reply message ID
        await User.updateOne(
            { user_id: userId },
            { $push: { pending_message_cleanup: openedMsg.message_id } }
        );
    } catch (err) {
        console.error('[Reminder Button Error]:', err.message);
    }
});

// =====================================================
// ENHANCED BOT VIDEO HANDLER - AUTO FILE_ID CAPTURE
// =====================================================

// Step 1: Admin sends video to bot
bot.on('video', async (ctx) => {
    try {
        if (!admins.includes(ctx.from.id)) {
            return ctx.reply('❌ Only admins can upload course videos.');
        }

        const video = ctx.message.video;
        const fileId = video.file_id;
        const fileName = video.file_name || 'video.mp4';
        const duration = video.duration || 0;
        const durationStr = Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0');

        adminVideoSessions.set(ctx.from.id, {
            fileId: fileId,
            fileName: fileName,
            duration: durationStr,
            timestamp: new Date(),
            step: 'awaiting_course',
            data: {}
        });

        console.log(`[Video Upload] Admin ${ctx.from.username || ctx.from.id} uploaded: ${fileName}`);

        if (STORAGE_CHANNEL_ID) {
            try {
                const forwarded = await ctx.forwardMessage(STORAGE_CHANNEL_ID);
                await bot.telegram.sendMessage(
                    STORAGE_CHANNEL_ID,
                    `🎬 *COURSE VIDEO UPLOAD*\n👤 Admin: @${ctx.from.username || ctx.from.first_name}\n📝 File ID: \`${fileId}\`\n⏱️ Duration: ${durationStr}`,
                    { parse_mode: 'Markdown', reply_to_message_id: forwarded.message_id }
                );
            } catch (e) {
                console.log('[Storage channel skip]:', e.message);
            }
        }

        await askForCourse(ctx);

    } catch (err) {
        console.error('[Video handler error]:', err);
        ctx.reply('❌ Error processing video. Check server logs.');
    }
});


// Step 2: Admin sends metadata as JSON
bot.on('text', async (ctx, next) => {
    try {
        if (!adminVideoSessions.has(ctx.from.id)) {
            return next();
        }

        const session = adminVideoSessions.get(ctx.from.id);
        const input = ctx.message.text.trim();

        if (input.toLowerCase() === '/cancel') {
            adminVideoSessions.delete(ctx.from.id);
            await ctx.reply('❌ Upload cancelled.');
            return;
        }

        // ===== APK WIZARD =====
        if (session.type === 'apk') {
            switch (session.step) {
                case 'awaiting_title':
                    session.data.title = input;
                    session.step = 'awaiting_description';
                    await ctx.reply('*Step 2/4 — Description?*\nReply with a short description, or /cancel.', { parse_mode: 'Markdown' });
                    return;

                case 'awaiting_description':
                    session.data.description = input;
                    session.step = 'awaiting_price';
                    await ctx.reply('*Step 3/4 — Price?*\nReply with a number (DASH), or /cancel.', { parse_mode: 'Markdown' });
                    return;

                case 'awaiting_price': {
                    const price = Number(input);
                    if (isNaN(price) || price < 0) {
                        await ctx.reply('❌ Please send a valid positive number for price.');
                        return;
                    }
                    session.data.price = price;
                    session.step = 'awaiting_category';
                    await ctx.reply('*Step 4/4 — Category?*\nReply with a category (e.g. Utility, Game, Tool), or /cancel.', { parse_mode: 'Markdown' });
                    return;
                }

                case 'awaiting_category': {
                    session.data.category = input;

                    const product = await ShopProduct.create({
                        title: session.data.title,
                        description: session.data.description,
                        price: session.data.price,
                        category: session.data.category,
                        type: 'apk',
                        telegram_file_id: session.fileId,
                        fileName: session.fileName,
                        fileSize: session.fileSize
                    });

                    await ctx.reply(
                        `✅ *APK PRODUCT CREATED*\n\n📦 Title: ${session.data.title}\n💰 Price: ${session.data.price}\n🏷 Category: ${session.data.category}\n🔗 Product ID: \`${product._id}\``,
                        { parse_mode: 'Markdown' }
                    );

                    await logAdminAction(ctx.from, 'shop_apk_created', `Created APK product: ${session.data.title}`);
                    adminVideoSessions.delete(ctx.from.id);
                    console.log(`[APK Product Created] ${session.data.title}`);
                    return;
                }

                default:
                    adminVideoSessions.delete(ctx.from.id);
                    return;
            }
        }

        // ===== VIDEO LESSON WIZARD (default) =====
        switch (session.step) {
            case 'awaiting_course': {
                const idx = parseInt(input, 10) - 1;
                if (isNaN(idx) || !session.courseOptions || !session.courseOptions[idx]) {
                    await ctx.reply('❌ Please reply with a valid number from the list above, or /cancel.');
                    return;
                }
                session.data.courseId = session.courseOptions[idx];
                session.step = 'awaiting_module';
                await ctx.reply('*Step 2/4 — Module name?*\nE.g. "Module 1: Getting Started". Or /cancel.', { parse_mode: 'Markdown' });
                return;
            }

            case 'awaiting_module':
                session.data.moduleName = input;
                session.step = 'awaiting_lesson';
                await ctx.reply('*Step 3/4 — Lesson name?*\nE.g. "Chapter 1: Setup". Or /cancel.', { parse_mode: 'Markdown' });
                return;

            case 'awaiting_lesson':
                session.data.lessonName = input;
                session.step = 'awaiting_order';
                await ctx.reply('*Step 4/4 — Sort order?*\nReply with a number, or send "skip" to use default (0). Or /cancel.', { parse_mode: 'Markdown' });
                return;

            case 'awaiting_order': {
                let order = 0;
                if (input.toLowerCase() !== 'skip') {
                    const parsed = Number(input);
                    if (isNaN(parsed)) {
                        await ctx.reply('❌ Please send a valid number, or "skip".');
                        return;
                    }
                    order = parsed;
                }

                const course = await ShopProduct.findById(session.data.courseId).catch(() => null);
                if (!course) {
                    adminVideoSessions.delete(ctx.from.id);
                    await ctx.reply('❌ Course no longer exists. Upload cancelled — please start again.');
                    return;
                }

                const lesson = await CourseLesson.create({
                    courseId: session.data.courseId,
                    moduleName: session.data.moduleName,
                    lessonName: session.data.lessonName,
                    telegram_file_id: session.fileId,
                    duration: session.duration,
                    order: order
                });

                await ctx.reply(
                    `✅ *LESSON CREATED*\n\n📚 Course: ${course.title}\n📖 Module: ${session.data.moduleName}\n📝 Lesson: ${session.data.lessonName}\n⏱️ Duration: ${session.duration}\n🔗 Lesson ID: \`${lesson._id}\`\n\nVideo is now ready to stream!`,
                    { parse_mode: 'Markdown' }
                );

                await logAdminAction(ctx.from, 'lesson_created', `Created lesson: ${session.data.lessonName} in course ${course.title}`);
                adminVideoSessions.delete(ctx.from.id);
                console.log(`[Lesson Created] ${session.data.lessonName} in ${course.title}`);
                return;
            }

            default:
                adminVideoSessions.delete(ctx.from.id);
                return;
        }

    } catch (err) {
        console.error('[Text handler error]:', err);
        ctx.reply('❌ Error: ' + err.message);
        adminVideoSessions.delete(ctx.from.id);
    }
});

bot.on('document', async (ctx) => {
    try {
        if (!admins.includes(ctx.from.id)) {
            return ctx.reply('❌ Only admins can upload files.');
        }

        const doc = ctx.message.document;
        const fileId = doc.file_id;
        const fileName = doc.file_name || 'file';
        const fileSize = doc.file_size ? (doc.file_size / 1024 / 1024).toFixed(2) + ' MB' : 'unknown';
        const lower = fileName.toLowerCase();

        const videoExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm'];
        if (videoExtensions.some(ext => lower.endsWith(ext))) {
            adminVideoSessions.set(ctx.from.id, {
                fileId: fileId,
                fileName: fileName,
                duration: '0:00',
                timestamp: new Date(),
                step: 'awaiting_course',
                data: {}
            });

            console.log(`[Video Upload as Document] Admin ${ctx.from.username || ctx.from.id} uploaded: ${fileName}`);
            await askForCourse(ctx);
            return;
        }

        if (!lower.endsWith('.apk')) {
            await ctx.reply('❌ Only .apk or video files are supported.', {
                reply_to_message_id: ctx.message.message_id
            });
            return;
        }

        adminVideoSessions.set(ctx.from.id, {
            fileId: fileId,
            fileName: fileName,
            fileSize: fileSize,
            type: 'apk',
            step: 'awaiting_title',
            data: {},
            timestamp: new Date()
        });

        await ctx.reply(
            `📱 *APK CAPTURED*\n\n📦 File: \`${fileName}\`\n💾 Size: ${fileSize}\n\n*Step 1/4 — App title?*\nReply with the title, or /cancel.`,
            { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id }
        );

        console.log(`[APK Upload] Admin ${ctx.from.username} uploaded: ${fileName}`);

    } catch (err) {
        console.error('[Document handler error]:', err);
        ctx.reply('❌ Error processing file.');
    }
});

setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 60 * 60 * 1000; // 1 hour

    for (const [userId, session] of adminVideoSessions) {
        if (now - session.timestamp.getTime() > TIMEOUT) {
            adminVideoSessions.delete(userId);
            console.log(`[Session Cleanup] Cleared session for admin ${userId}`);
        }
    }
}, 30 * 60 * 1000); // Run every 30 minutes


bot.catch((err) => console.log(`⚠️ Telegraf Framework Core Event Loop Catch Error:`, err));

module.exports = { askForCourse };
