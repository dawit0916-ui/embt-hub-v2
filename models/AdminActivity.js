const mongoose = require('mongoose');

const AdminActivity = mongoose.model('AdminActivity', new mongoose.Schema({
    admin_id: Number,
    admin_name: String,
    action: String,
    description: String,
    timestamp: { type: Date, default: Date.now }
}));

module.exports = AdminActivity;
