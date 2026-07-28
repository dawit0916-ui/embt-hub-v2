const mongoose = require('mongoose');


// Track feature usage per user (for per-use charges)
const FeatureUsageLog = mongoose.model('FeatureUsageLog', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    feature: { type: String, required: true },  // 'custom_task', 'weekly_task', etc
    cost: { type: Number, required: true },
    metadata: { type: Object, default: {} },    // task_id, duration, etc
    createdAt: { type: Date, default: Date.now }
}));

module.exports = FeatureUsageLog;
