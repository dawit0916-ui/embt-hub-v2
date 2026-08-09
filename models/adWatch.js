const mongoose = require('mongoose');


// --- ADD AFTER YOUR EXISTING MODELS ---

const AdWatch = mongoose.model('AdWatch', new mongoose.Schema({
    sessionId:       { type: String, unique: true, required: true },
    userId:          { type: Number, required: true, index: true },
    adId:            { type: String, required: true },
    adNetwork:       { type: String, default: 'adgrams' },
    reward:          { type: Number, required: true },
    serverConfirmed: { type: Boolean, default: false }, // set by S2S postback
    clientDone:      { type: Boolean, default: false }, // set by browser
    claimed:         { type: Boolean, default: false },
    blurDetected: { type: Boolean, default: false }, // audit only
    createdAt:       { type: Date, default: Date.now }
    // NOTE: this used to auto-delete after 10 minutes via a TTL index
    // (`expires: 600`). That was meant to clean up abandoned/incomplete
    // sessions, but this same collection is also how watchesPerReset gets
    // counted against each ad's admin-configured resetIntervalHours — so a
    // claimed watch record needs to survive for the FULL reset period
    // (could be 24h, 12h, whatever the admin sets), not get wiped after 10
    // minutes. The TTL was silently making any reset period longer than 10
    // minutes unenforceable. Abandoned-session cleanup now happens via a
    // scheduled job (bot/adWatchCleanup.js) that only removes old,
    // never-claimed sessions — claimed records are never touched.
}));

module.exports = AdWatch;
