const mongoose = require('mongoose');


const ReferralEarningSchema = new mongoose.Schema({
    referrerId: { type: Number, required: true, index: true },
    friendId: { type: Number, required: true, index: true },
    totalEarned: { type: Number, default: 0 },
    lastEarnedAt: { type: Date, default: Date.now }
});

ReferralEarningSchema.index({ referrerId: 1, friendId: 1 }, { unique: true });

const ReferralEarning = mongoose.models.ReferralEarning || mongoose.model('ReferralEarning', ReferralEarningSchema);

module.exports = ReferralEarning;
