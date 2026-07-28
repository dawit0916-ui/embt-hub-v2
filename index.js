require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const https = require('https');
const cors = require('cors');

const { PORT } = require('./config/constants');
const enforceGlobalMaintenanceGate = require('./middleware/maintenanceGate');

const app = express();

app.use(cors());
app.use(express.json());

// ==========================================================================
// NOTE ON ORDERING: in the original monolithic file, the AdsGram/Monetag
// reward-callback routes were registered BEFORE the maintenance-gate
// middleware was mounted. In Express, middleware only applies to routes
// registered after it in the stack — so those two S2S callback endpoints
// have always bypassed maintenance mode. Preserving that exact ordering
// here rather than "fixing" it, since it may be relied upon (ad network
// callbacks needing to keep working even during maintenance).
// ==========================================================================
app.use('/', require('./routes/adsgram'));

app.use('/api', enforceGlobalMaintenanceGate);

app.use('/', require('./routes/verification'));
app.use('/', require('./routes/adminStats'));
app.use('/', require('./routes/reminders'));
app.use('/', require('./routes/console'));
app.use('/', require('./routes/profile'));
app.use('/', require('./routes/settings'));
app.use('/', require('./routes/tasks'));
app.use('/', require('./routes/adminUsers'));
app.use('/', require('./routes/proofs'));
app.use('/', require('./routes/ads'));
app.use('/', require('./routes/levels'));
app.use('/', require('./routes/dailyTasks'));
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
require('./bot/config');
require('./bot/handlers');
require('./bot/dailyConfig');
require('./bot/ghostValidator');
require('./bot/reminders');

process.on('unhandledRejection', (reason) => console.log('❌ Host Process Unhandled Rejection Fault:', reason));

app.listen(PORT, () => console.log(`Backend gateway infrastructure running on channel interface port ${PORT}`));


setInterval(() => { https.get('https://embt-gateway.onrender.com', () => console.log('🛰 Core link self-ping complete')); }, 10 * 60 * 1000);


mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ Main Database Node Connected & Synced"));

app.get('/', (req, res) => res.send('Gateway Active'));

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ['message', 'callback_query', 'chat_member', 'message_reaction', 'message_reaction_count']
}).catch((err) => {
  console.error('❌ Bot polling died, forcing restart:', err.message);
  process.exit(1); // let Render restart the process so polling comes back clean
});
