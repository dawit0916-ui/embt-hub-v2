const mongoose = require('mongoose');

// Level System Configuration
const LevelConfig = mongoose.model('LevelConfig', new mongoose.Schema({
    level: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    cost: { type: Number, required: true },
    features: [String],              // ['daily_tasks', 'custom_tasks', etc]
    daily_task_limit: { type: Number, default: 1 },
    daily_task_reward: { type: Number, required: true },
    cost_discount_percent: { type: Number, default: 100 },  // 100 = no discount, 80 = 20% off
    commission_percent: { type: Number, default: 5 },
    createdAt: { type: Date, default: Date.now }
}));

module.exports = LevelConfig;
