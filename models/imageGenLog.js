const mongoose = require('mongoose');

const ImageGenLog = mongoose.model('ImageGenLog', new mongoose.Schema({
    userId: { type: Number, index: true, required: true },
    styleId: { type: String, required: true },
    cost: { type: Number, required: true },
    status: { type: String, enum: ['success', 'refunded', 'failed'], default: 'success' },
    resultFileId: { type: String, default: null }, // Telegram file_id, set async by the archive step
    createdAt: { type: Date, default: Date.now }
}));

module.exports = ImageGenLog;
