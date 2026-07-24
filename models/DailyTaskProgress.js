const mongoose = require('mongoose');


const DailyTaskProgress = mongoose.model('DailyTaskProgress', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    taskId: { type: String, required: true },
    completedCount: { type: Number, default: 0 },
    claimedToday: { type: Boolean, default: false },
    resetAt: { type: Date, required: true }, // When this daily task resets (next UTC midnight)
    lastCompletedAt: { type: Date, default: null }
}));

module.exports = DailyTaskProgress;
