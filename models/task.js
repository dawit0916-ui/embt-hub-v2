const mongoose = require('mongoose');


const Task = mongoose.model('Task', new mongoose.Schema({
    id: String, 
    title: String, 
    description: String,
    image: String,      // Fixed: Explicitly declare image string tracking
    category: String,
    url: String, 
    reward: Number, 
    type: String, 
    completions: { type: Number, default: 0 }, 
    max_users: Number,
    enabled: { type: Boolean, default: true }
}));

module.exports = Task;
