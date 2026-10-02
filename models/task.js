const mongoose = require('mongoose');

const Task = mongoose.model('Task', new mongoose.Schema({
    id: String,
    title: String,
    description: String,
    image: String,
    category: String,
    url: String,
    reward: Number,
    type: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    proof_type: { type: String, enum: ['text', 'screenshot', 'either'], default: 'either' }, // manual only
    max_users: { type: Number, default: null },   // null = unlimited
    completions: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true }
}));

module.exports = Task;
