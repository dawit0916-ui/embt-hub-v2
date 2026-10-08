const mongoose = require('mongoose');

const WeeklyPayoutSchema = new mongoose.Schema({
    week_key: { type: String, required: true },
    category: { type: String, enum: ['earners', 'inviters'], required: true },
    winners: [{
        _id: false,
        rank: Number,
        user_id: Number,
        score: Number,
        prize: Number,
        paid: { type: Boolean, default: false }
    }],
    createdAt: { type: Date, default: Date.now }
});

// One payout record per week per category = idempotent payouts
WeeklyPayoutSchema.index({ week_key: 1, category: 1 }, { unique: true });

module.exports = mongoose.models.WeeklyPayout || mongoose.model('WeeklyPayout', WeeklyPayoutSchema);
