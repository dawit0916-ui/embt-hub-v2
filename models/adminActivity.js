const mongoose = require('mongoose');

const AdminActivity = mongoose.model('AdminActivity', new mongoose.Schema({
    admin_id: Number,
    admin_name: String,
    action: String,
    description: String,
    // NEW: which user was edited + exactly what changed
    target_user_id: { type: Number, default: null, index: true },
    changes: [{ _id: false, field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }],
    timestamp: { type: Date, default: Date.now }
}));

module.exports = AdminActivity;
