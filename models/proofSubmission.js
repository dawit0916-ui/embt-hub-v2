const mongoose = require('mongoose');


const ProofSubmission = mongoose.model('ProofSubmission', new mongoose.Schema({
    proofId: { type: String, unique: true, default: () => 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase() },
    userId: { type: Number, required: true, index: true },
    username: { type: String, default: null },
    taskId: { type: String, required: true },
    taskTitle: { type: String, default: '' },
    reward: { type: Number, default: 0 },
    proofType: { type: String, enum: ['text', 'screenshot'], default: 'text' },
    proofText: { type: String, default: null },
    telegramFileId: { type: String, default: null },
    channelMessageId: { type: Number, default: null },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null }
}));

module.exports = ProofSubmission;
