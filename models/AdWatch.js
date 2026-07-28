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
    createdAt:       { type: Date, default: Date.now, expires: 600 } // auto-delete after 10 min
}));

module.exports = AdWatch;
