const bot = require('./bot');
const { User } = require('../models');
const UserNotifState = require('../models/userNotifState');

const MINI_APP_URL = 'https://mini-app-ui-embta.vercel.app';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const GLOBAL_GAP = 6 * HOUR;
const BATCH_LIMIT = 500;

const startOfUtcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Each rule returns [{ user_id, text }] for users who qualify right now.
const RULES = [
    {
        type: 'claim_ready',
        cooldown: 20 * HOUR,
        hours: [7, 11], // UTC window
        async candidates(now) {
            const today = startOfUtcDay(now);
            const users = await User.find({
                lastClaimDate: { $gte: new Date(today - DAY), $lt: new Date(today) },
                currentStreak: { $gte: 1 },
                is_banned: false
            }).select('user_id streakDay currentStreak').limit(BATCH_LIMIT).lean();
            return users.map(u => ({
                user_id: u.user_id,
                text: `🎁 <b>Your Day ${u.streakDay} reward is ready!</b>\n\nClaim it now and keep your ${u.currentStreak}-day streak going.`
            }));
        }
    },
    {
        type: 'streak_risk',
        cooldown: 20 * HOUR,
        hours: [15, 21],
        async candidates(now) {
            const today = startOfUtcDay(now);
            const users = await User.find({
                lastClaimDate: { $gte: new Date(today - DAY), $lt: new Date(today) },
                currentStreak: { $gte: 2 },
                is_banned: false
            }).select('user_id currentStreak').limit(BATCH_LIMIT).lean();
            return users.map(u => ({
                user_id: u.user_id,
                text: `🔥 <b>Your ${u.currentStreak}-day streak ends tonight!</b>\n\nClaim today's reward before midnight UTC or it resets to Day 1.`
            }));
        }
    },
    {
        type: 'comeback',
        cooldown: 7 * DAY,
        hours: [12, 16],
        async candidates(now) {
            const states = await UserNotifState.find({
                last_active_at: { $lt: new Date(now - 3 * DAY), $gt: new Date(now - 30 * DAY) }
            }).select('user_id').limit(BATCH_LIMIT).lean();
            if (!states.length) return [];
            const users = await User.find({
                user_id: { $in: states.map(s => s.user_id) },
                is_banned: false
            }).select('user_id balance').lean();
            return users.map(u => ({
                user_id: u.user_id,
                text: `👋 <b>We miss you!</b>\n\nYou have <b>${u.balance || 0} DASH</b> waiting, and new tasks just dropped.`
            }));
        }
    }
];

async function deliver(userId, text) {
    try {
        await bot.telegram.sendMessage(userId, text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🟢 Open Dash Earn', web_app: { url: MINI_APP_URL } }],
                    [{ text: '🔕 Mute notifications', callback_data: 'notif_mute' }]
                ]
            }
        });
        return 'ok';
    } catch (err) {
        const code = err?.response?.error_code;
        if (code === 403) return 'blocked';
        if (code === 429) {
            await sleep(((err.response.parameters?.retry_after) || 5) * 1000);
            return 'retry';
        }
        console.error(`[SmartNotif] send error ${userId}:`, err.message);
        return 'error';
    }
}

let running = false;
async function runSmartNotifications() {
    if (running) return;
    running = true;
    try {
        const now = new Date();
        const hour = now.getUTCHours();

        for (const rule of RULES) {
            if (hour < rule.hours[0] || hour > rule.hours[1]) continue;

            const cands = await rule.candidates(now);
            if (!cands.length) continue;

            const states = await UserNotifState.find({ user_id: { $in: cands.map(c => c.user_id) } }).lean();
            const stateMap = new Map(states.map(s => [s.user_id, s]));
            let sent = 0;

            for (const c of cands) {
                const st = stateMap.get(c.user_id);
                if (st?.muted || st?.blocked) continue;
                if (st?.last_sent_at && now - new Date(st.last_sent_at) < GLOBAL_GAP) continue;
                const lastOfType = st?.last_by_type?.[rule.type];
                if (lastOfType && now - new Date(lastOfType) < rule.cooldown) continue;

                let result = await deliver(c.user_id, c.text);
                if (result === 'retry') result = await deliver(c.user_id, c.text);

                if (result === 'ok') {
                    await UserNotifState.updateOne(
                        { user_id: c.user_id },
                        { $set: { last_sent_at: now, [`last_by_type.${rule.type}`]: now } },
                        { upsert: true }
                    );
                    sent++;
                } else if (result === 'blocked') {
                    await UserNotifState.updateOne(
                        { user_id: c.user_id },
                        { $set: { blocked: true } },
                        { upsert: true }
                    );
                }
                await sleep(60); // stay under Telegram's ~30 msg/s limit
            }
            console.log(`[SmartNotif] ${rule.type}: ${sent}/${cands.length} sent`);
        }
    } catch (err) {
        console.error('[SmartNotif] run error:', err.message);
    } finally {
        running = false;
    }
}

setInterval(runSmartNotifications, 30 * 60 * 1000);

module.exports = { runSmartNotifications };
