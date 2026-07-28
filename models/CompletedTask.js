const mongoose = require('mongoose');

const CompletedTask = mongoose.model('CompletedTask', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    taskType: { type: String, required: true },  // 'comment' or 'reaction'
    taskKey: { type: String, required: true },   // 'YYYY-MM-DD' or 'message_id'
    createdAt: { type: Date, default: Date.now }
}).index({ userId: 1, taskType: 1, taskKey: 1 }, { unique: true })); // Prevents double-claiming

module.exports = CompletedTask;
