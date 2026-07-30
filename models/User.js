const mongoose = require('mongoose');


// --- DATABASE SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
    user_id: { type: Number, index: true },
    first_name: { type: String, default: null },
    username: { type: String, default: null },
    balance: { type: Number, default: 0 },
    
    total_earned: { type: Number, default: 0 },
    completed_tasks: [String],
    current_state: String,
    pending_message_cleanup: { type: [Number], default: [] },
    red_flag: { type: Boolean, default: false },
    referralCount: { type: Number, default: 0 },
    
    history: [{ type: Object }], 
    createdAt: { type: Date, default: Date.now },
    referral_tasks_done: { type: Number, default: 0 },
    referral_paid: { type: Boolean, default: false },
    penalized_tasks: [String],
    is_banned: { type: Boolean, default: false },
    last_admin_active: { type: Date, default: null },
    
    whitelisted: { type: Boolean, default: false },
    
    referred_by: { type: Number, default: null },
    level: { type: Number, default: 0 },  // 0 = free, 1-10 = paid tiers
    purchased_levels: [Number],           // [1,2,3] = owns these levels
    level_purchase_history: [{
        level: Number,
        purchased_at: { type: Date, default: Date.now },
        cost: Number
    }],
    features_unlocked: {
        daily_tasks: { type: Boolean, default: false },
        custom_tasks: { type: Boolean, default: false },
        weekly_tasks: { type: Boolean, default: false },
        monthly_tasks: { type: Boolean, default: false },
        three_month_tasks: { type: Boolean, default: false },
        whitelist: { type: Boolean, default: false },
        analytics: { type: Boolean, default: false },
        youtube_tasks: { type: Boolean, default: false },
        priority_support: { type: Boolean, default: false }
    }
}));

module.exports = User;
