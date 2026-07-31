const mongoose = require('mongoose');


const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, 
    title: String, 
    description: String,
    image: String,      // Fixed: Explicitly declare image string tracking
    category: String,
    url: String, 
    reward: Number, 
    type: String,        // 'auto' | 'manual' | 'daily' | 'custom'
    duration: String,    // null | 'weekly' | 'monthly' | 'three_month' — gates by level in claim-task
    completions: { type: Number, default: 0 }, 
    max_users: Number,
    enabled: { type: Boolean, default: true }
}));

module.exports = Task;
