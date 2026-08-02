const mongoose = require('mongoose');

const CompletedTask = mongoose.model('CompletedTask', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    taskType: { type: String, required: true },  // 'comment' or 'reaction'
    taskKey: { type: String, required: true },   // stable per-task id, e.g. 'comment_CRYPTO2026' or 'reaction_4821'
    dateKey: { type: String, required: true },   // 'YYYY-MM-DD' — lets the same task be redone on a new day
    createdAt: { type: Date, default: Date.now }
}).index({ userId: 1, taskType: 1, taskKey: 1, dateKey: 1 }, { unique: true })); // Prevents double-claiming same task same day

module.exports = CompletedTask;
