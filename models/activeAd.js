const mongoose = require('mongoose');


// Track which ad units we're currently offering
const ActiveAd = mongoose.model('ActiveAd', new mongoose.Schema({
    adId:               { type: String, unique: true, required: true },
    network:            { type: String, enum: ['adgrams', 'google_ads'] },
    unitId:             { type: String, required: true },
    reward:             { type: Number, required: true },        // DASH per view
    resetIntervalHours: { type: Number, default: 24 },          // reset every N hours
    watchesPerReset:    { type: Number, default: 2 },           // watches allowed per reset period
    enabled:            { type: Boolean, default: true },
    createdAt:          { type: Date, default: Date.now }
}));

module.exports = ActiveAd;
