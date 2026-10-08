const mongoose = require('mongoose');

const Settings = mongoose.model('Settings', new mongoose.Schema({
    min_withdraw: { type: Number, default: 0.2 },
    ref_bonus: { type: Number, default: 0.1 },
    penalty_fee: { type: Number, default: 0.1 },
    withdrawals_enabled: { type: Boolean, default: true },
    maintenance_mode: { type: Boolean, default: false },
    ref_commission_percent: { type: Number, default: 10 },
    ref_bonus_amount: { type: Number, default: 0.05 },
    ref_tasks_required: { type: Number, default: 3 },
    weekly_rewards_enabled: { type: Boolean, default: false },
    weekly_earner_prizes: { type: [Number], default: [0, 0, 0, 0, 0] },
    weekly_inviter_prizes: { type: [Number], default: [0, 0, 0, 0, 0] },
    weekly_min_earned: { type: Number, default: 0 },
    weekly_min_invites: { type: Number, default: 1 }
}));

module.exports = Settings;
