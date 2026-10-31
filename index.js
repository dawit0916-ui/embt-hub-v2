require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const https = require('https');
const cors = require('cors');

const { PORT } = require('./config/constants');
const { startWeeklyPayoutWorker } = require('./utils/weeklyPayout');
const { expireStalePending } = require('./utils/marketplaceApproval');

const app = express();

app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 2);

app.use(cors());
app.use(express.json({ limit: '5mb' }));


app.use('/', require('./routes/adsgram'));
app.use('/', require('./routes/verification'));
app.use('/', require('./routes/adminStats'));
app.use('/', require('./routes/reminders'));
app.use('/', require('./routes/banners'));
app.use('/', require('./routes/console'));
app.use('/', require('./routes/profile'));
app.use('/', require('./routes/settings'));
app.use('/', require('./routes/tasks'));
app.use('/', require('./routes/adminUsers'));
app.use('/', require('./routes/proofs'));
app.use('/api/marketplace', require('./routes/marketplace')); 
app.use('/api/admin/marketplace', require('./routes/adminMarketplace'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/admin/feedback', require('./routes/adminFeedback'));
app.use('/', require('./routes/ads'));
app.use('/', require('./routes/streak'));
app.use('/', require('./routes/support'));
app.use('/', require('./routes/referrals'));
app.use('/', require('./routes/broadcast'));
app.use('/', require('./routes/leaderboard'));
app.use('/', require('./routes/youtubeTasks'));
app.use('/', require('./routes/history'));
app.use('/', require('./routes/video'));
app.use('/', require('./routes/shop'));

// ==========================================================================
// BOT — requiring these registers all Telegraf handlers and starts the
// background workers (daily config poll, ghost validator sweep, reminder
// checks) as a side effect, exactly as the original monolith did by having
// them all in one top-to-bottom executed file.
// ==========================================================================
const bot = require('./bot/bot');
require('./bot/handlers');
require('./bot/ghostValidator');
require('./bot/reminders');
require('./bot/smartNotifications');
require('./bot/adWatchCleanup');

process.on('unhandledRejection', (reason) => console.log('❌ Host Process Unhandled Rejection Fault:', reason));

app.listen(PORT, () => console.log(`Backend gateway infrastructure running on channel interface port ${PORT}`));


setInterval(() => { https.get('https://embt-gateway.onrender.com', () => console.log('🛰 Core link self-ping complete')); }, 10 * 60 * 1000);


mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("✅ Main Database Node Connected & Synced");
    startWeeklyPayoutWorker();
        setInterval(() => {
        expireStalePending().catch(e => console.error('expireStalePending failed:', e.message));
    }, 60 * 60 * 1000);
});

app.get('/', (req, res) => res.send('Gateway Active'));

let botConnected = false;

async function launchBot(attempt = 1) {
  try {
    await bot.launch(
      {
        dropPendingUpdates: true,
        allowedUpdates: ['message', 'callback_query', 'chat_member']
      },
      () => { botConnected = true; } // runs once Telegram answered getMe
    );
  } catch (err) {
    // Telegram unreachable while starting: retry instead of killing the deploy
    if (!botConnected) {
      const delay = Math.min(60000, attempt * 5000);
      console.error(`⚠️ Telegram not reachable (attempt ${attempt}): ${err.message || 'no reason'} — retrying in ${delay / 1000}s`);
      return setTimeout(() => launchBot(attempt + 1), delay);
    }
        // polling died after a good start (e.g. 409 conflict)
    if (/409/.test(err.message || '')) {
      // another instance took over polling (normal during a deploy):
      // stop quietly, do NOT exit, or Render restarts us and we steal updates back
      console.warn('⚠️ Another instance took over polling, stopping this one');
      try { bot.stop('409'); } catch (_) {}
      return;
    }
    console.error('❌ Bot polling died, forcing restart:', err.message);
    process.exit(1);
  }
}

launchBot();
function shutdown(signal) {
  console.log(`${signal} received, stopping bot`);
  try { bot.stop(signal); } catch (_) {} // throws if the bot never started
  setTimeout(() => process.exit(0), 1500);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
